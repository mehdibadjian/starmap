/**
 * Helpers for the browser smoke test: browser lifecycle, phone emulation, and
 * memory-safe canvas sampling.
 *
 * Canvas assertions read *painted pixels*, not the code that paints them. That
 * distinction is the whole reason this file exists — every bug in
 * docs/Known-Gaps.md that type-checking missed was a bug in what actually got
 * drawn.
 */
import { spawn } from "node:child_process";
import { connect as cdpConnect, closeTab } from "./cdp.mjs";

export const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4173";
export const ROOT = new URL("../../", import.meta.url).pathname;
const PORT = process.env.CDP_PORT ?? "9222";
let spawnFailure = null;

/**
 * GitHub's runners ship `google-chrome` but not `chromium`; most dev machines
 * have the reverse. Resolve whichever exists rather than hard-coding one name
 * and failing on the other platform. `CHROME_PATH` still wins.
 */
const CANDIDATES = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];

async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  for (const bin of CANDIDATES) {
    try {
      await run(bin, ["--version"], { timeout: 8000 });
      return bin;
    } catch {
      /* not installed under this name */
    }
  }
  throw new Error(`no Chromium found — looked for ${CANDIDATES.join(", ")}; set CHROME_PATH`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { closeTab };

/* ------------------------------------------------------------------ *
 * Child processes
 *
 * Every detached child this harness starts (Chrome, `vite preview`) goes in one
 * list, so a throw partway through the run cannot leave a process holding a
 * debug port or a static-server port behind.
 * ------------------------------------------------------------------ */
const children = [];

function track(kind, proc) {
  children.push({ kind, proc });
  proc.on("error", (err) => {
    spawnFailure = err.message;
  });
  proc.unref();
  return proc;
}

function reap(signal, kind) {
  const doomed = kind ? children.filter((c) => c.kind === kind) : children;
  for (const { proc } of doomed) {
    try {
      process.kill(-proc.pid, signal);
    } catch {
      /* already gone */
    }
  }
  if (!kind) children.length = 0;
}

async function alive() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureBrowser() {
  if (await alive()) return;
  const chrome = await findChrome();
  const proc = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--no-first-run",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  );
  track("chrome", proc);
  for (let i = 0; i < 60; i++) {
    if (await alive()) return;
    await sleep(250);
  }
  throw new Error(`${chrome} did not expose a debugging port${spawnFailure ? `: ${spawnFailure}` : ""}`);
}

export async function killBrowser() {
  reap("SIGTERM", "chrome");
  await sleep(500);
}

const results = [];

/**
 * Start `vite preview` if nothing is serving `BASE` yet, so `npm run smoke` is
 * one command instead of a build, a server, a port, and a remember-to-kill.
 * An already-running preview (a dev's `npm run preview`) is used as-is.
 *
 * The host is pinned to the one in `BASE`, which is a real fix rather than
 * tidiness: Vite resolves a default `localhost` through the OS, and on a clean
 * machine that means `::1` — a server running perfectly and answering nothing
 * on the `127.0.0.1` this file probes. The first CI run of this harness failed
 * exactly that way while passing locally, because locally a previous run had
 * already left a server on the port.
 *
 * The child's output is captured rather than discarded, because a server that
 * exits immediately (no `dist/`, `--strictPort` finding the port taken, an
 * unparsable config) is otherwise indistinguishable from one that is merely
 * slow, and "vite preview did not come up" is not a failure anyone can act on.
 */
export async function ensureSite() {
  if (await reachable()) return;
  const url = new URL(BASE);
  const host = url.hostname || "127.0.0.1";
  const port = url.port || "4173";
  const vite = new URL("../../node_modules/vite/bin/vite.js", import.meta.url).pathname;
  const proc = spawn(process.execPath, [vite, "preview", "--host", host, "--port", port, "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  track("preview", proc);

  let output = "";
  proc.stdout.on("data", (b) => (output += b));
  proc.stderr.on("data", (b) => (output += b));
  let exit = null;
  proc.on("exit", (code, signal) => (exit = signal ? `signal ${signal}` : `code ${code}`));

  for (let i = 0; i < 80; i++) {
    if (await reachable()) return;
    // A dead child will never answer; don't spend 20 seconds pretending.
    if (exit !== null) break;
    await sleep(250);
  }
  throw new Error(
    `vite preview is not serving ${BASE} (${exit === null ? "never came up" : `exited with ${exit}`}; did \`npm run build\` produce dist/?)\n${output.trim() || "<no output from the server>"}`,
  );
}

async function reachable() {
  try {
    return (await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

export async function stopServer() {
  reap("SIGTERM", "preview");
}

process.on("exit", () => reap("SIGKILL"));
process.on("uncaughtException", (err) => {
  console.error(err);
  process.exit(1);
});

/**
 * A check that fails the run. There is deliberately no advisory variant: every
 * check that was once "report but don't fail" turned out to be describing a real
 * defect, so a green run has to mean all of them passed.
 */
export function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

export function section(title) {
  console.log(`\n== ${title} ==`);
}

export function report() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.detail}`);
  return failed.length;
}

/**
 * Open a page under phone emulation: coarse pointer, mobile viewport.
 *
 * `url` defaults to a blank tab with *no* navigation, because a listener
 * attached after the first load misses exactly the errors worth catching — the
 * boot-time ones. Callers navigate through `goto` once `on()` is wired up.
 */
export async function phone({ width = 390, height = 844, dpr = 3, colorScheme = "dark", url = null, touch = true, mobile = true } = {}) {
  await ensureBrowser();
  const { send, evaluate, on, tabId } = await cdpConnect(url ?? "about:blank");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile });
  if (touch) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (colorScheme) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: colorScheme }] });
  }
  if (url) await send("Page.navigate", { url });
  return { send, evaluate, on, tabId };
}

/**
 * Collect console errors and uncaught exceptions. Attach before navigating, or
 * the failures you are looking for have already happened.
 */
export function watchErrors(on) {
  const errors = [];
  on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") errors.push(p.args.map((a) => a.value ?? a.description).join(" "));
  });
  on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description ?? "exception"));
  return errors;
}

/**
 * A cursor page: no touch emulation, so the component takes its `pointer: fine`
 * path and hover exists. Needed for anything that has to *find* a node from
 * outside the app — see `sweepForNode`.
 */
export const desktop = (opts = {}) =>
  phone({ width: 1280, height: 800, dpr: 1, mobile: false, touch: false, ...opts });

export async function waitCanvas(evaluate, timeout = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready = await evaluate(`(() => {
      const c = document.querySelector("canvas");
      return c && c.width > 10 ? { w: c.width, h: c.height } : null;
    })()`);
    if (ready) return ready;
    await sleep(250);
  }
  throw new Error("canvas never appeared");
}

/**
 * Colour census by downscaled draw. Counting millions of antialiased pixels is
 * slow and memory-hungry — full-res getImageData has crashed the renderer here —
 * while a ~160px copy preserves every fill colour and collapses label
 * antialiasing. Raise `width` for thin features: a 2px ring needs ~600px.
 */
export const census = (evaluate) => async (width = 160) =>
  evaluate(`(() => {
    const c = document.querySelector("canvas");
    const small = document.createElement("canvas");
    const scale = ${width} / Math.max(c.width, c.height);
    small.width = Math.max(1, Math.round(c.width * scale));
    small.height = Math.max(1, Math.round(c.height * scale));
    const sctx = small.getContext("2d");
    sctx.drawImage(c, 0, 0, small.width, small.height);
    const img = sctx.getImageData(0, 0, small.width, small.height).data;
    const counts = new Map();
    for (let i = 0; i < img.length; i += 4) {
      counts.set((img[i] << 16) | (img[i + 1] << 8) | img[i + 2], (counts.get((img[i] << 16) | (img[i + 1] << 8) | img[i + 2]) ?? 0) + 1);
    }
    const toHex = (k) => "#" + (k + 0x1000000).toString(16).slice(1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, v]) => [toHex(k), v]);
  })()`);

/**
 * Colour census of a small region at *full* resolution.
 *
 * `census` downscales, which is the only safe way to scan a whole canvas, but a
 * 2px ring averages into the background at 0.47x and vanishes. When the thing
 * under test is thin, crop around the known pixel instead: a 64x64 read is
 * memory-cheap and preserves the exact stroke colour.
 */
export const cropCensus = (evaluate) => async (x, y, size = 64) =>
  evaluate(`(() => {
    const c = document.querySelector("canvas");
    const ctx = c.getContext("2d");
    const sx = Math.max(0, Math.round(${x} * devicePixelRatio - ${size} / 2));
    const sy = Math.max(0, Math.round(${y} * devicePixelRatio - ${size} / 2));
    const w = Math.min(${size}, c.width - sx);
    const h = Math.min(${size}, c.height - sy);
    const img = ctx.getImageData(sx, sy, w, h).data;
    const counts = new Map();
    for (let i = 0; i < img.length; i += 4) {
      const k = (img[i] << 16) | (img[i + 1] << 8) | img[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const toHex = (k) => "#" + (k + 0x1000000).toString(16).slice(1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => [toHex(k), v]);
  })()`);

export const tokens = (evaluate) => async () =>
  evaluate(`(() => {
    const s = getComputedStyle(document.documentElement);
    const g = (n) => s.getPropertyValue(n).trim();
    return {
      bg: g("--color-bg"), surface: g("--color-surface"), border: g("--color-border"),
      text: g("--color-text"), textDim: g("--color-text-dim"), accent: g("--color-accent"),
      active: g("--health-active"), slowing: g("--health-slowing"),
    };
  })()`);

/** Distance between two hex colours, loose enough to survive downscaling. */
export const close = (a, b, tol = 26) => {
  if (!a || !b) return false;
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return pa.reduce((s, v, i) => s + Math.abs(v - pb[i]), 0) <= tol;
};

export const hasNear = (top, want, tol = 60) => !!want && top.some(([c]) => close(c, want, tol));

/** Read the canvas's own account of what it is showing. */
export const graphLabel = (evaluate) => async () =>
  (await evaluate(`document.querySelector("canvas")?.getAttribute("aria-label") ?? ""`)) || "";

export const visibleCount = (label) => Number((label.match(/([\d,]+) repos visible/) ?? [])[1]?.replace(/,/g, "") ?? -1);
export const hiddenCount = (label) => Number((label.match(/(\d+) hidden/) ?? [])[1] ?? 0);

/**
 * Navigate and let the app settle.
 *
 * `expectCanvas: false` is for the degradation cases — with `graph.json` blocked
 * the app renders an error and no canvas ever mounts, so waiting for one would
 * time out and report a harness failure instead of the behaviour under test.
 */
export async function goto(send, evaluate, hash, { settle = 2300, expectCanvas = true } = {}) {
  await send("Page.navigate", { url: `${BASE}/${hash}` });
  if (expectCanvas) await waitCanvas(evaluate);
  await sleep(settle);
}

/**
 * Sweep the canvas with the pointer until something is hit, and return its pixel
 * position.
 *
 * Hit-testing lives entirely in painted pixels and internal node coordinates, so
 * there is no way to ask the app "what's at (x, y)" without adding a test hook to
 * production code. Walking the pointer and watching for the hover card answers
 * the same question from outside — and it is the *only* answer worth having,
 * because it proves the projection, the radius, and the hit slop all agree with
 * what was actually drawn.
 *
 * Only works where a cursor exists: under `pointer: coarse` the component drops
 * hover deliberately, so a finger never gets a tooltip it cannot dismiss.
 */
export async function sweepForNode(send, evaluate, { ring = 110, step = 7 } = {}) {
  const rect = await evaluate(`(() => { const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const seen = async () =>
    await evaluate(`(() => { const c = document.querySelector("canvas").parentElement;
      const card = [...c.querySelectorAll("div")].find(d => d.className.includes("pointer-events-none") && d.textContent.includes("★"));
      return card ? card.textContent.slice(0, 80) : null; })()`);
  for (let dx = 0; dx <= ring; dx += step) {
    for (let dy = -ring; dy <= ring; dy += step) {
      for (const [x, y] of [
        [cx + dx, cy + dy],
        [cx - dx, cy + dy],
      ]) {
        if (x < rect.x + 2 || x > rect.x + rect.w - 2 || y < rect.y + 2 || y > rect.y + rect.h - 2) continue;
        await move(x, y);
        const text = await seen();
        if (text) return { x, y, text };
      }
    }
  }
  return null;
}

