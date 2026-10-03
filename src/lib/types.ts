/**
 * Browser view of the published data format. The shapes are shared with the
 * pipeline and live in `shared/dataSchema.ts`; they are re-exported rather than
 * restated so the reader cannot disagree with the writer about a field name.
 * `src/*` imports keep pointing here.
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
} from "@shared/dataSchema";

export type View = "graph" | "list" | "timeline" | "graveyard";

export interface AppState {
  view: View;
  query: string;
  /** Expanded taxonomy path, e.g. ["devtools", "cli"] — bare ids, no `hub:` prefix. */
  path: string[];
  /** Repo node id, as a string so it survives a URL round trip unchanged. */
  selected: string | null;
}
