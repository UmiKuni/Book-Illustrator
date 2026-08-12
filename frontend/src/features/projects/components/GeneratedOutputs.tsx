import { useRef, useState, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'

import type { PipelineStepName, ProjectDetail } from '../projects.types'
import { ChapterCard } from './ChapterCard'
import { CharacterCard } from './CharacterCard'
import { currentStep } from './pipelineDisplay'

const OUTPUT_TABS = [
  { id: 'visual-direction', label: 'Visual Direction', number: '01' },
  { id: 'character-studies', label: 'Character Studies', number: '02' },
  { id: 'chapter-illustration', label: 'Chapter Illustration', number: '03' },
] as const

type OutputTabId = (typeof OUTPUT_TABS)[number]['id']

const STEP_TAB: Record<PipelineStepName, OutputTabId> = {
  STYLE: 'visual-direction',
  CHARACTERS: 'character-studies',
  PORTRAITS: 'character-studies',
  CHAPTERS: 'chapter-illustration',
  ILLUSTRATIONS: 'chapter-illustration',
}

function initialTab(project: ProjectDetail): OutputTabId {
  const step = currentStep(project)
  return step ? STEP_TAB[step.name] : 'chapter-illustration'
}

export function GeneratedOutputs({ project }: { project: ProjectDetail }) {
  const [activeTab, setActiveTab] = useState<OutputTabId>(() => initialTab(project))
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % OUTPUT_TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + OUTPUT_TABS.length) % OUTPUT_TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = OUTPUT_TABS.length - 1
    if (nextIndex === undefined) return

    event.preventDefault()
    const nextTab = OUTPUT_TABS[nextIndex]
    setActiveTab(nextTab.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <section className="project-outputs" aria-label="Generated project content">
      <div className="output-tabs" role="tablist" aria-label="Project content">
        {OUTPUT_TABS.map((tab, index) => (
          <button
            id={`output-tab-${tab.id}`}
            key={tab.id}
            ref={(element) => { tabRefs.current[index] = element }}
            className={activeTab === tab.id ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`output-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => selectFromKeyboard(event, index)}
          >
            <span>{tab.number}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <section
        id="output-panel-visual-direction"
        className="output-tab-panel"
        role="tabpanel"
        aria-labelledby="output-tab-visual-direction"
        hidden={activeTab !== 'visual-direction'}
        tabIndex={0}
      >
        {project.style ? (
          <div className="style-card markdown-content">
            <ReactMarkdown>{project.style}</ReactMarkdown>
          </div>
        ) : (
          <EmptyOutput>Generated art direction will appear here.</EmptyOutput>
        )}
      </section>

      <section
        id="output-panel-character-studies"
        className="output-tab-panel"
        role="tabpanel"
        aria-labelledby="output-tab-character-studies"
        hidden={activeTab !== 'character-studies'}
        tabIndex={0}
      >
        {project.characters.length ? (
          <div className="character-grid">
            {[...project.characters]
              .sort((left, right) => left.position - right.position)
              .map((character) => (
                <CharacterCard key={character.position} character={character} projectId={project.id} />
              ))}
          </div>
        ) : (
          <EmptyOutput>Character prompts and portraits will be collected here.</EmptyOutput>
        )}
      </section>

      <section
        id="output-panel-chapter-illustration"
        className="output-tab-panel"
        role="tabpanel"
        aria-labelledby="output-tab-chapter-illustration"
        hidden={activeTab !== 'chapter-illustration'}
        tabIndex={0}
      >
        {project.chapters.length ? (
          [...project.chapters]
            .sort((left, right) => left.position - right.position)
            .map((chapter) => (
              <ChapterCard key={chapter.position} chapter={chapter} project={project} />
            ))
        ) : (
          <EmptyOutput>The selected chapter scene and final artwork will appear here.</EmptyOutput>
        )}
      </section>
    </section>
  )
}

function EmptyOutput({ children }: { children: string }) {
  return (
    <div className="empty-output">
      <span aria-hidden="true">✦</span>
      <p>{children}</p>
    </div>
  )
}
