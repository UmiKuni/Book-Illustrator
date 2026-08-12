import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp, type AppContext } from "../src/app.js";
import type {
  GeminiBookReference,
  GeminiChapterOutput,
  GeminiCharacterOutput,
  GeminiGeneratedStyle,
  GeminiImageOutput,
  GeminiInteractionReference,
  GeminiProvider,
} from "../src/gemini.js";
import { LocalStore } from "../src/local-store.js";
import { PipelineService } from "../src/pipeline.js";

const PORTRAIT_IMAGE = Buffer.from("mole-portrait-bytes").toString("base64");

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
  readonly portraitContextStyles: string[] = [];
  readonly portraitContexts: string[] = [];
  readonly chapterContexts: string[] = [];
  chapterOutput: string | undefined = JSON.stringify([
    {
      name: "The River Bank",
      prompt: "Mole meets Rat beside the sparkling river in one warm watercolor scene.",
    },
  ]);
  failChapterCount = 0;
  chapterGate: Deferred | undefined;
  chapterStarted: Deferred | undefined;

  async uploadBook(bookPath: string): Promise<GeminiBookReference> {
    this.uploadedBooks.push(bookPath);
    return { uri: `gemini://book-${this.uploadedBooks.length}` };
  }

  async createBookInteraction(bookUri: string): Promise<GeminiInteractionReference> {
    this.bookInteractionUris.push(bookUri);
    return { interactionId: `book-interaction-${this.bookInteractionUris.length}` };
  }

  async generateStyle(_bookInteractionId: string): Promise<GeminiGeneratedStyle> {
    return { interactionId: "generated-style-interaction", style: "Generated style" };
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
    return {
      interactionId: `characters-interaction-${this.characterContexts.length}`,
      outputText: JSON.stringify([
        { name: "Mole", prompt: "A gentle adult mole in a velvet coat" },
      ]),
    };
  }

  async generateChapters(characterInteractionId: string): Promise<GeminiChapterOutput> {
    this.chapterContexts.push(characterInteractionId);
    this.chapterStarted?.resolve();
    if (this.chapterGate) {
      await this.chapterGate.promise;
    }
    if (this.failChapterCount > 0) {
      this.failChapterCount -= 1;
      throw new Error("Chapter provider unavailable");
    }
    return {
      interactionId: `chapter-interaction-${this.chapterContexts.length}`,
      outputText: this.chapterOutput,
    };
  }

  async createPortraitContext(style: string): Promise<GeminiInteractionReference> {
    this.portraitContextStyles.push(style);
    return { interactionId: `image-context-${this.portraitContextStyles.length}` };
  }

  async generatePortrait(
    previousInteractionId: string,
    _characterName: string,
    _characterPrompt: string,
  ): Promise<GeminiImageOutput> {
    this.portraitContexts.push(previousInteractionId);
    return {
      interactionId: `portrait-interaction-${this.portraitContexts.length}`,
      imageData: PORTRAIT_IMAGE,
      mimeType: "image/jpeg",
    };
  }
}

let context: AppContext;
let dataDirectory: string;
let fakeGemini: FakeGeminiProvider;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-chapters-"));
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

async function completeThroughPortraits(
  agent: ReturnType<typeof request.agent>,
  projectId: string,
): Promise<void> {
  await agent
    .post(`/api/projects/${projectId}/steps/style/run`)
    .send({ style: "Vintage watercolor" })
    .expect(200);
  await agent.post(`/api/projects/${projectId}/steps/characters/run`).send({}).expect(200);
  await agent.post(`/api/projects/${projectId}/steps/portraits/run`).send({}).expect(200);
}

describe("Gemini chapter generation", () => {
  it("rejects Chapters before Portraits succeeds without calling Gemini", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await agent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({ style: "Vintage watercolor" })
      .expect(200);
    await agent.post(`/api/projects/${projectId}/steps/characters/run`).send({}).expect(200);

    const response = await agent
      .post(`/api/projects/${projectId}/steps/chapters/run`)
      .send({})
      .expect(409);

    expect(response.body.error).toBe("Previous pipeline steps must succeed first.");
    expect(fakeGemini.chapterContexts).toEqual([]);
  });

  it("uses Characters text context, caps output at one, persists it, and survives restart", async () => {
    fakeGemini.chapterOutput = JSON.stringify([
      {
        name: "  The River Bank  ",
        prompt: "  Mole meets Rat beside the sparkling river in one watercolor scene.  ",
      },
      {
        name: "The Wild Wood",
        prompt: "A second scene that must not be retained.",
      },
    ]);
    const firstAgent = request.agent(context.app);
    const session = await signIn(firstAgent);
    const projectId = await createProject(firstAgent);
    await completeThroughPortraits(firstAgent, projectId);

    const executed = await firstAgent
      .post(`/api/projects/${projectId}/steps/chapters/run`)
      .send({})
      .expect(200);

    const expectedChapter = {
      position: 0,
      name: "The River Bank",
      prompt: "Mole meets Rat beside the sparkling river in one watercolor scene.",
    };
    expect(executed.body).toMatchObject({
      step: { name: "CHAPTERS", state: "SUCCEEDED", attemptCount: 1 },
      chapters: [expectedChapter],
    });
    expect(fakeGemini.chapterContexts).toEqual(["characters-interaction-1"]);

    context.close();
    context = createApp({ dataDirectory, geminiProvider: fakeGemini });
    const resumedAgent = request.agent(context.app);
    await signIn(resumedAgent);
    const detail = await resumedAgent.get(`/api/projects/${projectId}`).expect(200);
    expect(detail.body.project.chapters).toEqual([expectedChapter]);

    const reader = new LocalStore(dataDirectory);
    expect(reader.getChapterProject(session.body.user.id, projectId)).toEqual({
      id: projectId,
      characterInteractionId: "characters-interaction-1",
      chapterInteractionId: "chapter-interaction-1",
      chapters: [expectedChapter],
    });
    reader.close();
  });

  it.each([
    ["missing output", undefined],
    ["malformed JSON", "[{"],
    ["a wrapper object", JSON.stringify({ chapters: [] })],
    ["an empty array", JSON.stringify([])],
    ["an invalid retained record", JSON.stringify([{ name: "Chapter One", prompt: "  " }])],
  ])("leaves no partial chapter data for %s", async (_caseName, output) => {
    fakeGemini.chapterOutput = output;
    const agent = request.agent(context.app);
    const session = await signIn(agent);
    const projectId = await createProject(agent);
    await completeThroughPortraits(agent, projectId);

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/chapters/run`)
      .send({})
      .expect(502);

    expect(failed.body).toMatchObject({
      step: { name: "CHAPTERS", state: "FAILED", attemptCount: 1 },
      chapters: [],
    });
    const reader = new LocalStore(dataDirectory);
    expect(reader.getChapterProject(session.body.user.id, projectId)).toMatchObject({
      chapterInteractionId: null,
      chapters: [],
    });
    reader.close();
  });

  it("retries provider failure from Characters context without rerunning earlier steps", async () => {
    fakeGemini.failChapterCount = 1;
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeThroughPortraits(agent, projectId);

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/chapters/run`)
      .send({})
      .expect(502);
    expect(failed.body).toMatchObject({
      error: "Chapter provider unavailable",
      step: { state: "FAILED", attemptCount: 1 },
      chapters: [],
    });

    const retried = await agent
      .post(`/api/projects/${projectId}/steps/chapters/run`)
      .send({})
      .expect(200);
    expect(retried.body.step).toMatchObject({ state: "SUCCEEDED", attemptCount: 2 });
    expect(fakeGemini.chapterContexts).toEqual([
      "characters-interaction-1",
      "characters-interaction-1",
    ]);
    expect(fakeGemini.uploadedBooks).toHaveLength(1);
    expect(fakeGemini.suppliedStyleContexts).toHaveLength(1);
    expect(fakeGemini.characterContexts).toHaveLength(1);
    expect(fakeGemini.portraitContextStyles).toHaveLength(1);
    expect(fakeGemini.portraitContexts).toHaveLength(1);
  });

  it("fails clearly when persisted Characters text context is missing", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    const store = new LocalStore(dataDirectory);
    const pipeline = new PipelineService(store);
    for (const step of ["STYLE", "CHARACTERS", "PORTRAITS"] as const) {
      pipeline.startStep(projectId, step);
      pipeline.succeedStep(projectId, step);
    }
    store.close();

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/chapters/run`)
      .send({})
      .expect(502);
    expect(failed.body).toMatchObject({
      error: "Persisted Characters interaction context is missing; Chapters cannot continue.",
      step: { name: "CHAPTERS", state: "FAILED", attemptCount: 1 },
      chapters: [],
    });
    expect(fakeGemini.chapterContexts).toEqual([]);
  });

  it("starts chapter provider work only once for overlapping requests", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeThroughPortraits(agent, projectId);
    fakeGemini.chapterGate = deferred();
    fakeGemini.chapterStarted = deferred();

    const firstRequest = agent
      .post(`/api/projects/${projectId}/steps/chapters/run`)
      .send({})
      .then((response) => response);
    await fakeGemini.chapterStarted.promise;

    const duplicate = await agent
      .post(`/api/projects/${projectId}/steps/chapters/run`)
      .send({})
      .expect(409);
    expect(duplicate.body).toMatchObject({
      error: "Chapters are already running.",
      step: { name: "CHAPTERS", state: "RUNNING", attemptCount: 1 },
      chapters: [],
    });
    expect(fakeGemini.chapterContexts).toEqual(["characters-interaction-1"]);

    fakeGemini.chapterGate.resolve();
    await expect(firstRequest).resolves.toMatchObject({ status: 200 });
  });

  it("does not allow another user to execute Chapters", async () => {
    const owner = request.agent(context.app);
    const otherUser = request.agent(context.app);
    await signIn(owner, "Owner", "owner@example.com");
    await signIn(otherUser, "Other", "other@example.com");
    const projectId = await createProject(owner);
    await completeThroughPortraits(owner, projectId);

    await otherUser.post(`/api/projects/${projectId}/steps/chapters/run`).send({}).expect(404);
    expect(fakeGemini.chapterContexts).toEqual([]);
  });
});
