import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import MiniSearch from "minisearch";
import type { Config, GraphData, HistoryEntry, MetaJson, RepoRecord } from "./types.js";

const SHARD_SIZE = 500;

function buildSearchIndex(repos: RepoRecord[]): string {
  const mini = new MiniSearch({
    idField: "id",
    // Index shadow text fields so array values (topics/tags) tokenize into
    // multiple searchable words. storeFields below reference the original
    // properties directly, so cat/tags/health stay real arrays/objects for
    // the frontend — MiniSearch's field extraction runs for stored fields
    // too, so joining topics/tags in place (rather than via a custom
    // extractField) would otherwise collapse those arrays into strings.
    fields: ["nwo", "desc", "blurb", "topicsText", "tagsText"],
    storeFields: ["nwo", "stars", "lang", "cat", "tags", "health", "archived", "pushed_at", "blurb"],
  });
  const docs = repos.map((r) => ({ ...r, topicsText: r.topics.join(" "), tagsText: r.tags.join(" ") }));
  mini.addAll(docs);
  return JSON.stringify(mini);
}

export interface BuildOutputsArgs {
  outDir: string;
  config: Config;
  repos: RepoRecord[];
  graph: GraphData;
  taxonomyVersion: number;
  previousHistory: HistoryEntry[];
  added: number;
  removed: number;
  llmDegraded: boolean;
}

export async function buildOutputs(args: BuildOutputsArgs): Promise<void> {
  const { outDir, config, repos, graph, taxonomyVersion, previousHistory, added, removed, llmDegraded } = args;

  const repoDir = path.join(outDir, "repos");
  await mkdir(repoDir, { recursive: true });

  const shardCount = Math.max(1, Math.ceil(repos.length / SHARD_SIZE));
  for (let i = 0; i < shardCount; i += 1) {
    const shard = repos.slice(i * SHARD_SIZE, (i + 1) * SHARD_SIZE);
    const name = String(i).padStart(3, "0");
    await writeFile(path.join(repoDir, `${name}.json`), JSON.stringify(shard));
  }

  await writeFile(path.join(outDir, "search.json"), buildSearchIndex(repos));
  await writeFile(path.join(outDir, "graph.json"), JSON.stringify(graph));

  const unsortedCount = repos.filter((r) => r.cat.length === 0 || r.cat.includes("misc/other")).length;
  const meta: MetaJson = {
    login: config.login,
    title: config.title,
    theme: config.theme,
    total: repos.length,
    last_sync: new Date().toISOString(),
    taxonomy_version: taxonomyVersion,
    unsorted_pct: repos.length === 0 ? 0 : Math.round((unsortedCount / repos.length) * 1000) / 10,
    shard_count: shardCount,
    shard_size: SHARD_SIZE,
    llm_degraded: llmDegraded,
  };
  await writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta));

  const today = new Date().toISOString().slice(0, 10);
  const history = previousHistory.filter((h) => h.date !== today);
  history.push({ date: today, total: repos.length, added, removed });
  await writeFile(path.join(outDir, "history.json"), JSON.stringify(history));
}
