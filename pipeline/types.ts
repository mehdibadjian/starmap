export type HealthState = "active" | "slowing" | "stale" | "dead" | "archived";

export interface Health {
  stale_days: number;
  state: HealthState;
}

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
  cat: string[];
  tags: string[];
  blurb: string;
  health: Health;
}

export interface TaxonomyLeaf {
  id: string;
  label: string;
  topics: string[];
  langs?: string[];
}

export interface TaxonomyRoot {
  id: string;
  label: string;
  leaves: TaxonomyLeaf[];
}

export interface Taxonomy {
  version: number;
  roots: TaxonomyRoot[];
}

export interface ClassificationCacheEntry {
  id: number;
  hash: string;
  cat: string[];
  tags: string[];
  blurb: string;
  source: "rules" | "llm";
}

export type ClassificationCache = Record<string, ClassificationCacheEntry>;

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

export interface MetaJson {
  login: string;
  title: string;
  theme: "dark" | "light";
  total: number;
  last_sync: string;
  taxonomy_version: number;
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

export interface Config {
  login: string;
  title: string;
  theme: "dark" | "light";
  taxonomy: string;
  classifier: "auto" | "rules" | "llm";
  schedule: string;
  exclude_forks: boolean;
}
