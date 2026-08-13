# Architecture — Proposed Implementation Baseline

## Chosen shape

Use a small TypeScript application: React + Vite for the browser, Express for the API, SQLite for metadata, and the local filesystem for book/image bytes. This keeps one language across the stack and gives transactions for the concurrency rule without introducing a hosted service or queue. The proposed layout is:

```text
frontend/src/        React pages, components, API client, tests
backend/src/         HTTP routes, pipeline service, Gemini adapter, repositories
backend/tests/       API and pipeline tests
data/projects/<id>/  book.txt and generated PNG/WebP images (gitignored)
```

The final rationale and trade-offs belong in `DECISIONS.md` after they have been tested; do not copy this proposal there as an invented decision.

## State model

`projects` stores ownership, title, book path, Gemini file URI, text-conversation interaction IDs, timestamps, and an overall status. `pipeline_steps` stores one row per ordered step with `PENDING | RUNNING | SUCCEEDED | FAILED | INTERRUPTED`, `started_at`, `finished_at`, `error_message`, and an attempt count. `characters` and `chapters` store the structured provider output and generated-image state/path needed by the application.

Project status is derived: **Draft** when all five steps are `PENDING` and none has been attempted; **Done** when all five are `SUCCEEDED`; otherwise **In progress**, including `RUNNING`, `FAILED`, and `INTERRUPTED` work.

For a multi-image step, persist each item's state after every provider result. A retry processes only incomplete or failed items, preserving successful portraits and preventing extra image cost.

## Execution and recovery

`POST /steps/:step/run` validates ownership, ordering, and eligibility, atomically claims the step as `RUNNING` in a SQLite transaction, and commits that transaction before Gemini work begins. After the commit, the route performs the Gemini work outside the transaction and persists each result. This is an in-process operation, not a separate worker subsystem. Concurrent callers receive `409 Conflict` with the currently persisted running-step state in the response body; they never start a second Gemini execution.

The claim is committed before the long call, so a process crash may leave persisted `RUNNING` work. After a configurable stale threshold, the UI offers recovery. `POST /steps/:step/recover` changes only that stale claim to `INTERRUPTED`; the user then explicitly runs the step again. No scheduler, automatic retry, or provider request is involved in recovery.

## API contract

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/session` | Validate name/email; create or resume the user and set an HTTP-only local-session cookie. |
| `GET` | `/api/session` | Return the current authenticated local user. |
| `DELETE` | `/api/session` | Sign out. |
| `GET` | `/api/projects` | Return the current user's project summaries. |
| `POST` | `/api/projects` | Create a project from title plus pasted text or multipart `.txt`. |
| `GET` | `/api/projects/:id` | Return full persisted project and item/step state. |
| `POST` | `/api/projects/:id/steps/:step/run` | Claim and begin the current step; accepts optional `style` only for `style`. |
| `POST` | `/api/projects/:id/steps/:step/recover` | Mark a stale in-progress step interrupted. |
| `GET` | `/api/projects/:id/characters/:position/portrait` | Serve a persisted portrait only to the project owner. |
| `GET` | `/api/projects/:id/chapters/:position/illustration` | Serve a persisted illustration only to the project owner. |

The client polls `GET /api/projects/:id` while any step or image item is running. This is adequate for a local assessment; SSE/WebSockets are bonus work.

## Gemini boundaries

The server is the only Gemini caller. It uploads the persisted book once and saves the returned file URI. It saves each text interaction ID and supplies it as `previous_interaction_id` to retain book/style/character context. Character and chapter responses use JSON Schema and are validated before persistence; persisted records are capped at two adult characters and one chapter even if a model returns more. Portrait generation establishes a persisted Gemini image-interaction chain; core chapter illustration generation continues from that image context. The detailed provider mechanics and the separate bonus granular-control flow are in `docs/gemini-integration.md`.

## Security and operations

Read `GEMINI_API_KEY` only on the server. Do not expose it, trust client step status, or accept arbitrary media paths. Validate `.txt` MIME/extension, reject empty content, set upload limits, generate UUID paths, and authorize every project/media route. Ignore `.env`, `data/`, SQLite journals, coverage, and build outputs.
