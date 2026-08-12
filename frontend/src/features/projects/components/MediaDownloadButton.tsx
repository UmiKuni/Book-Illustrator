function imageExtension(mimeType: string | null): string {
  const subtype = mimeType?.split(';', 1)[0].split('/', 2)[1]?.toLowerCase()

  if (subtype === 'jpeg') return 'jpg'
  if (subtype === 'svg+xml') return 'svg'
  return subtype || 'png'
}

interface MediaDownloadButtonProps {
  href: string
  label: string
  mimeType: string | null
  fileName: string
}

export function MediaDownloadButton({
  href,
  label,
  mimeType,
  fileName,
}: MediaDownloadButtonProps) {
  return (
    <a
      className="media-download-button"
      href={href}
      download={`${fileName}.${imageExtension(mimeType)}`}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14" />
      </svg>
    </a>
  )
}
