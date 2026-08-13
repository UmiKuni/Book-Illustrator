import type { Character, PortraitState } from "./characters.js";
import type { GeminiProvider } from "../../../integrations/gemini/gemini.js";
import {
  PipelineExecutor,
  type PipelineExecutionResult,
  type PipelineRepository,
} from "../pipeline.js";

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface PortraitProjectContext {
  id: string;
  style: string | null;
  characterInteractionId: string | null;
  imageInteractionId: string | null;
  characters: Character[];
}

export interface PortraitRepository extends PipelineRepository {
  getPortraitProject(userId: string, projectId: string): PortraitProjectContext | undefined;
  saveImageInteractionId(projectId: string, interactionId: string): void;
  markPortraitRunning(projectId: string, position: number): void;
  markPortraitFailed(projectId: string, position: number, errorMessage: string): void;
  savePortraitSuccess(
    projectId: string,
    position: number,
    imageBytes: Uint8Array,
    mimeType: string,
    interactionId: string,
  ): Promise<void>;
}

export interface PortraitExecutionResult {
  execution: PipelineExecutionResult;
  characters: Character[];
}

export class PortraitProjectNotFoundError extends Error {}

export class PortraitOutputError extends Error {}

export function decodePortraitImage(
  imageData: string | undefined,
  mimeType: string | undefined,
): { bytes: Uint8Array; mimeType: string } {
  const normalizedMimeType = mimeType?.trim().toLowerCase();
  const extension = normalizedMimeType ? IMAGE_EXTENSIONS[normalizedMimeType] : undefined;
  if (!normalizedMimeType || !extension) {
    throw new PortraitOutputError("Gemini did not return a supported portrait image type.");
  }

  const normalizedData = imageData?.replace(/\s/g, "") ?? "";
  if (
    !normalizedData ||
    normalizedData.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedData)
  ) {
    throw new PortraitOutputError("Gemini did not return usable portrait image data.");
  }

  const bytes = Buffer.from(normalizedData, "base64");
  if (bytes.length === 0) {
    throw new PortraitOutputError("Gemini did not return usable portrait image data.");
  }

  return { bytes, mimeType: normalizedMimeType };
}

function incompletePortrait(state: PortraitState): boolean {
  return state !== "SUCCEEDED";
}

export class PortraitService {
  constructor(
    private readonly repository: PortraitRepository,
    private readonly provider: GeminiProvider,
    private readonly executor: PipelineExecutor,
  ) {}

  async execute(userId: string, projectId: string): Promise<PortraitExecutionResult> {
    if (!this.repository.getPortraitProject(userId, projectId)) {
      throw new PortraitProjectNotFoundError("Project not found.");
    }

    const execution = await this.executor.executeStep(projectId, "PORTRAITS", async () => {
      let context = this.repository.getPortraitProject(userId, projectId);
      if (!context) {
        throw new PortraitProjectNotFoundError("Project not found.");
      }
      if (!context.characterInteractionId) {
        throw new Error(
          "Persisted Characters interaction context is missing; Portraits cannot continue.",
        );
      }
      if (!context.style?.trim()) {
        throw new Error("Persisted Style is missing; Portraits cannot continue.");
      }
      if (
        context.characters.some((character) => character.portraitState === "SUCCEEDED") &&
        !context.imageInteractionId
      ) {
        throw new Error(
          "Persisted portrait image context is missing; completed portraits cannot be resumed safely.",
        );
      }

      const remaining = context.characters.filter((character) =>
        incompletePortrait(character.portraitState),
      );
      if (remaining.length === 0) {
        return;
      }

      let previousInteractionId = context.imageInteractionId;
      if (!previousInteractionId) {
        const imageContext = await this.provider.createPortraitContext(context.style);
        previousInteractionId = imageContext.interactionId;
        this.repository.saveImageInteractionId(projectId, previousInteractionId);
      }

      for (const character of remaining) {
        this.repository.markPortraitRunning(projectId, character.position);
        try {
          const generated = await this.provider.generatePortrait(
            previousInteractionId,
            character.name,
            character.prompt,
          );
          const image = decodePortraitImage(generated.imageData, generated.mimeType);
          await this.repository.savePortraitSuccess(
            projectId,
            character.position,
            image.bytes,
            image.mimeType,
            generated.interactionId,
          );
          previousInteractionId = generated.interactionId;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Portrait generation failed.";
          this.repository.markPortraitFailed(projectId, character.position, message);
          throw error;
        }
      }

      context = this.repository.getPortraitProject(userId, projectId);
      if (
        !context ||
        context.characters.some((character) => incompletePortrait(character.portraitState))
      ) {
        throw new Error("Portrait generation did not complete every character.");
      }
    });

    const context = this.repository.getPortraitProject(userId, projectId);
    return { execution, characters: context?.characters ?? [] };
  }
}
