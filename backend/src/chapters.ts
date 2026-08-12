import type { GeminiProvider } from "./gemini.js";
import {
  PipelineExecutor,
  type PipelineExecutionResult,
  type PipelineRepository,
} from "./pipeline.js";

const MAX_CHAPTERS = 1;

export interface Chapter {
  position: number;
  name: string;
  prompt: string;
  illustrationImagePath: string | null;
  illustrationMimeType: string | null;
}

export interface ChapterProjectContext {
  id: string;
  characterInteractionId: string | null;
  chapterInteractionId: string | null;
  chapters: Chapter[];
}

export interface ChapterRepository extends PipelineRepository {
  getChapterProject(userId: string, projectId: string): ChapterProjectContext | undefined;
  saveChapters(projectId: string, chapters: Chapter[], interactionId: string): void;
}

export interface ChapterExecutionResult {
  execution: PipelineExecutionResult;
  chapters: Chapter[];
}

export class ChapterProjectNotFoundError extends Error {}

export class ChapterOutputError extends Error {}

export function parseChapterOutput(outputText: string | undefined): Chapter[] {
  if (typeof outputText !== "string" || outputText.trim().length === 0) {
    throw new ChapterOutputError("Gemini did not return chapter output.");
  }

  let output: unknown;
  try {
    output = JSON.parse(outputText);
  } catch {
    throw new ChapterOutputError("Gemini returned malformed chapter JSON.");
  }

  if (!Array.isArray(output)) {
    throw new ChapterOutputError("Gemini chapter output must be an array.");
  }
  if (output.length === 0) {
    throw new ChapterOutputError("Gemini did not return a usable chapter record.");
  }

  return output.slice(0, MAX_CHAPTERS).map((record, position) => {
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      throw new ChapterOutputError(`Chapter ${position + 1} must be an object.`);
    }

    const name = "name" in record && typeof record.name === "string" ? record.name.trim() : "";
    const prompt =
      "prompt" in record && typeof record.prompt === "string" ? record.prompt.trim() : "";

    if (!name || !prompt) {
      throw new ChapterOutputError(
        `Chapter ${position + 1} requires a non-empty name and prompt.`,
      );
    }

    return {
      position,
      name,
      prompt,
      illustrationImagePath: null,
      illustrationMimeType: null,
    };
  });
}

export class ChapterService {
  constructor(
    private readonly repository: ChapterRepository,
    private readonly provider: GeminiProvider,
    private readonly executor: PipelineExecutor,
  ) {}

  async execute(userId: string, projectId: string): Promise<ChapterExecutionResult> {
    if (!this.repository.getChapterProject(userId, projectId)) {
      throw new ChapterProjectNotFoundError("Project not found.");
    }

    const execution = await this.executor.executeStep(projectId, "CHAPTERS", async () => {
      const context = this.repository.getChapterProject(userId, projectId);
      if (!context) {
        throw new ChapterProjectNotFoundError("Project not found.");
      }
      if (context.chapterInteractionId) {
        return;
      }
      if (!context.characterInteractionId) {
        throw new Error(
          "Persisted Characters interaction context is missing; Chapters cannot continue.",
        );
      }

      const generated = await this.provider.generateChapters(context.characterInteractionId);
      const chapters = parseChapterOutput(generated.outputText);
      this.repository.saveChapters(projectId, chapters, generated.interactionId);
    });

    const context = this.repository.getChapterProject(userId, projectId);
    return { execution, chapters: context?.chapters ?? [] };
  }
}
