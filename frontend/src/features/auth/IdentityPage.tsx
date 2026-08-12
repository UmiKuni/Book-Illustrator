import { useState, type FormEvent } from 'react'

import { ApiError } from '../../shared/api/client'
import { startSession, type SessionUser } from './auth.api'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

export function IdentityPage({ onSessionStarted }: { onSessionStarted: (user: SessionUser) => void }) {
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
      const user = await startSession(trimmedName, trimmedEmail)
      onSessionStarted(user)
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
