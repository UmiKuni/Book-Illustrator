import path from "node:path";

import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";

import { LocalStore, type User } from "../../infrastructure/persistence/local-store.js";

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

function parseProjectUpload(request: Request, response: Response, next: NextFunction): void {
  if (!request.is("multipart/form-data")) {
    next();
    return;
  }
  projectUpload(request, response, next);
}

export function registerProjectRoutes(
  app: Express,
  store: LocalStore,
  requireUser: RequestHandler,
): void {
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
}
