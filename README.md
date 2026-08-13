# Book Illustration Studio

Book Illustration Studio is a local-only web application for the Gradion Software Engineering Intern assessment. A user signs in with a name and email, creates a project from pasted book text or a `.txt` file, and explicitly advances it through five Gemini-assisted stages:

`Style → Characters → Portraits → Chapters → Illustrations`

The application preserves progress, generated output, and retryable failures so a project can be reopened after a refresh, sign-out, or backend restart.

## Technology

- React, Vite, and TypeScript in `frontend/`
- Express and TypeScript in `backend/`
- SQLite for users, projects, pipeline state, and Gemini context metadata
- Local filesystem storage for the original book and generated images
- Vitest, React Testing Library, and Supertest for automated tests

Gemini calls are made only by the backend. The browser receives authorized media URLs and never receives the API key or local filesystem paths.

## Prerequisites

- Node.js 22.13 or newer LTS release (Node.js 24 LTS is recommended)
- npm
- A Gemini API key for manual end-to-end generation

Automated tests use deterministic fake Gemini providers and do not need an API key.

## Install and configure

From the repository root:

```bash
npm install
```

Copy `backend/.env.example` to `backend/.env`, then set the server-only values:

```dotenv
GEMINI_API_KEY=your_key_here
GEMINI_TEXT_MODEL=gemini-3.6-flash
GEMINI_IMAGE_MODEL=gemini-3.1-flash-lite-image
PORT=3001
APP_DATA_DIR=../data
STEP_STALE_AFTER_MS=300000
```

The model IDs are configurable because availability can vary by account and over time. Verify them before a live demonstration. The frontend needs no `.env` file for local development: it uses relative `/api` requests, and Vite proxies them to `http://localhost:3001`.

## Run

Start the complete local stack from the repository root:

```bash
npm run dev
```

Open `http://localhost:5173`. The backend listens on `http://localhost:3001` by default. Keep the command running while using the application.

Run all automated tests with one command:

```bash
npm test
```

Other verification commands are:

```bash
npm run build
npm run lint
```

## Local behavior

Identity is intentionally passwordless and local: an existing email resumes the same user, and the HTTP-only session cookie is used for authentication. Every project and media request enforces ownership.

Runtime state is written beneath `APP_DATA_DIR` (by default the root `data/` directory). It contains SQLite metadata plus project folders with `book.txt`, portraits, and the final illustration. This directory and `backend/.env` are ignored by Git and should not be committed.

Each pipeline stage requires a separate user action. Failed or interrupted work remains explicitly retryable, overlapping requests cannot claim the same running step twice, and stale running work has a separate recovery action that does not call Gemini. See [docs/architecture.md](docs/architecture.md) for the compact system design and [TESTING.md](TESTING.md) for verification scope and recorded results.
