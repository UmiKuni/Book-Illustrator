# AGENTS.md

## Project

This repository contains the Gradion Software Engineering Intern take-home assessment.

The application is a local-only Book Illustration Studio that transforms a user-provided book through five explicit user-driven stages:

`Style → Characters → Portraits → Chapters → Illustrations`

The goal is to build the smallest correct, testable, resumable implementation that satisfies the assessment.

Prefer simple, focused solutions over production-scale infrastructure or speculative abstractions.

---

## Source of truth

Use the following precedence when implementation guidance conflicts:

1. `docs/gradion/gradion-assessment-intern-software-engineer.md`
2. `docs/SRS.md`
3. `docs/gemini-integration.md` for Gemini provider mechanics
4. `docs/architecture.md`
5. `docs/plan.md`
6. Existing implementation and tests

The original Gradion assessment always wins.

Read only the documents relevant to the current task rather than re-reading every document for every change.

Do not treat the following as implementation requirements:

- `DECISIONS.md`
- files under `prompts/`

They are development artifacts, not primary implementation context.

If a meaningful conflict exists between authoritative sources, surface it instead of silently inventing behavior.

---

## Core invariants

Do not violate these rules:

- The pipeline has exactly five mandatory stages:
  `Style → Characters → Portraits → Chapters → Illustrations`.
- Each stage requires explicit user action.
- A later stage cannot start before all preceding stages succeed.
- Persist at most two adult character records.
- Persist at most one chapter record.
- Character and chapter caps are enforced server-side.
- Duplicate clicks, overlapping requests, refreshes, or another browser tab must not trigger duplicate Gemini execution for an already-running step.
- Failed work remains retryable without regenerating successful preceding work.
- Gemini retries are user-triggered only.
- Stranded `RUNNING` work must have an explicit user-visible recovery path.
- The full book content is provided to Gemini no more than once per project.
- Later Gemini work reuses persisted provider context.
- Successful portrait items remain persisted if another portrait fails.
- Gemini is called from the backend only.
- The original book and generated images remain on the local filesystem.
- Project and media access is restricted to the owning user.

---

## Architecture baseline

Follow `docs/architecture.md`.

The current baseline is intentionally small:

- React + Vite frontend
- Express backend
- TypeScript
- SQLite for metadata and pipeline state
- local filesystem for book and image bytes
- HTTP-only local session cookie
- polling while pipeline work is running
- server-side atomic step claim before Gemini execution

Pipeline step states are:

`PENDING | RUNNING | SUCCEEDED | FAILED | INTERRUPTED`

Do not introduce alternative infrastructure unless a mandatory requirement cannot reasonably be satisfied by the existing baseline.

Avoid adding:

- Redis
- queues
- microservices
- PostgreSQL
- WebSockets
- SSE
- cloud storage
- distributed locks
- background schedulers
- production-scale infrastructure

If the current architecture appears insufficient, explain the concrete requirement it fails to satisfy and propose the smallest alternative before changing it.

---

## Gemini integration

Before changing Gemini-related code, read:

`docs/gemini-integration.md`

Follow the verified core notebook flow.

Important rules:

- keep text and image interaction contexts distinct;
- reuse persisted Gemini context instead of resending the complete book;
- validate structured character and chapter output before persistence;
- generate portraits sequentially when required by the verified image-context flow;
- continue chapter illustration generation from the required image-interaction context;
- do not replace the core flow with the notebook bonus granular-control flow unless explicitly requested;
- do not add automatic Gemini retry loops;
- automated tests must not consume live Gemini quota.

Do not duplicate detailed Gemini mechanics in unrelated modules or documentation.

---

## Development workflow

Implement one coherent increment at a time.

Before editing:

1. identify the relevant SRS requirements and acceptance criteria;
2. inspect the existing implementation and related tests;
3. read the relevant architecture or Gemini documentation if the task depends on them;
4. choose the smallest change that satisfies the requirement.

Prefer incremental implementation over large rewrites.

Do not:

- modify unrelated files;
- refactor unrelated code while completing a bounded task;
- introduce abstractions for hypothetical future requirements;
- implement bonus features before mandatory requirements are complete;
- expand scope without a requirement;
- duplicate the same rules across multiple documentation files.

Simple duplication is acceptable when removing it would require unnecessary abstraction.

---

## Testing

Tests are part of implementation, not a final cleanup phase.

Use automated tests for important behavior as it is introduced.

Backend priorities include:

- pipeline ordering;
- duplicate execution prevention;
- persistence;
- failure and retry;
- stranded-step recovery;
- server-side character/chapter caps.

Frontend priorities include:

- empty states;
- running/loading states;
- error and retry states;
- recovery behavior;
- per-portrait progress.

Use a fake or mock Gemini implementation for automated tests.

Live Gemini verification must be explicit and separate from the normal test suite.

Never fabricate test output.

Before declaring a task complete, run the relevant tests and report the actual result.

---

## Security and repository hygiene

Never commit:

- `.env`;
- API keys;
- user book files;
- generated runtime images;
- runtime databases or storage;
- coverage output;
- temporary test artifacts.

Do not:

- expose `GEMINI_API_KEY` to frontend code;
- trust client-provided pipeline state;
- trust client-provided ownership;
- accept arbitrary filesystem paths;
- serve project media without ownership checks.

---

## Scope discipline

Mandatory assessment requirements come before bonus work.

Do not add bonus features simply because the technology supports them.

In particular, avoid introducing:

- later Gemini notebook bonus flows;
- video;
- music;
- narration;
- audiobook features;
- cloud deployment;
- realtime infrastructure;
- additional characters or chapters.

When uncertain, prefer the smaller implementation that still satisfies the assessment.

---

## Completion report

After completing a coding task, report:

### Changed
A concise description of what was implemented.

### Requirements
Relevant SRS requirement and acceptance-criteria IDs.

### Tests
Commands actually executed and their results.

### Remaining verification
Anything that still requires manual or live-Gemini verification.

Do not claim the task is complete when required verification has not been performed.