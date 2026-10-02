import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHash, parseHash } from "../src/lib/url.ts";

test("the default state round-trips to an empty hash", () => {
  assert.equal(buildHash({ view: "graph", path: [], query: "", selected: null }), "#/");
  assert.deepEqual(parseHash("#/"), { view: "graph", path: [], query: "", selected: null });
});

test("a drilled path survives the round trip", () => {
  const state = { view: "graph" as const, path: ["web", "web-frameworks"], query: "", selected: null };
  assert.equal(buildHash(state), "#/web/web-frameworks");
  assert.deepEqual(parseHash(buildHash(state)), state);
});

test("non-graph views carry their name and still keep the path", () => {
  assert.equal(buildHash({ view: "list", path: ["ai-ml"], query: "", selected: null }), "#/list/ai-ml");
  assert.deepEqual(parseHash("#/graveyard/web"), {
    view: "graveyard",
    path: ["web"],
    query: "",
    selected: null,
  });
});

test("query and repo params encode and decode", () => {
  const state = { view: "list" as const, path: [], query: "rust http", selected: "42" };
  const hash = buildHash(state);
  assert.ok(hash.includes("q=rust+http"), `expected the query in ${hash}`);
  assert.ok(hash.includes("r=42"), `expected the repo in ${hash}`);
  assert.deepEqual(parseHash(hash), state);
});

test("hand-typed and unusual hashes degrade instead of throwing", () => {
  assert.deepEqual(parseHash(""), { view: "graph", path: [], query: "", selected: null });
  assert.deepEqual(parseHash("#///"), { view: "graph", path: [], query: "", selected: null });
  // An unknown first segment is a path, not a view.
  assert.equal(parseHash("#nonsense").path[0], "nonsense");
  assert.equal(parseHash("#/list?q=%22quoted%22").query, '"quoted"');
  assert.equal(parseHash("#/graph?r=").selected, null, "an empty repo param is no selection");
});

/**
 * `graph` is the default view and is omitted from the hash, so it must never be
 * mistaken for a category named "graph" — a deep link is the whole point of
 * shareable URLs.
 */
test("an explicit graph prefix is read as a path segment", () => {
  assert.deepEqual(parseHash("#/graph/web").path, ["graph", "web"]);
});
