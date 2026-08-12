import { portraitMediaUrl } from '../projects.api'
import type { Character } from '../projects.types'
import { MediaDownloadButton } from './MediaDownloadButton'
import { humanState } from './pipelineDisplay'

export function CharacterCard({ character, projectId }: { character: Character; projectId: string }) {
  const portraitUrl = portraitMediaUrl(projectId, character.position)

  return (
    <article className="character-card">
      <div className={`portrait-frame portrait-${character.portraitState.toLowerCase()}`}>
        {character.portraitState === 'SUCCEEDED' ? (
          <>
            <img src={portraitUrl} alt={`${character.name} portrait`} />
            <MediaDownloadButton
              href={portraitUrl}
              label={`Download ${character.name} portrait`}
              mimeType={character.portraitMimeType}
              fileName={`character-${character.position + 1}-portrait`}
            />
          </>
        ) : (
          <div className="media-placeholder">
            {character.portraitState === 'RUNNING' && <span className="portrait-loader" aria-hidden="true" />}
            <span className="portrait-state">{humanState(character.portraitState)}</span>
            <small>
              {character.portraitState === 'RUNNING'
                ? `Painting ${character.name}`
                : character.portraitState === 'FAILED'
                  ? 'Portrait needs another try'
                  : 'Waiting for portrait generation'}
            </small>
          </div>
        )}
        <span className={`media-state-chip media-chip-${character.portraitState.toLowerCase()}`}>
          {humanState(character.portraitState)}
        </span>
      </div>
      <div className="card-copy">
        <span className="card-kicker">Character {character.position + 1}</span>
        <h3>{character.name}</h3>
        <p>{character.prompt}</p>
        {character.portraitState === 'FAILED' && character.portraitErrorMessage && (
          <p className="item-error" role="status">{character.portraitErrorMessage}</p>
        )}
      </div>
    </article>
  )
}
