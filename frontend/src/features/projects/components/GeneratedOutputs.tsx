import type { ProjectDetail } from '../projects.types'
import { ChapterCard } from './ChapterCard'
import { CharacterCard } from './CharacterCard'

export function GeneratedOutputs({ project }: { project: ProjectDetail }) {
  return (
    <div className="output-stack">
      <section className="output-section" aria-labelledby="style-output-title">
        <SectionHeading number="01" title="Visual direction" id="style-output-title" />
        {project.style ? (
          <blockquote className="style-card">{project.style}</blockquote>
        ) : (
          <EmptyOutput>Generated art direction will appear here.</EmptyOutput>
        )}
      </section>

      <section className="output-section" aria-labelledby="characters-output-title">
        <SectionHeading number="02" title="Character studies" id="characters-output-title" />
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

      <section className="output-section" aria-labelledby="chapter-output-title">
        <SectionHeading number="03" title="Chapter illustration" id="chapter-output-title" />
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
    </div>
  )
}

function SectionHeading({ number, title, id }: { number: string; title: string; id: string }) {
  return (
    <div className="section-heading">
      <span>{number}</span>
      <h2 id={id}>{title}</h2>
      <i aria-hidden="true" />
    </div>
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
