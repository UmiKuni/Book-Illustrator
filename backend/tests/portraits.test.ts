import { mkdtemp, readFile, rm } from "node:fs/promises";
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

const MOLE_IMAGE = Buffer.from("mole-portrait-bytes");
const RAT_IMAGE = Buffer.from("rat-portrait-bytes");

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
  readonly portraitRequests: Array<{
    previousInteractionId: string;
    characterName: string;
    characterPrompt: string;
  }> = [];
  readonly failPortraitCalls = new Set<number>();
  characterOutput = JSON.stringify([
    { name: "Mole", prompt: "A gentle adult mole in a velvet coat" },
    { name: "Rat", prompt: "A cheerful adult water rat beside the river" },
  ]);
  portraitOutputs: Array<{ imageData: string | undefined; mimeType: string | undefined }> = [
    { imageData: MOLE_IMAGE.toString("base64"), mimeType: "image/jpeg" },
    { imageData: RAT_IMAGE.toString("base64"), mimeType: "image/png" },
  ];
  portraitGate: Deferred | undefined;
  portraitStarted: Deferred | undefined;
  activePortraitCalls = 0;
  maxActivePortraitCalls = 0;

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
      outputText: this.characterOutput,
    };
  }

  async generateChapters(_characterInteractionId: string): Promise<GeminiChapterOutput> {
    throw new Error("Chapter generation is not used by Portrait tests.");
  }

  async createPortraitContext(style: string): Promise<GeminiInteractionReference> {
    this.portraitContextStyles.push(style);
    return { interactionId: `image-context-${this.portraitContextStyles.length}` };
  }

  async generatePortrait(
    previousInteractionId: string,
    characterName: string,
    characterPrompt: string,
  ): Promise<GeminiImageOutput> {
    this.portraitRequests.push({ previousInteractionId, characterName, characterPrompt });
    const callNumber = this.portraitRequests.length;
    this.activePortraitCalls += 1;
    this.maxActivePortraitCalls = Math.max(
      this.maxActivePortraitCalls,
      this.activePortraitCalls,
    );
    this.portraitStarted?.resolve();

    try {
      if (this.portraitGate) {
        await this.portraitGate.promise;
        this.portraitGate = undefined;
      }
      if (this.failPortraitCalls.delete(callNumber)) {
        throw new Error(`Portrait provider failed on call ${callNumber}`);
      }
      const output = this.portraitOutputs[callNumber - 1] ?? this.portraitOutputs.at(-1) ?? {};
      return {
        interactionId: `portrait-interaction-${callNumber}`,
        imageData: output.imageData,
        mimeType: output.mimeType,
      };
    } finally {
      this.activePortraitCalls -= 1;
    }
  }
}

let context: AppContext;
let dataDirectory: string;
let fakeGemini: FakeGeminiProvider;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-portraits-"));
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

async function completeStyleAndCharacters(
  agent: ReturnType<typeof request.agent>,
  projectId: string,
): Promise<void> {
  await agent
    .post(`/api/projects/${projectId}/steps/style/run`)
    .send({ style: "Vintage watercolor" })
    .expect(200);
  await agent.post(`/api/projects/${projectId}/steps/characters/run`).send({}).expect(200);
}

describe("sequential portrait generation", () => {
  it("rejects Portraits before Characters succeeds without starting image work", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await agent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({ style: "Vintage watercolor" })
      .expect(200);

    const response = await agent
      .post(`/api/projects/${projectId}/steps/portraits/run`)
      .send({})
      .expect(409);

    expect(response.body.error).toBe("Previous pipeline steps must succeed first.");
    expect(fakeGemini.portraitContextStyles).toEqual([]);
    expect(fakeGemini.portraitRequests).toEqual([]);
  });

  it("generates in persisted order, chains image context, and stores bytes and metadata", async () => {
    const agent = request.agent(context.app);
    const session = await signIn(agent);
    const projectId = await createProject(agent);
    await completeStyleAndCharacters(agent, projectId);

    const executed = await agent
      .post(`/api/projects/${projectId}/steps/portraits/run`)
      .send({})
      .expect(200);

    expect(executed.body.step).toMatchObject({
      name: "PORTRAITS",
      state: "SUCCEEDED",
      attemptCount: 1,
    });
    expect(fakeGemini.portraitContextStyles).toEqual(["Vintage watercolor"]);
    expect(fakeGemini.portraitRequests).toEqual([
      {
        previousInteractionId: "image-context-1",
        characterName: "Mole",
        characterPrompt: "A gentle adult mole in a velvet coat",
      },
      {
        previousInteractionId: "portrait-interaction-1",
        characterName: "Rat",
        characterPrompt: "A cheerful adult water rat beside the river",
      },
    ]);
    expect(fakeGemini.maxActivePortraitCalls).toBe(1);

    const [mole, rat] = executed.body.characters;
    expect(mole).toMatchObject({
      portraitState: "SUCCEEDED",
      portraitImagePath: `projects/${projectId}/portraits/0.jpg`,
      portraitMimeType: "image/jpeg",
      portraitErrorMessage: null,
    });
    expect(rat).toMatchObject({
      portraitState: "SUCCEEDED",
      portraitImagePath: `projects/${projectId}/portraits/1.png`,
      portraitMimeType: "image/png",
      portraitErrorMessage: null,
    });
    await expect(
      readFile(path.join(dataDirectory, "projects", projectId, "portraits", "0.jpg")),
    ).resolves.toEqual(MOLE_IMAGE);
    await expect(
      readFile(path.join(dataDirectory, "projects", projectId, "portraits", "1.png")),
    ).resolves.toEqual(RAT_IMAGE);

    const reader = new LocalStore(dataDirectory);
    expect(reader.getPortraitProject(session.body.user.id, projectId)).toMatchObject({
      imageInteractionId: "portrait-interaction-2",
    });
    reader.close();
  });

  it("keeps portrait 1 after portrait 2 fails and resumes only portrait 2 after restart", async () => {
    fakeGemini.failPortraitCalls.add(2);
    const firstAgent = request.agent(context.app);
    const session = await signIn(firstAgent);
    const projectId = await createProject(firstAgent);
    await completeStyleAndCharacters(firstAgent, projectId);

    const failed = await firstAgent
      .post(`/api/projects/${projectId}/steps/portraits/run`)
      .send({})
      .expect(502);

    expect(failed.body).toMatchObject({
      error: "Portrait provider failed on call 2",
      step: { name: "PORTRAITS", state: "FAILED", attemptCount: 1 },
      characters: [
        {
          name: "Mole",
          portraitState: "SUCCEEDED",
          portraitImagePath: `projects/${projectId}/portraits/0.jpg`,
          portraitErrorMessage: null,
        },
        {
          name: "Rat",
          portraitState: "FAILED",
          portraitImagePath: null,
          portraitErrorMessage: "Portrait provider failed on call 2",
        },
      ],
    });
    await expect(
      readFile(path.join(dataDirectory, "projects", projectId, "portraits", "0.jpg")),
    ).resolves.toEqual(MOLE_IMAGE);

    context.close();
    context = createApp({ dataDirectory, geminiProvider: fakeGemini });
    const resumedAgent = request.agent(context.app);
    await signIn(resumedAgent);
    const reloaded = await resumedAgent.get(`/api/projects/${projectId}`).expect(200);
    expect(reloaded.body.project.characters).toEqual(failed.body.characters);

    const beforeRetry = new LocalStore(dataDirectory);
    expect(beforeRetry.getPortraitProject(session.body.user.id, projectId)).toMatchObject({
      imageInteractionId: "portrait-interaction-1",
    });
    beforeRetry.close();

    const retried = await resumedAgent
      .post(`/api/projects/${projectId}/steps/portraits/run`)
      .send({})
      .expect(200);

    expect(retried.body.step).toMatchObject({ state: "SUCCEEDED", attemptCount: 2 });
    expect(retried.body.characters[0]).toEqual(failed.body.characters[0]);
    expect(retried.body.characters[1]).toMatchObject({
      name: "Rat",
      portraitState: "SUCCEEDED",
      portraitImagePath: `projects/${projectId}/portraits/1.png`,
      portraitMimeType: "image/png",
      portraitErrorMessage: null,
    });
    expect(fakeGemini.portraitContextStyles).toEqual(["Vintage watercolor"]);
    expect(fakeGemini.portraitRequests.map((call) => call.characterName)).toEqual([
      "Mole",
      "Rat",
      "Rat",
    ]);
    expect(fakeGemini.portraitRequests[2]?.previousInteractionId).toBe(
      "portrait-interaction-1",
    );
    expect(fakeGemini.uploadedBooks).toHaveLength(1);
    expect(fakeGemini.characterContexts).toHaveLength(1);
    await expect(
      readFile(path.join(dataDirectory, "projects", projectId, "portraits", "1.png")),
    ).resolves.toEqual(RAT_IMAGE);
  });

  it.each([
    ["missing image data", { imageData: undefined, mimeType: "image/png" }],
    [
      "unsupported image type",
      { imageData: MOLE_IMAGE.toString("base64"), mimeType: "text/plain" },
    ],
  ])("treats %s as retryable item failure", async (_caseName, invalidOutput) => {
    fakeGemini.portraitOutputs[0] = invalidOutput;
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeStyleAndCharacters(agent, projectId);

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/portraits/run`)
      .send({})
      .expect(502);
    expect(failed.body.step).toMatchObject({ state: "FAILED", attemptCount: 1 });
    expect(failed.body.characters).toEqual([
      expect.objectContaining({ name: "Mole", portraitState: "FAILED" }),
      expect.objectContaining({ name: "Rat", portraitState: "PENDING" }),
    ]);

    fakeGemini.portraitOutputs[1] = {
      imageData: MOLE_IMAGE.toString("base64"),
      mimeType: "image/jpeg",
    };
    fakeGemini.portraitOutputs[2] = {
      imageData: RAT_IMAGE.toString("base64"),
      mimeType: "image/png",
    };
    const retried = await agent
      .post(`/api/projects/${projectId}/steps/portraits/run`)
      .send({})
      .expect(200);
    expect(retried.body.step).toMatchObject({ state: "SUCCEEDED", attemptCount: 2 });
  });

  it("starts portrait provider work only once for overlapping requests", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeStyleAndCharacters(agent, projectId);
    fakeGemini.portraitGate = deferred();
    fakeGemini.portraitStarted = deferred();

    const firstRequest = agent
      .post(`/api/projects/${projectId}/steps/portraits/run`)
      .send({})
      .then((response) => response);
    await fakeGemini.portraitStarted.promise;

    const duplicate = await agent
      .post(`/api/projects/${projectId}/steps/portraits/run`)
      .send({})
      .expect(409);
    expect(duplicate.body).toMatchObject({
      error: "Portraits are already running.",
      step: { name: "PORTRAITS", state: "RUNNING", attemptCount: 1 },
      characters: [
        expect.objectContaining({ name: "Mole", portraitState: "RUNNING" }),
        expect.objectContaining({ name: "Rat", portraitState: "PENDING" }),
      ],
    });
    expect(fakeGemini.portraitContextStyles).toHaveLength(1);
    expect(fakeGemini.portraitRequests).toHaveLength(1);

    fakeGemini.portraitGate.resolve();
    await expect(firstRequest).resolves.toMatchObject({ status: 200 });
  });

  it("does not allow another user to execute Portraits", async () => {
    const owner = request.agent(context.app);
    const otherUser = request.agent(context.app);
    await signIn(owner, "Owner", "owner@example.com");
    await signIn(otherUser, "Other", "other@example.com");
    const projectId = await createProject(owner);
    await completeStyleAndCharacters(owner, projectId);

    await otherUser.post(`/api/projects/${projectId}/steps/portraits/run`).send({}).expect(404);
    expect(fakeGemini.portraitContextStyles).toEqual([]);
    expect(fakeGemini.portraitRequests).toEqual([]);
  });
});
