import { useCallback, useEffect, useState } from 'react'
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'

import {
  getCurrentSession,
  type SessionUser,
} from '../features/auth/auth.api'
import { IdentityPage } from '../features/auth/IdentityPage'
import { NewProjectPage } from '../features/projects/NewProjectPage'
import { ProjectDetailPage } from '../features/projects/ProjectDetailPage'
import { ProjectLibraryPage } from '../features/projects/ProjectLibraryPage'
import { listProjects } from '../features/projects/projects.api'
import type { ProjectDetail, ProjectSummary } from '../features/projects/projects.types'
import { ApiError } from '../shared/api/client'
import { AuthenticatedShell } from './AuthenticatedShell'

type BootstrapState = 'loading' | 'authenticated' | 'unauthenticated' | 'error'

export function AppRoutes() {
  const navigate = useNavigate()
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  const loadApplication = useCallback(async (knownUser?: SessionUser) => {
    setBootstrapState('loading')
    setBootstrapError(null)

    try {
      const currentUser = knownUser ?? await getCurrentSession()
      const nextProjects = await listProjects()
      setUser(currentUser)
      setProjects(nextProjects)
      setBootstrapState('authenticated')
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null)
        setProjects([])
        setBootstrapState('unauthenticated')
        return
      }

      setBootstrapError(error instanceof Error ? error.message : 'Could not open the application.')
      setBootstrapState('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void getCurrentSession()
      .then(async (currentUser) => ({
        currentUser,
        nextProjects: await listProjects(),
      }))
      .then(({ currentUser, nextProjects }) => {
        if (cancelled) return
        setUser(currentUser)
        setProjects(nextProjects)
        setBootstrapState('authenticated')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          setUser(null)
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

  const handleSessionStarted = useCallback((sessionUser: SessionUser) => {
    navigate('/projects', { replace: true })
    void loadApplication(sessionUser)
  }, [loadApplication, navigate])

  const handleUnauthorized = useCallback(() => {
    setUser(null)
    setProjects([])
    setBootstrapError(null)
    setBootstrapState('unauthenticated')
  }, [])

  const addProject = useCallback((project: ProjectDetail) => {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)])
  }, [])

  if (bootstrapState === 'loading') {
    return <ApplicationLoading />
  }

  if (bootstrapState === 'error') {
    return <ApplicationError message={bootstrapError} onRetry={() => void loadApplication()} />
  }

  if (bootstrapState === 'unauthenticated' || !user) {
    return <IdentityPage onSessionStarted={handleSessionStarted} />
  }

  return (
    <Routes>
      <Route element={<AuthenticatedShell user={user} onSignedOut={handleUnauthorized} />}>
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

function RoutedProjectDetail({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { projectId } = useParams()

  if (!projectId) return <Navigate replace to="/projects" />

  return <ProjectDetailPage projectId={projectId} onUnauthorized={onUnauthorized} />
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
