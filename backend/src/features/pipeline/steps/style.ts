import type { GeminiProvider } from "../../../integrations/gemini/gemini.js";
import {
  PipelineExecutor,
  type PipelineExecutionResult,
  type PipelineRepository,
} from "../pipeline.js";

export interface StyleProjectContext {
  id: string;
  bookPath: string;
  geminiBookUri: string | null;
  bookInteractionId: string | null;
  style: string | null;
  styleInteractionId: string | null;
}

export interface StyleRepository extends PipelineRepository {
  getStyleProject(userId: string, projectId: string): StyleProjectContext | undefined;
  saveGeminiBookUri(projectId: string, bookUri: string): void;
  saveBookInteractionId(projectId: string, interactionId: string): void;
  saveStyle(projectId: string, style: string, interactionId: string): void;
}

export interface StyleExecutionResult {
  execution: PipelineExecutionResult;
  style: string | null;
}

export class StyleProjectNotFoundError extends Error {}

export class StyleService {
  constructor(
    private readonly repository: StyleRepository,
    private readonly provider: GeminiProvider,
    private readonly executor: PipelineExecutor,
  ) {}

  async execute(
    userId: string,
    projectId: string,
    suppliedStyle?: string,
  ): Promise<StyleExecutionResult> {
    if (!this.repository.getStyleProject(userId, projectId)) {
      throw new StyleProjectNotFoundError("Project not found.");
    }

    const requestedStyle = suppliedStyle?.trim() || undefined;
    const execution = await this.executor.executeStep(projectId, "STYLE", async () => {
      const context = this.repository.getStyleProject(userId, projectId);
      if (!context) {
        throw new StyleProjectNotFoundError("Project not found.");
      }

      if (context.style && context.styleInteractionId) {
        return;
      }

      const bookInteractionId = await this.ensureBookContext(context);
      if (requestedStyle) {
        const interaction = await this.provider.continueWithStyle(
          bookInteractionId,
          requestedStyle,
        );
        this.repository.saveStyle(projectId, requestedStyle, interaction.interactionId);
        return;
      }

      const generated = await this.provider.generateStyle(bookInteractionId);
      const style = generated.style.trim();
      if (!style) {
        throw new Error("Gemini did not return generated Style text.");
      }
      this.repository.saveStyle(projectId, style, generated.interactionId);
    });

    const context = this.repository.getStyleProject(userId, projectId);
    return { execution, style: context?.style ?? null };
  }

  private async ensureBookContext(context: StyleProjectContext): Promise<string> {
    if (context.bookInteractionId) {
      return context.bookInteractionId;
    }

    let bookUri = context.geminiBookUri;
    if (!bookUri) {
      const uploaded = await this.provider.uploadBook(context.bookPath);
      bookUri = uploaded.uri;
      this.repository.saveGeminiBookUri(context.id, bookUri);
    }

    const interaction = await this.provider.createBookInteraction(bookUri);
    this.repository.saveBookInteractionId(context.id, interaction.interactionId);
    return interaction.interactionId;
  }
}
