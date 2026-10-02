import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSearchIndex } from "../pipeline/buildIndex.ts";
import { loadSearchIndex, search } from "../src/lib/search.ts";
import { SEARCH_FIELDS, SEARCH_STORE_FIELDS } from "../shared/searchSchema.ts";
import type { RepoRecord } from "../pipeline/types.ts";

/**
 * Defaults are deliberately free of the words any test queries for, so a
 * "which repo matched?" assertion proves the field it claims to.
 */
const repo = (over: Partial<RepoRecord>): RepoRecord => ({
  id: 1,
  nwo: "acme/zebra-cli",
  desc: "A fast terminal app",
  lang: "Rust",
  topics: ["terminal"],
  stars: 100,
  forks: 5,
  license: "MIT",
  archived: false,
  is_fork: false,
  pushed_at: "2026-01-01T00:00:00Z",
  created_at: "2024-01-01T00:00:00Z",
  starred_at: "2026-01-02T00:00:00Z",
  homepage: null,
  cat: ["devtools/cli"],
  tags: ["rust"],
  blurb: "Terminal app",
  health: { stale_days: 1, state: "active" },
  ...over,
});

/**
 * The whole point of `shared/searchSchema.ts`. Topic and tag search broke
 * because the indexer wrote `topicsText`/`tagsText` while the client
 * rehydrated claiming `topics`/`tags`; MiniSearch restores its field map from
 * the payload, so the client's unknown names resolved to `undefined` and those
 * fields matched nothing — silently, with no error thrown.
 *
 * This test crosses the real boundary (build → JSON → loadJSON → query), so it
 * fails if either side drifts.
 */
test("topics and tags are searchable after a serialize/rehydrate round trip", () => {
  const json = buildSearchIndex([
    repo({ id: 1, nwo: "acme/zebra-cli", desc: "nothing relevant here", topics: ["dashboard", "tui"] }),
    repo({ id: 2, nwo: "other/thing", desc: "unrelated prose", topics: ["kubernetes"] }),
  ]);

  loadSearchIndex(json);

  // "dashboard" appears nowhere in repo 2 — matching id 1 only is the proof
  // that the topic field is really indexed under a name both ends agree on.
  assert.deepEqual(search("dashboard").map((r) => r.id), [1], "a topic must be found");
  assert.deepEqual(search("kubernetes").map((r) => r.id), [2]);
});

test("stored arrays survive the round trip as arrays", () => {
  loadSearchIndex(buildSearchIndex([repo({ id: 7, desc: "unrelated prose", tags: ["dashboard", "rust"] })]));
  const [hit] = search("dashboard");
  assert.ok(hit, "the tag must match");
  assert.ok(Array.isArray(hit.tags), "tags must stay an array for RepoPanel's badges");
  assert.deepEqual(hit.tags, ["dashboard", "rust"]);
  assert.ok(Array.isArray(hit.cat));
  assert.deepEqual(hit.cat, ["devtools/cli"]);
  assert.equal(hit.nwo, "acme/zebra-cli");
  assert.equal(hit.stars, 100);
});

test("name matches outrank description matches", () => {
  loadSearchIndex(
    buildSearchIndex([
      repo({ id: 1, nwo: "other/proxy", desc: "zebra patterns in the docs", topics: [] }),
      repo({ id: 2, nwo: "acme/zebra", desc: "something", topics: [] }),
    ]),
  );
  const hits = search("zebra");
  assert.equal(hits[0].id, 2, "SEARCH_BOOST.nwo must rank the name hit first");
});

test("prefix and fuzzy matching still work", () => {
  loadSearchIndex(buildSearchIndex([repo({ id: 3, nwo: "acme/typescript", topics: [] })]));
  assert.equal(search("typescri").length, 1, "prefix");
  assert.equal(search("typoescript").length, 1, "fuzzy");
  assert.equal(search("").length, 0);
  assert.equal(search("   ").length, 0, "whitespace-only queries are not searches");
});

test("limit caps results without throwing", () => {
  loadSearchIndex(
    buildSearchIndex([repo({ id: 1, nwo: "a/x", topics: ["shared"] }), repo({ id: 2, nwo: "b/y", topics: ["shared"] })]),
  );
  assert.equal(search("shared", 1).length, 1);
});

/**
 * Cheap structural guard: every field the index stores must be a real
 * RepoRecord property, or `storeFields` quietly yields `undefined` in results.
 */
test("schema fields exist on the record shape", () => {
  const keys = new Set(Object.keys(repo({})));
  // topicsText/tagsText are synthesised by buildSearchIndex, not stored fields.
  const synthesised = new Set(["topicsText", "tagsText"]);
  for (const field of SEARCH_FIELDS) {
    assert.ok(keys.has(field) || synthesised.has(field), `indexed field "${field}" is not on RepoRecord`);
  }
  for (const field of SEARCH_STORE_FIELDS) {
    assert.ok(keys.has(field), `stored field "${field}" is not on RepoRecord`);
  }
});
