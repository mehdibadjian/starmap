# Local Development

## Setup

```bash
npm install
GITHUB_TOKEN=<token with public repo read access> npm run sync   # writes public/data/
npm run dev                                                     # http://localhost:5173
```

`npm run sync` is the same command CI runs nightly — fetch → classify → enrich → build graph → build search index → write shards. To work on the UI without a token there is `npm run fixture`, which writes a synthetic dataset through the pipeline's own functions (see below).

For the token, a classic PAT with no scopes beyond public read, or `gh auth token`, is enough: the pipeline only calls `GET /users/{login}/starred`.

## Without a token

The frontend reads only `public/data/`, so you can develop the UI against a synthetic dataset instead of a real star list. `npm run fixture` (i.e. `tests/browser/fixture.mjs`) does this, and it matters *how*: the generator drives `loadTaxonomy`/`leafIds`, `computeHealth`, `buildGraph`, and `buildOutputs` over a hand-written array of ~76 fake repos rather than authoring JSON. A hand-written blob would not exercise shard splitting, the search-index serialization, or the graph's node ids — and those are exactly the seams that break.

Whatever it generates lands in `public/data/`, which is gitignored — so the repo never carries a fake dataset, and `npm run sync` overwrites it with a real one.

Traps worth knowing before you change the generator:

- **Keep the fixture's words distinct.** If every fake description contains the string you later search for, a "topics are indexed too" test proves nothing. Give each record a topic that appears nowhere else in it — the fixture uses `homebrew`.
- **Derive `cat` from real leaf IDs.** A `cat: [null]` from an off-by-one in the generator is the fastest way to conclude the SPA is broken when the data is. The client now filters such rows out rather than blanking, but you'll be debugging the wrong thing.
- **Put at least one hub over the phone cap.** The first 62 records are deliberately filed under `misc` so a hub exceeds `MAX_VISIBLE_REPOS_COARSE` (60) and the `+N` overflow path gets exercised. Spread evenly over 55 leaves, no hub in a 76-repo fixture reaches the cap and the smoke test quietly stops testing it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server. Reads `public/data/` as-is — no pipeline watching. |
| `npm run build` | `tsc -p tsconfig.json --noEmit` then `vite build` → `dist/`. |
| `npm run preview` | Serve `dist/` locally, closest thing to the real Pages deploy. |
| `npm run sync` | Run the whole pipeline once. |
| `npm run lint` | ESLint over `src`, `shared`, `pipeline`, `tests`, and the `.mjs` browser harness. |
| `npm test` | `node --import tsx --test "tests/*.test.ts"` — 40 tests, no test framework. |
| `npm run fixture` | Regenerate `public/data/` from the fixture generator. |
| `npm run smoke` | Drive headless Chromium over CDP against `dist/`. Needs `npm run build` first. |
| `npm run typecheck` | Type-checks `src` (DOM), `pipeline` (Node), and `tests` as three separate projects. |

The test runner is Node 22's built-in `node:test` with `tsx` as a loader, so there is nothing new to install and no config file. Notes on making it work:

- Pass the quoted glob, `node --test "tests/*.test.ts"`. A bare directory argument makes Node treat it as a module and fail with `ERR_MODULE_NOT_FOUND`.
- `tests/tsconfig.json` is its own project: Node globals for the runner, DOM lib for the browser-facing code under test, `allowImportingTsExtensions` because the suite imports `.ts` sources directly. It needs no `jsx` — the tests exercise functions, not components.
- Tests import from `@/` and `@shared/`, which resolve via the `paths` mirrors — the same aliases Vite uses, so a test and the browser agree on what a module is.

What the suite covers, in order of the harm it prevents: the MiniSearch serialize → rehydrate → query round trip (gap 1), `readCanvasTheme()` against the real `tokens.css` (gap 2 and the `<html>` scope), `planClassifications`' pending-hash retry rule (gap 4), `computeHealth` threshold edges, `parseHash`/`buildHash` round trips, the shard row guard, `buildGraph`'s empty-leaf pruning and root-reachability rule (the bug that made a category tap open an empty view), the cross-account merge-baseline guard in `previousData`, and the uncategorised-rate badge threshold. None of them need a browser or a network.

The correctness gates are `npm run lint`, `npm run typecheck` and `npm test`, and all three run in CI — on every pull request in [ci.yml](CI-and-Deployment.md), and again before the nightly pipeline deploys. `ci.yml` adds a second job that builds the fixture dataset and drives the real page over the Chrome DevTools Protocol (`npm run smoke`); see [Browser smoke test](#browser-smoke-test) below for why it is raw CDP rather than Playwright, and what it refuses to let regress.

## Browser smoke test

`tests/browser/` is a second tier of testing, for the things the unit suite structurally cannot see: whether the canvas paints, whether a tap on a hub lands on something, whether the search combobox opens for a real keystroke. It spawns headless Chromium with `--remote-debugging-port`, drives it over a raw WebSocket to the Chrome DevTools Protocol, and runs `npm run preview` itself if the port isn't already answering.

Two decisions worth defending:

- **No Playwright.** Puppeteer and Playwright both pin a Chrome download and a version cadence of their own. The harness needs three CDP commands — `Page.navigate`, `Runtime.evaluate`, `Input.dispatchMouseEvent` — and a `cdp.mjs` of about sixty lines does that against whatever Chromium the runner already has (`CHROME_PATH` overrides the search). On a phone-managed repo, the fewer binary downloads in CI the better.
- **Every check can fail.** There is deliberately no advisory variant. Each check that was once "report but don't fail" turned out to be describing a real defect — an empty hub, a font that was never fetched, a selection ring painted the wrong colour.

The suite is 47 checks in nine groups: the phone shell (viewport, `100dvh`, touch-action, input font size, no sideways overflow, IBM Plex actually loaded), tokens painting rather than `var()` reaching the canvas, drilling a hub that exceeds the phone cap, the graph pruning empty categories instead of emitting dead-end dots, keyboard navigation, search typing, pinch and pan, hit-testing and the selection ring, and degradation when `search.json` or `graph.json` is blocked.

Two gotchas cost real time and are encoded in the harness:

- **React-controlled inputs need genuine keystrokes.** Setting `input.value` through the native setter and dispatching `input` updates React state but leaves the element blurred, and the combobox renders its list only while focused. `typeInto()` clicks the field and sends per-character `Input.dispatchKeyEvent`, the way a person does.
- **A downscaled canvas census averages away thin features.** The device pixel ratio means a 2px selection ring can vanish from a full-canvas `getImageData`. The selection-ring check sweeps for the node, then reads a full-resolution `cropCensus()` around that known pixel.

Run it locally with `npm run fixture && npm run build && npm run smoke`. It refuses to start against a missing or stale dataset and tells you which command to run — a byte-compare of `public/data/graph.json` against `dist/data/graph.json`, because a green run against an old bundle proves nothing.

## Working on the pipeline

The pipeline is plain ESM TypeScript run through `tsx`, so each stage is independently readable and the module boundaries are the seams:

```
config.ts        → load config.yml
taxonomyRules.ts → load taxonomy.json, rules-tier match
fetch.ts         → Octokit, paging, retry, incremental stop
classify.ts      → cache + rules + optional LLM
enrich.ts        → RawStar + classification → RepoRecord
health.ts        → pushed_at/archived → state
graph.ts         → nodes, edges, headless layout, positions
buildIndex.ts    → shards, search index, meta, history
previousData.ts  → merge baseline from the live Pages site
sync.ts          → the orchestrator
```

Useful local flags:

```bash
FORCE_FULL=1 npm run sync     # ignore incremental, walk everything
npm run sync                  # re-runs are cheap: cache hits, no LLM spend
```

To test baseline fetching offline, set `PAGES_URL` to a deployed site — or let it fail, which is a valid path and forces a full pass.

`public/data/` is gitignored. Delete it to confirm your code handles a cold start, and delete `cache/positions.json` to force a fresh layout.

## Working on the frontend

`src/lib/data.ts` fetches with relative `./data/...` paths, so the dev server needs the generated dataset present. If you edit only components, run `sync` once and then never again.

Loading order is intentional and easy to break: `meta.json`, `graph.json`, and `search.json` load on mount; repo shards load one at a time in `requestIdleCallback`. If you add a component that needs the full repo list, it will race that idle loading — `ListView` and `Graveyard` are empty until shards land.

To see a real deploy locally:

```bash
npm run sync && npm run build && npm run preview
```

`preview` is the check for path and `.nojekyll` problems that `dev` hides.

## Debugging a sync

The log line at the end tells you most of what you need:

```
Synced 1204 repos (added 7, removed 0, full=false, llm_degraded=true)
```

Anything thrown earlier aborts before writing output — the run exits non-zero and publishes nothing, by design. See [Troubleshooting](Troubleshooting.md) for the common causes.
