/**
 * Browser smoke test. Run with `npm run smoke` after `npm run build`: it reads
 * the site the way it is actually published, from `vite preview`.
 *
 * These are the checks type-checking structurally cannot make — does the canvas
 * really paint the theme's colours, does a single-finger tap land on a node,
 * does drilling into a category show its repos. Each of those has broken at
 * least once with a green build and a passing unit suite (docs/Known-Gaps.md),
 * which is the entire justification for driving a real browser here.
 *
 * Deliberately dependency-free (raw CDP over Node's global WebSocket) so it
 * costs nothing to keep. Exits non-zero on any hard failure.
 *
 * Environment:
 *   SMOKE_BASE   site under test           (default http://127.0.0.1:4173)
 *   CHROME_PATH  browser binary            (default: try four known names)
 *   CDP_PORT     attach to a browser you started, instead of launching one
 */
import { readFileSync, statSync } from "node:fs";
import {
  census,
  check,
  closeTab,
  cropCensus,
  desktop,
  ensureSite,
  goto,
  graphLabel,
  hasNear,
  hiddenCount,
  killBrowser,
  phone,
  report,
  section,
  sleep,
  stopServer,
  sweepForNode,
  tokens,
  visibleCount,
  watchErrors,
} from "./lib.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const graphFile = (p) => readFileSync(`${ROOT}${p}`, "utf8");

/* The browser fetches `dist/`, but the expectations below are computed from the
 * source dataset. If a regeneration went into `public/data` without a rebuild,
 * every check would run against stale numbers and "pass" — so compare the two
 * before opening a browser. Vite copies `public/` verbatim, so they must match
 * byte for byte. `data/` is gitignored, so on a fresh checkout both are missing
 * until `npm run fixture` and `npm run build` have run. */
const exists = (p) => {
  try {
    statSync(`${ROOT}${p}`);
    return true;
  } catch {
    return false;
  }
};
if (!exists("public/data/graph.json") || !exists("dist/data/graph.json")) {
  console.error("no dataset found — run `npm run fixture && npm run build` before `npm run smoke`.");
  process.exit(1);
}
if (graphFile("public/data/graph.json") !== graphFile("dist/data/graph.json")) {
  console.error("dist/ is stale relative to public/data — run `npm run build` before `npm run smoke`.");
  process.exit(1);
}

const graph = JSON.parse(graphFile("public/data/graph.json"));
const taxonomy = JSON.parse(graphFile("taxonomy.json"));

const hubs = graph.nodes.filter((n) => n.kind === "hub");
const leaves = graph.nodes.filter((n) => n.kind === "leaf");
/** Biggest hub by repos — the one that must show repos, not just leaf dots. */
const bigHub = hubs.slice().sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
const bigHubLeaves = leaves.filter((n) => n.parent === bigHub?.id);
const allLeaves = new Set(taxonomy.roots.flatMap((r) => r.leaves.map((l) => l.id)));
const emittedLeaves = new Set(leaves.map((n) => n.id.slice("leaf:".length)));
/** A taxonomy leaf the graph dropped on purpose: the empty-state path. */
const prunedLeaf = [...allLeaves].find((id) => !emittedLeaves.has(id));

const label = graphLabel;

await ensureSite();

/* ================================================================== *
 * 1. Phone shell — what the layout does at 390px
 * ================================================================== */
section("phone shell");
{
  const { send, evaluate, on, tabId } = await phone({ dpr: 3 });
  const errors = watchErrors(on);
  await goto(send, evaluate, "");

  check("pointer: coarse is active under touch emulation", (await evaluate(`matchMedia("(pointer: coarse)").matches`)) === true);

  const vh = await evaluate(`(() => {
    const el = document.querySelector("div[class*='100dvh']");
    return el ? getComputedStyle(el).height : "none";
  })()`);
  check("shell uses 100dvh, not 100vh", vh !== "none" && Number(vh.replace("px", "")) > 500, `height=${vh}`);

  const viewport = await evaluate(`document.querySelector('meta[name=viewport]')?.content ?? ""`);
  check("viewport sets viewport-fit=cover", viewport.includes("viewport-fit=cover"), viewport);

  const inputFont = await evaluate(`(() => {
    const i = document.querySelector("input");
    return i ? parseInt(getComputedStyle(i).fontSize, 10) : 0;
  })()`);
  check("search input is >=16px so iOS does not zoom on focus", inputFont >= 16, `${inputFont}px`);

  const touchAction = await evaluate(`getComputedStyle(document.querySelector("canvas")).touchAction`);
  check("canvas sets touch-action: none", touchAction === "none", touchAction);

  const sideways = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check("no sideways overflow at 390px", sideways <= 1, `${sideways}px`);

  /* Fonts: the @font-face rules must survive the build's asset rewriting.
   * `base: "./"` plus a project-page subpath is what breaks an absolute
   * `/fonts/x.woff2`, so "declared" is not enough — one must actually load. */
  const fontOk = await evaluate(`(async () => {
    await document.fonts.ready;
    const faces = [...document.fonts];
    return {
      declared: faces.filter((f) => f.family.includes("IBM Plex")).length,
      loaded: faces.filter((f) => f.family.includes("IBM Plex") && f.status === "loaded").length,
      fetched: performance.getEntriesByType("resource").filter((e) => e.name.endsWith(".woff2")).length,
    };
  })()`);
  check("webfont faces are declared in the shipped CSS", fontOk.declared >= 3, `${fontOk.declared} faces`);
  check("a woff2 loads over the rewritten relative url", fontOk.loaded >= 1 || fontOk.fetched >= 1, `loaded=${fontOk.loaded} fetched=${fontOk.fetched}`);

  const header = await evaluate(`document.querySelector("header")?.innerText ?? ""`);
  /* `unsorted_pct` was computed, published, typed, and read by nothing — so the
   * live site reported 58.7% of stars dumped in `misc / other` while the header
   * advertised a perfectly healthy map. The number must be on screen. */
  check("the uncategorised rate from meta.json is visible in the header", /% uncategorised/.test(header), JSON.stringify(header.replace(/\n+/g, " ").slice(0, 70)));

  check("no console errors while booting the graph view", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

/* ================================================================== *
 * 2. The canvas paints resolved tokens, not var() strings
 * ================================================================== */
section("canvas paints tokens, not var()");
{
  const { send, evaluate, on, tabId } = await phone({ dpr: 3 });
  const errors = watchErrors(on);
  await goto(send, evaluate, "");

  const dark = await tokens(evaluate)();
  const top = await census(evaluate)(160);
  check("canvas background is the theme bg", hasNear(top, dark.bg), `want=${dark.bg} top=${top[0]?.[0]}`);

  /* `--accent` exists as the shadcn hover-surface alias and is NOT the brand
   * colour; reading it instead of `--color-accent` paints the wrong ring and
   * fails nothing. Both names must resolve to different values. */
  const aliasDiffers = await evaluate(`(() => {
    const s = getComputedStyle(document.documentElement);
    return s.getPropertyValue("--color-accent").trim() !== s.getPropertyValue("--accent").trim();
  })()`);
  check("brand accent and shadcn --accent are distinct tokens", aliasDiffers === true);

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await evaluate(`document.documentElement.classList.replace("dark", "light")`);
  await sleep(800);
  const light = await tokens(evaluate)();
  const lightTop = await census(evaluate)(160);
  check("theme swap repaints the canvas", hasNear(lightTop, light.bg), `want=${light.bg} top=${lightTop[0]?.[0]}`);
  check("light bg differs from dark bg", light.bg !== dark.bg, `${dark.bg} -> ${light.bg}`);

  check("no console errors during the theme swap", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

/* ================================================================== *
 * 3. Drilling: a hub is a group of repos, not a row of leaf dots
 * ================================================================== */
section("drilling into a category shows its repos");
{
  const { send, evaluate, on, tabId } = await phone({ dpr: 3 });
  const errors = watchErrors(on);

  check("fixture has a hub over the phone visibility cap", !!bigHub && bigHub.count > 60, `${bigHub?.id.slice(4)}=${bigHub?.count}`);

  await goto(send, evaluate, `#/${bigHub.id.slice("hub:".length)}`);
  const hubLabel = await label(evaluate)();
  const vis = visibleCount(hubLabel);
  const hid = hiddenCount(hubLabel);
  check(
    `hub "${bigHub.id.slice(4)}" (${bigHub.count} repos) renders repos, not just leaves`,
    vis > 0,
    `visible=${vis} hidden=${hid} label=${JSON.stringify(hubLabel.slice(0, 70))}`,
  );
  check("hub view accounts for what it hid behind +N", bigHub.count <= vis || hid > 0, `hidden=${hid}`);

  const leafName = bigHubLeaves[0]?.id.slice("leaf:".length);
  if (leafName) {
    await goto(send, evaluate, `#/${leafName}`);
    const leafLabel = await label(evaluate)();
    check(`leaf "${leafName}" reports its own repo count`, /repos visible/.test(leafLabel), leafLabel.slice(0, 60));
  }

  check("no console errors while drilling", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

/* ================================================================== *
 * 4. An empty category explains itself instead of showing a blank panel
 * ================================================================== */
section("empty categories explain themselves");
{
  const { send, evaluate, on, tabId } = await phone({ dpr: 3 });
  const errors = watchErrors(on);

  if (prunedLeaf) {
    await goto(send, evaluate, `#/${prunedLeaf}`);
    const body = await evaluate(`document.body.innerText`);
    check(`pruned category "${prunedLeaf}" says so`, /nothing in this category/i.test(body), body.slice(0, 60).replace(/\n/g, " "));
    check("the empty state offers a way back out", /back to all categories/i.test(body));
  } else {
    // Not advisory: a 76-repo fixture across a 55-leaf taxonomy can never fill
    // every leaf, so an unpruned graph *is* the bug — empty dots you can tap
    // into and find nothing on. Asserting "the emitted set is a strict subset"
    // fails the run when pruning stops happening.
    check(
      "the graph prunes empty leaves instead of emitting dead-end dots",
      emittedLeaves.size < new Set(allLeaves).size,
      `${emittedLeaves.size} emitted / ${new Set(allLeaves).size} in taxonomy`,
    );
  }

  await goto(send, evaluate, "#/nonexistent/nope");
  check("a hand-typed path degrades to an explanation", /nothing in this category/i.test(await evaluate(`document.body.innerText`)));

  check("no console errors on the empty path", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

/* ================================================================== *
 * 5. Keyboard: the canvas is a surface you can operate, not a picture
 * ================================================================== */
section("keyboard");
{
  const { send, evaluate, on, tabId } = await desktop({ dpr: 1 });
  const errors = watchErrors(on);
  await goto(send, evaluate, "");

  const focused = await evaluate(`(() => {
    const c = document.querySelector("canvas");
    c.focus();
    return document.activeElement === c;
  })()`);
  check("the canvas is focusable", focused === true);

  const key = async (k, code, vk) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    await sleep(180);
  };
  await key("ArrowRight", "ArrowRight", 39);
  await key("ArrowRight", "ArrowRight", 39);
  const announced = await evaluate(`document.querySelector('[aria-live="polite"]')?.textContent ?? ""`);
  check("arrow keys move a cursor and announce it", announced.length > 4, JSON.stringify(announced.slice(0, 70)));

  /* Enter descends. A keyboard user's only route into a category is this key,
   * and it is the one canvas interaction that cannot be observed through pixels,
   * so check the URL the app committed to instead. (The accent ring the cursor
   * paints is covered by the full-res crop check under "hit-testing matches the
   * paint", where the node's pixel position is already known.) */
  await goto(send, evaluate, "");
  await evaluate(`document.querySelector("canvas").focus()`);
  await key("ArrowRight", "ArrowRight", 39);
  await key("Enter", "Enter", 13);
  await sleep(700);
  const descendedHash = await evaluate(`location.hash`);
  const descendedLabel = await label(evaluate)();
  check("Enter on a hub descends into it", /^#\/[a-z][\w-]*$/.test(descendedHash), JSON.stringify(descendedHash));
  check(
    "the descended view is that hub's, showing its repos",
    descendedLabel.includes(`showing ${descendedHash.slice(2)}.`) && visibleCount(descendedLabel) > 0,
    JSON.stringify(descendedLabel.slice(0, 60)),
  );

  /* Zoom must not change which repos are in the view — membership depends on the
   * drill path and the cap, not the camera. Tested inside a hub, because at root
   * the repo count is 0 and the comparison would pass vacuously. */
  await goto(send, evaluate, `#/${bigHub.id.slice("hub:".length)}`);
  const visBefore = visibleCount(await label(evaluate)());
  await key("0", "Digit0", 48);
  await key("+", "Equal", 187);
  await key("-", "Minus", 189);
  await sleep(500);
  const visAfter = visibleCount(await label(evaluate)());
  check("zoom keys keep the same repos in view", visBefore > 0 && visBefore === visAfter, `${visBefore} -> ${visAfter}`);

  check("no console errors with the keyboard", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

/* ================================================================== *
 * 6. Search: the serialized index must agree with the client's field names
 * ================================================================== */
section("search round trip");
{
  const { send, evaluate, on, tabId } = await desktop({ dpr: 1 });
  const errors = watchErrors(on);
  await goto(send, evaluate, "");

  const typeInto = async (text) => {
    const box = await evaluate(`(() => { const r = document.querySelector('input[aria-label="Search stars"]').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await sleep(150);
    for (const ch of text) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await sleep(60);
    }
    await sleep(700);
  };

  /* Typed as real key events, not by setting `input.value`: the combobox only
   * renders its list while focused, and the synthetic-setter route left the
   * React-controlled input blurred, so a green run here would have proven
   * nothing about what a thumb on glass actually sees. */
  await typeInto("homebrew");
  const state = await evaluate(`(() => {
    const i = document.querySelector('input[aria-label="Search stars"]');
    return {
      val: i.value,
      focused: document.activeElement === i,
      expanded: i.getAttribute("aria-expanded"),
      options: document.querySelectorAll('[role="option"]').length,
      first: document.querySelector('[role="option"]')?.textContent ?? "",
    };
  })()`);
  check("the search box keeps focus while typing", state.focused === true && state.val === "homebrew", JSON.stringify(state).slice(0, 80));
  /* "homebrew" appears in `topics` and nowhere else. The published index carries
   * its own field-name → field-id map, so if the client's list drops `topicsText`,
   * that field resolves to undefined and the term silently stops matching — no
   * error, no warning. This is the original bug; querying through the app is the
   * only way to catch it. */
  check(`topic-only term "homebrew" finds results through the app`, state.options > 0, JSON.stringify(state).slice(0, 120));
  check("the dropdown is an open combobox with readable labels", state.expanded === "true" && state.first.length > 1, JSON.stringify(state.first.slice(0, 40)));

  await closeTab(tabId);
  check("no console errors while searching", errors.length === 0, errors.slice(0, 2).join(" | "));
}

/* ================================================================== *
 * 7. Touch: pinch must not scroll, a pan must not count as a tap
 * ================================================================== */
section("touch");
{
  const { send, evaluate, on, tabId } = await phone({ dpr: 3 });
  const errors = watchErrors(on);
  await goto(send, evaluate, `#/${bigHub.id.slice("hub:".length)}`);

  const scrolledBefore = await evaluate(`window.scrollY`);
  const hashBefore = await evaluate(`location.hash`);
  const rect = await evaluate(`(() => { const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const touch = (type, points) => send("Input.dispatchTouchEvent", { type, touchPoints: points });

  await touch("touchStart", [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }]);
  for (let i = 1; i <= 6; i++) {
    await touch("touchMove", [{ x: cx - 40 - i * 8, y: cy, id: 1 }, { x: cx + 40 + i * 8, y: cy, id: 2 }]);
    await sleep(30);
  }
  await touch("touchEnd", []);
  await sleep(300);
  check("pinch does not scroll the page", (await evaluate(`window.scrollY`)) === scrolledBefore, `scrollY=${await evaluate(`window.scrollY`)}`);

  /* A finger that travels past the tap threshold is a pan. `coarse` raises that
   * threshold to 10px precisely because taps tremble; if a drag ever started
   * firing selections, every scroll on a phone would open a panel. */
  await touch("touchStart", [{ x: cx, y: cy, id: 7 }]);
  for (let i = 1; i <= 8; i++) {
    await touch("touchMove", [{ x: cx - i * 12, y: cy + i * 6, id: 7 }]);
    await sleep(20);
  }
  await touch("touchEnd", []);
  await sleep(400);
  const afterPan = await evaluate(`(() => ({ hash: location.hash, live: document.querySelector('[aria-live="polite"]')?.textContent ?? "" }))()`);
  check("a drag pans instead of selecting a node", afterPan.hash === hashBefore && afterPan.live.length === 0, JSON.stringify(afterPan).slice(0, 70));

  check("no console errors during touch", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

/* ================================================================== *
 * 8. Hit-testing agrees with what was actually drawn
 * ================================================================== */
section("hit-testing matches the paint");
{
  const { send, evaluate, on, tabId } = await desktop({ dpr: 1 });
  const errors = watchErrors(on);
  await goto(send, evaluate, `#/${bigHub.id.slice("hub:".length)}`);

  /* Under `pointer: fine` the component keeps hover, so walking the cursor is an
   * outside-in way to ask "is there a node at this pixel" without adding a test
   * hook to production code — and it proves the projection, the radius, and the
   * hit slop all agree with what was painted. */
  const found = await sweepForNode(send, evaluate, { ring: 300, step: 12 });
  check("hovering the hub view finds a repo node", !!found, found ? JSON.stringify(found.text.slice(0, 44)) : "nothing hovered");

  if (found) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: found.x, y: found.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: found.x, y: found.y, button: "left", clickCount: 1 });
    await sleep(700);
    const hash = await evaluate(`location.hash`);
    const body = await evaluate(`document.body.innerText`);
    check("a cursor click on that node selects it", hash.includes("?") && hash.includes("r="), hash.slice(0, 60));
    check("the repo panel opens with the clicked repo", /Open on GitHub/i.test(body));

    /* The selected ring is a 2px stroke, which a downscaled census averages away,
     * so read a full-res crop centred on the pixel we already know is on the
     * node. This is the check that `var(--color-accent)` never reached the canvas:
     * canvas silently rejects a custom property, and nothing but painted pixels
     * proves the literal got there. */
    const origin = await evaluate(`(() => { const r = document.querySelector("canvas").getBoundingClientRect();
      return { x: r.left, y: r.top }; })()`);
    const crop = await cropCensus(evaluate)(found.x - origin.x, found.y - origin.y, 80);
    const tk = await tokens(evaluate)();
    check("the selection ring paints in the brand accent", hasNear(crop, tk.accent, 40), `want=${tk.accent} crop=${crop.slice(0, 3).map(([c]) => c).join(",")}`);
  }
  check("no console errors during hit-testing", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

/* ================================================================== *
 * 9. Degradation: a missing file must not blank the site
 * ================================================================== */
section("degradation");
{
  const { send, evaluate, on, tabId } = await phone({ dpr: 2 });
  const errors = watchErrors(on);
  await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["**/data/search.json"] });
  await goto(send, evaluate, "");
  const body = await evaluate(`document.body.innerText`);
  check("a missing search index degrades instead of blanking the app", /search off/i.test(body), body.slice(0, 50).replace(/\n/g, " "));
  check("the map still renders without the index", /repos|categories/i.test(body));
  // Degrading is not the same as failing: a blocked file must not also throw.
  check("a blocked search index logs no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

{
  const { send, evaluate, on, tabId } = await phone({ dpr: 2 });
  const errors = watchErrors(on);
  await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["**/data/graph.json"] });
  // No canvas mounts when the graph is missing, so don't wait for one — that
  // would time out and report a harness failure instead of the real behaviour.
  await goto(send, evaluate, "", { settle: 3500, expectCanvas: false });
  const body = await evaluate(`document.body.innerText`);
  check("a missing graph shows an actionable error, not a blank page", /could not load/i.test(body), body.slice(0, 60).replace(/\n/g, " "));
  check("a blocked graph logs no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await closeTab(tabId);
}

await stopServer();
await killBrowser();
process.exit(report() === 0 ? 0 : 1);
