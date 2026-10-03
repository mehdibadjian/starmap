/**
 * Single source of truth for the wire format: everything `pipeline/buildIndex.ts`
 * writes into `data/` and everything the browser reads back out of it.
 *
 * These types used to be typed out twice — once in `pipeline/types.ts`, once in
 * `src/lib/types.ts` — and nothing stopped them from drifting. That is the same
 * class of bug as the duplicated MiniSearch field list (`shared/searchSchema.ts`):
 * the two sides are one contract, enforced only by JSON, so the drift shows up
 * at runtime as a blank view rather than as a compile error. One file, two
 * importers, divergence unrepresentable.
 *
 * The pipeline reaches this through `pipeline/types.ts`; the frontend through
 * `src/lib/types.ts`. Both are `type`-only re-exports, so nothing browser-facing
 * depends on the pipeline and the emitted JavaScript is unchanged.
 */

export type HealthState = "active" | "slowing" | "stale" | "dead" | "archived";

export interface Health {
  stale_days: number;
  state: HealthState;
}

/** One starred repository, as published in `data/repos/NNN.json`. */
export interface RepoRecord {
  id: number;
  nwo: string;
  desc: string | null;
  lang: string | null;
  topics: string[];
  stars: number;
  forks: number;
  license: string | null;
  archived: boolean;
  is_fork: boolean;
  pushed_at: string;
  created_at: string;
  starred_at: string;
  homepage: string | null;
  /** Taxonomy leaf ids. `cat[0]` is the *primary* category and is what the graph
   * files the repo under; the rest are secondary labels shown in the UI. */
  cat: string[];
  tags: string[];
  blurb: string;
  health: Health;
}

export interface MetaJson {
  login: string;
  title: string;
  theme: "dark" | "light";
  total: number;
  last_sync: string;
  taxonomy_version: number;
  /** Percentage of repos the rules classifier could not place (see `misc/other`). */
  unsorted_pct: number;
  shard_count: number;
  shard_size: number;
  llm_degraded: boolean;
}

export interface HistoryEntry {
  date: string;
  total: number;
  added: number;
  removed: number;
}

export interface GraphNode {
  id: string;
  kind: "root" | "hub" | "leaf" | "repo";
  label: string;
  parent?: string;
  count?: number;
  x: number;
  y: number;
}

export interface GraphEdge {
  s: string;
  t: string;
  kind: "struct" | "assoc";
  w?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
