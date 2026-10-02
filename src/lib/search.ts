import MiniSearch from "minisearch";
import { SEARCH_OPTIONS, SEARCH_QUERY_OPTIONS } from "@shared/searchSchema";
import type { RepoRecord } from "./types";

export interface SearchHit {
  id: number;
  nwo: string;
  stars: number;
  lang: string | null;
  cat: string[];
  tags: string[];
  blurb: string;
  score: number;
}

let index: MiniSearch<RepoRecord> | null = null;

/**
 * `loadJSON` restores the field-name → field-id map from the payload itself,
 * so a mismatch here fails silently: the offending field simply stops
 * producing matches. Sharing SEARCH_OPTIONS with the indexer is what keeps the
 * two ends honest — see `shared/searchSchema.ts`.
 */
export function loadSearchIndex(raw: string): void {
  index = MiniSearch.loadJSON<RepoRecord>(raw, SEARCH_OPTIONS);
}

export function search(query: string, limit = 100): SearchHit[] {
  if (!index || !query.trim()) return [];
  return index
    .search(query, SEARCH_QUERY_OPTIONS)
    .slice(0, limit)
    .map((r) => ({
      id: r.id as number,
      nwo: r.nwo as string,
      stars: r.stars as number,
      lang: (r.lang as string | null) ?? null,
      cat: (r.cat as string[]) ?? [],
      tags: (r.tags as string[]) ?? [],
      blurb: (r.blurb as string) ?? "",
      score: r.score,
    }));
}
