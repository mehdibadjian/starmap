import { useMemo } from "react";
import type { RepoRecord } from "../lib/types";

interface Props {
  repos: RepoRecord[];
  onSelectMonth: (month: string) => void;
}

export default function Timeline({ repos }: Props) {
  const months = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) {
      const month = r.starred_at.slice(0, 7);
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [repos]);

  const max = Math.max(1, ...months.map(([, c]) => c));

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="mb-4 font-mono text-sm text-text-dim">stars per month · {repos.length} total</h2>
      <div className="flex h-64 items-end gap-px overflow-x-auto border-b border-border pb-1">
        {months.map(([month, count]) => (
          <div
            key={month}
            className="group relative min-w-[6px] flex-1 hover:opacity-100"
            style={{ height: `${(count / max) * 100}%`, background: "var(--color-accent)", opacity: 0.7 }}
            title={`${month}: ${count}`}
          >
            <span className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap text-[10px] text-text-dim group-hover:block">
              {month} · {count}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-text-dim">
        <span>{months[0]?.[0] ?? ""}</span>
        <span>{months[months.length - 1]?.[0] ?? ""}</span>
      </div>
    </div>
  );
}
