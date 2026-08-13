import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ApiError } from '../../shared/api/client'
import { createProjectFromFile, createProjectFromText } from './projects.api'
import type { ProjectDetail } from './projects.types'

type BookInputMode = 'paste' | 'upload'

interface NewProjectPageProps {
  onProjectCreated: (project: ProjectDetail) => void
  onUnauthorized: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
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
  const sourceTabs = useRef<Record<BookInputMode, HTMLButtonElement | null>>({
    paste: null,
    upload: null,
  })

  function selectMode(nextMode: BookInputMode) {
    if (submitting) return
    setMode(nextMode)
    setFieldErrors((current) => ({ title: current.title }))
    setSubmitError(null)
  }

  function handleSourceTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: BookInputMode,
  ) {
    let nextMode: BookInputMode | undefined
    if (event.key === 'Home') nextMode = 'paste'
    if (event.key === 'End') nextMode = 'upload'
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextMode = currentMode === 'paste' ? 'upload' : 'paste'
    }
    if (!nextMode) return

    event.preventDefault()
    selectMode(nextMode)
    sourceTabs.current[nextMode]?.focus()
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
      if (error instanceof ApiError && error.status === 401) {
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
              id="paste-book-tab"
              ref={(node) => { sourceTabs.current.paste = node }}
              className={mode === 'paste' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={mode === 'paste'}
              aria-controls="paste-book-panel"
              tabIndex={mode === 'paste' ? 0 : -1}
              onClick={() => selectMode('paste')}
              onKeyDown={(event) => handleSourceTabKeyDown(event, 'paste')}
            >
              Paste text
            </button>
            <button
              id="upload-book-tab"
              ref={(node) => { sourceTabs.current.upload = node }}
              className={mode === 'upload' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={mode === 'upload'}
              aria-controls="upload-book-panel"
              tabIndex={mode === 'upload' ? 0 : -1}
              onClick={() => selectMode('upload')}
              onKeyDown={(event) => handleSourceTabKeyDown(event, 'upload')}
            >
              Upload .txt
            </button>
          </div>

          {mode === 'paste' ? (
            <div
              className={`book-source-panel form-field ${fieldErrors.book ? 'field-invalid' : ''}`}
              id="paste-book-panel"
              role="tabpanel"
              aria-labelledby="paste-book-tab"
            >
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
            <div
              className={`book-source-panel upload-panel ${fieldErrors.book ? 'field-invalid' : ''}`}
              id="upload-book-panel"
              role="tabpanel"
              aria-labelledby="upload-book-tab"
            >
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
