import path from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import { ChapterProjectNotFoundError, ChapterService } from "./chapters.js";
import { CharacterProjectNotFoundError, CharacterService } from "./characters.js";
import { GoogleGeminiProvider, type GeminiProvider } from "./gemini.js";
import {
  IllustrationProjectNotFoundError,
  IllustrationService,
} from "./illustrations.js";
import { LocalStore, type User } from "./local-store.js";
import {
  PipelineExecutor,
  PIPELINE_STEP_NAMES,
  PipelineRuleError,
  PipelineService,
  type PipelineStepName,
} from "./pipeline.js";
import { PortraitProjectNotFoundError, PortraitService } from "./portraits.js";
import { StyleProjectNotFoundError, StyleService } from "./style.js";

const SESSION_COOKIE = "book_studio_session";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BOOK_UPLOAD_BYTES = 10 * 1024 * 1024;
const projectUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_BOOK_UPLOAD_BYTES,
    files: 1,
    fields: 1,
    parts: 3,
    fieldSize: 1_000,
  },
}).single("book");

export interface AppOptions {
  dataDirectory?: string;
  geminiProvider?: GeminiProvider;
  staleAfterMs?: number;
}

export interface AppContext {
  app: express.Express;
  close: () => void;
}

function parseSessionToken(request: Request): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function textField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function bookTextField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function pipelineStepName(value: unknown): PipelineStepName | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.toUpperCase();
  return PIPELINE_STEP_NAMES.find((stepName) => stepName === normalized);
}

function parseProjectUpload(request: Request, response: Response, next: NextFunction): void {
  if (!request.is("multipart/form-data")) {
    next();
    return;
  }
  projectUpload(request, response, next);
}

export function createApp(options: AppOptions = {}): AppContext {
  const dataDirectory = path.resolve(options.dataDirectory ?? process.env.APP_DATA_DIR ?? "data");
  const store = new LocalStore(dataDirectory);
  const configuredStaleAfterMs = Number(process.env.STEP_STALE_AFTER_MS ?? 300_000);
  const staleAfterMs =
    options.staleAfterMs ??
    (Number.isFinite(configuredStaleAfterMs) ? configuredStaleAfterMs : 300_000);
  const pipeline = new PipelineService(store, {
    staleAfterMs,
  });
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

  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.post("/api/session", (request, response) => {
    const name = textField(request.body?.name);
    const email = textField(request.body?.email)?.toLowerCase();

    if (!name || !email || !EMAIL_PATTERN.test(email)) {
      response.status(400).json({ error: "A name and valid email are required." });
      return;
    }

    const user = store.findOrCreateUser(name, email);
    const sessionToken = store.createSession(user.id);
    response.cookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    response.status(200).json({ user });
  });

  app.delete("/api/session", (request, response) => {
    const sessionToken = parseSessionToken(request);
    if (sessionToken) {
      store.deleteSession(sessionToken);
    }

    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    response.status(204).send();
  });

  const requireUser = (request: Request, response: Response, next: NextFunction): void => {
    const sessionToken = parseSessionToken(request);
    const user = sessionToken ? store.findUserBySession(sessionToken) : undefined;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    response.locals.user = user;
    next();
  };

  app.get("/api/session", requireUser, (_request, response) => {
    response.status(200).json({ user: response.locals.user as User });
  });

  app.get("/api/projects", requireUser, (_request, response) => {
    const user = response.locals.user as User;
    response.status(200).json({ projects: store.listProjects(user.id) });
  });

  app.post("/api/projects", requireUser, parseProjectUpload, async (request, response) => {
    const title = textField(request.body?.title);
    const multipartRequest = Boolean(request.is("multipart/form-data"));
    let bookText: string | undefined;

    if (multipartRequest) {
      const uploadedBook = request.file;
      const extension = uploadedBook
        ? path.extname(uploadedBook.originalname).toLowerCase()
        : undefined;
      const validMimeType =
        uploadedBook?.mimetype === "text/plain" ||
        uploadedBook?.mimetype === "application/octet-stream";

      if (!uploadedBook || extension !== ".txt" || !validMimeType) {
        response.status(400).json({ error: "A readable .txt book file is required." });
        return;
      }

      try {
        bookText = bookTextField(
          new TextDecoder("utf-8", { fatal: true }).decode(uploadedBook.buffer),
        );
      } catch {
        response
          .status(400)
          .json({ error: "The uploaded .txt book must contain readable UTF-8 text." });
        return;
      }
    } else {
      bookText = bookTextField(request.body?.bookText);
    }

    if (!title || !bookText) {
      response.status(400).json({
        error: multipartRequest
          ? "A title and non-empty .txt book file are required."
          : "A title and non-empty book text are required.",
      });
      return;
    }

    const user = response.locals.user as User;
    const project = await store.createProject(user.id, title, bookText);
    response.status(201).json({ project });
  });

  app.get("/api/projects/:id", requireUser, async (request, response) => {
    const user = response.locals.user as User;
    const projectId = request.params.id;
    const project =
      typeof projectId === "string" ? await store.getProject(user.id, projectId) : undefined;

    if (!project) {
      response.status(404).json({ error: "Project not found." });
      return;
    }

    response.status(200).json({ project });
  });

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

  app.get(
    "/api/projects/:id/characters/:position/portrait",
    requireUser,
    async (request, response) => {
      const user = response.locals.user as User;
      const projectId = request.params.id;
      const position = Number(request.params.position);
      const media =
        typeof projectId === "string" && Number.isInteger(position) && position >= 0
          ? await store.getPortraitMedia(user.id, projectId, position)
          : undefined;

      if (!media) {
        response.status(404).json({ error: "Portrait not found." });
        return;
      }

      response.status(200).type(media.mimeType).send(Buffer.from(media.bytes));
    },
  );

  app.get(
    "/api/projects/:id/chapters/:position/illustration",
    requireUser,
    async (request, response) => {
      const user = response.locals.user as User;
      const projectId = request.params.id;
      const position = Number(request.params.position);
      const media =
        typeof projectId === "string" && Number.isInteger(position) && position >= 0
          ? await store.getIllustrationMedia(user.id, projectId, position)
          : undefined;

      if (!media) {
        response.status(404).json({ error: "Illustration not found." });
        return;
      }

      response.status(200).type(media.mimeType).send(Buffer.from(media.bytes));
    },
  );

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
