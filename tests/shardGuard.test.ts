import assert from "node:assert/strict";
import { test } from "node:test";

import { isUsableRepo } from "@/lib/data";
import type { RepoRecord } from "@/lib/types";

/**
 * The viewer filters published shards before handing them to the components.
 * A single row with `cat: [null]` is enough to throw inside ListView's filter
 * and blank the whole SPA, so the boundary has to reject it.
 */

const good: RepoRecord = {
  id: 1,
  nwo: "acme/cli",
  desc: "A fast terminal app",
  lang: "Rust",
  topics: ["rust"],
  stars: 10,
  forks: 1,
  license: "MIT",
  archived: false,
  is_fork: false,
  pushed_at: "2026-08-01T00:00:00Z",
  created_at: "2020-01-01T00:00:00Z",
  starred_at: "2024-01-01T00:00:00Z",
  homepage: null,
  cat: ["devtools/cli"],
  tags: ["rust"],
  blurb: "A fast terminal app",
  health: { stale_days: 30, state: "active" },
};

function keep(rows: unknown[]): RepoRecord[] {
  return rows.filter(isUsableRepo);
}

test("a well-formed record passes the shard guard", () => {
  assert.deepEqual(keep([good]), [good]);
});

test("rows that would crash the views are dropped, the rest survive", () => {
  const bad = [
    null,
    "string",
    { ...good, id: 2, nwo: 42 },
    { ...good, id: 3, nwo: "acme/id", cat: [null] },
    { ...good, id: 4, nwo: "acme/topics", topics: undefined },
    { ...good, id: 5, nwo: "acme/health", health: null },
  ];
  const kept = keep([good, ...bad]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 1);
});
