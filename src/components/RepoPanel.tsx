import type { ReactNode } from "react";
import { ExternalLink, GitFork, Globe, Star } from "lucide-react";
import type { RepoRecord } from "../lib/types";
import { healthColor } from "../lib/palette";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface Props {
  repo: RepoRecord | null;
  onClose: () => void;
}

export default function RepoPanel({ repo, onClose }: Props) {
  return (
    <Sheet open={!!repo} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col gap-0">
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
                className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
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

              {repo.homepage && (
                <>
                  <Separator />
                  <a
                    href={repo.homepage}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
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
