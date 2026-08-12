export function BookPanel({ title, text }: { title: string; text: string }) {
  return (
    <aside className="book-panel" aria-labelledby="book-text-title">
      <div className="book-panel-heading">
        <span className="book-icon" aria-hidden="true">Aa</span>
        <div>
          <span className="eyebrow">Source manuscript</span>
          <h2 id="book-text-title">{title}</h2>
        </div>
      </div>
      <div className="book-page">
        <pre>{text}</pre>
      </div>
      <p className="book-note">The complete saved text · read-only</p>
    </aside>
  )
}
