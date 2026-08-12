import { useState, type FormEvent } from 'react'

import './App.css'
import { ProjectDetailPage } from './ProjectDetailPage'

interface AppProps {
  projectId?: string
}

function projectIdFromLocation(): string | null {
  const hashMatch = window.location.hash.match(/^#\/projects\/([^/?#]+)/)
  const pathMatch = window.location.pathname.match(/^\/projects\/([^/?#]+)/)
  const value =
    hashMatch?.[1] ??
    pathMatch?.[1] ??
    new URLSearchParams(window.location.search).get('project')

  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function App({ projectId }: AppProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(
    () => projectId ?? projectIdFromLocation(),
  )

  if (selectedProjectId) {
    return <ProjectDetailPage projectId={selectedProjectId} />
  }

  return <OpenProject onOpen={setSelectedProjectId} />
}

function OpenProject({ onOpen }: { onOpen: (projectId: string) => void }) {
  const [value, setValue] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const projectId = value.trim()
    if (!projectId) return
    window.history.replaceState(null, '', `#/projects/${encodeURIComponent(projectId)}`)
    onOpen(projectId)
  }

  return (
    <main className="open-project-page">
      <div className="open-project-card">
        <span className="brand-mark large" aria-hidden="true">B</span>
        <span className="eyebrow">Book Illustration Studio</span>
        <h1>Open a story in progress.</h1>
        <p>
          Enter a project ID to continue its saved illustration pipeline. Sign-in,
          project creation, and the complete library arrive in the next frontend increment.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="project-id">Project ID</label>
          <div className="open-project-controls">
            <input
              id="project-id"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Paste a project ID"
              required
            />
            <button className="button button-primary" type="submit">Open project</button>
          </div>
        </form>
      </div>
    </main>
  )
}

export default App
