# Software Requirements Specification

## 1. Purpose

Book Illustration Studio is a local-only web application that transforms a user-provided book into character portraits and a chapter illustration using the Gemini API. This SRS refines `docs/gradion/gradion-assessment-intern-software-engineer.md`; if the two documents differ, the assessment is authoritative.

The product serves a user identified by name and email. Passwords and OAuth are not required.

## 2. Scope

The application provides an explicitly user-driven pipeline. The steps are always ordered as follows:

| Order | Step | Required output |
| --- | --- | --- |
| 1 | Style | A user-selected or AI-generated art style. |
| 2 | Characters | Structured prompts for main adult characters. |
| 3 | Portraits | A portrait for each saved character. |
| 4 | Chapters | A structured prompt for a chapter scene. |
| 5 | Illustrations | A scene illustration for each saved chapter. |

Video, music, narration, media mixing, audiobooks, cloud storage, public deployment, and automatic Gemini retry loops are out of scope.

## 3. Functional Requirements

### Identity and sessions

- **FR-01:** The system shall validate a required name and valid email before starting a session.
- **FR-02:** The system shall create a user for a new email and load that user's existing projects for a known email.
- **FR-03:** The system shall prevent a user from accessing another user's projects, books, or generated images.
- **FR-04:** The system shall provide sign-out without deleting the user's saved projects.

### Projects

- **FR-05:** The system shall create a project from a required title and non-empty book text supplied by paste or `.txt` upload.
- **FR-06:** The system shall retain the complete original book text locally and make it readable at every pipeline stage.
- **FR-07:** The system shall list the current user's projects with title, creation date, overall status, and progress across all five steps; it shall show an empty state when the user has no projects.
- **FR-08:** The system shall show the saved pipeline state, generated outputs, current execution state, and error information when a project is opened.

### Pipeline

- **FR-09:** The system shall require an explicit user action to start each pipeline step and shall not allow a later step to start before all earlier steps have succeeded.
- **FR-10:** The system shall accept an optional user-supplied style for the Style step. If no style is supplied, it shall generate an art style from the book and use the resulting style for subsequent pipeline steps.
- **FR-11:** The system shall identify only adult main characters and shall retain no more than two character records, each with a name and image prompt.
- **FR-12:** The system shall generate one portrait for each saved character, retain completed portraits when another portrait generation fails, and show progress for each portrait.
- **FR-13:** The system shall retain no more than one chapter record containing a name and scene illustration prompt. Where relevant, the prompt shall reference previously identified characters.
- **FR-14:** The system shall generate one scene illustration for each saved chapter and reuse previously generated character portrait context so the appearance of relevant characters remains consistent.
- **FR-15:** The system shall enforce the maximum of two adult characters and one chapter even when Gemini returns more entries.

### Resilience and cost controls

- **FR-16:** The system shall preserve project state, generated results, images, and retryable error information across browser refresh, logout, and server restart.
- **FR-17:** At most one execution of a project step shall trigger a Gemini provider call at a time. Duplicate clicks, overlapping requests, refreshes, or another browser tab shall show the existing execution state and shall not trigger another Gemini call.
- **FR-18:** The system shall leave a failed step retryable without regenerating successful preceding work. A retry shall be initiated by the user and shall not automatically retry Gemini.
- **FR-19:** The system shall provide a user-visible recovery path for a stranded running step so that it cannot remain stuck forever. Recovery and any retry shall require explicit user action and shall not automatically trigger a Gemini call.
- **FR-20:** The system shall provide the full book content to Gemini no more than once per project and shall reuse that context for later pipeline steps.

## 4. User Interface Requirements

- **UI-01:** The system shall provide identity, project-list, new-project, and project-detail views.
- **UI-02:** The identity view shall validate name and email. The project-list view shall show each project's Draft, In progress, or Done status and its five-step progress.
- **UI-03:** The new-project view shall validate the title and book text and shall support both pasted text and `.txt` selection.
- **UI-04:** The project-detail view shall show the project title, creation date, complete book text, a five-step done/current/pending stepper, generated style, character cards, chapter cards, and one clear action for the current step.
- **UI-05:** The system shall name the running step during work, show per-item portrait progress, display understandable retryable errors, and provide the stranded-step recovery action.
- **UI-06:** The interface shall be responsive, keyboard-usable, visually at least as complete as `docs/gradion/app-demo.html`, and shall avoid layout jumps while content loads.

## 5. External Integration Requirements

- **IR-01:** The system shall read the Gemini API key from server-side environment configuration and shall not expose it to the browser or commit it to version control.
- **IR-02:** The system shall follow the required Gemini cookbook mechanics: use document upload or an equivalent reusable book-reference mechanism; chain text interactions using prior interaction context; request structured JSON for character and chapter prompts; chain image interactions; and reuse portrait or image context for consistent scene generation.
- **IR-03:** The system shall make text and image model IDs configurable through server-side configuration or environment variables. The current model IDs selected for implementation shall be documented in `DECISIONS.md`.
- **IR-04:** The system shall accept only valid character and chapter prompt records. Malformed output, provider errors, safety blocks, and missing images shall be shown as retryable failures without losing completed work.

## 6. Data and Security Requirements

- **DR-01:** The system shall store books and generated images on the local filesystem and shall retain project metadata locally. It shall allow only the owning user to access a project's books and images.
- **DR-02:** The system shall retain a project's owner, title, timestamps, original book, overall state, step progress and errors, generated style, characters, chapters, images, and Gemini context needed to resume work.
- **DR-03:** The system shall accept `.txt` input only when it contains non-empty readable content, shall handle uploaded input safely, and shall not allow users to request arbitrary local files.
- **DR-04:** The repository shall not contain `.env` files, API keys, user book files, generated runtime images, or runtime database/storage. The required real test report may be committed in `TESTING.md` or as a generated report artifact. `.env.example` shall contain variable names or placeholders only and no secrets.

## 7. Quality and Verification Requirements

- **QR-01:** The project shall provide one command to start the complete local stack and one command to run all frontend and backend tests.
- **QR-02:** Backend tests shall cover pipeline ordering, duplicate-call prevention, persistence, failure/retry, and stranded-work recovery. Frontend tests shall cover meaningful empty, loading, error, and retry states.
- **QR-03:** The normal automated test suite shall not depend on live Gemini calls. Automated tests shall use a fake or mock Gemini implementation and shall not consume Gemini image-generation quota. Explicit manual or opt-in integration verification may use the real API. `TESTING.md` shall contain unedited output from an actual automated test run.
- **QR-04:** `README.md` shall document prerequisites, environment variables, start/test commands, and a short architecture overview.
- **QR-05:** `DECISIONS.md` shall contain 4–6 authentic engineering decisions, including at least three instances where AI output was overridden.

The decisions shall cover at minimum:
- stack and storage choice,
- pipeline progress/state modeling,
- prevention of duplicate step execution across refreshes or overlapping requests.

It shall end with the required one-more-day answer.

## 8. Acceptance Criteria

- **AC-01:** With documented prerequisites and environment variables set, a reviewer can start the complete local stack with one command.
- **AC-02:** A reviewer can enter a valid name and email, see existing projects for a known email, and sign out without deleting them.
- **AC-03:** A reviewer can create a project with a title and book text supplied either by paste or a readable `.txt` file.
- **AC-04:** A reviewer can explicitly complete the pipeline in the order Style → Characters → Portraits → Chapters → Illustrations; an attempt to start a later step first is rejected.
- **AC-05:** The completed project contains no more than two adult character records/portraits and no more than one chapter record/illustration.
- **AC-06:** Repeated clicks, overlapping requests, a refresh, and a second browser tab during one running step do not produce more than one Gemini call for that execution and instead show the existing state.
- **AC-07:** After a refresh, sign-out/sign-in, or server restart, a reviewer can reopen the project and see its saved outputs and actual pipeline state.
- **AC-08:** After a forced provider failure, a reviewer can retry only the failed step without regenerating successful preceding work.
- **AC-09:** A reviewer can recover a stranded running step through an explicit user action; the application does not automatically retry it.
- **AC-10:** During portrait generation, a reviewer can see the state of each character portrait and see completed portraits before all portrait work is finished.
- **AC-11:** A completed project displays its style, character prompts and portraits, chapter prompt, and chapter illustration; the scene preserves the appearance of its relevant characters.
- **AC-12:** A reviewer can run frontend and backend automated tests with one command, without requiring a live Gemini key or consuming image-generation quota.
