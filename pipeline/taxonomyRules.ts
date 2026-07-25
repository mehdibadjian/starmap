import { readFile } from "node:fs/promises";
import type { Taxonomy, TaxonomyLeaf } from "./types.js";

export const UNSORTED = "misc/other";

export async function loadTaxonomy(path: string): Promise<Taxonomy> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Taxonomy;
}

export function leaves(taxonomy: Taxonomy): TaxonomyLeaf[] {
  return taxonomy.roots.flatMap((root) => root.leaves);
}

export function leafIds(taxonomy: Taxonomy): string[] {
  return leaves(taxonomy).map((leaf) => leaf.id);
}

export function rootOfLeaf(taxonomy: Taxonomy, leafId: string): string | undefined {
  return taxonomy.roots.find((root) => root.leaves.some((leaf) => leaf.id === leafId))?.id;
}

/**
 * Deterministic rules-tier match: score each leaf by topic overlap (weight 2)
 * and language mention (weight 1), pick the best-scoring leaf above zero.
 * Falls back to `misc/other` when nothing matches.
 */
export function matchRules(taxonomy: Taxonomy, topics: string[], lang: string | null): string[] {
  const topicSet = new Set(topics.map((t) => t.toLowerCase()));
  const langLower = lang?.toLowerCase() ?? null;

  let best: { leaf: string; score: number } | null = null;

  for (const leaf of leaves(taxonomy)) {
    let score = 0;
    for (const topic of leaf.topics) {
      if (topicSet.has(topic.toLowerCase())) score += 2;
    }
    if (langLower && leaf.langs?.some((l) => l.toLowerCase() === langLower)) {
      score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { leaf: leaf.id, score };
    }
  }

  return best ? [best.leaf] : [UNSORTED];
}
