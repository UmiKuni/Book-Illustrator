import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError } from '../../shared/api/client'
import { ProjectCard } from './components/ProjectCard'
import { listProjects } from './projects.api'
import type { ProjectSummary } from './projects.types'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
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
      if (error instanceof ApiError && error.status === 401) {
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
          {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </section>
      )}
    </main>
  )
}
