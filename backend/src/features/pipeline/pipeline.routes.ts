import type { Express, RequestHandler } from "express";

import { LocalStore, type User } from "../../infrastructure/persistence/local-store.js";
import {
  PipelineRuleError,
  PipelineService,
  PIPELINE_STEP_NAMES,
  type PipelineStepName,
} from "./pipeline.js";
import { ChapterProjectNotFoundError, ChapterService } from "./steps/chapters.js";
import { CharacterProjectNotFoundError, CharacterService } from "./steps/characters.js";
import {
  IllustrationProjectNotFoundError,
  IllustrationService,
} from "./steps/illustrations.js";
import { PortraitProjectNotFoundError, PortraitService } from "./steps/portraits.js";
import { StyleProjectNotFoundError, StyleService } from "./steps/style.js";

interface PipelineRouteDependencies {
  store: LocalStore;
  pipeline: PipelineService;
  styleService: StyleService;
  characterService: CharacterService;
  portraitService: PortraitService;
  chapterService: ChapterService;
  illustrationService: IllustrationService;
  requireUser: RequestHandler;
}

function pipelineStepName(value: unknown): PipelineStepName | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.toUpperCase();
  return PIPELINE_STEP_NAMES.find((stepName) => stepName === normalized);
}

export function registerPipelineRoutes(
  app: Express,
  dependencies: PipelineRouteDependencies,
): void {
  const {
    store,
    pipeline,
    styleService,
    characterService,
    portraitService,
    chapterService,
    illustrationService,
    requireUser,
  } = dependencies;

  app.post("/api/projects/:id/steps/:step/recover", requireUser, (request, response) => {
    const user = response.locals.user as User;
    const projectId = request.params.id;

    if (typeof projectId !== "string" || !store.ownsProject(user.id, projectId)) {
      response.status(404).json({ error: "Project not found." });
      return;
    }

    const stepName = pipelineStepName(request.params.step);
    if (!stepName) {
      response.status(400).json({ error: "Unknown pipeline step." });
      return;
    }

    try {
      response.status(200).json({ step: pipeline.recoverStep(projectId, stepName) });
    } catch (error) {
      if (error instanceof PipelineRuleError) {
        const step = pipeline
          .getPipeline(projectId)
          .find((candidate) => candidate.name === stepName);
        response.status(409).json({ error: error.message, step });
        return;
      }
      throw error;
    }
  });

  app.post("/api/projects/:id/steps/style/run", requireUser, async (request, response) => {
    const user = response.locals.user as User;
    const projectId = request.params.id;
    const styleValue = request.body?.style;

    if (typeof projectId !== "string") {
      response.status(404).json({ error: "Project not found." });
      return;
    }
    if (styleValue !== undefined && styleValue !== null && typeof styleValue !== "string") {
      response.status(400).json({ error: "Style must be text when supplied." });
      return;
    }

    try {
      const result = await styleService.execute(
        user.id,
        projectId,
        typeof styleValue === "string" ? styleValue : undefined,
      );

      if (result.execution.outcome === "ALREADY_RUNNING") {
        response.status(409).json({
          error: "Style is already running.",
          step: result.execution.step,
          style: result.style,
        });
        return;
      }
      if (result.execution.outcome === "FAILED") {
        response.status(502).json({
          error: result.execution.step.errorMessage ?? "Style generation failed.",
          step: result.execution.step,
          style: result.style,
        });
        return;
      }

      response.status(200).json({ step: result.execution.step, style: result.style });
    } catch (error) {
      if (error instanceof StyleProjectNotFoundError) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      if (error instanceof PipelineRuleError) {
        response.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/projects/:id/steps/characters/run", requireUser, async (request, response) => {
    const user = response.locals.user as User;
    const projectId = request.params.id;

    if (typeof projectId !== "string") {
      response.status(404).json({ error: "Project not found." });
      return;
    }

    try {
      const result = await characterService.execute(user.id, projectId);

      if (result.execution.outcome === "ALREADY_RUNNING") {
        response.status(409).json({
          error: "Characters are already running.",
          step: result.execution.step,
          characters: result.characters,
        });
        return;
      }
      if (result.execution.outcome === "FAILED") {
        response.status(502).json({
          error: result.execution.step.errorMessage ?? "Character generation failed.",
          step: result.execution.step,
          characters: result.characters,
        });
        return;
      }

      response.status(200).json({
        step: result.execution.step,
        characters: result.characters,
      });
    } catch (error) {
      if (error instanceof CharacterProjectNotFoundError) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      if (error instanceof PipelineRuleError) {
        response.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/projects/:id/steps/portraits/run", requireUser, async (request, response) => {
    const user = response.locals.user as User;
    const projectId = request.params.id;

    if (typeof projectId !== "string") {
      response.status(404).json({ error: "Project not found." });
      return;
    }

    try {
      const result = await portraitService.execute(user.id, projectId);

      if (result.execution.outcome === "ALREADY_RUNNING") {
        response.status(409).json({
          error: "Portraits are already running.",
          step: result.execution.step,
          characters: result.characters,
        });
        return;
      }
      if (result.execution.outcome === "FAILED") {
        response.status(502).json({
          error: result.execution.step.errorMessage ?? "Portrait generation failed.",
          step: result.execution.step,
          characters: result.characters,
        });
        return;
      }

      response.status(200).json({
        step: result.execution.step,
        characters: result.characters,
      });
    } catch (error) {
      if (error instanceof PortraitProjectNotFoundError) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      if (error instanceof PipelineRuleError) {
        response.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/projects/:id/steps/chapters/run", requireUser, async (request, response) => {
    const user = response.locals.user as User;
    const projectId = request.params.id;

    if (typeof projectId !== "string") {
      response.status(404).json({ error: "Project not found." });
      return;
    }

    try {
      const result = await chapterService.execute(user.id, projectId);

      if (result.execution.outcome === "ALREADY_RUNNING") {
        response.status(409).json({
          error: "Chapters are already running.",
          step: result.execution.step,
          chapters: result.chapters,
        });
        return;
      }
      if (result.execution.outcome === "FAILED") {
        response.status(502).json({
          error: result.execution.step.errorMessage ?? "Chapter generation failed.",
          step: result.execution.step,
          chapters: result.chapters,
        });
        return;
      }

      response.status(200).json({
        step: result.execution.step,
        chapters: result.chapters,
      });
    } catch (error) {
      if (error instanceof ChapterProjectNotFoundError) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      if (error instanceof PipelineRuleError) {
        response.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  app.post(
    "/api/projects/:id/steps/illustrations/run",
    requireUser,
    async (request, response) => {
      const user = response.locals.user as User;
      const projectId = request.params.id;

      if (typeof projectId !== "string") {
        response.status(404).json({ error: "Project not found." });
        return;
      }

      try {
        const result = await illustrationService.execute(user.id, projectId);

        if (result.execution.outcome === "ALREADY_RUNNING") {
          response.status(409).json({
            error: "Illustrations are already running.",
            step: result.execution.step,
            chapters: result.chapters,
          });
          return;
        }
        if (result.execution.outcome === "FAILED") {
          response.status(502).json({
            error: result.execution.step.errorMessage ?? "Illustration generation failed.",
            step: result.execution.step,
            chapters: result.chapters,
          });
          return;
        }

        response.status(200).json({
          step: result.execution.step,
          chapters: result.chapters,
        });
      } catch (error) {
        if (error instanceof IllustrationProjectNotFoundError) {
          response.status(404).json({ error: "Project not found." });
          return;
        }
        if (error instanceof PipelineRuleError) {
          response.status(409).json({ error: error.message });
          return;
        }
        throw error;
      }
    },
  );
}
