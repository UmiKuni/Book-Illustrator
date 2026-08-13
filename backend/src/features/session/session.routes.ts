import type { Express, NextFunction, Request, RequestHandler, Response } from "express";

import { LocalStore, type User } from "../../infrastructure/persistence/local-store.js";

const SESSION_COOKIE = "book_studio_session";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function createRequireUser(store: LocalStore): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const sessionToken = parseSessionToken(request);
    const user = sessionToken ? store.findUserBySession(sessionToken) : undefined;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    response.locals.user = user;
    next();
  };
}

export function registerSessionRoutes(
  app: Express,
  store: LocalStore,
  requireUser: RequestHandler,
): void {
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

  app.get("/api/session", requireUser, (_request, response) => {
    response.status(200).json({ user: response.locals.user as User });
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
}
