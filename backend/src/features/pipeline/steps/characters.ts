import type { GeminiProvider } from "../../../integrations/gemini/gemini.js";
import {
  PipelineExecutor,
  type PipelineExecutionResult,
  type PipelineRepository,
} from "../pipeline.js";

const MAX_CHARACTERS = 2;

export type PortraitState = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface Character {
  position: number;
  name: string;
  prompt: string;
  portraitState: PortraitState;
  portraitImagePath: string | null;
  portraitMimeType: string | null;
  portraitErrorMessage: string | null;
}

export interface CharacterProjectContext {
  id: string;
  styleInteractionId: string | null;
  characterInteractionId: string | null;
  characters: Character[];
}

export interface CharacterRepository extends PipelineRepository {
  getCharacterProject(userId: string, projectId: string): CharacterProjectContext | undefined;
  saveCharacters(
    projectId: string,
    characters: Character[],
    interactionId: string,
  ): void;
}

export interface CharacterExecutionResult {
  execution: PipelineExecutionResult;
  characters: Character[];
}

export class CharacterProjectNotFoundError extends Error {}

export class CharacterOutputError extends Error {}

export function parseCharacterOutput(outputText: string | undefined): Character[] {
  if (typeof outputText !== "string" || outputText.trim().length === 0) {
    throw new CharacterOutputError("Gemini did not return character output.");
  }

  let output: unknown;
  try {
    output = JSON.parse(outputText);
  } catch {
    throw new CharacterOutputError("Gemini returned malformed character JSON.");
  }

  if (!Array.isArray(output)) {
    throw new CharacterOutputError("Gemini character output must be an array.");
  }

  if (output.length === 0) {
    throw new CharacterOutputError("Gemini did not return a usable character record.");
  }

  return output.slice(0, MAX_CHARACTERS).map((record, position) => {
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      throw new CharacterOutputError(`Character ${position + 1} must be an object.`);
    }

    const name = "name" in record && typeof record.name === "string" ? record.name.trim() : "";
    const prompt =
      "prompt" in record && typeof record.prompt === "string" ? record.prompt.trim() : "";

    if (!name || !prompt) {
      throw new CharacterOutputError(
        `Character ${position + 1} requires a non-empty name and prompt.`,
      );
    }

    return {
      position,
      name,
      prompt,
      portraitState: "PENDING",
      portraitImagePath: null,
      portraitMimeType: null,
      portraitErrorMessage: null,
    };
  });
}

export class CharacterService {
  constructor(
    private readonly repository: CharacterRepository,
    private readonly provider: GeminiProvider,
    private readonly executor: PipelineExecutor,
  ) {}

  async execute(userId: string, projectId: string): Promise<CharacterExecutionResult> {
    if (!this.repository.getCharacterProject(userId, projectId)) {
      throw new CharacterProjectNotFoundError("Project not found.");
    }

    const execution = await this.executor.executeStep(projectId, "CHARACTERS", async () => {
      const context = this.repository.getCharacterProject(userId, projectId);
      if (!context) {
        throw new CharacterProjectNotFoundError("Project not found.");
      }
      if (context.characterInteractionId) {
        return;
      }
      if (!context.styleInteractionId) {
        throw new Error("Persisted Style interaction context is missing; Characters cannot continue.");
      }

      const generated = await this.provider.generateCharacters(context.styleInteractionId);
      const characters = parseCharacterOutput(generated.outputText);
      this.repository.saveCharacters(projectId, characters, generated.interactionId);
    });

    const context = this.repository.getCharacterProject(userId, projectId);
    return { execution, characters: context?.characters ?? [] };
  }
}
