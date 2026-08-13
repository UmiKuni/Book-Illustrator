import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/infrastructure/persistence/local-store.js";
import {
  PIPELINE_STEP_NAMES,
  PipelineRuleError,
  PipelineService,
} from "../src/features/pipeline/pipeline.js";

let dataDirectory: string;
let store: LocalStore;
let pipeline: PipelineService;
let userId: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-pipeline-"));
  store = new LocalStore(dataDirectory);
  pipeline = new PipelineService(store);
  userId = store.findOrCreateUser("Mira Hassan", "mira@example.com").id;
});

afterEach(async () => {
  store.close();
  await rm(dataDirectory, { force: true, recursive: true });
});

async function createProject() {
  return store.createProject(userId, "The River Bank", "Once beside the river...");
}

describe("pipeline state management", () => {
  it("initializes all five ordered steps as pending with Draft progress", async () => {
    const project = await createProject();

    expect(
      project.steps.map(({ name, position, state, attemptCount }) => ({
        name,
        position,
        state,
        attemptCount,
      })),
    ).toEqual(
      PIPELINE_STEP_NAMES.map((name, position) => ({
        name,
        position,
        state: "PENDING",
        attemptCount: 0,
      })),
    );
    expect(project).toMatchObject({ status: "Draft", completedSteps: 0, totalSteps: 5 });
  });

  it("enforces ordering and supports pending to running to succeeded", async () => {
    const project = await createProject();

    expect(() => pipeline.startStep(project.id, "CHARACTERS")).toThrow(
      new PipelineRuleError("Previous pipeline steps must succeed first."),
    );

    const running = pipeline.startStep(project.id, "STYLE");
    expect(running).toMatchObject({ state: "RUNNING", attemptCount: 1, errorMessage: null });
    expect(running.startedAt).not.toBeNull();

    const runningProject = await store.getProject(userId, project.id);
    expect(runningProject).toMatchObject({ status: "In progress", completedSteps: 0 });

    const succeeded = pipeline.succeedStep(project.id, "STYLE");
    expect(succeeded.state).toBe("SUCCEEDED");
    expect(succeeded.finishedAt).not.toBeNull();

    expect(pipeline.startStep(project.id, "CHARACTERS").state).toBe("RUNNING");
    const progressedProject = await store.getProject(userId, project.id);
    expect(progressedProject).toMatchObject({ status: "In progress", completedSteps: 1 });
  });

  it("supports failure and retry without resetting successful previous steps", async () => {
    const project = await createProject();
    pipeline.startStep(project.id, "STYLE");
    pipeline.succeedStep(project.id, "STYLE");
    pipeline.startStep(project.id, "CHARACTERS");

    const failed = pipeline.failStep(project.id, "CHARACTERS", "Provider unavailable");
    expect(failed).toMatchObject({
      state: "FAILED",
      attemptCount: 1,
      errorMessage: "Provider unavailable",
    });
    expect(failed.finishedAt).not.toBeNull();
    expect(() => pipeline.startStep(project.id, "PORTRAITS")).toThrow(PipelineRuleError);

    const retried = pipeline.startStep(project.id, "CHARACTERS");
    expect(retried).toMatchObject({ state: "RUNNING", attemptCount: 2, errorMessage: null });

    const steps = pipeline.getPipeline(project.id);
    expect(steps.find((step) => step.name === "STYLE")?.state).toBe("SUCCEEDED");
    expect(pipeline.succeedStep(project.id, "CHARACTERS").state).toBe("SUCCEEDED");
  });

  it("derives Done and the completed count after all steps succeed", async () => {
    const project = await createProject();

    for (const stepName of PIPELINE_STEP_NAMES) {
      pipeline.startStep(project.id, stepName);
      pipeline.succeedStep(project.id, stepName);
    }

    const completed = await store.getProject(userId, project.id);
    expect(completed).toMatchObject({ status: "Done", completedSteps: 5, totalSteps: 5 });
    expect(store.listProjects(userId)[0]).toMatchObject({ status: "Done", completedSteps: 5 });
  });

  it("preserves pipeline state and derived progress across application restart", async () => {
    const project = await createProject();
    pipeline.startStep(project.id, "STYLE");
    pipeline.succeedStep(project.id, "STYLE");
    pipeline.startStep(project.id, "CHARACTERS");
    pipeline.failStep(project.id, "CHARACTERS", "Malformed response");

    store.close();
    store = new LocalStore(dataDirectory);
    pipeline = new PipelineService(store);

    expect(pipeline.getPipeline(project.id)).toEqual([
      expect.objectContaining({ name: "STYLE", state: "SUCCEEDED", attemptCount: 1 }),
      expect.objectContaining({
        name: "CHARACTERS",
        state: "FAILED",
        attemptCount: 1,
        errorMessage: "Malformed response",
      }),
      expect.objectContaining({ name: "PORTRAITS", state: "PENDING" }),
      expect.objectContaining({ name: "CHAPTERS", state: "PENDING" }),
      expect.objectContaining({ name: "ILLUSTRATIONS", state: "PENDING" }),
    ]);
    await expect(store.getProject(userId, project.id)).resolves.toMatchObject({
      status: "In progress",
      completedSteps: 1,
    });
  });
});
