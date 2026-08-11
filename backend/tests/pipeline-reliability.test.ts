import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/local-store.js";
import {
  PipelineExecutor,
  PipelineRuleError,
  PipelineService,
} from "../src/pipeline.js";

const STALE_AFTER_MS = 1_000;

let dataDirectory: string;
let store: LocalStore;
let now: Date;
let pipeline: PipelineService;
let projectId: string;
let additionalStores: LocalStore[];

function createPipeline(repository: LocalStore = store): PipelineService {
  return new PipelineService(repository, {
    staleAfterMs: STALE_AFTER_MS,
    now: () => new Date(now),
  });
}

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-reliability-"));
  store = new LocalStore(dataDirectory);
  now = new Date("2026-08-13T08:00:00.000Z");
  additionalStores = [];
  pipeline = createPipeline();
  const user = store.findOrCreateUser("Mira Hassan", "mira@example.com");
  projectId = (await store.createProject(user.id, "River Bank", "Book text")).id;
});

afterEach(async () => {
  additionalStores.forEach((additionalStore) => additionalStore.close());
  store.close();
  await rm(dataDirectory, { force: true, recursive: true });
});

describe("pipeline reliability", () => {
  it("starts exactly one external execution for overlapping attempts", async () => {
    const secondStore = new LocalStore(dataDirectory);
    additionalStores.push(secondStore);
    const firstExecutor = new PipelineExecutor(pipeline);
    const secondExecutor = new PipelineExecutor(createPipeline(secondStore));
    let releaseWork: (() => void) | undefined;
    const workGate = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    let executions = 0;

    const firstExecution = firstExecutor.executeStep(projectId, "STYLE", async () => {
      executions += 1;
      await workGate;
    });
    await Promise.resolve();

    const original = pipeline.getPipeline(projectId)[0];
    now = new Date("2026-08-13T08:00:00.500Z");
    const duplicate = await secondExecutor.executeStep(projectId, "STYLE", async () => {
      executions += 1;
    });

    expect(duplicate).toEqual({ outcome: "ALREADY_RUNNING", step: original });
    expect(executions).toBe(1);
    expect(pipeline.getPipeline(projectId)[0]).toMatchObject({
      state: "RUNNING",
      startedAt: original.startedAt,
      attemptCount: 1,
    });

    releaseWork?.();
    await expect(firstExecution).resolves.toMatchObject({ outcome: "SUCCEEDED" });
  });

  it("marks deterministic work failure and allows an explicit retry", async () => {
    const executor = new PipelineExecutor(pipeline);
    const failed = await executor.executeStep(projectId, "STYLE", async () => {
      throw new Error("Provider unavailable");
    });

    expect(failed).toMatchObject({
      outcome: "FAILED",
      step: { state: "FAILED", attemptCount: 1, errorMessage: "Provider unavailable" },
    });

    now = new Date("2026-08-13T08:00:01.000Z");
    const retried = await executor.executeStep(projectId, "STYLE", async () => {});
    expect(retried).toMatchObject({
      outcome: "SUCCEEDED",
      step: { state: "SUCCEEDED", attemptCount: 2, errorMessage: null },
    });
  });

  it("rejects recovery while a running step is still fresh", () => {
    const running = pipeline.startStep(projectId, "STYLE");
    now = new Date(running.startedAt ?? "");
    now = new Date(now.getTime() + STALE_AFTER_MS - 1);

    expect(() => pipeline.recoverStep(projectId, "STYLE")).toThrow(
      new PipelineRuleError("Step STYLE is still running and is not stale."),
    );
    expect(pipeline.getPipeline(projectId)[0]).toEqual(running);
  });

  it("explicitly interrupts stale work without executing anything and permits rerun", async () => {
    const running = pipeline.startStep(projectId, "STYLE");
    now = new Date(running.startedAt ?? "");
    now = new Date(now.getTime() + STALE_AFTER_MS);
    let executions = 0;

    const interrupted = pipeline.recoverStep(projectId, "STYLE");
    expect(interrupted).toMatchObject({
      state: "INTERRUPTED",
      startedAt: running.startedAt,
      attemptCount: 1,
    });
    expect(executions).toBe(0);

    now = new Date(now.getTime() + 1);
    const rerun = await new PipelineExecutor(pipeline).executeStep(
      projectId,
      "STYLE",
      async () => {
        executions += 1;
      },
    );

    expect(rerun).toMatchObject({
      outcome: "SUCCEEDED",
      step: { state: "SUCCEEDED", attemptCount: 2 },
    });
    expect(executions).toBe(1);
  });

  it("does not let an interrupted old attempt finish a newer rerun", () => {
    const original = pipeline.startStep(projectId, "STYLE");
    now = new Date(original.startedAt ?? "");
    now = new Date(now.getTime() + STALE_AFTER_MS);
    pipeline.recoverStep(projectId, "STYLE");

    now = new Date(now.getTime() + 1);
    const rerun = pipeline.startStep(projectId, "STYLE");
    expect(() =>
      pipeline.succeedStep(projectId, "STYLE", original.startedAt ?? undefined),
    ).toThrow(new PipelineRuleError("Step STYLE no longer belongs to this execution."));
    expect(pipeline.getPipeline(projectId)[0]).toEqual(rerun);
  });

  it("recovers persisted stale running state after application restart", () => {
    const running = pipeline.startStep(projectId, "STYLE");
    now = new Date(running.startedAt ?? "");
    now = new Date(now.getTime() + STALE_AFTER_MS);

    store.close();
    store = new LocalStore(dataDirectory);
    pipeline = createPipeline();

    expect(pipeline.getPipeline(projectId)[0]).toEqual(running);
    expect(pipeline.recoverStep(projectId, "STYLE")).toMatchObject({
      state: "INTERRUPTED",
      attemptCount: 1,
    });

    now = new Date(now.getTime() + 1);
    expect(pipeline.startStep(projectId, "STYLE")).toMatchObject({
      state: "RUNNING",
      attemptCount: 2,
    });
  });
});
