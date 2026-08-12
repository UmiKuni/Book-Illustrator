import { requestJson } from '../../shared/api/client'

export interface SessionUser {
  id: string
  name: string
  email: string
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
