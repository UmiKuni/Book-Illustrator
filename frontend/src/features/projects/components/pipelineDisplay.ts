import type {
  PipelineStep,
  PipelineStepName,
  ProjectDetail,
} from '../projects.types'

export const STEP_COPY: Record<
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
    label: 'Illustrations',
    action: 'Generate Illustration',
    running: 'Generating Illustration',
    description: 'Turn the saved chapter scene into the final artwork.',
  },
}

export function orderedSteps(project: ProjectDetail): PipelineStep[] {
  return [...project.steps].sort((left, right) => left.position - right.position)
}

export function currentStep(project: ProjectDetail): PipelineStep | undefined {
  return orderedSteps(project).find((step) => step.state !== 'SUCCEEDED')
}

export function humanState(state: PipelineStep['state']): string {
  return state.charAt(0) + state.slice(1).toLowerCase()
}
