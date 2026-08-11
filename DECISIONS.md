# Engineering Decisions

## Keep the required Gemini core image flow

AI initially mixed the notebook's later granular-control flow into the core design, using named character references when generating the chapter illustration. I pushed back after running and reviewing the notebook: the required steps 1–5 keep character consistency through the chained image interaction context, while explicit portrait inputs belong to the bonus section. I chose to follow the core interaction chain first. The cost is less explicit control over which portrait is supplied to a scene, but the implementation stays smaller and aligned with the required pipeline.

## Use SQLite for metadata and the filesystem for assets

AI proposed React + Vite, Express, SQLite, and local filesystem storage. I kept that direction after comparing it with the assessment's constraints. SQLite gives the pipeline durable structured state and transactions for duplicate-execution protection without requiring an external database service, while the book and generated images stay on disk as required. The trade-off is that this design is intended for a local single-server application rather than distributed or horizontally scaled execution.