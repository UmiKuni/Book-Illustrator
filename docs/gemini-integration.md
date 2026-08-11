# Gemini Integration Notes

## Purpose

This document records the Gemini provider mechanics demonstrated by the locally
executed `Book_illustration.ipynb` and maps them to Gradion's required five
user-facing stages:

`Style → Characters → Portraits → Chapters → Illustrations`

It does not prescribe application architecture, storage, API routes, or a
project-step state machine.

## Evidence and source hierarchy

The Gradion assessment is authoritative for product requirements. The executed
notebook is authoritative for observed provider behavior.

- **VERIFIED** — directly observed from an executed notebook path and its recorded result.
- **NOTEBOOK CODE — NOT EXERCISED** — code exists in the notebook, but that branch or outcome was not exercised in this run.
- **ASSESSMENT REQUIREMENT** — explicitly required by the Gradion assessment.
- **SRS REQUIREMENT** — a refinement defined in `docs/SRS.md`.
- **INFERENCE** — a limited technical conclusion drawn from verified behavior.
- **UNRESOLVED** — not established by the assessment or the executed notebook.

`docs/SRS.md` supplies explicitly labeled refinements. No claim below depends
on external Gemini documentation.

## Executed notebook environment

### Observed models

**VERIFIED — observed in this notebook run:**

| Purpose | Notebook variable | Observed value |
| --- | --- | --- |
| Text interactions | `GEMINI_MODEL_ID` | `gemini-3.6-flash` |
| Image interactions | `IMAGE_MODEL_ID` | `gemini-3.1-flash-lite-image` |

These are observations, not permanent model requirements. Model IDs and
availability depend on the API project/key. The final implementation choice is
to be recorded in `DECISIONS.md`. The notebook also warns that image generation
may require billing or available quota.

### Observed configuration

**VERIFIED:** the notebook configured HTTP retries: up to five attempts; a
two-second initial delay; a 60-second maximum delay; and statuses 429, 500,
502, 503, and 504.

**ASSESSMENT REQUIREMENT:** the application must not use automatic Gemini retry
loops. A user initiates any retry. The notebook configuration is evidence of
notebook behavior, not permission to add application retries.

**VERIFIED:** the executed parameter cell set `max_character_images = 2` and
`max_chapter_images = 1`. The notebook's surrounding text presents these as
image-generation limits that can be changed for experimentation.

## Verified provider flow

### Book initialization

```text
Local book text
    ↓
Gemini Files API upload
    ↓
Gemini file URI
    ↓
Initial text interaction containing the document
    ↓
book interaction ID
```

**VERIFIED:** the notebook downloaded a text book, called
`client.files.upload(file="book.txt")`, and used `book.uri` in an initial
`client.interactions.create` call as a `{"type": "document", "uri": ...}`
input alongside a short text instruction. The upload and initial interaction
cells executed without recorded errors; later successful interactions chained
from `book_interaction.id`.

**ASSESSMENT REQUIREMENT:** the full book content is provided to Gemini no more
than once per project and later operations reuse that context.

**UNRESOLVED:** whether application project creation, the first Style action, or
another point performs this provider initialization. The assessment leaves that
orchestration choice open. Initialization is not one of Gradion's five
user-triggered stages.

### Style

**VERIFIED:** with the notebook `style` parameter empty, the executed cell
created a text interaction using `previous_interaction_id=book_interaction.id`.
Its `output_text` was a generated art-style prompt, and the interaction became
`style_interaction`.

**NOTEBOOK CODE — NOT EXERCISED:** when a user supplies a
style, the notebook creates a new interaction from `book_interaction.id` whose
message tells Gemini to retain that style for future prompts. It assigns that
result to `style_interaction`.

**INFERENCE:** a user-supplied style must be represented in the continued text
context, not only in frontend or application memory, because the notebook's
later character request chains from `style_interaction.id`.

### Characters

**VERIFIED:** the notebook requested only adult main characters from a text
interaction chained with `previous_interaction_id=style_interaction.id`. It
requested `application/json` with an array schema whose items were the Pydantic
`Prompt` model:

```text
{
  name,
  prompt
}
```

The recorded successful output was a JSON array of five such records. It did
not wrap them in a `characters[]` property.

**ASSESSMENT REQUIREMENT:** retain and persist at most two adult character
records, and enforce that cap server-side. The notebook obtained five records
and later sliced only the image-generation loop. Its image loop limit is not a
server-side character-record cap.

**SRS REQUIREMENT:** validate structured records before persistence or use;
Gemini schema guidance alone is not sufficient application-boundary validation.

### Portraits

**VERIFIED:** the notebook starts a separate image interaction with the observed
image model. Its setup prompt carries the selected style and image instructions.
It then loops over `characters[:max_character_images]`; each portrait request
uses `previous_interaction_id` from the preceding image interaction. The
executed output displayed portraits for Mole and Water Rat in sequence.

```text
Image setup context
    ↓
Portrait A interaction
    ↓
Portrait B interaction
```

**VERIFIED:** portrait extraction scans the interaction's `steps` in reverse,
selects a `model_output` step, then a content item with `type == "image"`. The
image content supplies `data` and `mime_type`; the notebook renders a data URL
from those fields. It does not assume a hosted image URL.

**INFERENCE:** retaining the latest image-interaction reference is necessary to
continue the notebook's image-history chain into chapter illustration.

### Chapters

**VERIFIED:** the core chapter prompt request continues the text chain with
`previous_interaction_id=characters_prompts_interaction.id`. It requests an
`application/json` array using the same `Prompt` schema:

```text
{
  name,
  prompt
}
```

One chapter record was retained/displayed after applying the configured notebook
limit. The raw provider record count was not separately recorded. The prompt
asks for a single image and asks the model to describe/reuse relevant character
prompts, but the core response schema does not contain `characters`.

**ASSESSMENT REQUIREMENT:** retain no more than one chapter record and enforce
that cap server-side.

**VERIFIED:** the chapter text interaction chains from text context; it is
separate from the image-generation interaction chain.

### Illustrations

**VERIFIED:** before generating a chapter image, the notebook creates a chapter
image-context interaction chained from `last_image_interaction.id`, which is the
last portrait interaction. It instructs the image model to refer to prior
character illustrations for consistency. Each chapter image request continues
from that image interaction; the recorded run produced one JPEG chapter image.

```text
Initial image context
    ↓
Portrait 1
    ↓
Portrait 2
    ↓
Chapter-image context
    ↓
Chapter illustration
```

**VERIFIED:** core illustration extraction again finds an image content item in
model-output steps and decodes its base64 `data`; the recorded displayed result
was a `1408x768` JPEG.

**INFERENCE:** this history is the demonstrated mechanism by which the core
flow retains access to prior generated character appearance. The core request
does not attach selected portrait bytes to the chapter prompt.

## Text context and image context

The executed notebook demonstrates distinct interaction chains:

```text
TEXT CONTEXT

Book document interaction
    ↓
Style interaction
    ↓
Character-prompt interaction
    ↓
Chapter-prompt interaction
```

```text
IMAGE CONTEXT

Image setup interaction
    ↓
Portrait 1
    ↓
Portrait 2
    ↓
Chapter-image context
    ↓
Chapter illustration
```

**INFERENCE:** to resume later provider work using this flow, the relevant text
interaction IDs and the latest image interaction ID must conceptually remain
available, together with the generated outputs needed by the application.

**UNRESOLVED:** the lifetime, expiry behavior, and recovery options for provider
file URIs and interaction IDs were not demonstrated by this notebook.

## Structured output and server-side caps

| Output | Core notebook schema | Executed evidence | Gradion adaptation |
| --- | --- | --- | --- |
| Characters | JSON array of `{name, prompt}` | Five records returned | **ASSESSMENT REQUIREMENT:** retain at most two adult records. |
| Chapters | JSON array of `{name, prompt}` | One record retained/displayed after the notebook limit; raw count not recorded | **ASSESSMENT REQUIREMENT:** retain at most one record. |

**SRS REQUIREMENT:** malformed structured output is a retryable
provider/application-boundary failure without losing completed work. This
document does not define its application state representation.

## Core notebook flow vs bonus granular-control flow

The executed notebook contains two image-consistency approaches.

### Required core flow

**VERIFIED:** the core approach is chained image interaction history:

```text
image context → portrait A → portrait B → chapter illustration
```

The core chapter structure remains `{name, prompt}`. Its chapter image request
continues the previous image interaction and refers to previously generated
characters in its text instruction.

**ASSESSMENT REQUIREMENT:** the application must follow the required
core notebook pipeline.

**VERIFIED:** in the executed notebook, that core image flow uses
chained image interaction history as shown above.

### Bonus / going-further granular-control flow

**VERIFIED:** a later notebook section titled “Bonus: Going further with more
granular control” declares:

```text
Chapter {
  name,
  prompt,
  characters[]
}
```

It executed a chapter-prompt request using that schema, then selected named
portrait outputs, passed their `data` and `mime_type` as explicit image inputs,
and made a new image interaction without chaining. It produced a displayed
chapter image.

This is bonus/granular-control notebook behavior. It must not be described as
the mandatory core chapter schema or core illustration mechanism.

## Provider outputs and image extraction

**VERIFIED:** the core notebook reads structured text from either
`interaction.output_text` (characters) or the final step content text
(chapters), then parses JSON.

**VERIFIED:** for core images, it locates image content in interaction steps and
uses:

| Field | Observed use |
| --- | --- |
| `content.data` | Base64 image data, embedded for portraits or decoded for the chapter image. |
| `content.mime_type` | MIME type used for portrait data-URL rendering and available for image handling. |

**ASSESSMENT REQUIREMENT:** the original book text/file and generated images are
stored on the application's local filesystem. The filesystem layout and access
controls are not defined here.

## Failure and retry implications

**ASSESSMENT REQUIREMENT:** a failed step remains retryable without regenerating
successful preceding work. The user initiates retry; the application has no
automatic Gemini retry loop.

**SRS REQUIREMENT:** provider errors, malformed structured output, safety
blocks, and missing images are retryable failures without losing completed
work.

**NOTEBOOK CODE — NOT EXERCISED:** the portrait cell has a no-image branch that
reports no generated image for the character. The run does not demonstrate a
real provider failure, safety block, retry, or recovery path.

## Verified in the executed notebook

- **VERIFIED:** Files API upload, initial document interaction, and chained generated-style interaction.
- **VERIFIED:** structured character output, two chained portraits, and structured core chapter output.
- **VERIFIED:** a core chapter illustration from chained image context.
- **VERIFIED:** the executed bonus explicit-image-reference flow, including its bonus chapter schema.

## Assessment-specific adaptations

- **ASSESSMENT REQUIREMENT:** the five stages are user-driven and ordered; records are capped server-side at two adult characters and one chapter.
- **ASSESSMENT REQUIREMENT:** provide the full book content to Gemini once per project and reuse provider context afterward; prevent duplicate active-step calls.
- **ASSESSMENT REQUIREMENT:** failures are user-retryable without discarding successful work, and stranded work has a user-visible recovery path.
- **ASSESSMENT REQUIREMENT:** granular control and later notebook sections are outside required core scope.

## Not verified by this notebook

- Application persistence across browser refresh, sign-out, or server restart.
- Concurrent requests, duplicate-execution prevention, and stale-running recovery.
- Multi-user ownership and authorization for books or generated media.
- Local filesystem authorization and serving behavior.
- Real malformed-response, provider-failure, safety-block, or missing-image recovery paths.
- Production error handling and user-visible error messages.
- File-URI or interaction-ID expiry, invalidation, or provider-context recovery.
- Browser UI behavior and per-item progress persistence.
