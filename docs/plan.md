# Implementation Plan

## Pre-code prerequisites

1. Verify the required Gemini notebook and record relevant provider findings in `docs/gemini-integration.md`.
2. Establish and commit the requirement/provider documentation baseline.
3. Create the minimal project workspace, test harness, `.gitignore`, `.env.example`, and one-command start/test scripts.

## Delivery increments

1. **Foundation:** local metadata persistence, identity/session handling, frontend routing, and basic test infrastructure.
2. **Projects:** project creation, paste/`.txt` input, authorized list/detail access, readable book view, empty state, and basic responsive UI.
3. **Pipeline core:** persistent ordered step state, duplicate-execution prevention, failure/recovery handling, progress UI, and tests. Prove duplicate execution is prevented before connecting Gemini.
4. **Gemini text:** one-time book context initialization, style, character prompts (adult only, max two), and chapter prompt (max one). Validate provider output before persistence.
5. **Gemini images:** sequential portraits with per-item progress, followed by the chapter illustration using the required Gemini image context. Persist generated images locally.
6. **Quality pass:** complete loading/error/retry states, accessibility and narrow-screen checks, remaining frontend/backend tests, real test output in `TESTING.md`, README, and authentic `DECISIONS.md` entries.

## Definition of done

A reviewer can configure the Gemini key, start the application with one command, sign in, create a project, complete and resume the five-stage pipeline, recover from failures, and see persisted results. The full automated test suite runs with one command without live Gemini calls.

No secrets, user books, generated runtime images, runtime storage, coverage output, or temporary test artifacts are committed. Required real test output is recorded in `TESTING.md`.

## Commit discipline

Commit coherent, testable increments. Do not defer documentation, tests, or authentic decisions to one final commit.