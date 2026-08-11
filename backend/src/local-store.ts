import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: string;
  status: "Draft";
  completedSteps: 0;
  totalSteps: 5;
}

export interface ProjectDetail extends ProjectSummary {
  bookText: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
}

interface ProjectRow {
  id: string;
  title: string;
  book_path: string;
  created_at: string;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function projectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    status: "Draft",
    completedSteps: 0,
    totalSteps: 5,
  };
}

export class LocalStore {
  private readonly database: Database.Database;

  constructor(private readonly dataDirectory: string) {
    const absoluteDataDirectory = path.resolve(dataDirectory);
    this.dataDirectory = absoluteDataDirectory;

    mkdirSync(absoluteDataDirectory, { recursive: true });
    const databasePath = path.join(absoluteDataDirectory, "app.sqlite");
    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        book_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  findOrCreateUser(name: string, email: string): User {
    this.database
      .prepare(`
        INSERT INTO users (id, name, email, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET name = excluded.name
      `)
      .run(randomUUID(), name, email, new Date().toISOString());

    return this.database
      .prepare("SELECT id, name, email FROM users WHERE email = ?")
      .get(email) as UserRow;
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.database
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)")
      .run(hashSessionToken(token), userId, new Date().toISOString());
    return token;
  }

  findUserBySession(token: string): User | undefined {
    const user = this.database
      .prepare(`
        SELECT users.id, users.name, users.email
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
      `)
      .get(hashSessionToken(token)) as UserRow | undefined;

    return user;
  }

  deleteSession(token: string): void {
    this.database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
  }

  listProjects(userId: string): ProjectSummary[] {
    const rows = this.database
      .prepare(`
        SELECT id, title, book_path, created_at
        FROM projects
        WHERE user_id = ?
        ORDER BY created_at DESC, rowid DESC
      `)
      .all(userId) as ProjectRow[];

    return rows.map(projectSummary);
  }

  async createProject(userId: string, title: string, bookText: string): Promise<ProjectDetail> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const relativeBookPath = path.posix.join("projects", id, "book.txt");
    const projectDirectory = path.join(this.dataDirectory, "projects", id);
    const absoluteBookPath = path.join(projectDirectory, "book.txt");

    await mkdir(projectDirectory, { recursive: true });
    await writeFile(absoluteBookPath, bookText, "utf8");

    try {
      this.database
        .prepare(`
          INSERT INTO projects (id, user_id, title, book_path, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(id, userId, title, relativeBookPath, createdAt);
    } catch (error) {
      await rm(projectDirectory, { force: true, recursive: true });
      throw error;
    }

    return {
      id,
      title,
      createdAt,
      status: "Draft",
      completedSteps: 0,
      totalSteps: 5,
      bookText,
    };
  }

  async getProject(userId: string, projectId: string): Promise<ProjectDetail | undefined> {
    const row = this.database
      .prepare(`
        SELECT id, title, book_path, created_at
        FROM projects
        WHERE id = ? AND user_id = ?
      `)
      .get(projectId, userId) as ProjectRow | undefined;

    if (!row) {
      return undefined;
    }

    const absoluteBookPath = path.resolve(this.dataDirectory, row.book_path);
    const dataRoot = `${this.dataDirectory}${path.sep}`;
    if (!absoluteBookPath.startsWith(dataRoot)) {
      throw new Error("Stored book path is outside the application data directory");
    }

    return {
      ...projectSummary(row),
      bookText: await readFile(absoluteBookPath, "utf8"),
    };
  }

  close(): void {
    this.database.close();
  }
}
