import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import {
  ApiError,
  createProjectFromFile,
  createProjectFromText,
  listProjects,
  startSession,
  type ProjectDetail,
  type ProjectSummary,
} from './api'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function IdentityPage({ onSessionStarted }: { onSessionStarted: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const errors: { name?: string; email?: string } = {}

    if (!trimmedName) errors.name = 'Enter your full name.'
    if (!trimmedEmail) {
      errors.email = 'Enter your email address.'
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.email = 'Enter a valid email address.'
    }

    setFieldErrors(errors)
    setSubmitError(null)
    if (Object.keys(errors).length) return

    setSubmitting(true)
    try {
      await startSession(trimmedName, trimmedEmail)
      onSessionStarted()
    } catch (error) {
      setSubmitError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="identity-page">
      <section className="identity-card" aria-labelledby="identity-title">
        <div className="identity-intro">
          <span className="brand-mark large" aria-hidden="true">B</span>
          <span className="eyebrow">Book Illustration Studio</span>
          <h1 id="identity-title">Turn a story into a visual world.</h1>
          <p>
            Enter your details to begin or resume your saved illustration projects.
            No password is required for this local studio.
          </p>
        </div>

        <form className="identity-form" onSubmit={submit} noValidate>
          <div className="form-heading">
            <span className="eyebrow">Identity</span>
            <h2>Open your studio</h2>
            <p>A known email returns you to the projects already saved on this device.</p>
          </div>

          <div className={`form-field ${fieldErrors.name ? 'field-invalid' : ''}`}>
            <label htmlFor="identity-name">Full name</label>
            <input
              id="identity-name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mira Hassan"
              aria-describedby={fieldErrors.name ? 'identity-name-error' : undefined}
              aria-invalid={Boolean(fieldErrors.name)}
              disabled={submitting}
            />
            {fieldErrors.name && <small id="identity-name-error">{fieldErrors.name}</small>}
          </div>

          <div className={`form-field ${fieldErrors.email ? 'field-invalid' : ''}`}>
            <label htmlFor="identity-email">Email</label>
            <input
              id="identity-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="mira@example.com"
              aria-describedby={fieldErrors.email ? 'identity-email-error' : undefined}
              aria-invalid={Boolean(fieldErrors.email)}
              disabled={submitting}
            />
            {fieldErrors.email && <small id="identity-email-error">{fieldErrors.email}</small>}
          </div>

          {submitError && <div className="form-error" role="alert">{submitError}</div>}

          <button className="button button-primary form-submit" type="submit" disabled={submitting}>
            {submitting && <span className="button-spinner" aria-hidden="true" />}
            {submitting ? 'Opening studio…' : 'Continue to projects'}
          </button>
        </form>
      </section>
    </main>
  )
}

interface ProjectLibraryPageProps {
  projects: ProjectSummary[]
  onProjectsLoaded: (projects: ProjectSummary[]) => void
  onUnauthorized: () => void
}

export function ProjectLibraryPage({
  projects,
  onProjectsLoaded,
  onUnauthorized,
}: ProjectLibraryPageProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    try {
      onProjectsLoaded(await listProjects())
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized()
        return
      }
      setRefreshError(errorMessage(error))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <main className="library-page app-page">
      <section className="page-heading library-heading">
        <div>
          <span className="eyebrow">Your collection</span>
          <h1>Project Library</h1>
          <p>Return to a story exactly where its illustration work was saved.</p>
        </div>
        <div className="library-actions">
          <button className="button button-quiet" type="button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link className="button button-primary" to="/projects/new">New project</Link>
        </div>
      </section>

      {refreshError && (
        <div className="feedback feedback-error library-feedback" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <p>{refreshError}</p>
            <button className="inline-action" type="button" onClick={() => void refresh()}>Try again</button>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <section className="library-empty" aria-labelledby="empty-library-title">
          <span className="empty-book" aria-hidden="true">B</span>
          <span className="eyebrow">An empty shelf</span>
          <h2 id="empty-library-title">Your first story starts here.</h2>
          <p>Add a title and book text, then guide it through five deliberate illustration stages.</p>
          <Link className="button button-primary" to="/projects/new">Create your first project</Link>
        </section>
      ) : (
        <section className={`project-library ${refreshing ? 'is-refreshing' : ''}`} aria-label="Saved projects">
          {projects.map((project) => <ProjectLibraryCard key={project.id} project={project} />)}
        </section>
      )}
    </main>
  )
}

function ProjectLibraryCard({ project }: { project: ProjectSummary }) {
  return (
    <Link className="library-project-card" to={`/projects/${encodeURIComponent(project.id)}`}>
      <div className="project-card-topline">
        <span className={`project-pill pill-${project.status.toLowerCase().replace(' ', '-')}`}>
          {project.status}
        </span>
        <time dateTime={project.createdAt}>Created {formatDate(project.createdAt)}</time>
      </div>
      <h2>{project.title}</h2>
      <div className="library-progress">
        <div className="progress-label">
          <span>Illustration progress</span>
          <strong>{project.completedSteps} of {project.totalSteps}</strong>
        </div>
        <div
          className="progress-segments"
          aria-label={`${project.completedSteps} of ${project.totalSteps} steps complete`}
        >
          {Array.from({ length: project.totalSteps }, (_, index) => (
            <span className={index < project.completedSteps ? 'complete' : ''} key={index} />
          ))}
        </div>
      </div>
      <span className="open-project-label">Open project <span aria-hidden="true">→</span></span>
    </Link>
  )
}

type BookInputMode = 'paste' | 'upload'

interface NewProjectPageProps {
  onProjectCreated: (project: ProjectDetail) => void
  onUnauthorized: () => void
}

export function NewProjectPage({ onProjectCreated, onUnauthorized }: NewProjectPageProps) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<BookInputMode>('paste')
  const [title, setTitle] = useState('')
  const [bookText, setBookText] = useState('')
  const [bookFile, setBookFile] = useState<File | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; book?: string }>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  function selectMode(nextMode: BookInputMode) {
    if (submitting) return
    setMode(nextMode)
    setFieldErrors((current) => ({ title: current.title }))
    setSubmitError(null)
  }

  function selectFile(file: File | null) {
    setBookFile(file)
    setSubmitError(null)
    if (!file) {
      setFieldErrors((current) => ({ ...current, book: undefined }))
      return
    }

    const fileError = !file.name.toLowerCase().endsWith('.txt')
      ? 'Choose a file with a .txt extension.'
      : file.size === 0
        ? 'The selected .txt file is empty.'
        : undefined
    setFieldErrors((current) => ({ ...current, book: fileError }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const trimmedTitle = title.trim()
    const trimmedText = bookText.trim()
    const errors: { title?: string; book?: string } = {}
    if (!trimmedTitle) errors.title = 'Enter a project title.'

    if (mode === 'paste' && !trimmedText) {
      errors.book = 'Paste non-empty book text.'
    }
    if (mode === 'upload') {
      if (!bookFile) {
        errors.book = 'Choose a .txt book file.'
      } else if (!bookFile.name.toLowerCase().endsWith('.txt')) {
        errors.book = 'Choose a file with a .txt extension.'
      } else if (bookFile.size === 0) {
        errors.book = 'The selected .txt file is empty.'
      }
    }

    setFieldErrors(errors)
    setSubmitError(null)
    if (Object.keys(errors).length) return

    setSubmitting(true)
    try {
      const created = mode === 'paste'
        ? await createProjectFromText(trimmedTitle, trimmedText)
        : await createProjectFromFile(trimmedTitle, bookFile as File)
      onProjectCreated(created)
      navigate(`/projects/${encodeURIComponent(created.id)}`)
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized()
        return
      }
      setSubmitError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="new-project-page app-page">
      <Link className="back-link" to="/projects"><span aria-hidden="true">←</span> Back to projects</Link>
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">A new volume</span>
          <h1>Start an illustration project</h1>
          <p>Give the story a title and add its complete text. Generation begins only when you choose Style.</p>
        </div>
      </section>

      <form className="new-project-form" onSubmit={submit} noValidate>
        <div className={`form-field ${fieldErrors.title ? 'field-invalid' : ''}`}>
          <label htmlFor="project-title-input">Project title</label>
          <input
            id="project-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="The Wind in the Willows"
            aria-describedby={fieldErrors.title ? 'project-title-error' : undefined}
            aria-invalid={Boolean(fieldErrors.title)}
            disabled={submitting}
          />
          {fieldErrors.title && <small id="project-title-error">{fieldErrors.title}</small>}
        </div>

        <fieldset className="book-source-fieldset" disabled={submitting}>
          <legend>Book source</legend>
          <div className="source-tabs" role="tablist" aria-label="Book input method">
            <button
              className={mode === 'paste' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={mode === 'paste'}
              aria-controls="paste-book-panel"
              onClick={() => selectMode('paste')}
            >
              Paste text
            </button>
            <button
              className={mode === 'upload' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={mode === 'upload'}
              aria-controls="upload-book-panel"
              onClick={() => selectMode('upload')}
            >
              Upload .txt
            </button>
          </div>

          {mode === 'paste' ? (
            <div className={`book-source-panel form-field ${fieldErrors.book ? 'field-invalid' : ''}`} id="paste-book-panel" role="tabpanel">
              <label htmlFor="book-text-input">Complete book text</label>
              <textarea
                id="book-text-input"
                value={bookText}
                onChange={(event) => setBookText(event.target.value)}
                placeholder="Once upon a time…"
                rows={13}
                aria-describedby={fieldErrors.book ? 'book-source-error' : 'book-text-help'}
                aria-invalid={Boolean(fieldErrors.book)}
              />
              <small id="book-text-help">The complete text is stored locally and remains readable throughout the project.</small>
            </div>
          ) : (
            <div className={`book-source-panel upload-panel ${fieldErrors.book ? 'field-invalid' : ''}`} id="upload-book-panel" role="tabpanel">
              <span className="upload-symbol" aria-hidden="true">TXT</span>
              <label htmlFor="book-file-input">Choose a .txt book</label>
              <p>The backend verifies the file's size, UTF-8 readability, extension, and content.</p>
              <input
                ref={fileInput}
                id="book-file-input"
                type="file"
                accept=".txt,text/plain"
                onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
              />
              {bookFile && (
                <div className="selected-file">
                  <span><strong>{bookFile.name}</strong><small>{Math.max(1, Math.ceil(bookFile.size / 1024))} KB</small></span>
                  <button type="button" onClick={() => fileInput.current?.click()}>Choose another</button>
                </div>
              )}
            </div>
          )}
          {fieldErrors.book && <small className="field-error" id="book-source-error">{fieldErrors.book}</small>}
        </fieldset>

        {submitError && <div className="form-error" role="alert">{submitError}</div>}

        <div className="creation-actions">
          <Link className="button button-quiet" to="/projects">Cancel</Link>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting && <span className="button-spinner" aria-hidden="true" />}
            {submitting ? 'Creating project…' : 'Create project'}
          </button>
        </div>
      </form>
    </main>
  )
}
