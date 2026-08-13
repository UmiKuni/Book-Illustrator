import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import type {
  Chapter,
  ChapterProjectContext,
  ChapterRepository,
} from "../../features/pipeline/steps/chapters.js";
import type {
  Character,
  CharacterProjectContext,
  CharacterRepository,
} from "../../features/pipeline/steps/characters.js";
import type {
  IllustrationProjectContext,
  IllustrationRepository,
} from "../../features/pipeline/steps/illustrations.js";
import type {
  PortraitProjectContext,
  PortraitRepository,
} from "../../features/pipeline/steps/portraits.js";
import {
  deriveProjectProgress,
  PIPELINE_STEP_NAMES,
  type PipelineStep,
  type PipelineStepName,
  type PipelineStepState,
  type PipelineMutationResult,
  type ProjectStatus,
} from "../../features/pipeline/pipeline.js";
import type {
  StyleProjectContext,
  StyleRepository,
} from "../../features/pipeline/steps/style.js";

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
  style: string | null;
  characters: Character[];
  chapters: Chapter[];
  steps: PipelineStep[];
}

export interface ProjectMedia {
  bytes: Uint8Array;
  mimeType: string;
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

interface ProjectDetailRow extends ProjectRow {
  style: string | null;
}

interface CharacterProjectRow {
  id: string;
  style_interaction_id: string | null;
  character_interaction_id: string | null;
}

interface PortraitProjectRow {
  id: string;
  style: string | null;
  character_interaction_id: string | null;
  image_interaction_id: string | null;
}

interface ChapterProjectRow {
  id: string;
  character_interaction_id: string | null;
  chapter_interaction_id: string | null;
}

interface CharacterRow {
  position: number;
  name: string;
  prompt: string;
  portrait_state: Character["portraitState"];
  portrait_image_path: string | null;
  portrait_mime_type: string | null;
  portrait_error_message: string | null;
}

interface ChapterRow {
  position: number;
  name: string;
  prompt: string;
  illustration_image_path: string | null;
  illustration_mime_type: string | null;
}

interface IllustrationProjectRow {
  id: string;
  image_interaction_id: string | null;
  chapter_image_context_id: string | null;
}

interface MediaRow {
  media_path: string;
  mime_type: string;
}

interface StyleProjectRow {
  id: string;
  book_path: string;
  gemini_book_uri: string | null;
  book_interaction_id: string | null;
  style: string | null;
  style_interaction_id: string | null;
}

interface TableColumnRow {
  name: string;
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

export class LocalStore
  implements
    StyleRepository,
    CharacterRepository,
    PortraitRepository,
    ChapterRepository,
    IllustrationRepository
{
  private readonly database: Database.Database;

  constructor(private readonly dataDirectory: string) {
    const absoluteDataDirectory = path.resolve(dataDirectory);
    this.dataDirectory = absoluteDataDirectory;

    mkdirSync(absoluteDataDirectory, { recursive: true });
    const databasePath = path.join(absoluteDataDirectory, "app.sqlite");
    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("busy_timeout = 5000");
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
        gemini_book_uri TEXT,
        book_interaction_id TEXT,
        style TEXT,
        style_interaction_id TEXT,
        character_interaction_id TEXT,
        chapter_interaction_id TEXT,
        image_interaction_id TEXT,
        chapter_image_context_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS characters (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0 AND position < 2),
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        portrait_state TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (portrait_state IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
        portrait_image_path TEXT,
        portrait_mime_type TEXT,
        portrait_error_message TEXT,
        PRIMARY KEY (project_id, position)
      );

      CREATE TABLE IF NOT EXISTS chapters (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position = 0),
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        illustration_image_path TEXT,
        illustration_mime_type TEXT,
        PRIMARY KEY (project_id, position)
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

    this.ensureProjectColumn("gemini_book_uri", "TEXT");
    this.ensureProjectColumn("book_interaction_id", "TEXT");
    this.ensureProjectColumn("style", "TEXT");
    this.ensureProjectColumn("style_interaction_id", "TEXT");
    this.ensureProjectColumn("character_interaction_id", "TEXT");
    this.ensureProjectColumn("chapter_interaction_id", "TEXT");
    this.ensureProjectColumn("image_interaction_id", "TEXT");
    this.ensureProjectColumn("chapter_image_context_id", "TEXT");
    this.ensureCharacterColumn(
      "portrait_state",
      "TEXT NOT NULL DEFAULT 'PENDING' CHECK (portrait_state IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'))",
    );
    this.ensureCharacterColumn("portrait_image_path", "TEXT");
    this.ensureCharacterColumn("portrait_mime_type", "TEXT");
    this.ensureCharacterColumn("portrait_error_message", "TEXT");
    this.ensureChapterColumn("illustration_image_path", "TEXT");
    this.ensureChapterColumn("illustration_mime_type", "TEXT");

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

  ownsProject(userId: string, projectId: string): boolean {
    return Boolean(
      this.database
        .prepare("SELECT 1 FROM projects WHERE id = ? AND user_id = ?")
        .get(projectId, userId),
    );
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
      style: null,
      characters: [],
      chapters: [],
      steps,
    };
  }

  async getProject(userId: string, projectId: string): Promise<ProjectDetail | undefined> {
    const row = this.database
      .prepare(`
        SELECT id, title, book_path, created_at, style
        FROM projects
        WHERE id = ? AND user_id = ?
      `)
      .get(projectId, userId) as ProjectDetailRow | undefined;

    if (!row) {
      return undefined;
    }

    const absoluteBookPath = this.resolveBookPath(row.book_path);

    const steps = this.getPipelineSteps(projectId);
    return {
      ...projectSummary(row, steps),
      bookText: await readFile(absoluteBookPath, "utf8"),
      style: row.style,
      characters: this.getCharacters(projectId),
      chapters: this.getChapters(projectId),
      steps,
    };
  }

  async getPortraitMedia(
    userId: string,
    projectId: string,
    position: number,
  ): Promise<ProjectMedia | undefined> {
    const row = this.database
      .prepare(`
        SELECT characters.portrait_image_path AS media_path,
               characters.portrait_mime_type AS mime_type
        FROM characters
        JOIN projects ON projects.id = characters.project_id
        WHERE projects.id = ? AND projects.user_id = ? AND characters.position = ?
          AND characters.portrait_state = 'SUCCEEDED'
          AND characters.portrait_image_path IS NOT NULL
          AND characters.portrait_mime_type IS NOT NULL
      `)
      .get(projectId, userId, position) as MediaRow | undefined;

    return row ? this.readProjectMedia(projectId, row) : undefined;
  }

  async getIllustrationMedia(
    userId: string,
    projectId: string,
    position: number,
  ): Promise<ProjectMedia | undefined> {
    const row = this.database
      .prepare(`
        SELECT chapters.illustration_image_path AS media_path,
               chapters.illustration_mime_type AS mime_type
        FROM chapters
        JOIN projects ON projects.id = chapters.project_id
        WHERE projects.id = ? AND projects.user_id = ? AND chapters.position = ?
          AND chapters.illustration_image_path IS NOT NULL
          AND chapters.illustration_mime_type IS NOT NULL
      `)
      .get(projectId, userId, position) as MediaRow | undefined;

    return row ? this.readProjectMedia(projectId, row) : undefined;
  }

  getStyleProject(userId: string, projectId: string): StyleProjectContext | undefined {
    const row = this.database
      .prepare(`
        SELECT id, book_path, gemini_book_uri, book_interaction_id, style,
               style_interaction_id
        FROM projects
        WHERE id = ? AND user_id = ?
      `)
      .get(projectId, userId) as StyleProjectRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      bookPath: this.resolveBookPath(row.book_path),
      geminiBookUri: row.gemini_book_uri,
      bookInteractionId: row.book_interaction_id,
      style: row.style,
      styleInteractionId: row.style_interaction_id,
    };
  }

  saveGeminiBookUri(projectId: string, bookUri: string): void {
    this.database
      .prepare(`
        UPDATE projects
        SET gemini_book_uri = COALESCE(gemini_book_uri, ?)
        WHERE id = ?
      `)
      .run(bookUri, projectId);
  }

  saveBookInteractionId(projectId: string, interactionId: string): void {
    this.database
      .prepare(`
        UPDATE projects
        SET book_interaction_id = COALESCE(book_interaction_id, ?)
        WHERE id = ?
      `)
      .run(interactionId, projectId);
  }

  saveStyle(projectId: string, style: string, interactionId: string): void {
    this.database
      .prepare(`
        UPDATE projects
        SET style = ?, style_interaction_id = ?
        WHERE id = ?
      `)
      .run(style, interactionId, projectId);
  }

  getCharacterProject(
    userId: string,
    projectId: string,
  ): CharacterProjectContext | undefined {
    const row = this.database
      .prepare(`
        SELECT id, style_interaction_id, character_interaction_id
        FROM projects
        WHERE id = ? AND user_id = ?
      `)
      .get(projectId, userId) as CharacterProjectRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      styleInteractionId: row.style_interaction_id,
      characterInteractionId: row.character_interaction_id,
      characters: this.getCharacters(projectId),
    };
  }

  saveCharacters(
    projectId: string,
    characters: Character[],
    interactionId: string,
  ): void {
    const removeExisting = this.database.prepare("DELETE FROM characters WHERE project_id = ?");
    const insertCharacter = this.database.prepare(`
      INSERT INTO characters (project_id, position, name, prompt)
      VALUES (?, ?, ?, ?)
    `);
    const updateContext = this.database.prepare(`
      UPDATE projects
      SET character_interaction_id = ?
      WHERE id = ?
    `);

    const persist = this.database.transaction(() => {
      removeExisting.run(projectId);
      for (const character of characters) {
        insertCharacter.run(projectId, character.position, character.name, character.prompt);
      }
      const updated = updateContext.run(interactionId, projectId);
      if (updated.changes !== 1) {
        throw new Error("Project was not found while saving Characters.");
      }
    });
    persist();
  }

  getPortraitProject(userId: string, projectId: string): PortraitProjectContext | undefined {
    const row = this.database
      .prepare(`
        SELECT id, style, character_interaction_id, image_interaction_id
        FROM projects
        WHERE id = ? AND user_id = ?
      `)
      .get(projectId, userId) as PortraitProjectRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      style: row.style,
      characterInteractionId: row.character_interaction_id,
      imageInteractionId: row.image_interaction_id,
      characters: this.getCharacters(projectId),
    };
  }

  saveImageInteractionId(projectId: string, interactionId: string): void {
    const updated = this.database
      .prepare("UPDATE projects SET image_interaction_id = ? WHERE id = ?")
      .run(interactionId, projectId);
    if (updated.changes !== 1) {
      throw new Error("Project was not found while saving portrait image context.");
    }
  }

  markPortraitRunning(projectId: string, position: number): void {
    const updated = this.database
      .prepare(`
        UPDATE characters
        SET portrait_state = 'RUNNING', portrait_error_message = NULL
        WHERE project_id = ? AND position = ? AND portrait_state <> 'SUCCEEDED'
      `)
      .run(projectId, position);
    if (updated.changes !== 1) {
      throw new Error(`Character ${position + 1} cannot start portrait generation.`);
    }
  }

  markPortraitFailed(projectId: string, position: number, errorMessage: string): void {
    const updated = this.database
      .prepare(`
        UPDATE characters
        SET portrait_state = 'FAILED', portrait_error_message = ?
        WHERE project_id = ? AND position = ? AND portrait_state <> 'SUCCEEDED'
      `)
      .run(errorMessage.trim() || "Portrait generation failed.", projectId, position);
    if (updated.changes !== 1) {
      throw new Error(`Character ${position + 1} cannot record portrait failure.`);
    }
  }

  async savePortraitSuccess(
    projectId: string,
    position: number,
    imageBytes: Uint8Array,
    mimeType: string,
    interactionId: string,
  ): Promise<void> {
    const extension = this.imageExtension(mimeType);
    const relativeImagePath = path.posix.join(
      "projects",
      projectId,
      "portraits",
      `${position}.${extension}`,
    );
    const absoluteImagePath = this.resolveDataPath(relativeImagePath);
    const portraitDirectory = path.dirname(absoluteImagePath);
    const temporaryImagePath = path.join(
      portraitDirectory,
      `.${position}.${extension}.${randomUUID()}.tmp`,
    );

    await mkdir(portraitDirectory, { recursive: true });
    await writeFile(temporaryImagePath, imageBytes);

    try {
      await rm(absoluteImagePath, { force: true });
      await rename(temporaryImagePath, absoluteImagePath);

      const updateCharacter = this.database.prepare(`
        UPDATE characters
        SET portrait_state = 'SUCCEEDED', portrait_image_path = ?,
            portrait_mime_type = ?, portrait_error_message = NULL
        WHERE project_id = ? AND position = ? AND portrait_state = 'RUNNING'
      `);
      const updateContext = this.database.prepare(`
        UPDATE projects
        SET image_interaction_id = ?
        WHERE id = ?
      `);
      const persist = this.database.transaction(() => {
        if (
          updateCharacter.run(relativeImagePath, mimeType, projectId, position).changes !== 1
        ) {
          throw new Error(`Character ${position + 1} portrait is no longer running.`);
        }
        if (updateContext.run(interactionId, projectId).changes !== 1) {
          throw new Error("Project was not found while saving portrait image context.");
        }
      });
      persist();
    } catch (error) {
      await rm(temporaryImagePath, { force: true });
      await rm(absoluteImagePath, { force: true });
      throw error;
    }
  }

  getChapterProject(userId: string, projectId: string): ChapterProjectContext | undefined {
    const row = this.database
      .prepare(`
        SELECT id, character_interaction_id, chapter_interaction_id
        FROM projects
        WHERE id = ? AND user_id = ?
      `)
      .get(projectId, userId) as ChapterProjectRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      characterInteractionId: row.character_interaction_id,
      chapterInteractionId: row.chapter_interaction_id,
      chapters: this.getChapters(projectId),
    };
  }

  saveChapters(projectId: string, chapters: Chapter[], interactionId: string): void {
    const removeExisting = this.database.prepare("DELETE FROM chapters WHERE project_id = ?");
    const insertChapter = this.database.prepare(`
      INSERT INTO chapters (project_id, position, name, prompt)
      VALUES (?, ?, ?, ?)
    `);
    const updateContext = this.database.prepare(`
      UPDATE projects
      SET chapter_interaction_id = ?
      WHERE id = ?
    `);

    const persist = this.database.transaction(() => {
      removeExisting.run(projectId);
      for (const chapter of chapters) {
        insertChapter.run(projectId, chapter.position, chapter.name, chapter.prompt);
      }
      if (updateContext.run(interactionId, projectId).changes !== 1) {
        throw new Error("Project was not found while saving Chapters.");
      }
    });
    persist();
  }

  getIllustrationProject(
    userId: string,
    projectId: string,
  ): IllustrationProjectContext | undefined {
    const row = this.database
      .prepare(`
        SELECT id, image_interaction_id, chapter_image_context_id
        FROM projects
        WHERE id = ? AND user_id = ?
      `)
      .get(projectId, userId) as IllustrationProjectRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      imageInteractionId: row.image_interaction_id,
      chapterImageContextId: row.chapter_image_context_id,
      chapters: this.getChapters(projectId),
    };
  }

  saveChapterImageContextId(projectId: string, interactionId: string): void {
    const updated = this.database
      .prepare(`
        UPDATE projects
        SET chapter_image_context_id = COALESCE(chapter_image_context_id, ?)
        WHERE id = ?
      `)
      .run(interactionId, projectId);
    if (updated.changes !== 1) {
      throw new Error("Project was not found while saving chapter image context.");
    }
  }

  async saveIllustrationSuccess(
    projectId: string,
    chapterPosition: number,
    imageBytes: Uint8Array,
    mimeType: string,
  ): Promise<void> {
    const extension = this.imageExtension(mimeType);
    const relativeImagePath = path.posix.join(
      "projects",
      projectId,
      "illustrations",
      `${chapterPosition}.${extension}`,
    );
    const absoluteImagePath = this.resolveDataPath(relativeImagePath);
    const illustrationDirectory = path.dirname(absoluteImagePath);
    const temporaryImagePath = path.join(
      illustrationDirectory,
      `.${chapterPosition}.${extension}.${randomUUID()}.tmp`,
    );

    await mkdir(illustrationDirectory, { recursive: true });
    await writeFile(temporaryImagePath, imageBytes);

    try {
      await rm(absoluteImagePath, { force: true });
      await rename(temporaryImagePath, absoluteImagePath);

      const updated = this.database
        .prepare(`
          UPDATE chapters
          SET illustration_image_path = ?, illustration_mime_type = ?
          WHERE project_id = ? AND position = ?
        `)
        .run(relativeImagePath, mimeType, projectId, chapterPosition);
      if (updated.changes !== 1) {
        throw new Error("Chapter was not found while saving its illustration.");
      }
    } catch (error) {
      await rm(temporaryImagePath, { force: true });
      await rm(absoluteImagePath, { force: true });
      throw error;
    }
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

  claimPipelineStep(
    projectId: string,
    stepName: PipelineStepName,
    startedAt: string,
  ): PipelineMutationResult | undefined {
    const claim = this.database.transaction(() => {
      const updated = this.database
        .prepare(`
          UPDATE pipeline_steps
          SET state = 'RUNNING', started_at = ?, finished_at = NULL,
              error_message = NULL, attempt_count = attempt_count + 1
          WHERE project_id = ? AND step_name = ?
            AND state IN ('PENDING', 'FAILED', 'INTERRUPTED')
            AND NOT EXISTS (
              SELECT 1
              FROM pipeline_steps AS previous
              WHERE previous.project_id = pipeline_steps.project_id
                AND previous.position < pipeline_steps.position
                AND previous.state <> 'SUCCEEDED'
            )
          RETURNING step_name, position, state, started_at, finished_at,
                    error_message, attempt_count
        `)
        .get(startedAt, projectId, stepName) as PipelineStepRow | undefined;

      if (updated) {
        return { changed: true, step: pipelineStep(updated) };
      }

      const current = this.getPipelineStep(projectId, stepName);
      return current ? { changed: false, step: current } : undefined;
    });

    return claim();
  }

  finishPipelineStep(
    projectId: string,
    stepName: PipelineStepName,
    expectedStartedAt: string,
    state: "SUCCEEDED" | "FAILED",
    finishedAt: string,
    errorMessage: string | null,
  ): PipelineMutationResult | undefined {
    const finish = this.database.transaction(() => {
      const updated = this.database
        .prepare(`
          UPDATE pipeline_steps
          SET state = ?, finished_at = ?, error_message = ?
          WHERE project_id = ? AND step_name = ?
            AND state = 'RUNNING' AND started_at = ?
          RETURNING step_name, position, state, started_at, finished_at,
                    error_message, attempt_count
        `)
        .get(
          state,
          finishedAt,
          errorMessage,
          projectId,
          stepName,
          expectedStartedAt,
        ) as PipelineStepRow | undefined;

      if (updated) {
        return { changed: true, step: pipelineStep(updated) };
      }

      const current = this.getPipelineStep(projectId, stepName);
      return current ? { changed: false, step: current } : undefined;
    });

    return finish();
  }

  interruptStalePipelineStep(
    projectId: string,
    stepName: PipelineStepName,
    staleBefore: string,
    interruptedAt: string,
  ): PipelineMutationResult | undefined {
    const interrupt = this.database.transaction(() => {
      const updated = this.database
        .prepare(`
          UPDATE pipeline_steps
          SET state = 'INTERRUPTED', finished_at = ?,
              error_message = 'Execution was explicitly recovered after becoming stale.'
          WHERE project_id = ? AND step_name = ?
            AND state = 'RUNNING' AND started_at IS NOT NULL AND started_at <= ?
          RETURNING step_name, position, state, started_at, finished_at,
                    error_message, attempt_count
        `)
        .get(interruptedAt, projectId, stepName, staleBefore) as
        | PipelineStepRow
        | undefined;

      if (updated) {
        return { changed: true, step: pipelineStep(updated) };
      }

      const current = this.getPipelineStep(projectId, stepName);
      return current ? { changed: false, step: current } : undefined;
    });

    return interrupt();
  }

  private getPipelineStep(
    projectId: string,
    stepName: PipelineStepName,
  ): PipelineStep | undefined {
    const row = this.database
      .prepare(`
        SELECT step_name, position, state, started_at, finished_at, error_message, attempt_count
        FROM pipeline_steps
        WHERE project_id = ? AND step_name = ?
      `)
      .get(projectId, stepName) as PipelineStepRow | undefined;

    return row ? pipelineStep(row) : undefined;
  }

  private resolveBookPath(relativeBookPath: string): string {
    return this.resolveDataPath(relativeBookPath);
  }

  private resolveDataPath(relativePath: string): string {
    const absoluteBookPath = path.resolve(this.dataDirectory, relativePath);
    const dataRoot = `${this.dataDirectory}${path.sep}`;
    if (!absoluteBookPath.startsWith(dataRoot)) {
      throw new Error("Stored path is outside the application data directory");
    }
    return absoluteBookPath;
  }

  private async readProjectMedia(
    projectId: string,
    media: MediaRow,
  ): Promise<ProjectMedia | undefined> {
    const absolutePath = this.resolveDataPath(media.media_path);
    const projectDirectory = path.resolve(this.dataDirectory, "projects", projectId);
    if (!absolutePath.startsWith(`${projectDirectory}${path.sep}`)) {
      throw new Error("Stored media path is outside its project directory");
    }

    try {
      return { bytes: await readFile(absolutePath), mimeType: media.mime_type };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private getCharacters(projectId: string): Character[] {
    const rows = this.database
      .prepare(`
        SELECT position, name, prompt, portrait_state, portrait_image_path,
               portrait_mime_type, portrait_error_message
        FROM characters
        WHERE project_id = ?
        ORDER BY position
      `)
      .all(projectId) as CharacterRow[];

    return rows.map((row) => ({
      position: row.position,
      name: row.name,
      prompt: row.prompt,
      portraitState: row.portrait_state,
      portraitImagePath: row.portrait_image_path,
      portraitMimeType: row.portrait_mime_type,
      portraitErrorMessage: row.portrait_error_message,
    }));
  }

  private getChapters(projectId: string): Chapter[] {
    const rows = this.database
      .prepare(`
        SELECT position, name, prompt, illustration_image_path, illustration_mime_type
        FROM chapters
        WHERE project_id = ?
        ORDER BY position
      `)
      .all(projectId) as ChapterRow[];

    return rows.map((row) => ({
      position: row.position,
      name: row.name,
      prompt: row.prompt,
      illustrationImagePath: row.illustration_image_path,
      illustrationMimeType: row.illustration_mime_type,
    }));
  }

  private imageExtension(mimeType: string): string {
    const extension =
      mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      throw new Error("Unsupported generated image type.");
    }
    return extension;
  }

  private ensureProjectColumn(name: string, definition: string): void {
    const columns = this.database.prepare("PRAGMA table_info(projects)").all() as TableColumnRow[];
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
    }
  }

  private ensureCharacterColumn(name: string, definition: string): void {
    const columns = this.database.prepare("PRAGMA table_info(characters)").all() as TableColumnRow[];
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(`ALTER TABLE characters ADD COLUMN ${name} ${definition}`);
    }
  }

  private ensureChapterColumn(name: string, definition: string): void {
    const columns = this.database.prepare("PRAGMA table_info(chapters)").all() as TableColumnRow[];
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(`ALTER TABLE chapters ADD COLUMN ${name} ${definition}`);
    }
  }

  close(): void {
    this.database.close();
  }
}
