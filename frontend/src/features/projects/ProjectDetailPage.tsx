import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError } from '../../shared/api/client'
import { BookPanel } from './components/BookPanel'
import { GeneratedOutputs } from './components/GeneratedOutputs'
import {
  PipelineActionPanel,
  type PendingAction,
} from './components/PipelineActionPanel'
import { PipelineStepper } from './components/PipelineStepper'
import { currentStep, STEP_COPY } from './components/pipelineDisplay'
import {
  getProject,
  recoverPipelineStep,
  runPipelineStep,
} from './projects.api'
import type { ProjectDetail } from './projects.types'

const POLL_INTERVAL_MS = 1_250

interface ProjectDetailPageProps {
  projectId: string
  onUnauthorized?: () => void
}

interface Feedback {
  tone: 'error' | 'success'
  text: string
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

export function ProjectDetailPage({ projectId, onUnauthorized }: ProjectDetailPageProps) {
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [suppliedStyle, setSuppliedStyle] = useState('')
  const mounted = useRef(true)
  const projectRef = useRef<ProjectDetail | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refreshProject = useCallback(
    async (background = false) => {
      try {
        const nextProject = await getProject(projectId)
        if (!mounted.current) return
        projectRef.current = nextProject
        setProject(nextProject)
        setFatalError(null)
      } catch (error) {
        if (!mounted.current) return
        if (error instanceof ApiError && error.status === 401 && onUnauthorized) {
          onUnauthorized()
          return
        }
        const text = messageFor(error)
        if (background || projectRef.current) {
          setFeedback({ tone: 'error', text: `Could not refresh the project. ${text}` })
        } else {
          setFatalError(text)
        }
      } finally {
        if (mounted.current && !background) setLoading(false)
      }
    },
    [onUnauthorized, projectId],
  )

  useEffect(() => {
    let cancelled = false

    void getProject(projectId)
      .then((nextProject) => {
        if (cancelled) return
        projectRef.current = nextProject
        setProject(nextProject)
        setFatalError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401 && onUnauthorized) {
          onUnauthorized()
          return
        }
        setFatalError(messageFor(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [onUnauthorized, projectId])

  const runningStep = project?.steps.find((step) => step.state === 'RUNNING')
  const shouldPoll = Boolean(runningStep) || pendingAction === 'run'

  useEffect(() => {
    if (!shouldPoll) return
    const timer = window.setInterval(() => {
      void refreshProject(true)
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refreshProject, shouldPoll])

  const activeStep = useMemo(
    () => (project ? currentStep(project) : undefined),
    [project],
  )

  async function runCurrentStep() {
    if (!activeStep || activeStep.state === 'RUNNING' || pendingAction) return
    setPendingAction('run')
    setFeedback(null)
    try {
      await runPipelineStep(projectId, activeStep.name, suppliedStyle)
      await refreshProject(true)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && onUnauthorized) {
        onUnauthorized()
        return
      }
      await refreshProject(true)
      if (mounted.current) setFeedback({ tone: 'error', text: messageFor(error) })
    } finally {
      if (mounted.current) setPendingAction(null)
    }
  }

  async function recoverRunningStep() {
    if (!runningStep || pendingAction) return
    setPendingAction('recover')
    setFeedback(null)
    try {
      await recoverPipelineStep(projectId, runningStep.name)
      await refreshProject(true)
      if (mounted.current) {
        setFeedback({
          tone: 'success',
          text: `${STEP_COPY[runningStep.name].label} was marked interrupted. Start it again when you are ready.`,
        })
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && onUnauthorized) {
        onUnauthorized()
        return
      }
      await refreshProject(true)
      if (mounted.current) setFeedback({ tone: 'error', text: messageFor(error) })
    } finally {
      if (mounted.current) setPendingAction(null)
    }
  }

  if (loading && !project) {
    return <LoadingView />
  }

  if (!project) {
    return (
      <main className="centered-state">
        <span className="eyebrow">Project unavailable</span>
        <h1>We could not open this story.</h1>
        <p role="alert">{fatalError ?? 'The project could not be loaded.'}</p>
        <button className="button button-primary" type="button" onClick={() => void refreshProject()}>
          Try again
        </button>
      </main>
    )
  }

  return (
    <div className="project-detail-view">
      <div className="detail-context-bar">
        <Link className="back-link" to="/projects"><span aria-hidden="true">←</span> Project Library</Link>
      </div>

      <main className="project-page">
        <section className="project-hero" aria-labelledby="project-title">
          <div>
            <span className="eyebrow">Illustration project</span>
            <h1 id="project-title">{project.title}</h1>
            <p className="project-date">Created {formatDate(project.createdAt)}</p>
          </div>
        </section>

        <PipelineStepper project={project} activeStep={activeStep} />

        {feedback && (
          <div className={`feedback feedback-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
            <span aria-hidden="true">{feedback.tone === 'error' ? '!' : '✓'}</span>
            <p>{feedback.text}</p>
          </div>
        )}

        <div className="workspace-grid">
          <div className="generated-work">
            <PipelineActionPanel
              activeStep={activeStep}
              runningStep={runningStep}
              pendingAction={pendingAction}
              suppliedStyle={suppliedStyle}
              onStyleChange={setSuppliedStyle}
              onRun={() => void runCurrentStep()}
              onRecover={() => void recoverRunningStep()}
            />

            <GeneratedOutputs key={project.id} project={project} />
          </div>

          <BookPanel title={project.title} text={project.bookText} />
        </div>
      </main>
    </div>
  )
}

function LoadingView() {
  return (
    <main className="centered-state" aria-live="polite">
      <span className="loading-seal" aria-hidden="true" />
      <span className="eyebrow">Opening project</span>
      <h1>Preparing your studio…</h1>
    </main>
  )
}
