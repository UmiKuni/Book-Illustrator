import path from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import { registerPipelineRoutes } from "../features/pipeline/pipeline.routes.js";
import { PipelineExecutor, PipelineService } from "../features/pipeline/pipeline.js";
import { ChapterService } from "../features/pipeline/steps/chapters.js";
import { CharacterService } from "../features/pipeline/steps/characters.js";
import { IllustrationService } from "../features/pipeline/steps/illustrations.js";
import { PortraitService } from "../features/pipeline/steps/portraits.js";
import { StyleService } from "../features/pipeline/steps/style.js";
import { registerMediaRoutes } from "../features/projects/media.routes.js";
import { registerProjectRoutes } from "../features/projects/project.routes.js";
import {
  createRequireUser,
  registerSessionRoutes,
} from "../features/session/session.routes.js";
import {
  GoogleGeminiProvider,
  type GeminiProvider,
} from "../integrations/gemini/gemini.js";
import { LocalStore } from "../infrastructure/persistence/local-store.js";

export interface AppOptions {
  dataDirectory?: string;
  geminiProvider?: GeminiProvider;
  staleAfterMs?: number;
}

export interface AppContext {
  app: express.Express;
  close: () => void;
}

export function createApp(options: AppOptions = {}): AppContext {
  const dataDirectory = path.resolve(options.dataDirectory ?? process.env.APP_DATA_DIR ?? "data");
  const store = new LocalStore(dataDirectory);
  const configuredStaleAfterMs = Number(process.env.STEP_STALE_AFTER_MS ?? 300_000);
  const staleAfterMs =
    options.staleAfterMs ??
    (Number.isFinite(configuredStaleAfterMs) ? configuredStaleAfterMs : 300_000);
  const pipeline = new PipelineService(store, { staleAfterMs });
  const geminiProvider =
    options.geminiProvider ??
    new GoogleGeminiProvider({
      apiKey: process.env.GEMINI_API_KEY,
      textModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-3.6-flash",
      imageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-lite-image",
    });
  const styleService = new StyleService(store, geminiProvider, new PipelineExecutor(pipeline));
  const characterService = new CharacterService(
    store,
    geminiProvider,
    new PipelineExecutor(pipeline),
  );
  const portraitService = new PortraitService(
    store,
    geminiProvider,
    new PipelineExecutor(pipeline),
  );
  const chapterService = new ChapterService(
    store,
    geminiProvider,
    new PipelineExecutor(pipeline),
  );
  const illustrationService = new IllustrationService(
    store,
    geminiProvider,
    new PipelineExecutor(pipeline),
  );
  const app = express();
  const requireUser = createRequireUser(store);

  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  registerSessionRoutes(app, store, requireUser);
  registerProjectRoutes(app, store, requireUser);
  registerMediaRoutes(app, store, requireUser);
  registerPipelineRoutes(app, {
    store,
    pipeline,
    styleService,
    characterService,
    portraitService,
    chapterService,
    illustrationService,
    requireUser,
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "The uploaded book exceeds the 10 MB limit."
            : "Invalid book upload.",
      });
      return;
    }

    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 400 &&
      error.status < 500
        ? error.status
        : 500;

    if (status === 500) {
      console.error(error);
    }
    response.status(status).json({ error: status === 400 ? "Invalid request." : "Request failed." });
  });

  return {
    app,
    close: () => store.close(),
  };
}
