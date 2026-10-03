import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hashFor, loadCache, planClassifications } from "../pipeline/classify.ts";
import type { RawStar } from "../pipeline/fetch.ts";
import type { ClassificationCache, Taxonomy } from "../pipeline/types.ts";

const taxonomy: Taxonomy = {
  version: 1,
  roots: [
    {
      id: "devtools",
      label: "Devtools",
      leaves: [{ id: "devtools/cli", label: "CLI / TUI", topics: ["cli", "terminal"] }],
    },
  ],
};

const raw = (over: Partial<RawStar> = {}): RawStar => ({
  id: 1,
  nwo: "acme/tool",
  desc: "A terminal app",
  lang: "Rust",
  topics: ["cli"],
  stars: 10,
  forks: 0,
  license: null,
  archived: false,
  is_fork: false,
  pushed_at: "2026-01-01T00:00:00Z",
  created_at: "2020-01-01T00:00:00Z",
  starred_at: "2026-01-02T00:00:00Z",
  homepage: null,
  ...over,
});

test("hashFor is stable for identical content and changes with it", () => {
  assert.equal(hashFor("a", ["x", "y"]), hashFor("a", ["x", "y"]));
  assert.notEqual(hashFor("a", ["x", "y"]), hashFor("a", ["x"]));
  // Field order matters: the topics array is joined, not sorted.
  assert.notEqual(hashFor("a", ["x", "y"]), hashFor("a", ["y", "x"]));
  // `null` and "" are the same content here, deliberately: both normalize to
  // "No description provided." so a collision cannot strand a stale category.
  assert.equal(hashFor(null, []), hashFor("", []));
});

test("an unchanged repo is a cache hit and needs no work", () => {
  const repo = raw();
  const cache: ClassificationCache = {
    "1": { id: 1, hash: hashFor(repo.desc, repo.topics), cat: ["devtools/cli"], tags: ["cli"], blurb: "b", source: "llm" },
  };
  const { next, needsClassify } = planClassifications([repo], cache, taxonomy, true);
  assert.deepEqual(needsClassify, []);
  assert.equal(next["1"].source, "llm", "the cached LLM result must survive untouched");
});

test("an edited repo is reclassified and seeded from the rules tier", () => {
  const repo = raw({ desc: "Now with a TUI" });
  const cache: ClassificationCache = {
    "1": { id: 1, hash: "stale-hash", cat: ["misc/other"], tags: [], blurb: "old", source: "rules" },
  };
  const { next, needsClassify } = planClassifications([repo], cache, taxonomy, false);
  assert.equal(needsClassify.length, 1);
  assert.deepEqual(next["1"].cat, ["devtools/cli"]);
});

/**
 * Regression for the bug where a failed LLM batch left a rules-tier entry
 * carrying the repo's real content hash. The next nightly saw a matching hash,
 * treated the placeholder as a hit, and never retried — the repo was stuck on
 * the rules tier forever.
 */
test("a rules placeholder waits for the LLM instead of claiming a real hash", () => {
  const repo = raw();
  const { next, needsClassify } = planClassifications([repo], {}, taxonomy, true);
  assert.equal(needsClassify.length, 1);
  assert.notEqual(next["1"].hash, hashFor(repo.desc, repo.topics));

  // Feed the placeholder back in as the previous run's cache, exactly as the
  // nightly does when the batch failed: it must be re-queued, not kept.
  const again = planClassifications([repo], next, taxonomy, true);
  assert.equal(again.needsClassify.length, 1, "a pending placeholder must be retried");
});

test("without an LLM pass the rules tier is final and cacheable", () => {
  const repo = raw();
  const { next } = planClassifications([repo], {}, taxonomy, false);
  assert.equal(next["1"].hash, hashFor(repo.desc, repo.topics));
  assert.equal(next["1"].source, "rules");
  const again = planClassifications([repo], next, taxonomy, false);
  assert.equal(again.needsClassify.length, 0);
});

test("a taxonomy version bump invalidates the whole cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "starmap-test-"));
  try {
    const path = join(dir, "classifications.json");
    writeFileSync(
      path,
      JSON.stringify({
        taxonomy_version: 1,
        entries: { "1": { id: 1, hash: "h", cat: [], tags: [], blurb: "", source: "rules" } },
      }),
    );
    assert.equal(Object.keys(await loadCache(path, 1)).length, 1);
    assert.equal(Object.keys(await loadCache(path, 2)).length, 0, "a bumped version must drop every entry");
    // A missing or unparseable file is an empty cache, not a crash.
    assert.deepEqual(await loadCache(join(dir, "nope.json"), 1), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
