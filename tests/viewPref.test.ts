import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultView, rememberView, storedView } from "../src/lib/viewPref.ts";

/**
 * The landing-view default is the one piece of this feature that can annoy
 * somebody: open the wrong surface, or trap someone on it. The rules that stop
 * that happening are in `parseHash` (see tests/url.test.ts) and here — namely
 * that a preference is only ever *earned*, and that storage can fail without
 * taking the app down with it.
 *
 * Globals are stubbed per test rather than at import time because these modules
 * read `window` when called, not when loaded.
 */

type Win = Record<string, unknown>;

/**
 * Swap `window` for a stub, run, and put it back.
 *
 * The casts go via `unknown` because Node's `globalThis` already declares a
 * `window` (the DOM lib is in this tsconfig), and TypeScript rightly refuses to
 * call a hand-built object literal a `Window`.
 */
function withWindow(stub: Win, fn: () => void): void {
  const global = globalThis as unknown as Win;
  const had = "window" in global;
  const previous = global.window;
  global.window = stub;
  try {
    fn();
  } finally {
    if (had) global.window = previous;
    else delete global.window;
  }
}

const coarse = (matches: boolean) => ({ matchMedia: () => ({ matches }) });

test("a phone opens on List, a desktop on Graph", () => {
  withWindow(coarse(true), () => assert.equal(defaultView(), "list"));
  withWindow(coarse(false), () => assert.equal(defaultView(), "graph"));
});

/**
 * Without `matchMedia` there is no evidence either way, and guessing "coarse"
 * would put every non-browser render on List. `pointer: coarse` is a question
 * you answer from a real device or not at all.
 */
test("no matchMedia means the graph, the documented default", () => {
  withWindow({}, () => assert.equal(defaultView(), "graph"));
});

test("a stored choice survives until it is changed", () => {
  const store = new Map<string, string>();
  const win = {
    ...coarse(true),
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  withWindow(win, () => {
    assert.equal(storedView(), null, "nothing stored yet — so no preference, not a default");
    rememberView("timeline");
    assert.equal(storedView(), "timeline");
    rememberView("graph");
    assert.equal(storedView(), "graph", "graph is a choice like any other");
  });
});

test("a junk or unknown stored view is ignored rather than trusted", () => {
  for (const raw of ["graphh", "", "constructor", "42"]) {
    const win = {
      ...coarse(false),
      localStorage: { getItem: () => raw, setItem: () => undefined },
    };
    withWindow(win, () => assert.equal(storedView(), null, `"${raw}" is not a view`));
  }
});

/**
 * Safari private mode throws from `localStorage`, it does not return null, and a
 * preference is not worth a white screen for. `App` must still navigate.
 */
test("a blocked storage area degrades to the device default", () => {
  const throwing = () => {
    throw new Error("SecurityError");
  };
  const win = { ...coarse(true), localStorage: { getItem: throwing, setItem: throwing } };
  withWindow(win, () => {
    assert.equal(storedView(), null);
    assert.doesNotThrow(() => rememberView("list"));
    assert.equal(defaultView(), "list");
  });
});
