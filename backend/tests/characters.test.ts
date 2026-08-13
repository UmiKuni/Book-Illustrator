import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp, type AppContext } from "../src/app/create-app.js";
import type {
  GeminiBookReference,
  GeminiChapterOutput,
  GeminiCharacterOutput,
  GeminiGeneratedStyle,
  GeminiImageOutput,
  GeminiInteractionReference,
  GeminiProvider,
} from "../src/integrations/gemini/gemini.js";
import { LocalStore } from "../src/infrastructure/persistence/local-store.js";
import { PipelineService } from "../src/features/pipeline/pipeline.js";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

class FakeGeminiProvider implements GeminiProvider {
  readonly uploadedBooks: string[] = [];
  readonly bookInteractionUris: string[] = [];
  readonly suppliedStyleContexts: Array<{ bookInteractionId: string; style: string }> = [];
  readonly characterContexts: string[] = [];
  characterOutput: string | undefined = JSON.stringify([
    { name: "Mole", prompt: "A gentle adult mole in a velvet coat" },
    { name: "Rat", prompt: "A cheerful adult water rat beside the river" },
  ]);
  failCharacterCount = 0;
  characterGate: Deferred | undefined;
  characterStarted: Deferred | undefined;

  async uploadBook(bookPath: string): Promise<GeminiBookReference> {
    this.uploadedBooks.push(bookPath);
    return { uri: `gemini://book-${this.uploadedBooks.length}` };
  }

  async createBookInteraction(bookUri: string): Promise<GeminiInteractionReference> {
    this.bookInteractionUris.push(bookUri);
    return { interactionId: `book-interaction-${this.bookInteractionUris.length}` };
  }

  async generateStyle(_bookInteractionId: string): Promise<GeminiGeneratedStyle> {
    return {
      interactionId: "generated-style-interaction",
      style: "Generated watercolor style",
    };
  }

  async continueWithStyle(
    bookInteractionId: string,
    style: string,
  ): Promise<GeminiInteractionReference> {
    this.suppliedStyleContexts.push({ bookInteractionId, style });
    return { interactionId: `style-interaction-${this.suppliedStyleContexts.length}` };
  }

  async generateCharacters(styleInteractionId: string): Promise<GeminiCharacterOutput> {
    this.characterContexts.push(styleInteractionId);
    this.characterStarted?.resolve();
    if (this.characterGate) {
      await this.characterGate.promise;
    }
    if (this.failCharacterCount > 0) {
      this.failCharacterCount -= 1;
      throw new Error("Character provider unavailable");
    }
    return {
      interactionId: `characters-interaction-${this.characterContexts.length}`,
      outputText: this.characterOutput,
    };
  }

  async generateChapters(_characterInteractionId: string): Promise<GeminiChapterOutput> {
    throw new Error("Chapter generation is not used by Character tests.");
  }

  async createPortraitContext(_style: string): Promise<GeminiInteractionReference> {
    throw new Error("Portrait generation is not used by Character tests.");
  }

  async generatePortrait(
    _previousInteractionId: string,
    _characterName: string,
    _characterPrompt: string,
  ): Promise<GeminiImageOutput> {
    throw new Error("Portrait generation is not used by Character tests.");
  }

  async createChapterIllustrationContext(
    _previousInteractionId: string,
  ): Promise<GeminiInteractionReference> {
    throw new Error("Illustration generation is not used by Character tests.");
  }

  async generateChapterIllustration(
    _previousInteractionId: string,
    _chapterName: string,
    _chapterPrompt: string,
  ): Promise<GeminiImageOutput> {
    throw new Error("Illustration generation is not used by Character tests.");
  }
}

let context: AppContext;
let dataDirectory: string;
let fakeGemini: FakeGeminiProvider;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-characters-"));
  fakeGemini = new FakeGeminiProvider();
  context = createApp({ dataDirectory, geminiProvider: fakeGemini });
});

afterEach(async () => {
  context.close();
  await rm(dataDirectory, { force: true, recursive: true });
});

async function signIn(
  agent: ReturnType<typeof request.agent>,
  name = "Mira Hassan",
  email = "mira@example.com",
) {
  return agent.post("/api/session").send({ name, email }).expect(200);
}

async function createProject(agent: ReturnType<typeof request.agent>): Promise<string> {
  const response = await agent
    .post("/api/projects")
    .send({ title: "The River Bank", bookText: "Once beside the river..." })
    .expect(201);
  return response.body.project.id as string;
}

async function completeStyle(
  agent: ReturnType<typeof request.agent>,
  projectId: string,
): Promise<void> {
  await agent
    .post(`/api/projects/${projectId}/steps/style/run`)
    .send({ style: "Vintage watercolor" })
    .expect(200);
}

describe("Gemini character generation", () => {
  it("rejects Characters before Style succeeds without calling Gemini", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);

    const response = await agent
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .expect(409);

    expect(response.body.error).toBe("Previous pipeline steps must succeed first.");
    expect(fakeGemini.characterContexts).toEqual([]);
    expect(fakeGemini.uploadedBooks).toEqual([]);
  });

  it("fails clearly when a succeeded Style unexpectedly lacks provider context", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    const store = new LocalStore(dataDirectory);
    const pipeline = new PipelineService(store);
    pipeline.startStep(projectId, "STYLE");
    pipeline.succeedStep(projectId, "STYLE");
    store.close();

    const response = await agent
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .expect(502);

    expect(response.body).toMatchObject({
      error: "Persisted Style interaction context is missing; Characters cannot continue.",
      step: { name: "CHARACTERS", state: "FAILED", attemptCount: 1 },
      characters: [],
    });
    expect(fakeGemini.characterContexts).toEqual([]);
    expect(fakeGemini.uploadedBooks).toEqual([]);
  });

  it("persists the first two valid characters in provider order and survives restart", async () => {
    fakeGemini.characterOutput = JSON.stringify([
      { name: "  Mole  ", prompt: "  A gentle adult mole in a velvet coat  " },
      { name: "Rat", prompt: "A cheerful adult water rat beside the river" },
      { name: "Badger", prompt: "A dignified adult badger in the wild wood" },
    ]);
    const firstAgent = request.agent(context.app);
    const session = await signIn(firstAgent);
    const projectId = await createProject(firstAgent);
    await completeStyle(firstAgent, projectId);

    const executed = await firstAgent
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .expect(200);

    const expectedCharacters = [
      {
        position: 0,
        name: "Mole",
        prompt: "A gentle adult mole in a velvet coat",
        portraitState: "PENDING",
        portraitImagePath: null,
        portraitMimeType: null,
        portraitErrorMessage: null,
      },
      {
        position: 1,
        name: "Rat",
        prompt: "A cheerful adult water rat beside the river",
        portraitState: "PENDING",
        portraitImagePath: null,
        portraitMimeType: null,
        portraitErrorMessage: null,
      },
    ];
    expect(executed.body).toMatchObject({
      step: { name: "CHARACTERS", state: "SUCCEEDED", attemptCount: 1 },
      characters: expectedCharacters,
    });
    expect(fakeGemini.characterContexts).toEqual(["style-interaction-1"]);

    context.close();
    context = createApp({ dataDirectory, geminiProvider: fakeGemini });
    const resumedAgent = request.agent(context.app);
    await signIn(resumedAgent);
    const detail = await resumedAgent.get(`/api/projects/${projectId}`).expect(200);
    expect(detail.body.project.characters).toEqual(expectedCharacters);

    const reader = new LocalStore(dataDirectory);
    expect(reader.getCharacterProject(session.body.user.id, projectId)).toMatchObject({
      styleInteractionId: "style-interaction-1",
      characterInteractionId: "characters-interaction-1",
      characters: expectedCharacters,
    });
    reader.close();
  });

  it.each([
    ["missing output", undefined],
    ["malformed JSON", "[{"],
    ["a wrapper object", JSON.stringify({ characters: [] })],
    [
      "a malformed retained record",
      JSON.stringify([
        { name: "Mole", prompt: "A valid first character" },
        { name: "Rat", prompt: "  " },
      ]),
    ],
  ])("leaves no partial records for %s", async (_caseName, output) => {
    fakeGemini.characterOutput = output;
    const agent = request.agent(context.app);
    const session = await signIn(agent);
    const projectId = await createProject(agent);
    await completeStyle(agent, projectId);

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .expect(502);

    expect(failed.body).toMatchObject({
      step: { name: "CHARACTERS", state: "FAILED", attemptCount: 1 },
      characters: [],
    });
    const reader = new LocalStore(dataDirectory);
    expect(reader.getCharacterProject(session.body.user.id, projectId)).toMatchObject({
      characterInteractionId: null,
      characters: [],
    });
    reader.close();
  });

  it("retries provider failure from the same Style context without repeating earlier work", async () => {
    fakeGemini.failCharacterCount = 1;
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeStyle(agent, projectId);

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .expect(502);
    expect(failed.body).toMatchObject({
      error: "Character provider unavailable",
      step: { state: "FAILED", attemptCount: 1 },
    });

    const retried = await agent
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .expect(200);
    expect(retried.body.step).toMatchObject({ state: "SUCCEEDED", attemptCount: 2 });
    expect(fakeGemini.characterContexts).toEqual(["style-interaction-1", "style-interaction-1"]);
    expect(fakeGemini.uploadedBooks).toHaveLength(1);
    expect(fakeGemini.bookInteractionUris).toHaveLength(1);
    expect(fakeGemini.suppliedStyleContexts).toHaveLength(1);
  });

  it("starts character provider work only once for overlapping requests", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeStyle(agent, projectId);
    fakeGemini.characterGate = deferred();
    fakeGemini.characterStarted = deferred();

    const firstRequest = agent
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .then((response) => response);
    await fakeGemini.characterStarted.promise;

    const duplicate = await agent
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .expect(409);
    expect(duplicate.body).toMatchObject({
      error: "Characters are already running.",
      step: { name: "CHARACTERS", state: "RUNNING", attemptCount: 1 },
      characters: [],
    });
    expect(fakeGemini.characterContexts).toEqual(["style-interaction-1"]);

    fakeGemini.characterGate.resolve();
    await expect(firstRequest).resolves.toMatchObject({ status: 200 });
  });

  it("does not allow another user to execute Characters", async () => {
    const owner = request.agent(context.app);
    const otherUser = request.agent(context.app);
    await signIn(owner, "Owner", "owner@example.com");
    await signIn(otherUser, "Other", "other@example.com");
    const projectId = await createProject(owner);
    await completeStyle(owner, projectId);

    await otherUser
      .post(`/api/projects/${projectId}/steps/characters/run`)
      .send({})
      .expect(404);
    expect(fakeGemini.characterContexts).toEqual([]);
  });
});
