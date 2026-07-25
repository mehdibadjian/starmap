import MiniSearch from "minisearch";
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

export async function loadSearchIndex(raw: string): Promise<void> {
  index = MiniSearch.loadJSON<RepoRecord>(raw, {
    idField: "id",
    fields: ["nwo", "desc", "blurb", "topics", "tags"],
    storeFields: ["nwo", "stars", "lang", "cat", "tags", "blurb"],
  });
}

export function search(query: string, limit = 100): SearchHit[] {
  if (!index || !query.trim()) return [];
  return index
    .search(query, { prefix: true, fuzzy: 0.2, boost: { nwo: 3, tags: 2 } })
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
