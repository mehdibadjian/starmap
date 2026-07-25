import type { RepoRecord } from "../lib/types";
import { healthColor } from "../lib/palette";

interface Props {
  repo: RepoRecord | null;
  onClose: () => void;
}

export default function RepoPanel({ repo, onClose }: Props) {
  if (!repo) return null;

  return (
    <aside className="absolute right-0 top-0 h-full w-80 overflow-y-auto border-l border-border bg-surface p-4 shadow-xl">
      <button
        className="mb-3 text-xs text-text-dim hover:text-text"
        onClick={onClose}
        aria-label="Close panel"
      >
        Esc · close
      </button>
      <a
        href={`https://github.com/${repo.nwo}`}
        target="_blank"
        rel="noreferrer"
        className="block break-all font-mono text-base text-accent hover:underline"
      >
        {repo.nwo}
      </a>
      <p className="mt-2 text-sm text-text-dim">{repo.blurb}</p>

      <dl className="mt-4 grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-text-dim">stars</dt>
        <dd className="tabular-nums">{repo.stars.toLocaleString()}</dd>
        <dt className="text-text-dim">forks</dt>
        <dd className="tabular-nums">{repo.forks.toLocaleString()}</dd>
        <dt className="text-text-dim">lang</dt>
        <dd>{repo.lang ?? "—"}</dd>
        <dt className="text-text-dim">license</dt>
        <dd>{repo.license ?? "—"}</dd>
        <dt className="text-text-dim">health</dt>
        <dd className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: healthColor(repo.health.state) }}
          />
          {repo.health.state}
        </dd>
        <dt className="text-text-dim">pushed</dt>
        <dd>{repo.pushed_at.slice(0, 10)}</dd>
        <dt className="text-text-dim">starred</dt>
        <dd>{repo.starred_at.slice(0, 10)}</dd>
      </dl>

      {repo.topics.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1">
          {repo.topics.map((t) => (
            <span key={t} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-dim">
              {t}
            </span>
          ))}
        </div>
      )}

      {repo.homepage && (
        <a
          href={repo.homepage}
          target="_blank"
          rel="noreferrer"
          className="mt-4 block text-xs text-accent hover:underline"
        >
          {repo.homepage}
        </a>
      )}
    </aside>
  );
}
