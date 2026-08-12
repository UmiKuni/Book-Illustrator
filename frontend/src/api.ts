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

export interface ProjectDetail {
  id: string
  title: string
  createdAt: string
  status: 'Draft' | 'In progress' | 'Done'
  completedSteps: number
  totalSteps: 5
  bookText: string
  style: string | null
  characters: Character[]
  chapters: Chapter[]
  steps: PipelineStep[]
}

interface ErrorResponse {
  error?: string
  step?: PipelineStep
}

export class ApiError extends Error {
  readonly status: number
  readonly response: ErrorResponse | null

  constructor(message: string, status: number, response: ErrorResponse | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.response = response
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  })

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // A non-JSON error is still reported with its HTTP status below.
  }

  if (!response.ok) {
    const errorBody = isErrorResponse(body) ? body : null
    throw new ApiError(
      errorBody?.error ?? `Request failed with status ${response.status}.`,
      response.status,
      errorBody,
    )
  }

  return body as T
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return typeof value === 'object' && value !== null
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  const response = await requestJson<{ project: ProjectDetail }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
  )
  return response.project
}

export async function runPipelineStep(
  projectId: string,
  step: PipelineStepName,
  suppliedStyle?: string,
): Promise<void> {
  const body =
    step === 'STYLE' && suppliedStyle?.trim()
      ? { style: suppliedStyle.trim() }
      : {}

  await requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/steps/${step.toLowerCase()}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

export async function recoverPipelineStep(
  projectId: string,
  step: PipelineStepName,
): Promise<PipelineStep> {
  const response = await requestJson<{ step: PipelineStep }>(
    `/api/projects/${encodeURIComponent(projectId)}/steps/${step.toLowerCase()}/recover`,
    { method: 'POST' },
  )
  return response.step
}

export function portraitMediaUrl(projectId: string, position: number): string {
  return `/api/projects/${encodeURIComponent(projectId)}/characters/${position}/portrait`
}

export function illustrationMediaUrl(projectId: string, position: number): string {
  return `/api/projects/${encodeURIComponent(projectId)}/chapters/${position}/illustration`
}
