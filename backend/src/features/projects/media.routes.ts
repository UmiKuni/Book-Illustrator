import type { Express, RequestHandler } from "express";

import { LocalStore, type User } from "../../infrastructure/persistence/local-store.js";

export function registerMediaRoutes(
  app: Express,
  store: LocalStore,
  requireUser: RequestHandler,
): void {
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
}
