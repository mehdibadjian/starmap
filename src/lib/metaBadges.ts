/**
 * Header badges derived from `meta.json`.
 *
 * Separate from `App.tsx` because the threshold is the part worth arguing about,
 * and a browser test of a whole header proves only that something rendered. This
 * is pure, so the unit suite can pin the cut-off.
 */

/**
 * `SPEC.md`'s M3 target: "blurbs, tags, `unsorted` under 10". Above it the
 * taxonomy is not describing the collection — the map's clusters are mostly one
 * big `misc / other` blob — so the number goes on screen instead of staying a
 * `meta.json` field nobody reads. Rules-only classification sits here routinely
 * when no `ANTHROPIC_API_KEY` is configured, which is exactly when to say so.
 */
export const UNSORTED_TARGET_PCT = 10;

/**
 * The badge text, or null when the collection is within the M3 target.
 *
 * `unsorted_pct` already arrives rounded to one decimal from the pipeline, so it
 * is interpolated rather than reformatted: `toLocaleString` would make the string
 * locale-dependent, which makes both this and its test harder to reason about.
 */
export function unsortedBadge(pct: number | undefined): string | null {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  if (pct < UNSORTED_TARGET_PCT) return null;
  return `${pct}% uncategorised`;
}

/**
 * Shown as the badge's tooltip, so it stays one line — a `title` renders newlines
 * as spaces. Takes the already-checked `number`, because it is only ever rendered
 * alongside a badge that `unsortedBadge` decided to show.
 */
export function unsortedHint(pct: number): string {
  return `${pct}% of these stars landed in "misc / other" — the rules classifier could not place them. Add an ANTHROPIC_API_KEY repository secret to classify by LLM, or extend taxonomy.json with the topics and languages your collection actually uses.`;
}
