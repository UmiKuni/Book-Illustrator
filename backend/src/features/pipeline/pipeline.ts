export const PIPELINE_STEP_NAMES = [
  "STYLE",
  "CHARACTERS",
  "PORTRAITS",
  "CHAPTERS",
  "ILLUSTRATIONS",
] as const;

export type PipelineStepName = (typeof PIPELINE_STEP_NAMES)[number];
export type PipelineStepState =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "INTERRUPTED";
export type ProjectStatus = "Draft" | "In progress" | "Done";

export interface PipelineStep {
  name: PipelineStepName;
  position: number;
  state: PipelineStepState;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  attemptCount: number;
}

export interface ProjectProgress {
  status: ProjectStatus;
  completedSteps: number;
  totalSteps: 5;
}

export interface PipelineMutationResult {
  changed: boolean;
  step: PipelineStep;
}

export interface PipelineRepository {
  getPipelineSteps(projectId: string): PipelineStep[];
  claimPipelineStep(
    projectId: string,
    stepName: PipelineStepName,
    startedAt: string,
  ): PipelineMutationResult | undefined;
  finishPipelineStep(
    projectId: string,
    stepName: PipelineStepName,
    expectedStartedAt: string,
    state: "SUCCEEDED" | "FAILED",
    finishedAt: string,
    errorMessage: string | null,
  ): PipelineMutationResult | undefined;
  interruptStalePipelineStep(
    projectId: string,
    stepName: PipelineStepName,
    staleBefore: string,
    interruptedAt: string,
  ): PipelineMutationResult | undefined;
}

export interface PipelineServiceOptions {
  staleAfterMs?: number;
  now?: () => Date;
}

export type PipelineExecutionResult =
  | { outcome: "SUCCEEDED"; step: PipelineStep }
  | { outcome: "FAILED"; step: PipelineStep }
  | { outcome: "ALREADY_RUNNING"; step: PipelineStep };

export class PipelineRuleError extends Error {}

export class PipelineConflictError extends PipelineRuleError {
  constructor(public readonly step: PipelineStep) {
    super(`Step ${step.name} is already running.`);
  }
}

export function deriveProjectProgress(steps: PipelineStep[]): ProjectProgress {
  const completedSteps = steps.filter((step) => step.state === "SUCCEEDED").length;
  const neverAttempted = steps.every(
    (step) => step.state === "PENDING" && step.attemptCount === 0,
  );

  return {
    status:
      completedSteps === PIPELINE_STEP_NAMES.length
        ? "Done"
        : neverAttempted
          ? "Draft"
          : "In progress",
    completedSteps,
    totalSteps: 5,
  };
}

export class PipelineService {
  private readonly staleAfterMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: PipelineRepository,
    options: PipelineServiceOptions = {},
  ) {
    this.staleAfterMs = options.staleAfterMs ?? 300_000;
    this.now = options.now ?? (() => new Date());

    if (!Number.isFinite(this.staleAfterMs) || this.staleAfterMs < 0) {
      throw new Error("staleAfterMs must be a non-negative number.");
    }
  }

  getPipeline(projectId: string): PipelineStep[] {
    const steps = this.repository.getPipelineSteps(projectId);
    if (steps.length !== PIPELINE_STEP_NAMES.length) {
      throw new PipelineRuleError("Project pipeline was not found.");
    }
    return steps;
  }

  startStep(projectId: string, stepName: PipelineStepName): PipelineStep {
    const result = this.repository.claimPipelineStep(
      projectId,
      stepName,
      this.now().toISOString(),
    );

    if (!result) {
      throw new PipelineRuleError("Project pipeline was not found.");
    }
    if (result.changed) {
      return result.step;
    }
    if (result.step.state === "RUNNING") {
      throw new PipelineConflictError(result.step);
    }

    const firstIncomplete = this.getPipeline(projectId).find(
      (candidate) => candidate.state !== "SUCCEEDED",
    );
    if (firstIncomplete?.name !== stepName) {
      throw new PipelineRuleError("Previous pipeline steps must succeed first.");
    }

    throw new PipelineRuleError(`Step ${stepName} cannot start from ${result.step.state}.`);
  }

  succeedStep(
    projectId: string,
    stepName: PipelineStepName,
    expectedStartedAt?: string,
  ): PipelineStep {
    return this.finishStep(projectId, stepName, "SUCCEEDED", null, expectedStartedAt);
  }

  failStep(
    projectId: string,
    stepName: PipelineStepName,
    errorMessage: string,
    expectedStartedAt?: string,
  ): PipelineStep {
    return this.finishStep(
      projectId,
      stepName,
      "FAILED",
      errorMessage.trim() || "Step failed.",
      expectedStartedAt,
    );
  }

  recoverStep(projectId: string, stepName: PipelineStepName): PipelineStep {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - this.staleAfterMs).toISOString();
    const result = this.repository.interruptStalePipelineStep(
      projectId,
      stepName,
      staleBefore,
      now.toISOString(),
    );

    if (!result) {
      throw new PipelineRuleError("Project pipeline was not found.");
    }
    if (result.changed) {
      return result.step;
    }
    if (result.step.state === "RUNNING") {
      throw new PipelineRuleError(`Step ${stepName} is still running and is not stale.`);
    }

    throw new PipelineRuleError(`Step ${stepName} cannot be recovered from ${result.step.state}.`);
  }

  private finishStep(
    projectId: string,
    stepName: PipelineStepName,
    state: "SUCCEEDED" | "FAILED",
    errorMessage: string | null,
    expectedStartedAt?: string,
  ): PipelineStep {
    const currentStep = this.findStep(this.getPipeline(projectId), stepName);
    const startedAt = expectedStartedAt ?? currentStep.startedAt;

    if (currentStep.state !== "RUNNING" || !startedAt) {
      throw new PipelineRuleError(`Step ${stepName} cannot finish from ${currentStep.state}.`);
    }

    const result = this.repository.finishPipelineStep(
      projectId,
      stepName,
      startedAt,
      state,
      this.now().toISOString(),
      errorMessage,
    );
    if (!result) {
      throw new PipelineRuleError("Project pipeline was not found.");
    }
    if (!result.changed) {
      throw new PipelineRuleError(`Step ${stepName} no longer belongs to this execution.`);
    }
    return result.step;
  }

  private findStep(steps: PipelineStep[], stepName: PipelineStepName): PipelineStep {
    const step = steps.find((candidate) => candidate.name === stepName);
    if (!step) {
      throw new PipelineRuleError(`Pipeline step ${stepName} was not found.`);
    }
    return step;
  }
}

export class PipelineExecutor {
  constructor(private readonly pipeline: PipelineService) {}

  async executeStep(
    projectId: string,
    stepName: PipelineStepName,
    work: (runningStep: PipelineStep) => Promise<void>,
  ): Promise<PipelineExecutionResult> {
    let runningStep: PipelineStep;
    try {
      runningStep = this.pipeline.startStep(projectId, stepName);
    } catch (error) {
      if (error instanceof PipelineConflictError) {
        return { outcome: "ALREADY_RUNNING", step: error.step };
      }
      throw error;
    }

    try {
      await work(runningStep);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step failed.";
      return {
        outcome: "FAILED",
        step: this.pipeline.failStep(projectId, stepName, message, runningStep.startedAt ?? undefined),
      };
    }

    return {
      outcome: "SUCCEEDED",
      step: this.pipeline.succeedStep(
        projectId,
        stepName,
        runningStep.startedAt ?? undefined,
      ),
    };
  }
}
