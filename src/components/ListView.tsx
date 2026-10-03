import { useEffect, useMemo, useRef, useState } from "react";
import type { RepoRecord } from "../lib/types";
import { healthColor } from "../lib/palette";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface Props {
  repos: RepoRecord[];
  path: string[];
  searchHitIds: Set<number> | null;
  onSelect: (repoId: number) => void;
}

type SortKey = "stars" | "pushed" | "recent" | "name";

const SORTS: { id: SortKey; label: string; compare: (a: RepoRecord, b: RepoRecord) => number }[] = [
  { id: "stars", label: "stars", compare: (a, b) => b.stars - a.stars },
  { id: "pushed", label: "last push", compare: (a, b) => b.pushed_at.localeCompare(a.pushed_at) },
  { id: "recent", label: "recently starred", compare: (a, b) => b.starred_at.localeCompare(a.starred_at) },
  // Alphabetical is the only ascending sort here, so it is negated to keep the
  // `compare` contract "bigger first" like the others.
  { id: "name", label: "name", compare: (a, b) => -a.nwo.localeCompare(b.nwo) },
];

/**
 * Rough fixed row height, used only to size the scroll spacer. A wrapped blurb
 * can make a row taller, which shifts the estimate — it costs a little over- or
 * under-rendering at the edge of the window, never a wrong row.
 */
const ROW_HEIGHT = 33;
/** Rows rendered outside the viewport, above and below, to hide edge flicker. */
const OVERSCAN = 8;

export default function ListView({ repos, path, searchHitIds, onSelect }: Props) {
  const [lang, setLang] = useState<string>("all");
  const [health, setHealth] = useState<string>("all");
  const [sort, setSort] = useState<string>("stars");
  const [range, setRange] = useState({ start: 0, end: 60 });
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const filtered = useMemo(() => {
    const kept = searched.filter(
      (r) => (lang === "all" || r.lang === lang) && (health === "all" || r.health.state === health),
    );
    const active = SORTS.find((s) => s.id === sort) ?? SORTS[0];
    return kept.slice().sort(active.compare);
  }, [searched, lang, health, sort]);

  const total = filtered.length;

  /* Windowing: a fork with thousands of stars should not build thousands of
     table rows for a phone to lay out, when only a dozen are on screen. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const viewport = el.clientHeight || 600;
      const start = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN);
      const count = Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2;
      setRange((prev) =>
        prev.start === start && prev.end === Math.min(total, start + count) ? prev : { start, end: Math.min(total, start + count) },
      );
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [total]);

  // Not `window` — that would shadow the global the effect above listens on.
  const rows = filtered.slice(range.start, range.end);
  const padTop = range.start * ROW_HEIGHT;
  const padBottom = Math.max(0, (total - range.end) * ROW_HEIGHT);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-2 text-xs sm:px-4">
        <span className="font-mono text-muted-foreground">{total.toLocaleString()} repos</span>
        <FacetSelect label="language" value={lang} options={langs} onChange={setLang} />
        <FacetSelect
          label="health"
          value={health}
          options={["active", "slowing", "stale", "dead", "archived"]}
          onChange={setHealth}
        />
        <div className="ml-auto">
          <FacetSelect label="sort" value={sort} options={SORTS.map((s) => s.id)} onChange={setSort} labels={Object.fromEntries(SORTS.map((s) => [s.id, s.label]))} />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="sticky top-0 z-10 bg-card hover:bg-transparent">
              <TableHead>repo</TableHead>
              <TableHead className="hidden sm:table-cell">lang</TableHead>
              <TableHead className="text-right">stars</TableHead>
              <TableHead>health</TableHead>
              <TableHead className="hidden md:table-cell">pushed</TableHead>
              <TableHead className="hidden lg:table-cell">blurb</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {padTop > 0 && <tr aria-hidden="true"><td colSpan={6} style={{ height: padTop }} /></tr>}
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="h-[33px] cursor-pointer"
                onClick={() => onSelect(r.id)}
                // Rows are buttons to a keyboard user: Enter/Space selects, the
                // same way a click does.
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(r.id);
                  }
                }}
              >
                <TableCell className="max-w-[45vw] truncate font-mono text-primary">{r.nwo}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{r.lang ?? "—"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{r.stars.toLocaleString()}</TableCell>
                <TableCell>
                  <span
                    className="inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: healthColor(r.health.state) }}
                    title={r.health.state}
                  />
                  <span className="ml-1.5 hidden text-muted-foreground sm:inline">{r.health.state}</span>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{r.pushed_at.slice(0, 10)}</TableCell>
                <TableCell className="hidden max-w-md truncate text-muted-foreground lg:table-cell">{r.blurb}</TableCell>
              </TableRow>
            ))}
            {padBottom > 0 && <tr aria-hidden="true"><td colSpan={6} style={{ height: padBottom }} /></tr>}
          </TableBody>
        </Table>
        {total === 0 && (
          <div className="flex flex-col items-center gap-2 p-16 text-center text-muted-foreground">
            <Badge variant="muted">no matches</Badge>
            <p className="text-sm">Try clearing a filter or the search query.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
  labels,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  labels?: Record<string, string>;
}) {
  return (
    <label className="flex items-center gap-1.5 text-muted-foreground">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-28 sm:w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {label === "sort" ? null : <SelectItem value="all">all</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {labels?.[o] ?? o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
