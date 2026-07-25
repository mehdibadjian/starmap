import { useMemo, useState } from "react";
import type { RepoRecord } from "../lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  repos: RepoRecord[];
}

export default function Timeline({ repos }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const months = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) {
      const month = r.starred_at.slice(0, 7);
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [repos]);

  const max = Math.max(1, ...months.map(([, c]) => c));
  const hoveredEntry = months.find(([m]) => m === hovered);

  return (
    <div className="h-full overflow-y-auto p-6">
      <Card className="mx-auto max-w-5xl">
        <CardHeader className="flex-row items-baseline justify-between space-y-0">
          <CardTitle>Stars per month</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            {hoveredEntry ? `${hoveredEntry[0]} · ${hoveredEntry[1]} stars` : `${repos.length.toLocaleString()} total`}
          </span>
        </CardHeader>
        <CardContent>
          <div className="flex h-56 items-end gap-px border-b border-border pb-1" onMouseLeave={() => setHovered(null)}>
            {months.map(([month, count]) => (
              <div
                key={month}
                className="min-w-[5px] flex-1 rounded-t-sm bg-primary transition-opacity"
                style={{ height: `${(count / max) * 100}%`, opacity: hovered === null || hovered === month ? 0.85 : 0.35 }}
                onMouseEnter={() => setHovered(month)}
              />
            ))}
            {months.length === 0 && (
              <div className="flex w-full items-center justify-center pb-8 text-sm text-muted-foreground">
                No repos loaded yet.
              </div>
            )}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{months[0]?.[0] ?? ""}</span>
            <span>{months[months.length - 1]?.[0] ?? ""}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
