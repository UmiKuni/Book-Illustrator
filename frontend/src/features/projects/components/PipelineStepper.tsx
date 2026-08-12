import type { PipelineStep, ProjectDetail } from '../projects.types'
import { humanState, orderedSteps, STEP_COPY } from './pipelineDisplay'

export function PipelineStepper({
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
