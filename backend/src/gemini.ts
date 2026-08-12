import { GoogleGenAI } from "@google/genai";

const BOOK_CONTEXT_PROMPT =
  "Here's a book, to illustrate using Nano Banana. Don't say anything for now, instructions will follow.";
const GENERATED_STYLE_PROMPT =
  "Can you define an art style that would fit the story but with a twist? Just give us the prompt for the art style that will be added to future prompts.";
const CHARACTER_PROMPT =
  "Describe the main characters from the book, only the adults, and prepare a detailed image prompt for each one using the book's descriptions. Each prompt should be at least 50 words.";

const CHARACTER_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The adult main character's name.",
      },
      prompt: {
        type: "string",
        description: "A detailed image-generation prompt based on the book.",
      },
    },
    required: ["name", "prompt"],
    additionalProperties: false,
  },
} as const;
const PORTRAIT_CONTEXT_RULES = `
There must be no text on the image, and it must not look like a cover page.
Produce a full illustration without borders, titles, descriptions, or panels.
Stay family-friendly with uplifting colors.`;

export interface GeminiBookReference {
  uri: string;
}

export interface GeminiInteractionReference {
  interactionId: string;
}

export interface GeminiGeneratedStyle extends GeminiInteractionReference {
  style: string;
}

export interface GeminiCharacterOutput extends GeminiInteractionReference {
  outputText: string | undefined;
}

export interface GeminiImageOutput extends GeminiInteractionReference {
  imageData: string | undefined;
  mimeType: string | undefined;
}

export interface GeminiProvider {
  uploadBook(bookPath: string): Promise<GeminiBookReference>;
  createBookInteraction(bookUri: string): Promise<GeminiInteractionReference>;
  generateStyle(bookInteractionId: string): Promise<GeminiGeneratedStyle>;
  continueWithStyle(
    bookInteractionId: string,
    style: string,
  ): Promise<GeminiInteractionReference>;
  generateCharacters(styleInteractionId: string): Promise<GeminiCharacterOutput>;
  createPortraitContext(style: string): Promise<GeminiInteractionReference>;
  generatePortrait(
    previousInteractionId: string,
    characterName: string,
    characterPrompt: string,
  ): Promise<GeminiImageOutput>;
}

export interface GoogleGeminiProviderOptions {
  apiKey?: string;
  textModel: string;
  imageModel: string;
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

  async generateCharacters(styleInteractionId: string): Promise<GeminiCharacterOutput> {
    const interaction = await this.getClient().interactions.create({
      model: this.options.textModel,
      input: CHARACTER_PROMPT,
      previous_interaction_id: styleInteractionId,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: CHARACTER_RESPONSE_SCHEMA,
      },
    });

    return {
      interactionId: requiredProviderString(interaction.id, "Characters interaction ID"),
      outputText: interaction.output_text,
    };
  }

  async createPortraitContext(style: string): Promise<GeminiInteractionReference> {
    const interaction = await this.getClient().interactions.create({
      model: this.options.imageModel,
      input: `You are going to generate portrait images to illustrate this book.
The style to follow is: ${style}
Also follow these rules: ${PORTRAIT_CONTEXT_RULES}`,
    });

    return {
      interactionId: requiredProviderString(interaction.id, "portrait context interaction ID"),
    };
  }

  async generatePortrait(
    previousInteractionId: string,
    characterName: string,
    characterPrompt: string,
  ): Promise<GeminiImageOutput> {
    const interaction = await this.getClient().interactions.create({
      model: this.options.imageModel,
      input: `Create an illustration for ${characterName} following this description: ${characterPrompt}`,
      previous_interaction_id: previousInteractionId,
    });

    let image: { data?: string; mime_type?: string } | undefined;
    for (const step of [...(interaction.steps ?? [])].reverse()) {
      if (step.type !== "model_output") {
        continue;
      }
      for (const content of [...(step.content ?? [])].reverse()) {
        if (content.type === "image") {
          image = content;
          break;
        }
      }
      if (image) {
        break;
      }
    }

    return {
      interactionId: requiredProviderString(interaction.id, "portrait interaction ID"),
      imageData: image?.data,
      mimeType: image?.mime_type,
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
