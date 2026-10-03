import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameAccount } from "../pipeline/previousData.ts";

/**
 * `data/` is a build artifact that only exists on the deployed Pages site, so
 * the pipeline scrapes its own merge baseline from there. Changing `login` in
 * config.yml does not change what is already published — without this check an
 * incremental run happily merges the previous owner's stars into yours and
 * publishes both, with nothing logged as an error.
 */
test("a baseline from the same account is usable", () => {
  assert.equal(isSameAccount("mehdibadjian", "mehdibadjian"), true);
});

test("a baseline from another account is rejected", () => {
  // The real case: `mb` is a live, unrelated GitHub user, so the placeholder
  // login in config.yml published two of their stars rather than failing.
  assert.equal(isSameAccount("mb", "mehdibadjian"), false);
});

test("a missing or unreadable baseline login is rejected, not trusted", () => {
  assert.equal(isSameAccount(undefined, "mehdibadjian"), false);
  assert.equal(isSameAccount("", "mehdibadjian"), false);
});

/**
 * The comparison is exact, so a case-only edit to `login` counts as a different
 * account and forces a full pass. GitHub treats logins case-insensitively, so
 * that re-fetch is not strictly necessary — but the failure mode is a correct
 * rebuild rather than a contaminated merge, which is the wrong way to round-trip.
 */
test("the comparison is exact, so a case-only change falls back to a full pass", () => {
  assert.equal(isSameAccount("MehdiBadjian", "mehdibadjian"), false);
  assert.equal(isSameAccount("mehdibadjian ", "mehdibadjian"), false);
});
