import type { PipelineStep } from '../projects.types'
import { STEP_COPY } from './pipelineDisplay'

export type PendingAction = 'run' | 'recover' | null

interface PipelineActionPanelProps {
  activeStep?: PipelineStep
  runningStep?: PipelineStep
  pendingAction: PendingAction
  suppliedStyle: string
  onStyleChange: (value: string) => void
  onRun: () => void
  onRecover: () => void
}

export function PipelineActionPanel({
  activeStep,
  runningStep,
  pendingAction,
  suppliedStyle,
  onStyleChange,
  onRun,
  onRecover,
}: PipelineActionPanelProps) {
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
