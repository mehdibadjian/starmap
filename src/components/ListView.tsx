import { useMemo, useState } from "react";
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

export default function ListView({ repos, path, searchHitIds, onSelect }: Props) {
  const [lang, setLang] = useState<string>("all");
  const [health, setHealth] = useState<string>("all");

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
    () => searched.filter((r) => (lang === "all" || r.lang === lang) && (health === "all" || r.health.state === health)),
    [searched, lang, health],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2 text-xs">
        <span className="font-mono text-muted-foreground">{filtered.length.toLocaleString()} repos</span>
        <FacetSelect label="language" value={lang} options={langs} onChange={setLang} />
        <FacetSelect
          label="health"
          value={health}
          options={["active", "slowing", "stale", "dead", "archived"]}
          onChange={setHealth}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>repo</TableHead>
              <TableHead>lang</TableHead>
              <TableHead className="text-right">stars</TableHead>
              <TableHead>health</TableHead>
              <TableHead>pushed</TableHead>
              <TableHead>blurb</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r.id)}>
                <TableCell className="font-mono text-primary">{r.nwo}</TableCell>
                <TableCell className="text-muted-foreground">{r.lang ?? "—"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{r.stars.toLocaleString()}</TableCell>
                <TableCell>
                  <span
                    className="inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: healthColor(r.health.state) }}
                    title={r.health.state}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">{r.pushed_at.slice(0, 10)}</TableCell>
                <TableCell className="max-w-md truncate text-muted-foreground">{r.blurb}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length === 0 && (
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
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-muted-foreground">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">all</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
