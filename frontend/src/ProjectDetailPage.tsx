import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  ApiError,
  illustrationMediaUrl,
  portraitMediaUrl,
  recoverPipelineStep,
  runPipelineStep,
  getProject,
  type Character,
  type Chapter,
  type PipelineStep,
  type PipelineStepName,
  type ProjectDetail,
} from './api'

const POLL_INTERVAL_MS = 1_250

const STEP_COPY: Record<
  PipelineStepName,
  { label: string; action: string; running: string; description: string }
> = {
  STYLE: {
    label: 'Style',
    action: 'Generate Style',
    running: 'Generating Style',
    description: 'Define the visual language that guides every image.',
  },
  CHARACTERS: {
    label: 'Characters',
    action: 'Generate Characters',
    running: 'Generating Characters',
    description: 'Find the main adult characters and shape their portrait prompts.',
  },
  PORTRAITS: {
    label: 'Portraits',
    action: 'Generate Portraits',
    running: 'Generating Portraits',
    description: 'Create each character portrait in story order.',
  },
  CHAPTERS: {
    label: 'Chapters',
    action: 'Generate Chapter',
    running: 'Generating Chapter',
    description: 'Choose the key scene and prepare its illustration prompt.',
  },
  ILLUSTRATIONS: {
    label: 'Illustration',
    action: 'Generate Illustration',
    running: 'Generating Illustration',
    description: 'Turn the saved chapter scene into the final artwork.',
  },
}

interface ProjectDetailPageProps {
  projectId: string
  onUnauthorized?: () => void
}

interface Feedback {
  tone: 'error' | 'success'
  text: string
}

type PendingAction = 'run' | 'recover' | null

function orderedSteps(project: ProjectDetail): PipelineStep[] {
  return [...project.steps].sort((left, right) => left.position - right.position)
}

function currentStep(project: ProjectDetail): PipelineStep | undefined {
  return orderedSteps(project).find((step) => step.state !== 'SUCCEEDED')
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

function humanState(state: PipelineStep['state']): string {
  return state.charAt(0) + state.slice(1).toLowerCase()
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
        <p>{fatalError ?? 'The project could not be loaded.'}</p>
        <button className="button button-primary" onClick={() => void refreshProject()}>
          Try again
        </button>
      </main>
    )
  }

  return (
    <div className="project-detail-view">
      <div className="detail-context-bar">
        <Link className="back-link" to="/projects"><span aria-hidden="true">←</span> Project library</Link>
        <div className="project-status" aria-label={`${project.completedSteps} of ${project.totalSteps} steps complete`}>
          <span className={`status-dot status-${project.status.toLowerCase().replace(' ', '-')}`} />
          {project.status} · {project.completedSteps}/{project.totalSteps}
        </div>
      </div>

      <main className="project-page">
        <section className="project-hero" aria-labelledby="project-title">
          <div>
            <span className="eyebrow">Illustration project</span>
            <h1 id="project-title">{project.title}</h1>
            <p className="project-date">Created {formatDate(project.createdAt)}</p>
          </div>
          <div className="progress-number" aria-hidden="true">
            <strong>{project.completedSteps}</strong>
            <span>of {project.totalSteps}</span>
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
            <ActionPanel
              activeStep={activeStep}
              runningStep={runningStep}
              pendingAction={pendingAction}
              suppliedStyle={suppliedStyle}
              onStyleChange={setSuppliedStyle}
              onRun={() => void runCurrentStep()}
              onRecover={() => void recoverRunningStep()}
            />

            <GeneratedOutputs project={project} />
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

function PipelineStepper({
  project,
  activeStep,
}: {
  project: ProjectDetail
  activeStep?: PipelineStep
}) {
  return (
    <nav className="pipeline-stepper" aria-label="Illustration pipeline">
      <ol>
        {orderedSteps(project).map((step, index) => {
          const isActive = activeStep?.name === step.name
          const visualState = step.state === 'SUCCEEDED' ? 'done' : isActive ? 'current' : 'pending'
          return (
            <li className={`pipeline-step step-${visualState}`} key={step.name} aria-current={isActive ? 'step' : undefined}>
              <span className="step-marker" aria-hidden="true">
                {step.state === 'SUCCEEDED' ? '✓' : index + 1}
              </span>
              <span className="step-copy">
                <strong>{STEP_COPY[step.name].label}</strong>
                <small>{humanState(step.state)}</small>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

interface ActionPanelProps {
  activeStep?: PipelineStep
  runningStep?: PipelineStep
  pendingAction: PendingAction
  suppliedStyle: string
  onStyleChange: (value: string) => void
  onRun: () => void
  onRecover: () => void
}

function ActionPanel({
  activeStep,
  runningStep,
  pendingAction,
  suppliedStyle,
  onStyleChange,
  onRun,
  onRecover,
}: ActionPanelProps) {
  if (!activeStep) {
    return (
      <section className="action-panel action-complete" aria-labelledby="action-title">
        <span className="complete-seal" aria-hidden="true">✓</span>
        <div>
          <span className="eyebrow">Five stages complete</span>
          <h2 id="action-title">Your illustrated story is ready.</h2>
          <p>Style, cast, portraits, chapter, and final artwork are all safely saved.</p>
        </div>
      </section>
    )
  }

  const copy = STEP_COPY[activeStep.name]
  const isRunning = activeStep.state === 'RUNNING'
  const isRetry = activeStep.state === 'FAILED' || activeStep.state === 'INTERRUPTED'
  const runLabel = isRunning
    ? `${copy.running}…`
    : pendingAction === 'run'
      ? `Starting ${copy.label}…`
      : isRetry
        ? `Retry ${copy.label}`
        : copy.action

  return (
    <section className="action-panel" aria-labelledby="action-title">
      <div className="action-heading">
        <div>
          <span className="eyebrow">Current step · {activeStep.position + 1} of 5</span>
          <h2 id="action-title">{copy.label}</h2>
          <p>{copy.description}</p>
        </div>
        {isRunning && <span className="live-badge"><i aria-hidden="true" /> Running</span>}
      </div>

      {activeStep.name === 'STYLE' && !isRunning && (
        <div className="style-field">
          <label htmlFor="supplied-style">Optional art direction</label>
          <textarea
            id="supplied-style"
            aria-describedby="supplied-style-help"
            value={suppliedStyle}
            onChange={(event) => onStyleChange(event.target.value)}
            placeholder="For example: warm watercolor washes, soft ink outlines…"
            rows={3}
            disabled={pendingAction !== null}
          />
          <small id="supplied-style-help">Leave blank and the studio will propose a style from the book.</small>
        </div>
      )}

      {(activeStep.state === 'FAILED' || activeStep.state === 'INTERRUPTED') && (
        <div className="step-problem" role="status">
          <strong>{activeStep.state === 'FAILED' ? 'This step did not finish.' : 'This run was interrupted.'}</strong>
          <span>{activeStep.errorMessage ?? 'Your earlier completed work is still saved.'}</span>
        </div>
      )}

      <div className="action-controls">
        <button
          className="button button-primary"
          type="button"
          onClick={onRun}
          disabled={isRunning || pendingAction !== null}
        >
          {(isRunning || pendingAction === 'run') && <span className="button-spinner" aria-hidden="true" />}
          {runLabel}
        </button>

        {runningStep && (
          <button
            className="button button-secondary"
            type="button"
            onClick={onRecover}
            disabled={pendingAction !== null}
          >
            {pendingAction === 'recover' ? 'Checking recovery…' : `Recover stranded ${STEP_COPY[runningStep.name].label}`}
          </button>
        )}
      </div>

      {isRunning && (
        <p className="running-note" aria-live="polite">
          <span className="pulse-dot" aria-hidden="true" />
          {copy.running}. This page will update as saved results become available.
        </p>
      )}
    </section>
  )
}

function GeneratedOutputs({ project }: { project: ProjectDetail }) {
  return (
    <div className="output-stack">
      <section className="output-section" aria-labelledby="style-output-title">
        <SectionHeading number="01" title="Visual direction" id="style-output-title" />
        {project.style ? (
          <blockquote className="style-card">{project.style}</blockquote>
        ) : (
          <EmptyOutput>Generated art direction will appear here.</EmptyOutput>
        )}
      </section>

      <section className="output-section" aria-labelledby="characters-output-title">
        <SectionHeading number="02" title="Character studies" id="characters-output-title" />
        {project.characters.length ? (
          <div className="character-grid">
            {[...project.characters]
              .sort((left, right) => left.position - right.position)
              .map((character) => (
                <CharacterCard key={character.position} character={character} projectId={project.id} />
              ))}
          </div>
        ) : (
          <EmptyOutput>Character prompts and portraits will be collected here.</EmptyOutput>
        )}
      </section>

      <section className="output-section" aria-labelledby="chapter-output-title">
        <SectionHeading number="03" title="Chapter illustration" id="chapter-output-title" />
        {project.chapters.length ? (
          [...project.chapters]
            .sort((left, right) => left.position - right.position)
            .map((chapter) => (
              <ChapterCard key={chapter.position} chapter={chapter} project={project} />
            ))
        ) : (
          <EmptyOutput>The selected chapter scene and final artwork will appear here.</EmptyOutput>
        )}
      </section>
    </div>
  )
}

function SectionHeading({ number, title, id }: { number: string; title: string; id: string }) {
  return (
    <div className="section-heading">
      <span>{number}</span>
      <h2 id={id}>{title}</h2>
      <i aria-hidden="true" />
    </div>
  )
}

function EmptyOutput({ children }: { children: string }) {
  return (
    <div className="empty-output">
      <span aria-hidden="true">✦</span>
      <p>{children}</p>
    </div>
  )
}

function CharacterCard({ character, projectId }: { character: Character; projectId: string }) {
  return (
    <article className="character-card">
      <div className={`portrait-frame portrait-${character.portraitState.toLowerCase()}`}>
        {character.portraitState === 'SUCCEEDED' ? (
          <img src={portraitMediaUrl(projectId, character.position)} alt={`${character.name} portrait`} />
        ) : (
          <div className="media-placeholder">
            {character.portraitState === 'RUNNING' && <span className="portrait-loader" aria-hidden="true" />}
            <span className="portrait-state">{humanState(character.portraitState)}</span>
            <small>
              {character.portraitState === 'RUNNING'
                ? `Painting ${character.name}`
                : character.portraitState === 'FAILED'
                  ? 'Portrait needs another try'
                  : 'Waiting for portrait generation'}
            </small>
          </div>
        )}
        <span className={`media-state-chip media-chip-${character.portraitState.toLowerCase()}`}>
          {humanState(character.portraitState)}
        </span>
      </div>
      <div className="card-copy">
        <span className="card-kicker">Character {character.position + 1}</span>
        <h3>{character.name}</h3>
        <p>{character.prompt}</p>
        {character.portraitState === 'FAILED' && character.portraitErrorMessage && (
          <p className="item-error" role="status">{character.portraitErrorMessage}</p>
        )}
      </div>
    </article>
  )
}

function ChapterCard({ chapter, project }: { chapter: Chapter; project: ProjectDetail }) {
  const illustrationStep = project.steps.find((step) => step.name === 'ILLUSTRATIONS')
  const hasIllustration = Boolean(chapter.illustrationImagePath && chapter.illustrationMimeType)

  return (
    <article className="chapter-card">
      <div className="chapter-artwork">
        {hasIllustration ? (
          <img
            src={illustrationMediaUrl(project.id, chapter.position)}
            alt={`Illustration for ${chapter.name}`}
          />
        ) : (
          <div className="media-placeholder chapter-placeholder">
            {illustrationStep?.state === 'RUNNING' && <span className="portrait-loader" aria-hidden="true" />}
            <span className="portrait-state">
              {illustrationStep?.state === 'RUNNING' ? 'Painting' : 'Artwork pending'}
            </span>
            <small>The final scene keeps this space as it is generated.</small>
          </div>
        )}
      </div>
      <div className="chapter-copy">
        <span className="card-kicker">Saved chapter · {chapter.position + 1}</span>
        <h3>{chapter.name}</h3>
        <p>{chapter.prompt}</p>
      </div>
    </article>
  )
}

function BookPanel({ title, text }: { title: string; text: string }) {
  return (
    <aside className="book-panel" aria-labelledby="book-text-title">
      <div className="book-panel-heading">
        <span className="book-icon" aria-hidden="true">Aa</span>
        <div>
          <span className="eyebrow">Source manuscript</span>
          <h2 id="book-text-title">{title}</h2>
        </div>
      </div>
      <div className="book-page">
        <pre>{text}</pre>
      </div>
      <p className="book-note">The complete saved text · read-only</p>
    </aside>
  )
}
