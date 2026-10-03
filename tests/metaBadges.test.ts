import assert from "node:assert/strict";
import { test } from "node:test";
import { UNSORTED_TARGET_PCT, unsortedBadge, unsortedHint } from "../src/lib/metaBadges.ts";

/**
 * The M3 metric ("unsorted under 10") was computed by the pipeline, written to
 * `meta.json`, and read by nothing — so a map that had filed 58.7% of the
 * collection into `misc / other` advertised perfect classification. These pin
 * the threshold and, more importantly, that a bad number becomes visible text.
 */

test("within the M3 target shows no badge", () => {
  for (const pct of [0, 1.3, 9.9]) {
    assert.equal(unsortedBadge(pct), null, `${pct}% should not warn`);
  }
});

test("at or above the target is reported", () => {
  assert.equal(unsortedBadge(UNSORTED_TARGET_PCT), "10% uncategorised");
  assert.equal(unsortedBadge(58.7), "58.7% uncategorised");
});

test("a missing or bogus metric stays silent rather than inventing a number", () => {
  // An older published `meta.json` may not have the field at all; the header
  // must not render "undefined% uncategorised".
  assert.equal(unsortedBadge(undefined), null);
  assert.equal(unsortedBadge(Number.NaN), null);
});

test("the hint names both remedies", () => {
  const hint = unsortedHint(58.7);
  assert.match(hint, /58\.7%/);
  assert.match(hint, /ANTHROPIC_API_KEY/);
  assert.match(hint, /taxonomy\.json/);
  assert.doesNotMatch(hint, /\n/, "title tooltips render newlines as spaces");
});
