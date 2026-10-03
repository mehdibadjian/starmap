import assert from "node:assert/strict";
import { test } from "node:test";
import { computeHealth } from "../pipeline/health.ts";

const NOW = new Date("2026-06-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

test("recent pushes are active", () => {
  const h = computeHealth(daysAgo(10), false, NOW);
  assert.equal(h.state, "active");
  assert.equal(h.stale_days, 10);
});

/**
 * The boundaries are inclusive `>=`, and they are what the legend and the
 * Graveyard view both claim — a drift here silently reclassifies repos.
 */
test("health thresholds", () => {
  assert.equal(computeHealth(daysAgo(89), false, NOW).state, "active");
  assert.equal(computeHealth(daysAgo(90), false, NOW).state, "slowing");
  assert.equal(computeHealth(daysAgo(364), false, NOW).state, "slowing");
  assert.equal(computeHealth(daysAgo(365), false, NOW).state, "stale");
  assert.equal(computeHealth(daysAgo(729), false, NOW).state, "stale");
  assert.equal(computeHealth(daysAgo(730), false, NOW).state, "dead");
});

test("archived wins over any other state", () => {
  assert.equal(computeHealth(daysAgo(1), true, NOW).state, "archived");
  assert.equal(computeHealth(daysAgo(5000), true, NOW).state, "archived");
});

test("a future push date clamps to zero instead of going negative", () => {
  const h = computeHealth(daysAgo(-5), false, NOW);
  assert.equal(h.stale_days, 0);
  assert.equal(h.state, "active");
});
