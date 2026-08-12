import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp, type AppContext } from "../src/app.js";

let context: AppContext;
let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), "book-studio-test-"));
  context = createApp({ dataDirectory });
});

afterEach(async () => {
  context.close();
  await rm(dataDirectory, { force: true, recursive: true });
});

async function signIn(agent: ReturnType<typeof request.agent>, name: string, email: string) {
  return agent.post("/api/session").send({ name, email });
}

describe("identity and project persistence", () => {
  it("creates and resumes the same user by normalized email", async () => {
    const firstAgent = request.agent(context.app);
    const firstSignIn = await signIn(firstAgent, "Mira Hassan", "Mira@Example.com");

    expect(firstSignIn.status).toBe(200);
    expect(firstSignIn.body.user.email).toBe("mira@example.com");
    expect(firstSignIn.headers["set-cookie"]?.[0]).toContain("HttpOnly");

    const userId = firstSignIn.body.user.id;
    await firstAgent
      .post("/api/projects")
      .send({ title: "River Story", bookText: "Once beside the river..." })
      .expect(201);
    await firstAgent.delete("/api/session").expect(204);
    await firstAgent.get("/api/projects").expect(401);

    context.close();
    context = createApp({ dataDirectory });

    const resumedAgent = request.agent(context.app);
    const resumedSignIn = await signIn(resumedAgent, "Mira Hassan", "mira@example.com");

    expect(resumedSignIn.status).toBe(200);
    expect(resumedSignIn.body.user.id).toBe(userId);
    const projects = await resumedAgent.get("/api/projects").expect(200);
    expect(projects.body.projects).toHaveLength(1);
  });

  it("creates, lists, and loads a project while storing its book on disk", async () => {
    const agent = request.agent(context.app);
    await signIn(agent, "Mira Hassan", "mira@example.com").then((response) => {
      expect(response.status).toBe(200);
    });

    const created = await agent
      .post("/api/projects")
      .send({ title: "  The River Bank  ", bookText: "  Once beside the river...  " })
      .expect(201);

    expect(created.body.project).toMatchObject({
      title: "The River Bank",
      bookText: "  Once beside the river...  ",
      status: "Draft",
      completedSteps: 0,
      totalSteps: 5,
    });
    expect(created.body.project.steps).toHaveLength(5);
    expect(
      created.body.project.steps.every((step: { state: string }) => step.state === "PENDING"),
    ).toBe(true);

    const projectId = created.body.project.id as string;
    const list = await agent.get("/api/projects").expect(200);
    expect(list.body.projects).toEqual([
      expect.objectContaining({ id: projectId, title: "The River Bank", status: "Draft" }),
    ]);
    expect(list.body.projects[0]).not.toHaveProperty("bookText");

    const detail = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(detail.body.project.bookText).toBe("  Once beside the river...  ");
    await expect(
      readFile(path.join(dataDirectory, "projects", projectId, "book.txt"), "utf8"),
    ).resolves.toBe("  Once beside the river...  ");
  });

  it("creates a project from a readable .txt upload using the existing book storage", async () => {
    const agent = request.agent(context.app);
    expect((await signIn(agent, "Mira Hassan", "mira@example.com")).status).toBe(200);
    const bookText = "Chapter One\n\nMole stepped into the sunlight. ☀";

    const created = await agent
      .post("/api/projects")
      .field("title", "Uploaded River Story")
      .attach("book", Buffer.from(bookText, "utf8"), {
        filename: "river-story.txt",
        contentType: "text/plain",
      })
      .expect(201);

    expect(created.body.project).toMatchObject({
      title: "Uploaded River Story",
      bookText,
      status: "Draft",
    });
    const projectId = created.body.project.id as string;
    const detail = await agent.get(`/api/projects/${projectId}`).expect(200);
    expect(detail.body.project.bookText).toBe(bookText);
    await expect(
      readFile(path.join(dataDirectory, "projects", projectId, "book.txt"), "utf8"),
    ).resolves.toBe(bookText);
  });

  it.each([
    ["a missing file", undefined, undefined],
    ["an empty file", Buffer.alloc(0), "empty.txt"],
    ["a non-.txt file", Buffer.from("Readable text"), "book.md"],
    ["unreadable UTF-8", Buffer.from([0xc3, 0x28]), "book.txt"],
  ])("rejects %s in multipart project creation", async (_caseName, contents, filename) => {
    const agent = request.agent(context.app);
    expect((await signIn(agent, "Mira Hassan", "mira@example.com")).status).toBe(200);
    let projectRequest = agent.post("/api/projects").field("title", "Invalid Upload");
    if (contents && filename) {
      projectRequest = projectRequest.attach("book", contents, {
        filename,
        contentType: filename.endsWith(".txt") ? "text/plain" : "text/markdown",
      });
    }

    await projectRequest.expect(400);
    const projects = await agent.get("/api/projects").expect(200);
    expect(projects.body.projects).toEqual([]);
  });

  it("rejects a .txt upload above the bounded size limit", async () => {
    const agent = request.agent(context.app);
    expect((await signIn(agent, "Mira Hassan", "mira@example.com")).status).toBe(200);

    const response = await agent
      .post("/api/projects")
      .field("title", "Oversized Upload")
      .attach("book", Buffer.alloc(10 * 1024 * 1024 + 1, "a"), {
        filename: "large.txt",
        contentType: "text/plain",
      })
      .expect(413);

    expect(response.body.error).toBe("The uploaded book exceeds the 10 MB limit.");
  });

  it("does not expose one user's project to another user", async () => {
    const owner = request.agent(context.app);
    const otherUser = request.agent(context.app);
    await signIn(owner, "Owner", "owner@example.com");
    await signIn(otherUser, "Other", "other@example.com");

    const created = await owner
      .post("/api/projects")
      .send({ title: "Private Book", bookText: "Private text" })
      .expect(201);

    await otherUser.get(`/api/projects/${created.body.project.id}`).expect(404);
    const otherProjects = await otherUser.get("/api/projects").expect(200);
    expect(otherProjects.body.projects).toEqual([]);
  });

  it("rejects invalid sessions, unauthenticated access, and invalid projects", async () => {
    await request(context.app).post("/api/session").send({ name: "", email: "bad" }).expect(400);
    await request(context.app)
      .post("/api/session")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    await request(context.app).get("/api/projects").expect(401);
    await request(context.app)
      .get("/api/projects")
      .set("Cookie", "book_studio_session=%invalid")
      .expect(401);
    await request(context.app)
      .post("/api/projects")
      .send({ title: "Book", bookText: "Text" })
      .expect(401);

    const agent = request.agent(context.app);
    await signIn(agent, "Mira Hassan", "mira@example.com");
    await agent.post("/api/projects").send({ title: "", bookText: "Text" }).expect(400);
    await agent.post("/api/projects").send({ title: "Book", bookText: "  " }).expect(400);
    await agent.get("/api/projects/does-not-exist").expect(404);
  });
});
