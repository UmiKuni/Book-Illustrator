# Engineering Decisions

## Keep the required Gemini core image flow

AI initially mixed the notebook's later granular-control flow into the core design, using named character references when generating the chapter illustration. I pushed back after running and reviewing the notebook: the required steps 1–5 keep character consistency through the chained image interaction context, while explicit portrait inputs belong to the bonus section. I chose to follow the core interaction chain first. The cost is less explicit control over which portrait is supplied to a scene, but the implementation stays smaller and aligned with the required pipeline.

## Use SQLite for metadata and the filesystem for assets

AI proposed React + Vite, Express, SQLite, and local filesystem storage. I kept that direction after comparing it with the assessment's constraints. SQLite gives the pipeline durable structured state and transactions for duplicate-execution protection without requiring an external database service, while the book and generated images stay on disk as required. The trade-off is that this design is intended for a local single-server application rather than distributed or horizontally scaled execution.

## Defer CI until hardening

I proposed adding GitHub Actions before continuing with the pipeline concurrency work so that every commit could be automatically verified. AI pushed back that CI would add limited value while the test suite and the core failure and concurrency paths were still evolving, and suggested keeping the existing local one-command test workflow as the verification gate for now. I agreed to defer CI until the hardening phase, after duplicate-execution and recovery behavior are in place. The cost is that early commits rely on local verification instead of remote status checks, but it keeps the assessment focused on product correctness before adding supporting infrastructure.