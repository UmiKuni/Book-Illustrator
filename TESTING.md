# Testing Strategy

## Backend

Vitest and Supertest cover API behavior without opening a real network port.
Current tests exercise `GET /health`, identity/session behavior, project
persistence, validation, ownership isolation, pipeline ordering, persistent
step transitions, failure/retry, duplicate execution prevention, and stale
recovery. Style tests use a deterministic fake Gemini provider to cover book
context reuse, persistence, provider failure, and overlapping requests.
Character tests cover structured-output validation, the server-side two-record
cap, context reuse, persistence, retry, ownership, and duplicate prevention.
The chapter cap will be added with its feature increment.

## Frontend

Vitest, React Testing Library, jest-dom, and jsdom cover component behavior and
meaningful UI states. The current scaffold has a rendering smoke test; empty,
running, error/retry, recovery, and portrait-progress tests will accompany those
features.

## Gemini

Automated tests do not require a Gemini API key or make live Gemini calls. A
fake Gemini provider covers integration behavior at the application boundary.
Live provider verification remains manual and opt-in.

## Test Report

The final real test output will be recorded after the required feature tests
are implemented. No final report is claimed by this harness increment.
