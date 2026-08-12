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

export interface SessionUser {
  id: string
  name: string
  email: string
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

  let body: unknown
  if (response.status !== 204) {
    try {
      body = await response.json()
    } catch {
      body = null
      // A non-JSON error is still reported with its HTTP status below.
    }
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

export async function startSession(name: string, email: string): Promise<SessionUser> {
  const response = await requestJson<{ user: SessionUser }>('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  })
  return response.user
}

export async function endSession(): Promise<void> {
  await requestJson<void>('/api/session', { method: 'DELETE' })
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await requestJson<{ projects: ProjectSummary[] }>('/api/projects')
  return response.projects
}

export async function createProjectFromText(
  title: string,
  bookText: string,
): Promise<ProjectDetail> {
  const response = await requestJson<{ project: ProjectDetail }>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, bookText }),
  })
  return response.project
}

export async function createProjectFromFile(
  title: string,
  book: File,
): Promise<ProjectDetail> {
  const body = new FormData()
  body.set('title', title)
  body.set('book', book)

  const response = await requestJson<{ project: ProjectDetail }>('/api/projects', {
    method: 'POST',
    body,
  })
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
