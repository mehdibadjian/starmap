import type { View } from "./types";
import { isCoarsePointer } from "./pointer";

const KEY = "starmap.view";
const VIEWS: View[] = ["graph", "list", "timeline", "graveyard"];

/**
 * The view a bare `#/` should mean, before any explicit choice.
 *
 * A phone gets List. Not because the graph is wrong — it is the primary surface
 * and the SPEC says so — but because the graph is a *pointer* instrument: hit
 * slop, a 60-node legibility cap, no hover, and a two-dimensional camera all
 * exist to make a mouse usable. On glass the honest first read of "which of my
 * 635 stars are about llm-tooling" is a list, so the landing view follows the
 * input device the way the hit-testing already does.
 *
 * Three things bound this so it cannot hold anyone hostage. The precedence is
 * fixed: a view named in the URL wins, then a path drill (which always means the
 * graph, so a shared link shows what its author saw on whatever device opens it),
 * then the stored choice, and only then the device default. A preference can
 * choose which *home* you land on; it cannot rewrite a link someone else picked.
 */
export function defaultView(): View {
  return isCoarsePointer() ? "list" : "graph";
}

/**
 * The last view the user picked, or null if they never have.
 *
 * `null` rather than a default is the point: "no stored choice" and "stored
 * choice is graph" have to stay distinguishable, otherwise a phone user who
 * never touched a tab would be pinned to `graph` and the device default above
 * would never apply.
 */
export function storedView(): View | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Private mode, a blocked storage area, or a quota error: a preference is
    // not worth failing the app over, so fall back to the device default.
    return null;
  }
  return raw && (VIEWS as string[]).includes(raw) ? (raw as View) : null;
}

export function rememberView(view: View): void {
  try {
    // Only the explicit choices are worth storing. A cold open lands on
    // `defaultView()` without anyone asking for it, and persisting that would
    // freeze the device guess in place forever.
    window.localStorage.setItem(KEY, view);
  } catch {
    /* as above — a lost preference must not break navigation */
  }
}
