import path from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";

import { LocalStore, type User } from "./local-store.js";

const SESSION_COOKIE = "book_studio_session";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AppOptions {
  dataDirectory?: string;
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

export function createApp(options: AppOptions = {}): AppContext {
  const dataDirectory = path.resolve(options.dataDirectory ?? process.env.APP_DATA_DIR ?? "data");
  const store = new LocalStore(dataDirectory);
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

  app.get("/api/projects", requireUser, (_request, response) => {
    const user = response.locals.user as User;
    response.status(200).json({ projects: store.listProjects(user.id) });
  });

  app.post("/api/projects", requireUser, async (request, response) => {
    const title = textField(request.body?.title);
    const bookText = bookTextField(request.body?.bookText);

    if (!title || !bookText) {
      response.status(400).json({ error: "A title and non-empty book text are required." });
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

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
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
