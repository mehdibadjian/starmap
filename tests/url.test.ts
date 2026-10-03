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

/* ------------------------------------------------------------------ *
 * The landing view is device-relative; a drill never is.
 *
 * `#/` means "home", and home is whatever this browser was configured to open
 * on, so the same string resolves differently on a phone and a desktop. A path
 * in the hash is a graph position and must resolve to the graph on every device
 * — otherwise the phone default would silently rewrite links other people chose.
 * ------------------------------------------------------------------ */

test("a bare home honours the device's landing view", () => {
  assert.deepEqual(parseHash("#/", "list"), { view: "list", path: [], query: "", selected: null });
  assert.equal(parseHash("#/?q=rust", "list").view, "list", "a home link with a query is still home");
  assert.equal(parseHash("#/", "graph").view, "graph");
});

test("a drilled path is the graph whatever the device defaults to", () => {
  assert.deepEqual(parseHash("#/web/web-frameworks", "list"), {
    view: "graph",
    path: ["web", "web-frameworks"],
    query: "",
    selected: null,
  });
  // Including the `?r=` shape a shared repo link uses.
  assert.equal(parseHash("#/ai-ml?r=42", "list").view, "graph");
  // And a graph drill whose first segment happens to be a view name.
  assert.equal(parseHash("#/graph/web", "list").view, "graph");
});

/**
 * A named view still beats the device default — the device only decides when the
 * hash says nothing.
 */
test("an explicit view prefix wins over the landing view", () => {
  assert.equal(parseHash("#/timeline", "list").view, "timeline");
  assert.equal(parseHash("#/list/web", "graph").view, "list");
});

/**
 * The asymmetry this design accepts, stated as a test rather than left as an
 * implication: `buildHash` writes no prefix for graph, so on a phone a Graph tab
 * click leaves the URL at `#/`. That is deliberate — `#/` is home, not a view —
 * and the tab click is remembered separately. If this ever breaks, it is because
 * someone added a `graph` prefix, which would collide with a category named graph.
 */
test("graph round-trips through the home hash", () => {
  const state = { view: "graph" as const, path: [], query: "", selected: null };
  assert.equal(buildHash(state), "#/");
  assert.equal(parseHash(buildHash(state), "graph").view, "graph");
});
