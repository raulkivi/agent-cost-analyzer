import type { Source } from "@agent-cost-analyzer/domain";

export const STALE_AFTER_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface SourcesFooterProps {
  sources: Source[];
  oldestCheckedAt: string;
  // Injectable so the staleness check is testable without fake timers.
  now?: Date;
}

function isStale(checkedAt: string, now: Date): boolean {
  const checked = Date.parse(checkedAt);
  // An unreadable date is shown as-is; guessing it is stale would mislead.
  return (
    !Number.isNaN(checked) &&
    now.getTime() - checked > STALE_AFTER_DAYS * MS_PER_DAY
  );
}

export function SourcesFooter({
  sources,
  oldestCheckedAt,
  now = new Date(),
}: SourcesFooterProps) {
  return (
    <footer className="sources-footer">
      <h3 className="sources-footer-title">Sources</h3>
      <ul className="sources-footer-list">
        {sources.map((source) => (
          <li key={source.id}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title}
            </a>
          </li>
        ))}
      </ul>
      <p className="sources-footer-checked">Checked {oldestCheckedAt}</p>
      {isStale(oldestCheckedAt, now) && (
        <p role="status" className="sources-footer-warning">
          Price and cache data is over 90 days old and may be out of date.
        </p>
      )}
    </footer>
  );
}
