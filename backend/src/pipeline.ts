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

export interface PipelineStepUpdate {
  state: PipelineStepState;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  incrementAttempt: boolean;
}

export interface PipelineRepository {
  getPipelineSteps(projectId: string): PipelineStep[];
  updatePipelineStep(
    projectId: string,
    stepName: PipelineStepName,
    update: PipelineStepUpdate,
  ): void;
}

export class PipelineRuleError extends Error {}

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
  constructor(private readonly repository: PipelineRepository) {}

  getPipeline(projectId: string): PipelineStep[] {
    const steps = this.repository.getPipelineSteps(projectId);
    if (steps.length !== PIPELINE_STEP_NAMES.length) {
      throw new PipelineRuleError("Project pipeline was not found.");
    }
    return steps;
  }

  startStep(projectId: string, stepName: PipelineStepName): PipelineStep {
    const steps = this.getPipeline(projectId);
    const step = this.findStep(steps, stepName);
    const firstIncomplete = steps.find((candidate) => candidate.state !== "SUCCEEDED");

    if (firstIncomplete?.name !== stepName) {
      throw new PipelineRuleError("Previous pipeline steps must succeed first.");
    }
    if (step.state !== "PENDING" && step.state !== "FAILED") {
      throw new PipelineRuleError(`Step ${stepName} cannot start from ${step.state}.`);
    }

    this.repository.updatePipelineStep(projectId, stepName, {
      state: "RUNNING",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errorMessage: null,
      incrementAttempt: true,
    });
    return this.findStep(this.getPipeline(projectId), stepName);
  }

  succeedStep(projectId: string, stepName: PipelineStepName): PipelineStep {
    return this.finishStep(projectId, stepName, "SUCCEEDED", null);
  }

  failStep(projectId: string, stepName: PipelineStepName, errorMessage: string): PipelineStep {
    return this.finishStep(
      projectId,
      stepName,
      "FAILED",
      errorMessage.trim() || "Step failed.",
    );
  }

  private finishStep(
    projectId: string,
    stepName: PipelineStepName,
    state: "SUCCEEDED" | "FAILED",
    errorMessage: string | null,
  ): PipelineStep {
    const step = this.findStep(this.getPipeline(projectId), stepName);
    if (step.state !== "RUNNING") {
      throw new PipelineRuleError(`Step ${stepName} cannot finish from ${step.state}.`);
    }

    this.repository.updatePipelineStep(projectId, stepName, {
      state,
      startedAt: step.startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage,
      incrementAttempt: false,
    });
    return this.findStep(this.getPipeline(projectId), stepName);
  }

  private findStep(steps: PipelineStep[], stepName: PipelineStepName): PipelineStep {
    const step = steps.find((candidate) => candidate.name === stepName);
    if (!step) {
      throw new PipelineRuleError(`Pipeline step ${stepName} was not found.`);
    }
    return step;
  }
}
