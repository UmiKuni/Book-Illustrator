import { readFile } from "node:fs/promises";
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
import { PipelineRuleError, PipelineService } from "../src/features/pipeline/pipeline.js";

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
  readonly uploadedBookPaths: string[] = [];
  readonly uploadedBookTexts: string[] = [];
  readonly bookInteractionUris: string[] = [];
  readonly generatedStyleContexts: string[] = [];
  readonly suppliedStyleContexts: Array<{ bookInteractionId: string; style: string }> = [];
  failBookInteractionCount = 0;
  failGeneratedStyleCount = 0;
  generatedStyleGate: Deferred | undefined;
  generatedStyleStarted: Deferred | undefined;

  async uploadBook(bookPath: string): Promise<GeminiBookReference> {
    this.uploadedBookPaths.push(bookPath);
    this.uploadedBookTexts.push(await readFile(bookPath, "utf8"));
    return { uri: `gemini://book-${this.uploadedBookPaths.length}` };
  }

  async createBookInteraction(bookUri: string): Promise<GeminiInteractionReference> {
    this.bookInteractionUris.push(bookUri);
    if (this.failBookInteractionCount > 0) {
      this.failBookInteractionCount -= 1;
      throw new Error("Book interaction unavailable");
    }
    return { interactionId: `book-interaction-${this.bookInteractionUris.length}` };
  }

  async generateStyle(bookInteractionId: string): Promise<GeminiGeneratedStyle> {
    this.generatedStyleContexts.push(bookInteractionId);
    this.generatedStyleStarted?.resolve();
    if (this.generatedStyleGate) {
      await this.generatedStyleGate.promise;
    }
    if (this.failGeneratedStyleCount > 0) {
      this.failGeneratedStyleCount -= 1;
      throw new Error("Style provider unavailable");
    }
    return {
      interactionId: `generated-style-interaction-${this.generatedStyleContexts.length}`,
      style: "Warm ink-and-watercolor storybook art",
    };
  }

  async continueWithStyle(
    bookInteractionId: string,
    style: string,
  ): Promise<GeminiInteractionReference> {
    this.suppliedStyleContexts.push({ bookInteractionId, style });
    return {
      interactionId: `supplied-style-interaction-${this.suppliedStyleContexts.length}`,
    };
  }

  async generateCharacters(_styleInteractionId: string): Promise<GeminiCharacterOutput> {
    throw new Error("Character generation is not used by Style tests.");
  }

  async generateChapters(_characterInteractionId: string): Promise<GeminiChapterOutput> {
    throw new Error("Chapter generation is not used by Style tests.");
  }

  async createPortraitContext(_style: string): Promise<GeminiInteractionReference> {
    throw new Error("Portrait generation is not used by Style tests.");
  }

  async generatePortrait(
    _previousInteractionId: string,
    _characterName: string,
    _characterPrompt: string,
  ): Promise<GeminiImageOutput> {
    throw new Error("Portrait generation is not used by Style tests.");
  }

  async createChapterIllustrationContext(
    _previousInteractionId: string,
  ): Promise<GeminiInteractionReference> {
    throw new Error("Illustration generation is not used by Style tests.");
  }

  async generateChapterIllustration(
    _previousInteractionId: string,
    _chapterName: string,
    _chapterPrompt: string,
  ): Promise<GeminiImageOutput> {
    throw new Error("Illustration generation is not used by Style tests.");
  }
}

let context: AppContext;
let dataDirectory: string;
let fakeGemini: FakeGeminiProvider;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-style-"));
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

async function createProject(agent: ReturnType<typeof request.agent>) {
  return agent
    .post("/api/projects")
    .send({ title: "The River Bank", bookText: "Once beside the river..." })
    .expect(201);
}

describe("Gemini book context and Style execution", () => {
  it("initializes book context once, generates Style, persists it, and unlocks the next step", async () => {
    const agent = request.agent(context.app);
    const session = await signIn(agent);
    const created = await createProject(agent);
    const projectId = created.body.project.id as string;

    const orderingStore = new LocalStore(dataDirectory);
    const orderingPipeline = new PipelineService(orderingStore);
    expect(() => orderingPipeline.startStep(projectId, "CHARACTERS")).toThrow(
      new PipelineRuleError("Previous pipeline steps must succeed first."),
    );
    orderingStore.close();

    const executed = await agent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({})
      .expect(200);

    expect(executed.body).toMatchObject({
      style: "Warm ink-and-watercolor storybook art",
      step: { name: "STYLE", state: "SUCCEEDED", attemptCount: 1 },
    });
    expect(fakeGemini.uploadedBookTexts).toEqual(["Once beside the river..."]);
    expect(fakeGemini.bookInteractionUris).toEqual(["gemini://book-1"]);
    expect(fakeGemini.generatedStyleContexts).toEqual(["book-interaction-1"]);

    const persistedStore = new LocalStore(dataDirectory);
    expect(persistedStore.getStyleProject(session.body.user.id, projectId)).toMatchObject({
      geminiBookUri: "gemini://book-1",
      bookInteractionId: "book-interaction-1",
      style: "Warm ink-and-watercolor storybook art",
      styleInteractionId: "generated-style-interaction-1",
    });
    expect(new PipelineService(persistedStore).startStep(projectId, "CHARACTERS")).toMatchObject({
      name: "CHARACTERS",
      state: "RUNNING",
    });
    persistedStore.close();

    const detail = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(detail.body.project.style).toBe("Warm ink-and-watercolor storybook art");
  });

  it("persists the uploaded book URI before creating the book interaction", async () => {
    fakeGemini.failBookInteractionCount = 1;
    const agent = request.agent(context.app);
    const session = await signIn(agent);
    const projectId = (await createProject(agent)).body.project.id as string;

    const failed = await agent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({})
      .expect(502);
    expect(failed.body.step).toMatchObject({ state: "FAILED", attemptCount: 1 });

    const reader = new LocalStore(dataDirectory);
    expect(reader.getStyleProject(session.body.user.id, projectId)).toMatchObject({
      geminiBookUri: "gemini://book-1",
      bookInteractionId: null,
    });
    reader.close();

    await agent.post(`/api/projects/${projectId}/steps/style/run`).send({}).expect(200);
    expect(fakeGemini.uploadedBookPaths).toHaveLength(1);
    expect(fakeGemini.bookInteractionUris).toEqual(["gemini://book-1", "gemini://book-1"]);
  });

  it("keeps provider failure retryable and reuses persisted book context after restart", async () => {
    fakeGemini.failGeneratedStyleCount = 1;
    const firstAgent = request.agent(context.app);
    const session = await signIn(firstAgent);
    const projectId = (await createProject(firstAgent)).body.project.id as string;

    const failed = await firstAgent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({})
      .expect(502);
    expect(failed.body).toMatchObject({
      error: "Style provider unavailable",
      style: null,
      step: { state: "FAILED", attemptCount: 1 },
    });

    context.close();
    context = createApp({ dataDirectory, geminiProvider: fakeGemini });
    const resumedAgent = request.agent(context.app);
    await signIn(resumedAgent);

    const retried = await resumedAgent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({})
      .expect(200);
    expect(retried.body.step).toMatchObject({ state: "SUCCEEDED", attemptCount: 2 });
    expect(fakeGemini.uploadedBookPaths).toHaveLength(1);
    expect(fakeGemini.bookInteractionUris).toHaveLength(1);
    expect(fakeGemini.generatedStyleContexts).toEqual([
      "book-interaction-1",
      "book-interaction-1",
    ]);

    const reloadedStore = new LocalStore(dataDirectory);
    expect(reloadedStore.getStyleProject(session.body.user.id, projectId)).toMatchObject({
      geminiBookUri: "gemini://book-1",
      bookInteractionId: "book-interaction-1",
      style: "Warm ink-and-watercolor storybook art",
      styleInteractionId: "generated-style-interaction-2",
    });
    reloadedStore.close();
  });

  it("places a supplied Style in the continued Gemini context and persists it", async () => {
    const agent = request.agent(context.app);
    const session = await signIn(agent);
    const projectId = (await createProject(agent)).body.project.id as string;

    const executed = await agent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({ style: "  Bold paper-cut collage  " })
      .expect(200);

    expect(executed.body.style).toBe("Bold paper-cut collage");
    expect(fakeGemini.generatedStyleContexts).toEqual([]);
    expect(fakeGemini.suppliedStyleContexts).toEqual([
      { bookInteractionId: "book-interaction-1", style: "Bold paper-cut collage" },
    ]);

    const reader = new LocalStore(dataDirectory);
    expect(reader.getStyleProject(session.body.user.id, projectId)).toMatchObject({
      style: "Bold paper-cut collage",
      styleInteractionId: "supplied-style-interaction-1",
    });
    reader.close();
  });

  it("starts Gemini Style work only once for overlapping requests", async () => {
    fakeGemini.generatedStyleGate = deferred();
    fakeGemini.generatedStyleStarted = deferred();
    const agent = request.agent(context.app);
    await signIn(agent);
    const projectId = (await createProject(agent)).body.project.id as string;

    const firstRequest = agent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({})
      .then((response) => response);
    await fakeGemini.generatedStyleStarted.promise;

    const duplicate = await agent
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({})
      .expect(409);
    expect(duplicate.body).toMatchObject({
      error: "Style is already running.",
      step: { state: "RUNNING", attemptCount: 1 },
    });
    expect(fakeGemini.uploadedBookPaths).toHaveLength(1);
    expect(fakeGemini.bookInteractionUris).toHaveLength(1);
    expect(fakeGemini.generatedStyleContexts).toHaveLength(1);

    fakeGemini.generatedStyleGate.resolve();
    await expect(firstRequest).resolves.toMatchObject({ status: 200 });
  });

  it("enforces authentication, project ownership, and Style input validation", async () => {
    const owner = request.agent(context.app);
    const otherUser = request.agent(context.app);
    await signIn(owner, "Owner", "owner@example.com");
    await signIn(otherUser, "Other", "other@example.com");
    const projectId = (await createProject(owner)).body.project.id as string;

    await request(context.app)
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({})
      .expect(401);
    await otherUser.post(`/api/projects/${projectId}/steps/style/run`).send({}).expect(404);
    await owner
      .post(`/api/projects/${projectId}/steps/style/run`)
      .send({ style: 42 })
      .expect(400);

    expect(fakeGemini.uploadedBookPaths).toEqual([]);
    expect(fakeGemini.generatedStyleContexts).toEqual([]);
  });
});
