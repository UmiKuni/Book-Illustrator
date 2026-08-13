# Testing Strategy

## Backend coverage

Vitest and Supertest exercise the Express application directly without opening a network port. The suite covers health, passwordless sessions, current-session lookup, project persistence, pasted and `.txt` input, validation, ownership, authorized media, ordered pipeline transitions, atomic duplicate prevention, failure/retry, stale recovery, server-side character/chapter caps, and restart persistence.

Each Gemini-backed step uses deterministic fake providers. Tests verify book-context reuse, text and image interaction chaining, sequential portraits, partial portrait persistence, structured-output and image validation, context reuse after failure, and overlapping request behavior. A whole-flow scenario creates a project, explicitly completes all five stages, recreates the application/store, and reopens the final `Done` project with its provider context and generated metadata intact.

## Frontend coverage

Vitest, React Testing Library, jest-dom, and jsdom cover application bootstrap, identity validation, session restoration/sign-out, library empty and error states, automatic polling and expiry, pasted/upload project creation, project-load retry, five-step progress, the three output tabs, Markdown rendering, explicit run/retry/recovery actions, polling, progressive portrait display, and media download controls. HTTP is mocked; frontend tests do not require the backend or Gemini.

## Gemini and manual scope

The normal automated suite never reads `GEMINI_API_KEY` and never makes a live Gemini request. Fake providers test the application boundary rather than SDK internals. Live model availability, safety behavior, generated-image quality, and visual consistency must still be verified manually with a configured key. Browser-level E2E tooling is deliberately not part of this assessment pass; the minimal GitHub Actions workflow runs the same test, build, and lint commands as local verification.

## Test Report

Final command run on 2026-08-13:

```text
$env:NO_COLOR='1'; npm test

> technical_assignment@1.0.0 test
> npm run test --workspaces


> frontend@0.0.0 test
> vitest run


 RUN  v3.2.7 F:/technical_assignment/frontend

 ✓ src/App.test.tsx (11 tests) 978ms
 ✓ src/ApplicationFlows.test.tsx (15 tests) 1230ms

 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  17:36:41
   Duration  3.38s (transform 292ms, setup 480ms, collect 880ms, tests 2.21s, environment 1.81s, prepare 418ms)


> backend@1.0.0 test
> vitest run


 RUN  v3.2.7 F:/technical_assignment/backend

 ✓ tests/pipeline.test.ts (5 tests) 247ms
 ✓ tests/pipeline-reliability.test.ts (6 tests) 271ms
 ✓ tests/health.test.ts (1 test) 77ms
 ✓ tests/style.test.ts (6 tests) 515ms
 ✓ tests/backend-http-completion.test.ts (6 tests) 692ms
 ✓ tests/portraits.test.ts (7 tests) 731ms
 ✓ tests/identity-projects.test.ts (11 tests) 752ms
 ✓ tests/characters.test.ts (11 tests) 846ms
 ✓ tests/chapters.test.ts (11 tests) 1000ms
 ✓ tests/illustrations.test.ts (9 tests) 1026ms

 Test Files  10 passed (10)
      Tests  73 passed (73)
   Start at  17:36:45
   Duration  2.62s (transform 1000ms, setup 0ms, collect 8.59s, tests 6.16s, environment 4ms, prepare 2.31s)
```
