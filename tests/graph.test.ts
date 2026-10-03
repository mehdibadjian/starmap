import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraph } from "../pipeline/graph.ts";
import type { RepoRecord, Taxonomy } from "../pipeline/types.ts";

const taxonomy: Taxonomy = {
  version: 1,
  roots: [
    {
      id: "web",
      label: "Web",
      leaves: [
        { id: "web/frameworks", label: "Frameworks", topics: ["react"], langs: [] },
        { id: "web/css", label: "CSS", topics: ["css"], langs: [] },
        { id: "web/empty-leaf", label: "Never Used", topics: [], langs: [] },
      ],
    },
    {
      id: "languages-compilers",
      label: "Languages / Compilers",
      leaves: [{ id: "languages-compilers/wasm", label: "WebAssembly", topics: [], langs: [] }],
    },
  ],
};

function repo(id: number, nwo: string, cat: string[]): RepoRecord {
  return {
    id,
    nwo,
    desc: null,
    lang: "TypeScript",
    topics: [],
    stars: 100,
    forks: 1,
    license: null,
    archived: false,
    is_fork: false,
    pushed_at: "2026-10-01T00:00:00Z",
    created_at: "2020-01-01T00:00:00Z",
    starred_at: "2026-01-01T00:00:00Z",
    homepage: null,
    cat,
    tags: [],
    blurb: "",
    health: { stale_days: 0, state: "active" },
  };
}

const repos = [repo(1, "facebook/react", ["web/frameworks"]), repo(2, "tailwindlabs/tailwindcss", ["web/css"])];

function ids(kind: string) {
  return buildGraph("me", taxonomy, repos, {})
    .nodes.filter((n) => n.kind === kind)
    .map((n) => n.id);
}

/**
 * The taxonomy is a fixed tree, so most forks leave categories unused. Emitting
 * those as nodes produced tappable dots that opened a genuinely empty view,
 * which reads as a broken map rather than an unused category.
 */
test("empty leaves are not emitted as nodes", () => {
  assert.deepEqual(ids("leaf").sort(), ["leaf:web/css", "leaf:web/frameworks"]);
});

test("a hub with no populated leaves is not emitted", () => {
  assert.deepEqual(ids("hub"), ["hub:web"]);
});

test("every emitted node is reachable from the root", () => {
  const g = buildGraph("me", taxonomy, repos, {});
  const edges = new Map<string, string[]>();
  for (const e of g.edges) {
    const list = edges.get(e.s) ?? [];
    list.push(e.t);
    edges.set(e.s, list);
  }
  const seen = new Set<string>(["root"]);
  const queue = ["root"];
  while (queue.length > 0) {
    for (const next of edges.get(queue.shift()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const unreachable = g.nodes.filter((n) => !seen.has(n.id));
  assert.deepEqual(unreachable.map((n) => n.id), []);
});

/**
 * Repos attach to their primary category only, so a leaf that is everybody's
 * *second* category advertises a count yet has nothing under it. Pruning on the
 * displayed count instead of attachment would leave that dead-end dot behind.
 */
test("a leaf that is only ever a secondary category is pruned", () => {
  const secondary = [repo(3, "x/y", ["web/frameworks", "web/css"])];
  const leafIds = buildGraph("me", taxonomy, secondary, {})
    .nodes.filter((n) => n.kind === "leaf")
    .map((n) => n.id);
  assert.deepEqual(leafIds, ["leaf:web/frameworks"]);
});

test("hub counts still include repos filed under any of its leaves", () => {
  const multi = [repo(4, "a/b", ["web/frameworks"]), repo(5, "c/d", ["web/css", "web/frameworks"])];
  const hub = buildGraph("me", taxonomy, multi, {}).nodes.find((n) => n.id === "hub:web");
  assert.equal(hub?.count, 2, "count is the advertised total, attachment drives the node's existence");
});
