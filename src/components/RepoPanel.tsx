import { type ReactNode, useMemo } from "react";
import { ArrowLeftRight, ExternalLink, GitFork, Globe, Star } from "lucide-react";
import type { GraphData, RepoRecord } from "../lib/types";
import { healthColor } from "../lib/palette";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface Props {
  repo: RepoRecord | null;
  graph: GraphData | null;
  reposById: Map<number, RepoRecord>;
  onClose: () => void;
  onSelectRelated: (id: number) => void;
}

export default function RepoPanel({ repo, graph, reposById, onClose, onSelectRelated }: Props) {
  const related = useMemo(() => {
    if (!repo || !graph) return [];
    const nodeId = `repo:${repo.id}`;
    return graph.edges
      .filter((e) => e.kind === "assoc" && (e.s === nodeId || e.t === nodeId))
      .map((e) => ({ id: Number((e.s === nodeId ? e.t : e.s).slice("repo:".length)), w: e.w ?? 0 }))
      .map((r) => ({ ...r, repo: reposById.get(r.id) }))
      .filter((r): r is { id: number; w: number; repo: RepoRecord } => !!r.repo)
      .sort((a, b) => b.w - a.w);
  }, [repo, graph, reposById]);

  return (
    <Sheet open={!!repo} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="flex flex-col gap-0"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {repo && (
          <>
            <SheetHeader>
              <SheetTitle className="break-all pr-6">{repo.nwo}</SheetTitle>
              <p className="text-sm text-muted-foreground">{repo.blurb}</p>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <a
                href={`https://github.com/${repo.nwo}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-link hover:text-link"
              >
                Open on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <Stat icon={Star} label="stars" value={repo.stars.toLocaleString()} />
                <Stat icon={GitFork} label="forks" value={repo.forks.toLocaleString()} />
                <Stat label="lang" value={repo.lang ?? "—"} />
                <Stat label="license" value={repo.license ?? "—"} />
                <Stat
                  label="health"
                  value={
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: healthColor(repo.health.state) }}
                      />
                      {repo.health.state}
                    </span>
                  }
                />
                <Stat label="pushed" value={repo.pushed_at.slice(0, 10)} />
                <Stat label="starred" value={repo.starred_at.slice(0, 10)} />
              </div>

              {repo.cat.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">categories</p>
                    <div className="flex flex-wrap gap-1.5">
                      {repo.cat.map((c) => (
                        <Badge key={c} variant="secondary" className="font-mono">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {repo.topics.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">topics</p>
                    <div className="flex flex-wrap gap-1.5">
                      {repo.topics.map((t) => (
                        <Badge key={t} variant="outline" className="font-mono">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {related.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="mb-1.5 flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <ArrowLeftRight className="h-3 w-3" />
                      related ({related.length})
                    </p>
                    <div className="flex flex-col">
                      {related.slice(0, 20).map((r) => (
                        <button
                          key={r.id}
                          onClick={() => onSelectRelated(r.id)}
                          className="truncate rounded px-1 py-1 text-left font-mono text-xs text-link transition-colors hover:bg-accent hover:text-primary"
                        >
                          {r.repo.nwo}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {repo.homepage && (
                <>
                  <Separator />
                  <a
                    href={repo.homepage}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-link hover:underline"
                  >
                    <Globe className="h-3 w-3" />
                    {repo.homepage}
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ icon: Icon, label, value }: { icon?: typeof Star; label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
