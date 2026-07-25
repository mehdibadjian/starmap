import type { HistoryEntry, MetaJson, RepoRecord } from "./types.js";

function pagesBaseUrl(): string | null {
  if (process.env.PAGES_URL) return process.env.PAGES_URL.replace(/\/$/, "");
  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull) return null;
  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) return null;
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner}.github.io`
    : `https://${owner}.github.io/${repo}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return (await response.json()) as T;
}

/**
 * data/ is a build artifact, not committed to git — so the previous night's
 * full dataset only exists on the already-deployed Pages site. Nightly runs
 * fetch it as the merge baseline; a failure (first-ever run, site not live
 * yet) is caught by the caller, which falls back to a full re-fetch.
 */
export async function fetchPreviousDataset(): Promise<{ repos: RepoRecord[]; history: HistoryEntry[] }> {
  const base = pagesBaseUrl();
  if (!base) throw new Error("cannot determine Pages URL (set GITHUB_REPOSITORY or PAGES_URL)");

  const meta = await fetchJson<MetaJson>(`${base}/data/meta.json`);
  const shards = await Promise.all(
    Array.from({ length: meta.shard_count }, (_, i) =>
      fetchJson<RepoRecord[]>(`${base}/data/repos/${String(i).padStart(3, "0")}.json`),
    ),
  );

  let history: HistoryEntry[] = [];
  try {
    history = await fetchJson<HistoryEntry[]>(`${base}/data/history.json`);
  } catch {
    history = [];
  }

  return { repos: shards.flat(), history };
}
