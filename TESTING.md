# Testing Strategy

## Backend

Vitest and Supertest cover API and pipeline behavior without opening a real
network port. The current smoke test exercises `GET /health`; ordering,
duplicate execution, persistence, failure/retry, recovery, and server-side caps
will be added with their feature increments.

## Frontend

Vitest, React Testing Library, jest-dom, and jsdom cover component behavior and
meaningful UI states. The current scaffold has a rendering smoke test; empty,
running, error/retry, recovery, and portrait-progress tests will accompany those
features.

## Gemini

Automated tests do not require a Gemini API key or make live Gemini calls. A
fake Gemini adapter and provider-dependent behavioral tests are deferred until
the integration increment. Live verification remains manual and opt-in.

## Test Report

The final real test output will be recorded after the required feature tests
are implemented. No final report is claimed by this harness increment.
