import { useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router-dom'

import { endSession, type SessionUser } from '../features/auth/auth.api'

export function AuthenticatedShell({
  user,
  onSignedOut,
}: {
  user: SessionUser
  onSignedOut: () => void
}) {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    setSignOutError(null)
    try {
      await endSession()
      onSignedOut()
      navigate('/', { replace: true })
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="studio-shell">
      <header className="studio-header app-header">
        <Link className="brand" to="/projects" aria-label="Book Illustration Studio">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>
            <strong>Book Illustration</strong>
            <small>Studio</small>
          </span>
        </Link>
        <div className="session-controls">
          <span className="session-user" title={user.email}>{user.name}</span>
          <button type="button" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>
      {signOutError && (
        <div className="shell-error" role="alert">
          <span>{signOutError}</span>
          <button type="button" onClick={() => setSignOutError(null)} aria-label="Dismiss sign-out error">×</button>
        </div>
      )}
      <Outlet />
    </div>
  )
}
