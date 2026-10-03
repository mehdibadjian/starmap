/**
 * Pipeline view of the published data format. The record/graph/meta shapes are
 * shared with the browser and live in `shared/dataSchema.ts`; they are re-exported
 * here rather than restated, so `pipeline/*` imports keep working and the two
 * sides cannot drift. Pipeline-only shapes (taxonomy, config, cache) stay below.
 */
export type {
  GraphData,
  GraphEdge,
  GraphNode,
  Health,
  HealthState,
  HistoryEntry,
  MetaJson,
  RepoRecord,
} from "../shared/dataSchema.js";

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

export interface Config {
  login: string;
  title: string;
  theme: "dark" | "light";
  taxonomy: string;
  classifier: "auto" | "rules" | "llm";
  schedule: string;
  exclude_forks: boolean;
}
