interface ErrorResponse {
  error?: string
  step?: unknown
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

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
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
