import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadConfig, taxonomyPath } from "./config.js";
import { loadTaxonomy } from "./taxonomyRules.js";
import { fetchStars, shouldRunFullPass } from "./fetch.js";
import { classifyAll, loadCache, saveCache } from "./classify.js";
import { enrichRepo } from "./enrich.js";
import { buildGraph, extractPositions } from "./graph.js";
import { buildOutputs } from "./buildIndex.js";
import { fetchPreviousDataset } from "./previousData.js";
import { computeHealth } from "./health.js";
import type { HistoryEntry, RepoRecord } from "./types.js";

const CACHE_DIR = "cache";
const CLASSIFICATIONS_PATH = `${CACHE_DIR}/classifications.json`;
const POSITIONS_PATH = `${CACHE_DIR}/positions.json`;
const OUT_DIR = "public/data";

async function loadPositions(): Promise<Record<string, { x: number; y: number }>> {
  try {
    return JSON.parse(await readFile(POSITIONS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const taxonomy = await loadTaxonomy(taxonomyPath(config));

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required to fetch starred repos");

  let baseline: RepoRecord[] = [];
  let previousHistory: HistoryEntry[] = [];
  let baselineAvailable = true;
  try {
    const prev = await fetchPreviousDataset();
    baseline = prev.repos;
    previousHistory = prev.history;
  } catch (err) {
    baselineAvailable = false;
    console.warn(`No previous dataset available, running a full pass: ${(err as Error).message}`);
  }

  const cache = await loadCache(CLASSIFICATIONS_PATH, taxonomy.version);
  const knownIds = new Set(baseline.map((r) => r.id));
  const full = shouldRunFullPass(new Date(), !baselineAvailable || process.env.FORCE_FULL === "1");

  const raws = await fetchStars({
    login: config.login,
    token,
    knownIds,
    full,
    excludeForks: config.exclude_forks,
  });

  const { cache: updatedCache, llmFailed } = await classifyAll(raws, taxonomy, cache, config.classifier);
  const llmDegraded = !process.env.ANTHROPIC_API_KEY || llmFailed;

  const freshRepos = raws.map((raw) => enrichRepo(raw, updatedCache[String(raw.id)]!));
  const freshIds = new Set(freshRepos.map((r) => r.id));

  let repos: RepoRecord[];
  let added: number;
  let removed: number;

  if (full) {
    repos = freshRepos;
    added = baselineAvailable ? [...freshIds].filter((id) => !knownIds.has(id)).length : freshRepos.length;
    removed = baselineAvailable ? [...knownIds].filter((id) => !freshIds.has(id)).length : 0;
  } else {
    const merged = new Map(baseline.map((r) => [r.id, r]));
    for (const repo of freshRepos) merged.set(repo.id, repo);
    repos = [...merged.values()].sort(
      (a, b) => new Date(b.starred_at).getTime() - new Date(a.starred_at).getTime(),
    );
    added = freshRepos.length;
    removed = 0;
  }

  // Recompute health at build time from the stored pushed_at so staleness
  // reflects "now", even for repos carried forward unchanged from baseline.
  repos = repos.map((r) => ({ ...r, health: computeHealth(r.pushed_at, r.archived) }));

  const prevPositions = await loadPositions();
  const graph = buildGraph(config.login, taxonomy, repos, prevPositions);

  await mkdir(OUT_DIR, { recursive: true });
  await buildOutputs({
    outDir: OUT_DIR,
    config,
    repos,
    graph,
    taxonomyVersion: taxonomy.version,
    previousHistory,
    added,
    removed,
    llmDegraded,
  });

  await saveCache(CLASSIFICATIONS_PATH, updatedCache, taxonomy.version);
  await writeFile(POSITIONS_PATH, `${JSON.stringify(extractPositions(graph), null, 2)}\n`);
  await writeFile("LAST_SYNC", `${new Date().toISOString()}\n`);

  console.log(
    `Synced ${repos.length} repos (added ${added}, removed ${removed}, full=${full}, llm_degraded=${llmDegraded})`,
  );
}

main().catch((err) => {
  console.error("Sync failed, aborting without publishing:", err);
  process.exitCode = 1;
});
