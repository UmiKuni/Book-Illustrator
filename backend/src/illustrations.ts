import type { Chapter } from "./chapters.js";
import type { GeminiProvider } from "./gemini.js";
import {
  PipelineExecutor,
  type PipelineExecutionResult,
  type PipelineRepository,
} from "./pipeline.js";

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface IllustrationProjectContext {
  id: string;
  imageInteractionId: string | null;
  chapterImageContextId: string | null;
  chapters: Chapter[];
}

export interface IllustrationRepository extends PipelineRepository {
  getIllustrationProject(
    userId: string,
    projectId: string,
  ): IllustrationProjectContext | undefined;
  saveChapterImageContextId(projectId: string, interactionId: string): void;
  saveIllustrationSuccess(
    projectId: string,
    chapterPosition: number,
    imageBytes: Uint8Array,
    mimeType: string,
  ): Promise<void>;
}

export interface IllustrationExecutionResult {
  execution: PipelineExecutionResult;
  chapters: Chapter[];
}

export class IllustrationProjectNotFoundError extends Error {}

export class IllustrationOutputError extends Error {}

export function decodeIllustrationImage(
  imageData: string | undefined,
  mimeType: string | undefined,
): { bytes: Uint8Array; mimeType: string } {
  const normalizedMimeType = mimeType?.trim().toLowerCase();
  const extension = normalizedMimeType ? IMAGE_EXTENSIONS[normalizedMimeType] : undefined;
  if (!normalizedMimeType || !extension) {
    throw new IllustrationOutputError(
      "Gemini did not return a supported chapter illustration image type.",
    );
  }

  const normalizedData = imageData?.replace(/\s/g, "") ?? "";
  if (
    !normalizedData ||
    normalizedData.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedData)
  ) {
    throw new IllustrationOutputError(
      "Gemini did not return usable chapter illustration image data.",
    );
  }

  const bytes = Buffer.from(normalizedData, "base64");
  if (bytes.length === 0) {
    throw new IllustrationOutputError(
      "Gemini did not return usable chapter illustration image data.",
    );
  }

  return { bytes, mimeType: normalizedMimeType };
}

export class IllustrationService {
  constructor(
    private readonly repository: IllustrationRepository,
    private readonly provider: GeminiProvider,
    private readonly executor: PipelineExecutor,
  ) {}

  async execute(userId: string, projectId: string): Promise<IllustrationExecutionResult> {
    if (!this.repository.getIllustrationProject(userId, projectId)) {
      throw new IllustrationProjectNotFoundError("Project not found.");
    }

    const execution = await this.executor.executeStep(projectId, "ILLUSTRATIONS", async () => {
      const context = this.repository.getIllustrationProject(userId, projectId);
      if (!context) {
        throw new IllustrationProjectNotFoundError("Project not found.");
      }

      const chapter = context.chapters[0];
      if (!chapter) {
        throw new Error("Persisted Chapter is missing; Illustrations cannot continue.");
      }
      if (chapter.illustrationImagePath && chapter.illustrationMimeType) {
        return;
      }
      if (chapter.illustrationImagePath || chapter.illustrationMimeType) {
        throw new Error("Persisted chapter illustration metadata is incomplete.");
      }
      let chapterImageContextId = context.chapterImageContextId;
      if (!chapterImageContextId) {
        if (!context.imageInteractionId) {
          throw new Error(
            "Persisted portrait image context is missing; Illustrations cannot continue.",
          );
        }
        const imageContext = await this.provider.createChapterIllustrationContext(
          context.imageInteractionId,
        );
        chapterImageContextId = imageContext.interactionId;
        this.repository.saveChapterImageContextId(projectId, chapterImageContextId);
      }

      const generated = await this.provider.generateChapterIllustration(
        chapterImageContextId,
        chapter.name,
        chapter.prompt,
      );
      const image = decodeIllustrationImage(generated.imageData, generated.mimeType);
      await this.repository.saveIllustrationSuccess(
        projectId,
        chapter.position,
        image.bytes,
        image.mimeType,
      );
    });

    const context = this.repository.getIllustrationProject(userId, projectId);
    return { execution, chapters: context?.chapters ?? [] };
  }
}
