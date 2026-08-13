import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ProjectDetailPage } from './features/projects/ProjectDetailPage'
import {
  PIPELINE_STEP_NAMES,
  type Character,
  type Chapter,
  type PipelineStep,
  type PipelineStepName,
  type PipelineStepState,
  type ProjectDetail,
} from './features/projects/projects.types'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

function steps(
  states: Partial<Record<PipelineStepName, PipelineStepState>>,
  errors: Partial<Record<PipelineStepName, string>> = {},
): PipelineStep[] {
  return PIPELINE_STEP_NAMES.map((name, position) => {
    const state = states[name] ?? 'PENDING'
    return {
      name,
      position,
      state,
      startedAt: state === 'PENDING' ? null : '2026-08-13T08:00:00.000Z',
      finishedAt: state === 'SUCCEEDED' || state === 'FAILED' ? '2026-08-13T08:01:00.000Z' : null,
      errorMessage: errors[name] ?? null,
      attemptCount: state === 'PENDING' ? 0 : 1,
    }
  })
}

const ada: Character = {
  position: 0,
  name: 'Ada Vale',
  prompt: 'A thoughtful cartographer with silver-streaked hair and an ink-stained coat.',
  portraitState: 'SUCCEEDED',
  portraitImagePath: 'projects/project-1/portraits/0.png',
  portraitMimeType: 'image/png',
  portraitErrorMessage: null,
}

const ben: Character = {
  position: 1,
  name: 'Ben Rowan',
  prompt: 'A warm, weathered lighthouse keeper carrying a brass lantern.',
  portraitState: 'RUNNING',
  portraitImagePath: null,
  portraitMimeType: null,
  portraitErrorMessage: null,
}

const chapter: Chapter = {
  position: 0,
  name: 'Arrival at the House',
  prompt: 'The two travelers approach a lantern-lit house beneath a storm-cleared sky.',
  illustrationImagePath: null,
  illustrationMimeType: null,
}

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'project-1',
    title: 'The Lantern Atlas',
    createdAt: '2026-08-13T07:30:00.000Z',
    status: 'In progress',
    completedSteps: 0,
    totalSteps: 5,
    bookText: 'Chapter One\n\nThe old map waited beneath the floorboards.',
    style: null,
    characters: [],
    chapters: [],
    steps: steps({}),
    ...overrides,
  }
}

function mockProject(value: ProjectDetail) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ project: value }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderProjectDetail() {
  return render(
    <MemoryRouter>
      <ProjectDetailPage projectId="project-1" />
    </MemoryRouter>,
  )
}

function capturePollingInterval() {
  const setIntervalSpy = vi.spyOn(window, 'setInterval')

  return async () => {
    const intervalCall = setIntervalSpy.mock.calls.find(([, timeout]) => timeout === 1_250)
    const callback = intervalCall?.[0]
    expect(callback).toBeDefined()
    await act(async () => {
      if (typeof callback === 'function') callback()
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('project pipeline', () => {
  it('announces a project-load failure and recovers when the user retries', async () => {
    let projectReads = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => {
      projectReads += 1
      return projectReads === 1
        ? response({ error: 'Project storage is temporarily unavailable.' }, 503)
        : response({ project: project() })
    }))

    renderProjectDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Project storage is temporarily unavailable.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'The Lantern Atlas' })).toBeInTheDocument()
    expect(projectReads).toBe(2)
  })

  it('groups persisted output into three tabs while keeping the five-step progress visible', async () => {
    const value = project({
      completedSteps: 4,
      style: 'Luminous gouache with restrained indigo shadows and fine copper linework.',
      characters: [ada],
      chapters: [{
        ...chapter,
        illustrationImagePath: 'projects/project-1/illustrations/0.png',
        illustrationMimeType: 'image/png',
      }],
      steps: steps({
        STYLE: 'SUCCEEDED',
        CHARACTERS: 'SUCCEEDED',
        PORTRAITS: 'SUCCEEDED',
        CHAPTERS: 'SUCCEEDED',
      }),
    })
    mockProject(value)

    renderProjectDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'The Lantern Atlas' })).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '01Visual Direction',
      '02Character Studies',
      '03Chapter Illustration',
    ])
    expect(screen.getByRole('tab', { name: /Chapter Illustration/ })).toHaveAttribute('aria-selected', 'true')

    const stepper = screen.getByRole('navigation', { name: 'Illustration pipeline' })
    for (const label of ['Style', 'Characters', 'Portraits', 'Chapters', 'Illustrations']) {
      expect(within(stepper).getByText(label)).toBeInTheDocument()
    }

    expect(screen.getByRole('heading', { name: 'Arrival at the House' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Illustration for Arrival at the House' })).toHaveAttribute(
      'src',
      '/api/projects/project-1/chapters/0/illustration',
    )
    expect(screen.getByRole('link', { name: 'Download illustration for Arrival at the House' })).toHaveAttribute(
      'download',
      'chapter-1-illustration.png',
    )

    fireEvent.click(screen.getByRole('tab', { name: /Character Studies/ }))
    expect(screen.getByRole('heading', { name: 'Ada Vale' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download Ada Vale portrait' })).toHaveAttribute(
      'download',
      'character-1-portrait.png',
    )
    fireEvent.click(screen.getByRole('tab', { name: /Visual Direction/ }))
    expect(screen.getByText(/Luminous gouache/)).toBeInTheDocument()

    expect(screen.getByText(/The old map waited beneath the floorboards/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate Illustration' })).toBeEnabled()
  })

  it('renders saved Visual Direction Markdown as semantic HTML', async () => {
    mockProject(project({
      completedSteps: 1,
      style: '### Palette\n\nUse **warm amber** with *quiet indigo*.\n\n- Fine ink lines\n- Soft paper grain',
      steps: steps({ STYLE: 'SUCCEEDED' }),
    }))

    renderProjectDetail()
    fireEvent.click(await screen.findByRole('tab', { name: /Visual Direction/ }))

    expect(screen.getByRole('heading', { level: 3, name: 'Palette' })).toBeInTheDocument()
    expect(screen.getByText('warm amber').tagName).toBe('STRONG')
    expect(screen.getByText('quiet indigo').tagName).toBe('EM')
    expect(screen.queryByText('### Palette')).not.toBeInTheDocument()
  })

  it('defaults to the tab containing the current pipeline step', async () => {
    mockProject(project({
      completedSteps: 2,
      characters: [ada, ben],
      steps: steps({
        STYLE: 'SUCCEEDED',
        CHARACTERS: 'SUCCEEDED',
        PORTRAITS: 'RUNNING',
      }),
    }))

    renderProjectDetail()

    const characterTab = await screen.findByRole('tab', { name: /Character Studies/ })
    expect(characterTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('img', { name: 'Ada Vale portrait' })).toBeInTheDocument()

    fireEvent.keyDown(characterTab, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: /Visual Direction/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Visual Direction/ })).toHaveFocus()
  })

  it('does not force a manually selected earlier tab back during polling', async () => {
    const running = project({
      completedSteps: 3,
      style: 'A saved visual direction.',
      chapters: [chapter],
      steps: steps({
        STYLE: 'SUCCEEDED',
        CHARACTERS: 'SUCCEEDED',
        PORTRAITS: 'SUCCEEDED',
        CHAPTERS: 'RUNNING',
      }),
    })
    const fetchMock = mockProject(running)
    const runPoll = capturePollingInterval()
    renderProjectDetail()

    const visualTab = await screen.findByRole('tab', { name: /Visual Direction/ })
    expect(screen.getByRole('tab', { name: /Chapter Illustration/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(visualTab)
    expect(visualTab).toHaveAttribute('aria-selected', 'true')

    await runPoll()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(visualTab).toHaveAttribute('aria-selected', 'true')
  })

  it('shows which persisted pipeline step is running', async () => {
    mockProject(project({
      completedSteps: 2,
      characters: [ada, ben],
      steps: steps({
        STYLE: 'SUCCEEDED',
        CHARACTERS: 'SUCCEEDED',
        PORTRAITS: 'RUNNING',
      }),
    }))

    renderProjectDetail()

    const runningButton = await screen.findByRole('button', { name: /Generating Portraits/ })
    expect(runningButton).toBeDisabled()
    expect(screen.getByText(/Generating Portraits\. This page will update/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recover stranded Portraits' })).toBeEnabled()
  })

  it('exposes an explicit retry and the persisted error for a failed step', async () => {
    mockProject(project({
      completedSteps: 1,
      style: 'Soft graphite and muted watercolor.',
      steps: steps(
        { STYLE: 'SUCCEEDED', CHARACTERS: 'FAILED' },
        { CHARACTERS: 'Gemini returned malformed character data.' },
      ),
    }))

    renderProjectDetail()

    expect(await screen.findByRole('button', { name: 'Retry Characters' })).toBeEnabled()
    expect(screen.getByText('Gemini returned malformed character data.')).toBeInTheDocument()
  })

  it('shows one completed portrait while the next portrait is still running', async () => {
    mockProject(project({
      completedSteps: 2,
      characters: [ada, ben],
      steps: steps({
        STYLE: 'SUCCEEDED',
        CHARACTERS: 'SUCCEEDED',
        PORTRAITS: 'RUNNING',
      }),
    }))

    renderProjectDetail()

    const completedPortrait = await screen.findByRole('img', { name: 'Ada Vale portrait' })
    expect(completedPortrait).toHaveAttribute(
      'src',
      '/api/projects/project-1/characters/0/portrait',
    )
    expect(screen.getByRole('link', { name: 'Download Ada Vale portrait' })).toHaveAttribute(
      'href',
      '/api/projects/project-1/characters/0/portrait',
    )
    expect(screen.queryByRole('link', { name: 'Download Ben Rowan portrait' })).not.toBeInTheDocument()
    expect(screen.getByText('Painting Ben Rowan')).toBeInTheDocument()
    expect(screen.getByText('Ben Rowan').closest('.character-card')).toHaveTextContent('Running')
  })

  it('recovers a stranded step to interrupted without automatically running it', async () => {
    const running = project({
      completedSteps: 2,
      steps: steps({
        STYLE: 'SUCCEEDED',
        CHARACTERS: 'SUCCEEDED',
        PORTRAITS: 'RUNNING',
      }),
    })
    const interrupted = project({
      completedSteps: 2,
      steps: steps({
        STYLE: 'SUCCEEDED',
        CHARACTERS: 'SUCCEEDED',
        PORTRAITS: 'INTERRUPTED',
      }),
    })
    let recovered = false
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/steps/portraits/recover') && init?.method === 'POST') {
        recovered = true
        return response({ step: interrupted.steps[2] })
      }
      return response({ project: recovered ? interrupted : running })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProjectDetail()
    fireEvent.click(await screen.findByRole('button', { name: 'Recover stranded Portraits' }))

    expect(await screen.findByRole('button', { name: 'Retry Portraits' })).toBeEnabled()
    expect(screen.getByText(/marked interrupted\. Start it again/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/run'))).toBe(false)
  })

  it('keeps fresh running state and shows the backend message when recovery is rejected', async () => {
    const running = project({
      completedSteps: 2,
      steps: steps({
        STYLE: 'SUCCEEDED',
        CHARACTERS: 'SUCCEEDED',
        PORTRAITS: 'RUNNING',
      }),
    })
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/steps/portraits/recover') && init?.method === 'POST') {
        return response(
          { error: 'Step PORTRAITS is still running and is not stale.', step: running.steps[2] },
          409,
        )
      }
      return response({ project: running })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProjectDetail()
    fireEvent.click(await screen.findByRole('button', { name: 'Recover stranded Portraits' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Step PORTRAITS is still running and is not stale.',
    )
    expect(screen.getByRole('button', { name: /Generating Portraits/ })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/run'))).toBe(false)
  })

  it('sends an optional supplied style through the Style run action', async () => {
    const draft = project()
    const completed = project({
      completedSteps: 1,
      style: 'Woodcut lines with a quiet amber palette.',
      steps: steps({ STYLE: 'SUCCEEDED' }),
    })
    let didRun = false
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/steps/style/run') && init?.method === 'POST') {
        didRun = true
        return response({ step: completed.steps[0], style: completed.style })
      }
      return response({ project: didRun ? completed : draft })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProjectDetail()
    fireEvent.change(await screen.findByLabelText('Optional art direction'), {
      target: { value: '  Woodcut lines with a quiet amber palette.  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Style' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Characters' })).toBeEnabled())
    const runCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/steps/style/run'))
    expect(runCall?.[1]?.body).toBe(
      JSON.stringify({ style: 'Woodcut lines with a quiet amber palette.' }),
    )
  })
})
