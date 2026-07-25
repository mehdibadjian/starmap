import { useMemo, useState } from "react";
import type { RepoRecord } from "../lib/types";
import { healthColor } from "../lib/palette";

interface Props {
  repos: RepoRecord[];
  path: string[];
  searchHitIds: Set<number> | null;
  onSelect: (repoId: number) => void;
}

export default function ListView({ repos, path, searchHitIds, onSelect }: Props) {
  const [lang, setLang] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);

  const pathFiltered = useMemo(() => {
    if (path.length === 0) return repos;
    if (path.length === 1) return repos.filter((r) => r.cat.some((c) => c.startsWith(`${path[0]}/`)));
    const leaf = path.join("/");
    return repos.filter((r) => r.cat.includes(leaf));
  }, [repos, path]);

  const searched = useMemo(
    () => (searchHitIds ? pathFiltered.filter((r) => searchHitIds.has(r.id)) : pathFiltered),
    [pathFiltered, searchHitIds],
  );

  const langs = useMemo(() => {
    const set = new Set<string>();
    for (const r of searched) if (r.lang) set.add(r.lang);
    return [...set].sort();
  }, [searched]);

  const filtered = useMemo(
    () =>
      searched.filter((r) => (!lang || r.lang === lang) && (!health || r.health.state === health)),
    [searched, lang, health],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <span className="text-text-dim">{filtered.length} repos</span>
        <FacetSelect label="lang" value={lang} options={langs} onChange={setLang} />
        <FacetSelect
          label="health"
          value={health}
          options={["active", "slowing", "stale", "dead", "archived"]}
          onChange={setHealth}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-text-dim">
            <tr>
              <th className="px-4 py-2 font-normal">repo</th>
              <th className="px-2 py-2 font-normal">lang</th>
              <th className="px-2 py-2 font-normal">stars</th>
              <th className="px-2 py-2 font-normal">health</th>
              <th className="px-2 py-2 font-normal">pushed</th>
              <th className="px-4 py-2 font-normal">blurb</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-b border-border hover:bg-surface"
                onClick={() => onSelect(r.id)}
              >
                <td className="px-4 py-1.5 font-mono text-accent">{r.nwo}</td>
                <td className="px-2 py-1.5 text-text-dim">{r.lang ?? "—"}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.stars.toLocaleString()}</td>
                <td className="px-2 py-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: healthColor(r.health.state) }}
                    title={r.health.state}
                  />
                </td>
                <td className="px-2 py-1.5 text-text-dim">{r.pushed_at.slice(0, 10)}</td>
                <td className="max-w-md truncate px-4 py-1.5 text-text-dim">{r.blurb}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-8 text-center text-text-dim">No repos match.</div>}
      </div>
    </div>
  );
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-text-dim">
      {label}
      <select
        className="rounded border border-border bg-surface px-1 py-0.5 text-text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">all</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
