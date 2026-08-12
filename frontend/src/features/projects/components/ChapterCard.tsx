import { illustrationMediaUrl } from '../projects.api'
import type { Chapter, ProjectDetail } from '../projects.types'
import { MediaDownloadButton } from './MediaDownloadButton'

export function ChapterCard({ chapter, project }: { chapter: Chapter; project: ProjectDetail }) {
  const illustrationStep = project.steps.find((step) => step.name === 'ILLUSTRATIONS')
  const hasIllustration = Boolean(chapter.illustrationImagePath && chapter.illustrationMimeType)
  const illustrationUrl = illustrationMediaUrl(project.id, chapter.position)

  return (
    <article className="chapter-card">
      <div className="chapter-artwork">
        {hasIllustration ? (
          <>
            <img src={illustrationUrl} alt={`Illustration for ${chapter.name}`} />
            <MediaDownloadButton
              href={illustrationUrl}
              label={`Download illustration for ${chapter.name}`}
              mimeType={chapter.illustrationMimeType}
              fileName={`chapter-${chapter.position + 1}-illustration`}
            />
          </>
        ) : (
          <div className="media-placeholder chapter-placeholder">
            {illustrationStep?.state === 'RUNNING' && <span className="portrait-loader" aria-hidden="true" />}
            <span className="portrait-state">
              {illustrationStep?.state === 'RUNNING' ? 'Painting' : 'Artwork pending'}
            </span>
            <small>The final scene keeps this space as it is generated.</small>
          </div>
        )}
      </div>
      <div className="chapter-copy">
        <span className="card-kicker">Saved chapter · {chapter.position + 1}</span>
        <h3>{chapter.name}</h3>
        <p>{chapter.prompt}</p>
      </div>
    </article>
  )
}
