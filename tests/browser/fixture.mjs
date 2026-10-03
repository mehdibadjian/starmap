/**
 * Dev-only fixture generator: writes a small but realistic `data/` set from the
 * repo's own taxonomy, so the frontend can be exercised with no GITHUB_TOKEN and
 * no network.
 *
 * It drives the *pipeline's own* functions rather than hand-writing JSON. That
 * matters: a hand-authored blob would not exercise shard splitting, the search
 * index serialization, or the graph's node ids — and those are exactly the seams
 * that have broken.
 */
import { mkdir } from "node:fs/promises";
import { buildOutputs } from "../../pipeline/buildIndex.ts";
import { computeHealth } from "../../pipeline/health.ts";
import { buildGraph } from "../../pipeline/graph.ts";
import { leafIds, loadTaxonomy } from "../../pipeline/taxonomyRules.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const OUT = process.argv[2] ?? `${ROOT}public/data`;
const THEME = process.argv.includes("--light") ? "light" : "dark";

const taxonomy = await loadTaxonomy(`${ROOT}taxonomy.json`);
const leaves = leafIds(taxonomy);

const NAMES = [
  "zed", "ghostty", "ripgrep", "starship", "lazygit", "atuin", "baobab", "hoppscotch",
  "bulwark", "vite", "esbuild", "playwright", "vitest", "turbo", "rollup", "swc",
  "pytorch", "transformers", "llama.cpp", "ollama", "langchain", "ragas", "whisper",
  "kubernetes", "terraform", "ansible", "nomad", "consul", "vaul", "linkerd",
  "postgres", "redis", "duckdb", "clickhouse", "sqlmesh", "dbt", "airflow",
  "react", "svelte", "solid", "htmx", "tailwindcss", "astro", "remix", "nextjs",
  "openssl", "sigstore", "kanister", "nuclei", "trivy", "gosec",
  "flutter", "compose-multiplatform", "tauri", "egui", "slint", "iced",
  "typescript", "zig", "golang", "rust-analyzer", "swift", "kotlin", "grain",
  "three.js", "bevy", "godot", "blender", "ffmpeg", "shotcut", "krita",
  "hands-on", "design-patterns", "roadmap", "system-design", "algorithms",
];

/** Deterministic, so a re-run produces a byte-identical fixture. */
const rand = (seed) => {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
};
const r = rand(7);
const miscLeaves = leaves.filter((l) => l.startsWith("misc/"));
/**
 * Primary leaf for repo `i`. The first 62 land under `misc`, deliberately just
 * over the phone visibility cap (`MAX_VISIBLE_REPOS_COARSE`, 60 in GraphView) so
 * the `+N` overflow path is exercised rather than left untested — spread evenly
 * across 55 leaves, no hub in a 76-repo fixture would reach the cap on its own.
 * Keeping the margin small leaves the other hubs populated enough to emit.
 */
const primaryLeaf = (i) => (i < 62 && miscLeaves.length > 0 ? miscLeaves[i % miscLeaves.length] : leaves[Math.floor(r() * leaves.length)]);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

const repos = NAMES.map((name, i) => {
  const leaf = primaryLeaf(i);

  const pushedDays = Math.floor(r() * 1200);
  const archived = r() < 0.06;
  const pushedAt = daysAgo(pushedDays);
  return {
    id: 1000 + i,
    nwo: `${["acme", "cloudflare", "vercel", "rustlang", "google", "facebook"][i % 6]}/${name}`,
    desc: `${name} is a tool for ${leaf.replace("/", " ")} work.`,
    lang: ["Rust", "TypeScript", "Go", "Python", "Zig", null][i % 6],
    // `homebrew` appears in no other field, so the UI can be probed with a
    // genuinely topic-only query — the exact case the shared schema broke.
    topics: [leaf.split("/")[0], name.slice(0, 3), "cli", "homebrew"],
    stars: Math.floor(r() ** 3 * 60000) + 3,
    forks: Math.floor(r() * 900),
    license: ["MIT", "Apache-2.0", null][i % 3],
    archived,
    is_fork: false,
    pushed_at: pushedAt,
    created_at: daysAgo(pushedDays + 900),
    starred_at: daysAgo(Math.floor(r() * 700)),
    homepage: i % 5 === 0 ? `https://${name}.dev` : null,
    cat: [leaf],
    tags: [leaf.split("/")[1], "tooling"],
    blurb: `${name}: ${leaf.replace("/", " ")} toolkit`.slice(0, 90),
    health: computeHealth(pushedAt, archived),
  };
});

// A couple of multi-category repos, to exercise secondary-category pruning.
for (const [i, extra] of [0, 5].entries()) {
  repos[i].cat = [leaves[extra + 2], leaves[i]];
}

const config = {
  login: "demo-user",
  title: "demo stars",
  theme: THEME,
  taxonomy: "default",
  classifier: "rules",
  schedule: "0 18 * * *",
  exclude_forks: false,
};

const graph = buildGraph(config.login, taxonomy, repos, {});
await mkdir(`${OUT}/repos`, { recursive: true });
await buildOutputs({
  outDir: OUT,
  config,
  repos,
  graph,
  taxonomyVersion: taxonomy.version,
  previousHistory: [],
  added: repos.length,
  removed: 0,
  llmDegraded: true,
});

const hubCount = graph.nodes.filter((n) => n.kind === "hub").length;
const leafCount = graph.nodes.filter((n) => n.kind === "leaf").length;
console.log(
  `fixture: ${repos.length} repos -> ${hubCount} hubs / ${leafCount} leaves emitted (taxonomy has ${taxonomy.roots.length}/${leaves.length}) into ${OUT}`,
);
