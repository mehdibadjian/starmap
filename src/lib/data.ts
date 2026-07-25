import type { GraphData, HistoryEntry, MetaJson, RepoRecord } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export function fetchMeta(): Promise<MetaJson> {
  return getJson<MetaJson>("./data/meta.json");
}

export function fetchGraph(): Promise<GraphData> {
  return getJson<GraphData>("./data/graph.json");
}

export function fetchHistory(): Promise<HistoryEntry[]> {
  return getJson<HistoryEntry[]>("./data/history.json");
}

export function fetchSearchIndexRaw(): Promise<string> {
  return fetch("./data/search.json").then((r) => r.text());
}

async function fetchShard(index: number): Promise<RepoRecord[]> {
  return getJson<RepoRecord[]>(`./data/repos/${String(index).padStart(3, "0")}.json`);
}

/** Loads repo shards sequentially during idle time so the graph/search index isn't blocked. */
export function loadAllRepos(shardCount: number, onBatch: (repos: RepoRecord[]) => void): void {
  let i = 0;
  const schedule = (typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 0)) as (cb: () => void) => void;

  const loadNext = () => {
    if (i >= shardCount) return;
    const shardIndex = i;
    i += 1;
    fetchShard(shardIndex)
      .then(onBatch)
      .finally(() => schedule(loadNext));
  };
  schedule(loadNext);
}
