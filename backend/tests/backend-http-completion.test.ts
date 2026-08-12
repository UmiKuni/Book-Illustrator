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

const PORTRAIT_BYTES = Buffer.from("authorized-portrait-bytes");
const ILLUSTRATION_BYTES = Buffer.from("authorized-illustration-bytes");

class FakeGeminiProvider implements GeminiProvider {
  callCount = 0;

  async uploadBook(_bookPath: string): Promise<GeminiBookReference> {
    this.callCount += 1;
    return { uri: "gemini://book" };
  }

  async createBookInteraction(_bookUri: string): Promise<GeminiInteractionReference> {
    this.callCount += 1;
    return { interactionId: "book-interaction" };
  }

  async generateStyle(_bookInteractionId: string): Promise<GeminiGeneratedStyle> {
    this.callCount += 1;
    return { interactionId: "style-interaction", style: "Watercolor" };
  }

  async continueWithStyle(
    _bookInteractionId: string,
    _style: string,
  ): Promise<GeminiInteractionReference> {
    this.callCount += 1;
    return { interactionId: "style-interaction" };
  }

  async generateCharacters(_styleInteractionId: string): Promise<GeminiCharacterOutput> {
    this.callCount += 1;
    return {
      interactionId: "characters-interaction",
      outputText: JSON.stringify([
        { name: "Mole", prompt: "A gentle adult mole in a velvet coat" },
      ]),
    };
  }

  async generateChapters(_characterInteractionId: string): Promise<GeminiChapterOutput> {
    this.callCount += 1;
    return {
      interactionId: "chapter-interaction",
      outputText: JSON.stringify([
        {
          name: "The River Bank",
          prompt: "Mole beside the sparkling river in one watercolor scene.",
        },
      ]),
    };
  }

  async createPortraitContext(_style: string): Promise<GeminiInteractionReference> {
    this.callCount += 1;
    return { interactionId: "portrait-context" };
  }

  async generatePortrait(
    _previousInteractionId: string,
    _characterName: string,
    _characterPrompt: string,
  ): Promise<GeminiImageOutput> {
    this.callCount += 1;
    return {
      interactionId: "portrait-interaction",
      imageData: PORTRAIT_BYTES.toString("base64"),
      mimeType: "image/jpeg",
    };
  }

  async createChapterIllustrationContext(
    _previousInteractionId: string,
  ): Promise<GeminiInteractionReference> {
    this.callCount += 1;
    return { interactionId: "chapter-image-context" };
  }

  async generateChapterIllustration(
    _previousInteractionId: string,
    _chapterName: string,
    _chapterPrompt: string,
  ): Promise<GeminiImageOutput> {
    this.callCount += 1;
    return {
      interactionId: "illustration-interaction",
      imageData: ILLUSTRATION_BYTES.toString("base64"),
      mimeType: "image/png",
    };
  }
}

let context: AppContext;
let dataDirectory: string;
let fakeGemini: FakeGeminiProvider;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-http-completion-"));
  fakeGemini = new FakeGeminiProvider();
});

afterEach(async () => {
  context?.close();
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
  const created = await agent
    .post("/api/projects")
    .send({ title: "The River Bank", bookText: "Once beside the river..." })
    .expect(201);
  return created.body.project.id as string;
}

async function completePipeline(
  agent: ReturnType<typeof request.agent>,
  projectId: string,
): Promise<void> {
  await agent
    .post(`/api/projects/${projectId}/steps/style/run`)
    .send({ style: "Vintage watercolor" })
    .expect(200);
  for (const step of ["characters", "portraits", "chapters", "illustrations"]) {
    await agent.post(`/api/projects/${projectId}/steps/${step}/run`).send({}).expect(200);
  }
}

function startStyleDirectly(projectId: string): void {
  const store = new LocalStore(dataDirectory);
  new PipelineService(store).startStep(projectId, "STYLE");
  store.close();
}

describe("pipeline recovery HTTP API", () => {
  it("allows only the owner to recover stale running work without calling Gemini", async () => {
    context = createApp({ dataDirectory, geminiProvider: fakeGemini, staleAfterMs: 0 });
    const owner = request.agent(context.app);
    const otherUser = request.agent(context.app);
    await signIn(owner, "Owner", "owner@example.com");
    await signIn(otherUser, "Other", "other@example.com");
    const projectId = await createProject(owner);
    startStyleDirectly(projectId);

    await otherUser
      .post(`/api/projects/${projectId}/steps/style/recover`)
      .send({})
      .expect(404);
    const recovered = await owner
      .post(`/api/projects/${projectId}/steps/style/recover`)
      .send({})
      .expect(200);

    expect(recovered.body.step).toMatchObject({
      name: "STYLE",
      state: "INTERRUPTED",
      attemptCount: 1,
    });
    expect(fakeGemini.callCount).toBe(0);
    const detail = await owner.get(`/api/projects/${projectId}`).expect(200);
    expect(detail.body.project.steps[0]).toEqual(recovered.body.step);
  });

  it("rejects recovery for fresh running work and returns its persisted state", async () => {
    context = createApp({ dataDirectory, geminiProvider: fakeGemini, staleAfterMs: 60_000 });
    const owner = request.agent(context.app);
    await signIn(owner);
    const projectId = await createProject(owner);
    startStyleDirectly(projectId);

    const response = await owner
      .post(`/api/projects/${projectId}/steps/style/recover`)
      .send({})
      .expect(409);

    expect(response.body).toMatchObject({
      error: "Step STYLE is still running and is not stale.",
      step: { name: "STYLE", state: "RUNNING", attemptCount: 1 },
    });
    expect(fakeGemini.callCount).toBe(0);
  });

  it("rejects unknown recovery step names without provider work", async () => {
    context = createApp({ dataDirectory, geminiProvider: fakeGemini, staleAfterMs: 0 });
    const owner = request.agent(context.app);
    await signIn(owner);
    const projectId = await createProject(owner);

    await owner
      .post(`/api/projects/${projectId}/steps/not-a-step/recover`)
      .send({})
      .expect(400);
    expect(fakeGemini.callCount).toBe(0);
  });
});

describe("authorized project media HTTP API", () => {
  it("serves completed portrait and illustration bytes only to the owning user", async () => {
    context = createApp({ dataDirectory, geminiProvider: fakeGemini });
    const owner = request.agent(context.app);
    const otherUser = request.agent(context.app);
    await signIn(owner, "Owner", "owner@example.com");
    await signIn(otherUser, "Other", "other@example.com");
    const projectId = await createProject(owner);

    await owner
      .get(`/api/projects/${projectId}/characters/0/portrait`)
      .expect(404);
    await owner
      .get(`/api/projects/${projectId}/chapters/0/illustration`)
      .expect(404);

    await completePipeline(owner, projectId);

    const portrait = await owner
      .get(`/api/projects/${projectId}/characters/0/portrait`)
      .expect("Content-Type", /^image\/jpeg/)
      .expect(200);
    expect(portrait.body).toEqual(PORTRAIT_BYTES);

    const illustration = await owner
      .get(`/api/projects/${projectId}/chapters/0/illustration`)
      .expect("Content-Type", /^image\/png/)
      .expect(200);
    expect(illustration.body).toEqual(ILLUSTRATION_BYTES);

    await otherUser
      .get(`/api/projects/${projectId}/characters/0/portrait`)
      .expect(404);
    await otherUser
      .get(`/api/projects/${projectId}/chapters/0/illustration`)
      .expect(404);
    await request(context.app)
      .get(`/api/projects/${projectId}/characters/0/portrait`)
      .expect(401);
  });

  it("does not expose arbitrary paths or unrelated media positions", async () => {
    context = createApp({ dataDirectory, geminiProvider: fakeGemini });
    const owner = request.agent(context.app);
    await signIn(owner);
    const projectId = await createProject(owner);
    await completePipeline(owner, projectId);

    await owner
      .get(`/api/projects/${projectId}/characters/99/portrait`)
      .expect(404);
    await owner
      .get(`/api/projects/${projectId}/chapters/not-a-position/illustration`)
      .expect(404);
    await owner
      .get(`/api/projects/${projectId}/media/${encodeURIComponent("../../app.sqlite")}`)
      .expect(404);
  });
});
