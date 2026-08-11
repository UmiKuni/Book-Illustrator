import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, type AppContext } from "../src/app.js";

let context: AppContext | undefined;
let dataDirectory: string | undefined;

afterEach(async () => {
  context?.close();
  if (dataDirectory) {
    await rm(dataDirectory, { force: true, recursive: true });
  }
  context = undefined;
  dataDirectory = undefined;
});

describe("GET /health", () => {
  it("returns the API health status without opening a network port", async () => {
    dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-health-"));
    context = createApp({ dataDirectory });

    const response = await request(context.app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
