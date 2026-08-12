export const PIPELINE_STEP_NAMES = [
  'STYLE',
  'CHARACTERS',
  'PORTRAITS',
  'CHAPTERS',
  'ILLUSTRATIONS',
] as const

export type PipelineStepName = (typeof PIPELINE_STEP_NAMES)[number]
export type PipelineStepState =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'INTERRUPTED'

export interface PipelineStep {
  name: PipelineStepName
  position: number
  state: PipelineStepState
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  attemptCount: number
}

export type PortraitState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'

export interface Character {
  position: number
  name: string
  prompt: string
  portraitState: PortraitState
  portraitImagePath: string | null
  portraitMimeType: string | null
  portraitErrorMessage: string | null
}

export interface Chapter {
  position: number
  name: string
  prompt: string
  illustrationImagePath: string | null
  illustrationMimeType: string | null
}

export type ProjectStatus = 'Draft' | 'In progress' | 'Done'

export interface ProjectSummary {
  id: string
  title: string
  createdAt: string
  status: ProjectStatus
  completedSteps: number
  totalSteps: 5
}

export interface ProjectDetail extends ProjectSummary {
  bookText: string
  style: string | null
  characters: Character[]
  chapters: Chapter[]
  steps: PipelineStep[]
}
