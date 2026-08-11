import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import {
  deriveProjectProgress,
  PIPELINE_STEP_NAMES,
  type PipelineRepository,
  type PipelineStep,
  type PipelineStepName,
  type PipelineStepState,
  type PipelineStepUpdate,
  type ProjectStatus,
} from "./pipeline.js";

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: string;
  status: ProjectStatus;
  completedSteps: number;
  totalSteps: 5;
}

export interface ProjectDetail extends ProjectSummary {
  bookText: string;
  steps: PipelineStep[];
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

interface PipelineStepRow {
  step_name: PipelineStepName;
  position: number;
  state: PipelineStepState;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  attempt_count: number;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pipelineStep(row: PipelineStepRow): PipelineStep {
  return {
    name: row.step_name,
    position: row.position,
    state: row.state,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count,
  };
}

function projectSummary(row: ProjectRow, steps: PipelineStep[]): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    ...deriveProjectProgress(steps),
  };
}

export class LocalStore implements PipelineRepository {
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

      CREATE TABLE IF NOT EXISTS pipeline_steps (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        step_name TEXT NOT NULL,
        position INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')),
        started_at TEXT,
        finished_at TEXT,
        error_message TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, step_name),
        UNIQUE (project_id, position)
      );
    `);

    const backfillStep = this.database.prepare(`
      INSERT OR IGNORE INTO pipeline_steps (project_id, step_name, position, state)
      SELECT id, ?, ?, 'PENDING' FROM projects
    `);
    const backfillPipeline = this.database.transaction(() => {
      PIPELINE_STEP_NAMES.forEach((stepName, position) => {
        backfillStep.run(stepName, position);
      });
    });
    backfillPipeline();
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

    return rows.map((row) => projectSummary(row, this.getPipelineSteps(row.id)));
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
      const insertProject = this.database.prepare(`
        INSERT INTO projects (id, user_id, title, book_path, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertStep = this.database.prepare(`
        INSERT INTO pipeline_steps (project_id, step_name, position, state)
        VALUES (?, ?, ?, 'PENDING')
      `);
      const persistProject = this.database.transaction(() => {
        insertProject.run(id, userId, title, relativeBookPath, createdAt);
        PIPELINE_STEP_NAMES.forEach((stepName, position) => {
          insertStep.run(id, stepName, position);
        });
      });
      persistProject();
    } catch (error) {
      await rm(projectDirectory, { force: true, recursive: true });
      throw error;
    }

    const steps = this.getPipelineSteps(id);
    return {
      ...projectSummary(
        { id, title, created_at: createdAt, book_path: relativeBookPath },
        steps,
      ),
      bookText,
      steps,
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

    const steps = this.getPipelineSteps(projectId);
    return {
      ...projectSummary(row, steps),
      bookText: await readFile(absoluteBookPath, "utf8"),
      steps,
    };
  }

  getPipelineSteps(projectId: string): PipelineStep[] {
    const rows = this.database
      .prepare(`
        SELECT step_name, position, state, started_at, finished_at, error_message, attempt_count
        FROM pipeline_steps
        WHERE project_id = ?
        ORDER BY position
      `)
      .all(projectId) as PipelineStepRow[];

    return rows.map(pipelineStep);
  }

  updatePipelineStep(
    projectId: string,
    stepName: PipelineStepName,
    update: PipelineStepUpdate,
  ): void {
    const result = this.database
      .prepare(`
        UPDATE pipeline_steps
        SET state = ?, started_at = ?, finished_at = ?, error_message = ?,
            attempt_count = attempt_count + ?
        WHERE project_id = ? AND step_name = ?
      `)
      .run(
        update.state,
        update.startedAt,
        update.finishedAt,
        update.errorMessage,
        update.incrementAttempt ? 1 : 0,
        projectId,
        stepName,
      );

    if (result.changes !== 1) {
      throw new Error(`Pipeline step ${stepName} was not found.`);
    }
  }

  close(): void {
    this.database.close();
  }
}
