import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './app/App'
import {
  PIPELINE_STEP_NAMES,
  type ProjectDetail,
  type ProjectSummary,
} from './features/projects/projects.types'

interface MockResponseOptions {
  status?: number
  noContent?: boolean
}

function response(body: unknown, options: MockResponseOptions = {}): Response {
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    json: options.noContent
      ? vi.fn().mockRejectedValue(new Error('No body'))
      : vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

const sessionUser = {
  id: 'user-1',
  name: 'Mira Hassan',
  email: 'mira@example.com',
}

const draftProject: ProjectSummary = {
  id: 'project-1',
  title: 'The Lantern Atlas',
  createdAt: '2026-08-13T07:30:00.000Z',
  status: 'Draft',
  completedSteps: 0,
  totalSteps: 5,
}

const activeProject: ProjectSummary = {
  id: 'project-2',
  title: 'The Clockmaker Sea',
  createdAt: '2026-08-12T07:30:00.000Z',
  status: 'In progress',
  completedSteps: 3,
  totalSteps: 5,
}

function createdProject(id: string): ProjectDetail {
  return {
    ...draftProject,
    id,
    title: 'A New Story',
    bookText: 'The whole story.',
    style: null,
    characters: [],
    chapters: [],
    steps: PIPELINE_STEP_NAMES.map((name, position) => ({
      name,
      position,
      state: 'PENDING',
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      attemptCount: 0,
    })),
  }
}

function visit(path: string) {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

function inputIdentity() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  Mira Hassan  ' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  mira@example.com  ' } })
}

function isSessionRead(input: RequestInfo | URL, init?: RequestInit): boolean {
  return String(input) === '/api/session' && !init?.method
}

function capturePollingInterval() {
  const setIntervalSpy = vi.spyOn(window, 'setInterval')

  function intervalCallIndex(): number {
    return setIntervalSpy.mock.calls.findIndex(([, timeout]) => timeout === 2_500)
  }

  return {
    timerId: () => setIntervalSpy.mock.results[intervalCallIndex()]?.value,
    run: async () => {
      let callback: TimerHandler | undefined
      await waitFor(() => {
        callback = setIntervalSpy.mock.calls[intervalCallIndex()]?.[0]
        expect(callback).toBeDefined()
      })
      await act(async () => {
        if (typeof callback === 'function') callback()
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      })
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('application flows', () => {
  it('shows Identity when session bootstrap is unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      response({ error: 'Authentication required.' }, { status: 401 }),
    ))

    visit('/')

    expect(await screen.findByRole('heading', { name: 'Open your studio' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('announces a bootstrap failure and can retry into the Project Library', async () => {
    let sessionReads = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) {
        sessionReads += 1
        return sessionReads === 1
          ? response({ error: 'The local backend is unavailable.' }, { status: 503 })
          : response({ user: sessionUser })
      }
      if (String(input) === '/api/projects') return response({ projects: [draftProject] })
      throw new Error(`Unexpected request: ${String(input)}`)
    }))

    visit('/projects')

    expect(await screen.findByRole('alert')).toHaveTextContent('The local backend is unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'Project Library' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The Lantern Atlas' })).toBeInTheDocument()
    expect(sessionReads).toBe(2)
  })

  it('rejects invalid Identity input without starting a session request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({ error: 'Authentication required.' }, { status: 401 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    visit('/')

    await screen.findByRole('heading', { name: 'Open your studio' })
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  ' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to projects' }))

    expect(screen.getByText('Enter your full name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('signs in with trimmed identity, opens the library, and shows the user name', async () => {
    let signedIn = false
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === '/api/session' && init?.method === 'POST') {
        signedIn = true
        return response({ user: sessionUser })
      }
      if (isSessionRead(input, init)) {
        return response({ error: 'Authentication required.' }, { status: 401 })
      }
      if (String(input) === '/api/projects' && signedIn) {
        return response({ projects: [draftProject] })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    visit('/')

    await screen.findByRole('heading', { name: 'Open your studio' })
    inputIdentity()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to projects' }))

    expect(await screen.findByRole('heading', { name: 'Project Library' })).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByText('Mira Hassan')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The Lantern Atlas' })).toBeInTheDocument()
    const sessionCall = fetchMock.mock.calls.find(([input, init]) => String(input) === '/api/session' && init?.method === 'POST')
    expect(sessionCall?.[1]?.body).toBe(JSON.stringify({ name: 'Mira Hassan', email: 'mira@example.com' }))
  })

  it('restores the current user after refresh and keeps the topbar essential', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/projects') return response({ projects: [draftProject, activeProject] })
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    visit('/projects')

    expect(await screen.findByRole('heading', { name: 'Project Library' })).toBeInTheDocument()
    const topbar = screen.getByRole('banner')
    expect(within(topbar).getByRole('link', { name: 'Book Illustration Studio' })).toHaveAttribute('href', '/projects')
    expect(within(topbar).getByText('Mira Hassan')).toBeInTheDocument()
    expect(within(topbar).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(within(topbar).queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument()
    expect(within(topbar).queryByRole('link', { name: 'New project' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The Clockmaker Sea' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows an empty library with a New Project action', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      return response({ projects: [] })
    }))
    visit('/projects')

    expect(await screen.findByRole('heading', { name: 'Your first story starts here.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create your first project' })).toHaveAttribute('href', '/projects/new')
  })

  it('renders project status and five-step progress and opens a project', async () => {
    const detail = { ...createdProject(activeProject.id), ...activeProject, bookText: 'A saved sea story.' }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      return String(input) === '/api/projects/project-2'
        ? response({ project: detail })
        : response({ projects: [activeProject] })
    }))
    visit('/projects')

    const card = (await screen.findByRole('heading', { name: 'The Clockmaker Sea' })).closest('a')
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText('In progress')).toBeInTheDocument()
    expect(within(card as HTMLElement).getByText('3 of 5')).toBeInTheDocument()
    expect(within(card as HTMLElement).getByLabelText('3 of 5 steps complete')).toBeInTheDocument()
    expect(card).toHaveAttribute('href', '/projects/project-2')
    fireEvent.click(card as HTMLElement)
    expect(await screen.findByText('A saved sea story.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/projects/project-2')
  })

  it('creates a pasted-text project with trimmed JSON and navigates to detail', async () => {
    const created = createdProject('new-text-project')
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/projects' && init?.method === 'POST') {
        return response({ project: created }, { status: 201 })
      }
      if (String(input) === `/api/projects/${created.id}`) return response({ project: created })
      return response({ projects: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    visit('/projects/new')

    await screen.findByRole('heading', { name: 'Start an illustration project' })
    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: '  A New Story  ' } })
    fireEvent.change(screen.getByLabelText('Complete book text'), { target: { value: '  The whole story.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'A New Story' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/projects/new-text-project')
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(createCall?.[1]?.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }))
    expect(createCall?.[1]?.body).toBe(JSON.stringify({ title: 'A New Story', bookText: 'The whole story.' }))
  })

  it('creates a project from FormData containing title and book', async () => {
    const created = createdProject('new-file-project')
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/projects' && init?.method === 'POST') {
        return response({ project: created }, { status: 201 })
      }
      if (String(input) === `/api/projects/${created.id}`) return response({ project: created })
      return response({ projects: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    visit('/projects/new')

    await screen.findByRole('heading', { name: 'Start an illustration project' })
    const pasteTab = screen.getByRole('tab', { name: 'Paste text' })
    pasteTab.focus()
    fireEvent.keyDown(pasteTab, { key: 'ArrowRight' })
    const uploadTab = screen.getByRole('tab', { name: 'Upload .txt' })
    expect(uploadTab).toHaveAttribute('aria-selected', 'true')
    expect(uploadTab).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'upload-book-tab')
    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'A New Story' } })
    const file = new File(['A readable story.'], 'story.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Choose a .txt book'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'A New Story' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/projects/new-file-project')
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(createCall?.[1]?.body).toBeInstanceOf(FormData)
    const form = createCall?.[1]?.body as FormData
    expect(form.get('title')).toBe('A New Story')
    expect(form.get('book')).toBe(file)
    expect(createCall?.[1]?.headers).not.toEqual(expect.objectContaining({ 'Content-Type': expect.anything() }))
  })

  it('calls the backend to sign out and returns to Identity', async () => {
    let signedOut = false
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/session' && init?.method === 'DELETE') {
        signedOut = true
        return response(null, { status: 204, noContent: true })
      }
      return response({ projects: [draftProject] })
    })
    vi.stubGlobal('fetch', fetchMock)
    visit('/projects')

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Open your studio' })).toBeInTheDocument()
    expect(signedOut).toBe(true)
  })

  it('returns to Identity when an authenticated project refresh returns 401', async () => {
    let projectRequests = 0
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/projects') return response({ projects: [draftProject] })
      if (String(input) === '/api/projects/project-1') {
        projectRequests += 1
        return response({ error: 'Authentication required.' }, { status: 401 })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    visit('/projects/project-1')

    expect(await screen.findByRole('heading', { name: 'Open your studio' })).toBeInTheDocument()
    await waitFor(() => expect(projectRequests).toBe(1))
  })

  it('automatically refreshes Project Library progress', async () => {
    let projectListRequests = 0
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/projects') {
        projectListRequests += 1
        return response({ projects: [projectListRequests === 1 ? draftProject : activeProject] })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const polling = capturePollingInterval()
    visit('/projects')
    await screen.findByRole('heading', { name: 'The Lantern Atlas' })

    await polling.run()

    expect(screen.getByRole('heading', { name: 'The Clockmaker Sea' })).toBeInTheDocument()
    expect(screen.getByText('3 of 5')).toBeInTheDocument()
    expect(projectListRequests).toBe(2)
  })

  it('keeps the last successful library visible after a transient background failure', async () => {
    let projectListRequests = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/projects') {
        projectListRequests += 1
        return projectListRequests === 1
          ? response({ projects: [draftProject] })
          : response({ error: 'Temporary backend problem.' }, { status: 500 })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    }))
    const polling = capturePollingInterval()
    visit('/projects')
    await screen.findByRole('heading', { name: 'The Lantern Atlas' })

    await polling.run()

    expect(screen.getByRole('heading', { name: 'The Lantern Atlas' })).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText(/Could not refresh the library/)).toBeInTheDocument()
  })

  it('stops Project Library polling after unmount', async () => {
    let projectListRequests = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/projects') {
        projectListRequests += 1
        return response({ projects: [draftProject] })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    }))
    const polling = capturePollingInterval()
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    const view = visit('/projects')
    await screen.findByRole('heading', { name: 'The Lantern Atlas' })
    view.unmount()

    expect(projectListRequests).toBe(1)
    expect(clearIntervalSpy).toHaveBeenCalledWith(polling.timerId())
  })

  it('returns to Identity when Project Library auto-refresh receives 401', async () => {
    let projectListRequests = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (isSessionRead(input, init)) return response({ user: sessionUser })
      if (String(input) === '/api/projects') {
        projectListRequests += 1
        return projectListRequests === 1
          ? response({ projects: [draftProject] })
          : response({ error: 'Authentication required.' }, { status: 401 })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    }))
    const polling = capturePollingInterval()
    visit('/projects')
    await screen.findByRole('heading', { name: 'The Lantern Atlas' })

    await polling.run()

    expect(screen.getByRole('heading', { name: 'Open your studio' })).toBeInTheDocument()
    expect(projectListRequests).toBe(2)
  })
})
