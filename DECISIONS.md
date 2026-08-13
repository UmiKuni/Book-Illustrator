# Engineering Decisions

## Keep the required Gemini core image flow

AI initially mixed the notebook's later granular-control flow into the core design, using named character references when generating the chapter illustration. I pushed back after running and reviewing the notebook: the required steps 1–5 keep character consistency through the chained image interaction context, while explicit portrait inputs belong to the bonus section. I chose to follow the core interaction chain first. The cost is less explicit control over which portrait is supplied to a scene, but the implementation stays smaller and aligned with the required pipeline.

## Use SQLite for metadata and the filesystem for assets

AI proposed React + Vite, Express, SQLite, and local filesystem storage. I questioned whether a hosted database or object store would make persistence easier, but they would add setup the local-only assessment does not need. I kept SQLite for durable structured state and transactions, while book and generated image bytes remain on disk as required. The trade-off is that this design targets a local single-server application rather than distributed or horizontally scaled execution.

## Persist every pipeline step and derive project progress

The assessment left the exact progress representation open, and AI surfaced both a single project-level status and per-step records. I rejected making one mutable `currentStep` field the source of truth because it would not preserve individual failures, attempt counts, or a stranded `RUNNING` claim across restart. I chose one persisted row for each of the five ordered steps and derive `Draft`, `In progress`, `Done`, and the completed count from those rows. The cost is a little more schema and query logic, but recovery and the UI read the same durable state.

## Claim execution atomically in SQLite

An early shortcut was to prevent duplicate work with disabled frontend buttons or a process-local running flag. I pushed back because refreshes, overlapping requests, and a second browser tab bypass those mechanisms. The final design uses one conditional SQLite update to claim an eligible step before provider work starts; a duplicate caller receives the persisted `RUNNING` state without incrementing the attempt or replacing `startedAt`. This deliberately does not claim distributed exactly-once behavior, and a process crash can still require explicit stale-step recovery.

## Keep observed Gemini model IDs configurable

AI initially treated the model IDs observed in the verified notebook flow as if they were permanent implementation requirements. I corrected that distinction: the current defaults are `gemini-3.6-flash` for text and `gemini-3.1-flash-lite-image` for images, but both come from backend environment variables. This keeps the verified text/image mechanics intact while allowing an account to use available compatible models. The cost is one more pre-demo configuration check, and a changed model can still expose provider behavior that the fake tests cannot verify.

## Defer CI until hardening

I proposed adding GitHub Actions before continuing with the pipeline concurrency work so that every commit could be automatically verified. AI pushed back that CI would add limited value while the test suite and the core failure and concurrency paths were still evolving, and suggested keeping the local one-command test workflow as the verification gate. I agreed, and revisited the choice during final hardening; CI remains deferred because it is optional and live-provider verification is the more important unresolved risk. The cost is that submission verification depends on the recorded local commands rather than a remote status check.

## What I would build with one more day

I would add an opt-in live-provider smoke harness that uses a very short public-domain story and records the provider/model checks without joining the normal automated suite. The deterministic fake providers give strong coverage of ordering, persistence, retry, and context reuse, but they cannot detect a Gemini SDK change, model availability problem, safety response, or account-specific behavior. Keeping that harness explicit would improve demo confidence without consuming quota during routine tests.
