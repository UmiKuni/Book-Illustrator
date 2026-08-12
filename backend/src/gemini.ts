import { GoogleGenAI } from "@google/genai";

const BOOK_CONTEXT_PROMPT =
  "Here's a book, to illustrate using Nano Banana. Don't say anything for now, instructions will follow.";
const GENERATED_STYLE_PROMPT =
  "Can you define an art style that would fit the story but with a twist? Just give us the prompt for the art style that will be added to future prompts.";

export interface GeminiBookReference {
  uri: string;
}

export interface GeminiInteractionReference {
  interactionId: string;
}

export interface GeminiGeneratedStyle extends GeminiInteractionReference {
  style: string;
}

export interface GeminiProvider {
  uploadBook(bookPath: string): Promise<GeminiBookReference>;
  createBookInteraction(bookUri: string): Promise<GeminiInteractionReference>;
  generateStyle(bookInteractionId: string): Promise<GeminiGeneratedStyle>;
  continueWithStyle(
    bookInteractionId: string,
    style: string,
  ): Promise<GeminiInteractionReference>;
}

export interface GoogleGeminiProviderOptions {
  apiKey?: string;
  textModel: string;
}

function requiredProviderString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Gemini did not return a valid ${label}.`);
  }
  return value.trim();
}

export class GoogleGeminiProvider implements GeminiProvider {
  private client: GoogleGenAI | undefined;

  constructor(private readonly options: GoogleGeminiProviderOptions) {}

  async uploadBook(bookPath: string): Promise<GeminiBookReference> {
    const file = await this.getClient().files.upload({
      file: bookPath,
      config: { mimeType: "text/plain" },
    });

    return { uri: requiredProviderString(file.uri, "book file URI") };
  }

  async createBookInteraction(bookUri: string): Promise<GeminiInteractionReference> {
    const interaction = await this.getClient().interactions.create({
      model: this.options.textModel,
      input: [
        { type: "text", text: BOOK_CONTEXT_PROMPT },
        { type: "document", uri: bookUri, mime_type: "text/plain" },
      ],
    });

    return {
      interactionId: requiredProviderString(interaction.id, "book interaction ID"),
    };
  }

  async generateStyle(bookInteractionId: string): Promise<GeminiGeneratedStyle> {
    const interaction = await this.getClient().interactions.create({
      model: this.options.textModel,
      input: GENERATED_STYLE_PROMPT,
      previous_interaction_id: bookInteractionId,
    });

    return {
      interactionId: requiredProviderString(interaction.id, "Style interaction ID"),
      style: requiredProviderString(interaction.output_text, "generated Style text"),
    };
  }

  async continueWithStyle(
    bookInteractionId: string,
    style: string,
  ): Promise<GeminiInteractionReference> {
    const interaction = await this.getClient().interactions.create({
      model: this.options.textModel,
      input: `The art style will be: "${style}". Keep that in mind when generating future prompts. Keep quiet for now, instructions will follow.`,
      previous_interaction_id: bookInteractionId,
    });

    return {
      interactionId: requiredProviderString(interaction.id, "Style interaction ID"),
    };
  }

  private getClient(): GoogleGenAI {
    const apiKey = this.options.apiKey?.trim();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    this.client ??= new GoogleGenAI({ apiKey });
    return this.client;
  }
}
