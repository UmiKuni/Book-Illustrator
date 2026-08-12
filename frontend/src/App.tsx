import { useCallback, useEffect, useState } from 'react'
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'

import './App.css'
import {
  IdentityPage,
  NewProjectPage,
  ProjectLibraryPage,
} from './ApplicationPages'
import { ProjectDetailPage } from './ProjectDetailPage'
import {
  ApiError,
  endSession,
  listProjects,
  type ProjectDetail,
  type ProjectSummary,
} from './api'

type BootstrapState = 'loading' | 'authenticated' | 'unauthenticated' | 'error'

function App() {
  return (
    <BrowserRouter>
      <ApplicationRoutes />
    </BrowserRouter>
  )
}

function ApplicationRoutes() {
  const navigate = useNavigate()
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>('loading')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  const loadApplication = useCallback(() => {
    setBootstrapState('loading')
    setBootstrapError(null)
    void listProjects()
      .then((nextProjects) => {
        setProjects(nextProjects)
        setBootstrapState('authenticated')
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setProjects([])
          setBootstrapState('unauthenticated')
          return
        }
        setBootstrapError(error instanceof Error ? error.message : 'Could not open the application.')
        setBootstrapState('error')
      })
  }, [])

  useEffect(() => {
    let cancelled = false

    void listProjects()
      .then((nextProjects) => {
        if (cancelled) return
        setProjects(nextProjects)
        setBootstrapState('authenticated')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          setProjects([])
          setBootstrapState('unauthenticated')
          return
        }
        setBootstrapError(error instanceof Error ? error.message : 'Could not open the application.')
        setBootstrapState('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  function handleSessionStarted() {
    navigate('/projects', { replace: true })
    loadApplication()
  }

  function handleUnauthorized() {
    setProjects([])
    setBootstrapError(null)
    setBootstrapState('unauthenticated')
  }

  function addProject(project: ProjectDetail) {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)])
  }

  if (bootstrapState === 'loading') {
    return <ApplicationLoading />
  }

  if (bootstrapState === 'error') {
    return <ApplicationError message={bootstrapError} onRetry={loadApplication} />
  }

  if (bootstrapState === 'unauthenticated') {
    return <IdentityPage onSessionStarted={handleSessionStarted} />
  }

  return (
    <Routes>
      <Route
        element={
          <AuthenticatedShell
            onSignedOut={handleUnauthorized}
          />
        }
      >
        <Route index element={<Navigate replace to="/projects" />} />
        <Route
          path="projects"
          element={
            <ProjectLibraryPage
              projects={projects}
              onProjectsLoaded={setProjects}
              onUnauthorized={handleUnauthorized}
            />
          }
        />
        <Route
          path="projects/new"
          element={
            <NewProjectPage
              onProjectCreated={addProject}
              onUnauthorized={handleUnauthorized}
            />
          }
        />
        <Route
          path="projects/:projectId"
          element={<RoutedProjectDetail onUnauthorized={handleUnauthorized} />}
        />
        <Route path="*" element={<Navigate replace to="/projects" />} />
      </Route>
    </Routes>
  )
}

function AuthenticatedShell({ onSignedOut }: { onSignedOut: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
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
        <Link className="brand" to="/projects" aria-label="Book Illustration Studio projects">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>
            <strong>Book Illustration</strong>
            <small>Studio</small>
          </span>
        </Link>
        <nav className="app-navigation" aria-label="Primary navigation">
          <Link className={location.pathname === '/projects' ? 'active' : ''} to="/projects">Projects</Link>
          <Link className={location.pathname === '/projects/new' ? 'active' : ''} to="/projects/new">New project</Link>
          <button type="button" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </nav>
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

function RoutedProjectDetail({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { projectId } = useParams()

  if (!projectId) return <Navigate replace to="/projects" />

  return (
    <ProjectDetailPage
      projectId={projectId}
      onUnauthorized={onUnauthorized}
    />
  )
}

function ApplicationLoading() {
  return (
    <main className="centered-state application-loading" aria-live="polite">
      <span className="loading-seal" aria-hidden="true" />
      <span className="eyebrow">Book Illustration Studio</span>
      <h1>Opening your library…</h1>
      <p>Checking the saved local session and project collection.</p>
    </main>
  )
}

function ApplicationError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <main className="centered-state">
      <span className="eyebrow">Application unavailable</span>
      <h1>We could not open the studio.</h1>
      <p>{message ?? 'The project library could not be loaded.'}</p>
      <button className="button button-primary" type="button" onClick={onRetry}>Try again</button>
    </main>
  )
}

export default App
