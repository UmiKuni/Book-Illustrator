import { requestJson } from '../../shared/api/client'
import type {
  PipelineStep,
  PipelineStepName,
  ProjectDetail,
  ProjectSummary,
} from './projects.types'

export async function getProject(projectId: string): Promise<ProjectDetail> {
  const response = await requestJson<{ project: ProjectDetail }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
  )
  return response.project
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
