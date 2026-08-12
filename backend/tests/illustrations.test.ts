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
import { PipelineService } from "../src/pipeline.js";

const PORTRAIT_IMAGE = Buffer.from("portrait-image-bytes").toString("base64");
const ILLUSTRATION_IMAGE = Buffer.from("chapter-illustration-bytes");

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
  readonly portraitRequests: Array<{ previousInteractionId: string; name: string }> = [];
  readonly chapterContexts: string[] = [];
  readonly chapterImageContextParents: string[] = [];
  readonly illustrationRequests: Array<{
    previousInteractionId: string;
    chapterName: string;
    chapterPrompt: string;
  }> = [];
  illustrationOutputs: Array<{
    imageData: string | undefined;
    mimeType: string | undefined;
  }> = [
    {
      imageData: ILLUSTRATION_IMAGE.toString("base64"),
      mimeType: "image/jpeg",
    },
  ];
  failIllustrationCount = 0;
  illustrationGate: Deferred | undefined;
  illustrationStarted: Deferred | undefined;

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
        { name: "Rat", prompt: "A cheerful adult water rat beside the river" },
      ]),
    };
  }

  async generateChapters(characterInteractionId: string): Promise<GeminiChapterOutput> {
    this.chapterContexts.push(characterInteractionId);
    return {
      interactionId: `chapter-interaction-${this.chapterContexts.length}`,
      outputText: JSON.stringify([
        {
          name: "The River Bank",
          prompt: "Mole and Rat meet beside the sparkling river in one watercolor scene.",
        },
      ]),
    };
  }

  async createPortraitContext(style: string): Promise<GeminiInteractionReference> {
    this.portraitContextStyles.push(style);
    return { interactionId: `image-context-${this.portraitContextStyles.length}` };
  }

  async generatePortrait(
    previousInteractionId: string,
    characterName: string,
    _characterPrompt: string,
  ): Promise<GeminiImageOutput> {
    this.portraitRequests.push({ previousInteractionId, name: characterName });
    return {
      interactionId: `portrait-interaction-${this.portraitRequests.length}`,
      imageData: PORTRAIT_IMAGE,
      mimeType: "image/jpeg",
    };
  }

  async createChapterIllustrationContext(
    previousInteractionId: string,
  ): Promise<GeminiInteractionReference> {
    this.chapterImageContextParents.push(previousInteractionId);
    return {
      interactionId: `chapter-image-context-${this.chapterImageContextParents.length}`,
    };
  }

  async generateChapterIllustration(
    previousInteractionId: string,
    chapterName: string,
    chapterPrompt: string,
  ): Promise<GeminiImageOutput> {
    this.illustrationRequests.push({ previousInteractionId, chapterName, chapterPrompt });
    const callNumber = this.illustrationRequests.length;
    this.illustrationStarted?.resolve();
    if (this.illustrationGate) {
      await this.illustrationGate.promise;
      this.illustrationGate = undefined;
    }
    if (this.failIllustrationCount > 0) {
      this.failIllustrationCount -= 1;
      throw new Error("Illustration provider unavailable");
    }
    const output =
      this.illustrationOutputs[callNumber - 1] ?? this.illustrationOutputs.at(-1) ?? {};
    return {
      interactionId: `illustration-interaction-${callNumber}`,
      imageData: output.imageData,
      mimeType: output.mimeType,
    };
  }
}

let context: AppContext;
let dataDirectory: string;
let fakeGemini: FakeGeminiProvider;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-illustrations-"));
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

async function completeThroughChapters(
  agent: ReturnType<typeof request.agent>,
  projectId: string,
): Promise<void> {
  await completeThroughPortraits(agent, projectId);
  await agent.post(`/api/projects/${projectId}/steps/chapters/run`).send({}).expect(200);
}

describe("Gemini chapter illustration generation", () => {
  it("rejects Illustrations before Chapters succeeds without starting image work", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeThroughPortraits(agent, projectId);

    const response = await agent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .expect(409);

    expect(response.body.error).toBe("Previous pipeline steps must succeed first.");
    expect(fakeGemini.chapterImageContextParents).toEqual([]);
    expect(fakeGemini.illustrationRequests).toEqual([]);
  });

  it("persists context before generation, stores the core-flow image, and survives restart", async () => {
    const agent = request.agent(context.app);
    const session = await signIn(agent);
    const projectId = await createProject(agent);
    await completeThroughChapters(agent, projectId);
    fakeGemini.illustrationGate = deferred();
    fakeGemini.illustrationStarted = deferred();

    const execution = agent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .then((response) => response);
    await fakeGemini.illustrationStarted.promise;

    expect(fakeGemini.chapterImageContextParents).toEqual(["portrait-interaction-2"]);
    expect(fakeGemini.illustrationRequests).toEqual([
      {
        previousInteractionId: "chapter-image-context-1",
        chapterName: "The River Bank",
        chapterPrompt:
          "Mole and Rat meet beside the sparkling river in one watercolor scene.",
      },
    ]);
    expect(fakeGemini.illustrationRequests[0]?.previousInteractionId).not.toBe(
      "chapter-interaction-1",
    );

    const duringGeneration = new LocalStore(dataDirectory);
    expect(
      duringGeneration.getIllustrationProject(session.body.user.id, projectId),
    ).toMatchObject({
      imageInteractionId: "portrait-interaction-2",
      chapterImageContextId: "chapter-image-context-1",
    });
    duringGeneration.close();

    fakeGemini.illustrationGate.resolve();
    const executed = await execution;
    expect(executed.status).toBe(200);
    expect(executed.body).toMatchObject({
      step: { name: "ILLUSTRATIONS", state: "SUCCEEDED", attemptCount: 1 },
      chapters: [
        {
          position: 0,
          illustrationImagePath: `projects/${projectId}/illustrations/0.jpg`,
          illustrationMimeType: "image/jpeg",
        },
      ],
    });
    await expect(
      readFile(path.join(dataDirectory, "projects", projectId, "illustrations", "0.jpg")),
    ).resolves.toEqual(ILLUSTRATION_IMAGE);

    context.close();
    context = createApp({ dataDirectory, geminiProvider: fakeGemini });
    const resumedAgent = request.agent(context.app);
    await signIn(resumedAgent);
    const detail = await resumedAgent.get(`/api/projects/${projectId}`).expect(200);
    expect(detail.body.project).toMatchObject({
      status: "Done",
      completedSteps: 5,
      chapters: [
        {
          illustrationImagePath: `projects/${projectId}/illustrations/0.jpg`,
          illustrationMimeType: "image/jpeg",
        },
      ],
    });
  });

  it("reuses persisted chapter image context after final generation fails", async () => {
    fakeGemini.failIllustrationCount = 1;
    const firstAgent = request.agent(context.app);
    const session = await signIn(firstAgent);
    const projectId = await createProject(firstAgent);
    await completeThroughChapters(firstAgent, projectId);

    const failed = await firstAgent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .expect(502);
    expect(failed.body).toMatchObject({
      error: "Illustration provider unavailable",
      step: { name: "ILLUSTRATIONS", state: "FAILED", attemptCount: 1 },
      chapters: [
        { illustrationImagePath: null, illustrationMimeType: null },
      ],
    });

    const afterFailure = new LocalStore(dataDirectory);
    expect(afterFailure.getIllustrationProject(session.body.user.id, projectId)).toMatchObject({
      chapterImageContextId: "chapter-image-context-1",
    });
    afterFailure.close();

    context.close();
    context = createApp({ dataDirectory, geminiProvider: fakeGemini });
    const resumedAgent = request.agent(context.app);
    await signIn(resumedAgent);
    const retried = await resumedAgent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .expect(200);

    expect(retried.body.step).toMatchObject({ state: "SUCCEEDED", attemptCount: 2 });
    expect(fakeGemini.chapterImageContextParents).toEqual(["portrait-interaction-2"]);
    expect(fakeGemini.illustrationRequests.map((call) => call.previousInteractionId)).toEqual([
      "chapter-image-context-1",
      "chapter-image-context-1",
    ]);
    expect(fakeGemini.uploadedBooks).toHaveLength(1);
    expect(fakeGemini.suppliedStyleContexts).toHaveLength(1);
    expect(fakeGemini.characterContexts).toHaveLength(1);
    expect(fakeGemini.portraitRequests).toHaveLength(2);
    expect(fakeGemini.chapterContexts).toHaveLength(1);
  });

  it.each([
    ["missing image data", { imageData: undefined, mimeType: "image/jpeg" }],
    [
      "an unsupported image type",
      { imageData: ILLUSTRATION_IMAGE.toString("base64"), mimeType: "text/plain" },
    ],
    ["malformed image data", { imageData: "%%%", mimeType: "image/png" }],
  ])("leaves %s retryable without illustration metadata", async (_caseName, invalidOutput) => {
    fakeGemini.illustrationOutputs[0] = invalidOutput;
    fakeGemini.illustrationOutputs[1] = {
      imageData: ILLUSTRATION_IMAGE.toString("base64"),
      mimeType: "image/png",
    };
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeThroughChapters(agent, projectId);

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .expect(502);
    expect(failed.body).toMatchObject({
      step: { state: "FAILED", attemptCount: 1 },
      chapters: [{ illustrationImagePath: null, illustrationMimeType: null }],
    });

    const retried = await agent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .expect(200);
    expect(retried.body.step).toMatchObject({ state: "SUCCEEDED", attemptCount: 2 });
    expect(fakeGemini.chapterImageContextParents).toHaveLength(1);
    expect(retried.body.chapters[0]).toMatchObject({
      illustrationImagePath: `projects/${projectId}/illustrations/0.png`,
      illustrationMimeType: "image/png",
    });
  });

  it("fails clearly when Chapters succeeded without a persisted chapter", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeThroughPortraits(agent, projectId);
    const store = new LocalStore(dataDirectory);
    const pipeline = new PipelineService(store);
    pipeline.startStep(projectId, "CHAPTERS");
    pipeline.succeedStep(projectId, "CHAPTERS");
    store.close();

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .expect(502);
    expect(failed.body).toMatchObject({
      error: "Persisted Chapter is missing; Illustrations cannot continue.",
      step: { name: "ILLUSTRATIONS", state: "FAILED", attemptCount: 1 },
      chapters: [],
    });
    expect(fakeGemini.chapterImageContextParents).toEqual([]);
    expect(fakeGemini.illustrationRequests).toEqual([]);
  });

  it("starts illustration image work only once for overlapping requests", async () => {
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = await createProject(agent);
    await completeThroughChapters(agent, projectId);
    fakeGemini.illustrationGate = deferred();
    fakeGemini.illustrationStarted = deferred();

    const firstRequest = agent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .then((response) => response);
    await fakeGemini.illustrationStarted.promise;

    const duplicate = await agent
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .expect(409);
    expect(duplicate.body).toMatchObject({
      error: "Illustrations are already running.",
      step: { name: "ILLUSTRATIONS", state: "RUNNING", attemptCount: 1 },
      chapters: [{ illustrationImagePath: null, illustrationMimeType: null }],
    });
    expect(fakeGemini.chapterImageContextParents).toHaveLength(1);
    expect(fakeGemini.illustrationRequests).toHaveLength(1);

    fakeGemini.illustrationGate.resolve();
    await expect(firstRequest).resolves.toMatchObject({ status: 200 });
  });

  it("does not allow another user to execute Illustrations", async () => {
    const owner = request.agent(context.app);
    const otherUser = request.agent(context.app);
    await signIn(owner, "Owner", "owner@example.com");
    await signIn(otherUser, "Other", "other@example.com");
    const projectId = await createProject(owner);
    await completeThroughChapters(owner, projectId);

    await otherUser
      .post(`/api/projects/${projectId}/steps/illustrations/run`)
      .send({})
      .expect(404);
    expect(fakeGemini.chapterImageContextParents).toEqual([]);
    expect(fakeGemini.illustrationRequests).toEqual([]);
  });
});
