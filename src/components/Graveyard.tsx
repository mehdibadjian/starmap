import { useMemo } from "react";
import type { RepoRecord } from "../lib/types";
import ListView from "./ListView";

interface Props {
  repos: RepoRecord[];
  onSelect: (repoId: number) => void;
}

export default function Graveyard({ repos, onSelect }: Props) {
  const dead = useMemo(
    () => repos.filter((r) => r.health.state === "archived" || r.health.state === "dead"),
    [repos],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2 text-xs text-text-dim">
        graveyard · archived + dead only
      </div>
      <div className="min-h-0 flex-1">
        <ListView repos={dead} path={[]} searchHitIds={null} onSelect={onSelect} />
      </div>
    </div>
  );
}
