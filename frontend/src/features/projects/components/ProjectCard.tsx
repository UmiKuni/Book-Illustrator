import { Link } from 'react-router-dom'

import type { ProjectSummary } from '../projects.types'

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
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
