# Views

Four views plus a persistent side panel. All share the same filtered set — switching views is re-rendering the same state, not querying differently.

```
Graph ──┬── tap/click hub/leaf ──► drill ──► per-leaf cap ──► "+N more" ──► List
        └── tap/click repo ─────────────────────────────────► RepoPanel
List    ◄── l key / "+N more"
Timeline · Graveyard · (search filters every one of them)
```

The app is phone-first. Anything that differs between a 390px touch screen and a desktop is driven by one signal — `matchMedia("(pointer: coarse)")`, in `src/lib/pointer.ts` — plus Tailwind's `sm:` breakpoints for the chrome. "Coarse" below means touch. The signal decides node radius, hit slop, whether hover exists at all, the visibility cap, and which view a cold open shows (below).

## Which view you land on

`#/` means *home*, and home is device-relative — a deliberate divergence from `SPEC.md`'s "Graph view (default)", recorded in [Known Gaps](Known-Gaps.md). Resolution order, highest first:

| Hash | Desktop | Phone |
|---|---|---|
| `#/list/ai-ml`, `#/timeline`, `#/graveyard` | named view | named view |
| `#/web/frameworks`, `#/ai-ml?r=42` | **graph** | **graph** |
| `#/`, `#/?q=rust`, no hash at all | stored choice, else graph | stored choice, else **List** |

A path in the hash always means the graph, whatever the device or the preference. That is the load-bearing rule: `#/misc` is a *position* on the map, so a link you send someone has to show them what you were looking at, and a phone default that intercepted shared links would be worse than the problem it solved. The stored choice is the escape hatch — one tab click or one `l` and it wins from then on. `src/lib/viewPref.ts` reads and writes it; a `localStorage` that throws (Safari private mode) is caught and falls back to the device default, because a preference is not worth a white screen.

Only the two controls that *are* the choice write it. `+N more` jumps to List without recording anything, because you were already looking at the graph when you tapped it — that's reading a long tail, not picking a home view. Same reasoning for a search pick.

Nothing about the graph got harder to reach on a phone: the drill-down, `+N more`, `l`, and the tabs all still work exactly as before. What changed is only which of them you see first.

## Graph (`GraphView.tsx`, Canvas)

The primary surface. Progressive disclosure is the whole design — it never renders everything.

**What's visible** is a function of the current path only:

| Path | Nodes rendered |
|---|---|
| `[]` (cold) | `root` + every hub that has repos. Nothing else. |
| `[hub]` | root, all hubs, that hub's leaves, **and that hub's repos up to the cap** — one `+N` circle per leaf for what it hides. Sibling hubs and their branches stay in place but recede to `globalAlpha 0.22` with their non-hub labels suppressed, so the active branch reads as the subject. `GraphView.tsx:229`. |
| `[hub, leaf]` | that leaf, its repos up to the cap, and one overflow node if there are more. |

The hub row is the fix for a defect that made the map look broken: showing only a hub's leaf dots meant tapping a category with hundreds of repos produced a view indistinguishable from tapping an empty one. A hub is a *group* of repos, so its view collects repos from every leaf under it.

The cap is `MAX_VISIBLE_REPOS_FINE = 200` with a cursor and `MAX_VISIBLE_REPOS_COARSE = 60` on touch (`:16-17`). Two hundred labelled dots are unreadable on a phone, and the cap exists for legibility, not as a ceiling. Repos are sorted by stars before the cut, so what hides behind `+N` is the smallest, not whatever landed last in shard order.

Because empty categories are pruned from `graph.json` (see [Graph Construction](Graph-Construction.md)), a drilled path can name a node that does not exist — a stale bookmark or a hand-typed hash. That renders an explicit **"Nothing in this category"** card over the canvas, naming the path and offering *Back to all categories*, rather than a blank panel that reads as a failure (`GraphView.tsx:785`, `pathMissing` at :261).

Associative edges render only between currently visible nodes (`visibleEdges = graph.edges.filter(e => visible.has(e.s) && visible.has(e.t))`), which is how the hairball is structurally impossible rather than merely hidden.

**Rendering.** DPR-aware canvas. Colours and fonts come from `readCanvasTheme()` (`src/lib/canvasTheme.ts`), which resolves the tokens to literal values once per draw — canvas silently ignores `var()` in `fillStyle`/`strokeStyle`/`font`, so nothing here may assign a custom property. See [Theming and Tokens](Theming-and-Tokens.md).

Node fill walks `parent` up to the hub and indexes the 12-colour palette — leaves and repos inherit their hub's colour. Node radius is a log scale: hub `12 + log(count)·2.5`, leaf `7 + log(count)·1.8`, repo `3 + log(stars)·1.3` with the floor raised to 6px on touch, because a sub-6px dot is un-tappable on glass and gives the health ring nothing to sit on (`radiusForNode`, `:313`). Every repo carries a **2px ring in its health colour**, which is how a field of dots reads as decay without any text. Labels are zoom-gated: hubs always, leaves above `zoom > 0.55`, repos above `0.9`, plus whichever node is hovered or under the keyboard cursor — so the canvas never becomes a word cloud.

A `requestAnimationFrame` loop runs continuously only while a search is active (that's what animates the pulse). Otherwise the canvas repaints when a dependency changes, which is why `themeTick` exists (`:95`): a `MutationObserver` on `<html>`'s class, a `prefers-color-scheme` listener, and `window.resize` all bump it, since none of those arrive as React state.

**Camera.** State is `{x, y, zoom}`. `fitToView` computes a bounding box over the *focus* set (which narrows as you drill) and animates there over 450 ms with an `easeInOutCubic`; the padding is proportional to the viewport (`min(w,h) · 0.18`, clamped 40–160) because a fixed 160 units on a phone is most of the screen and the fit zooms out too far to read. `cameraRef` mirrors `camera` so the animation reads the current value synchronously instead of waiting for React's next commit — a real bug that was caught and commented. `prefers-reduced-motion: reduce` makes the camera jump instead of fly, and freezes the pulse.

**Pointer input** is Pointer Events on a `touch-action: none` canvas — without it the browser would treat a one-finger drag as page scroll and a two-finger spread as page pinch-zoom, and the handlers would never run. One finger or the mouse pans; two fingers pinch about their midpoint, keeping the world point under the spread fixed (`onPointerMove`, `:560`). A 3px drag threshold distinguishes drag from click on desktop and 10px on touch, because taps tremble and drags don't. Releasing a second finger clears the pinch state so a pinch can't also fire a tap.

**Hover** is a cursor affordance only — the hover branch returns early on coarse pointers, since a finger has no hover state. The tooltip Card shows `nwo`, blurb clamped to two lines, and lang / stars / forks / last push with a health dot, clamped to the container edges.

**Hit-testing** is a linear scan over visible nodes with `radius + hitSlop` padding, plus the overflow circles. `hitSlop` is 3px with a pointer and 12px on touch (`:18`), which is what makes a repo you aimed at approximately still tappable. Cheap, correct at 200–250 nodes.

**Keyboard.** The canvas is `tabIndex={0}` with a `role="img"` label that states the current view and the key contract, and it owns a node cursor:

| Key | Action |
|---|---|
| `ArrowLeft`/`Up`, `ArrowRight`/`Down` | Walk the cursor backwards/forwards through every visible node except the root, wrapping. At root that's hubs and leaves — the set a keyboard user actually starts in. |
| `Enter` / `Space` | Descend: hub → its view, leaf → its repos, repo → open on GitHub. |
| `+` / `-`, `0` | Zoom by 1.3×, fit to view. |

The cursor is *drawn*, not just logically present: a dashed accent ring at `radius + 4`, distinct from the solid ring on a selected repo, and it survives the mouse (hover and cursor can both be active). It also borrows the hover affordances — its label always draws, its incident associative edges highlight in accent, and it recedes nothing. Each move writes to an `aria-live="polite"` region: repos announce `nwo, health state, N stars` and select themselves; hubs and leaves announce `label, kind, N repos. Press Enter to open.` The cursor resets when the path changes, so it never points at a node that just left the screen.

`Enter` is a shared key: `App.tsx` opens the selected repo on Enter at window level, which would have made two tabs from one press. The canvas marks the event (`starmapEnterHandled`, `GraphView.tsx:709`) and the app-level handler stands down when it sees the mark. One keypress, one owner.

**Touch chrome.** The legend starts collapsed on coarse pointers — twelve hubs are taller than a phone screen and 220px of a 390px viewport is most of the map — with a `show`/`hide` button carrying `aria-expanded`, and it scrolls when open (`max-h-[50%]`). Zoom controls are 40px on touch, 32px from `sm` up, since `size="icon"` is a poor thumb target and they're the only zoom affordance on glass. The desktop gesture hint (`scroll to zoom · drag to pan · …`) is `hidden sm:block`: on a phone the gestures are the obvious ones and that string would be the widest element on screen.

**`+N more`** calls `onOpenList(leafPath)` to jump to the List view for that leaf.

## List (`ListView.tsx`)

Dense table over the same filtered set, and the view a touch device cold-opens on (see [Which view you land on](#which-view-you-land-on)). Filter chain: `repos → path-filtered → search-hit-filtered → language facet → health facet → sort`. Sorts: stars (default), last push, recently starred, name.

**Rows are windowed.** `ROW_HEIGHT = 33` with `OVERSCAN = 8`, two spacer `<tr>`s carrying the off-screen height, a passive scroll listener. A fork with thousands of stars would otherwise build thousands of table rows on a phone that can show a dozen. Fixed row height is the trade: it keeps the arithmetic to a division, so rows are uniform by design.

**Columns collapse with width** rather than overflowing horizontally: language hides below `sm`, pushed-date below `md`, blurb below `lg`. The header row is sticky, and rows are `tabIndex={0}` — Enter or Space selects — so the table is operable without a mouse. Facets are `Select` dropdowns; the language options are built from the currently searched set, so it never offers a language you can't see. `path` filtering matches `cat.some(c => c.startsWith("hub/"))` at depth 1 and `cat.includes("hub/leaf")` at depth 2, so a repo with multiple categories appears under all of them in the list even though it lives under one leaf in the graph.

## Timeline (`Timeline.tsx`)

Bars of stars per month, derived from `starred_at` across all shards — client-side aggregation over the loaded records, not `history.json`. Hover highlights a month and shows `YYYY-MM · N stars` in the header slot. Reveals phases of interest; useful for "I went through a Rust phase in 2024".

## Graveyard (`Graveyard.tsx`)

Archived + dead only, by reusing `ListView` with `repos.filter(r => r.health.state === "archived" || r.health.state === "dead")`, an empty path, and `searchHitIds={null}`. Note this means typing in the search box does nothing on this view — the header box is global but Graveyard ignores it, which reads as broken search if you try it here. The highest-value page in the app: it's the answer to "should I still be depending on this?"

## Repo panel (`RepoPanel.tsx`)

A Radix `Sheet` from the right, opened by any selection. The overlay is transparent by design so the canvas stays visible while the panel is open. `onPointerDownOutside` / `onInteractOutside` are prevented so tapping a node doesn't close-and-reopen behind it — the ✕, `Esc`, or selecting another repo are the ways to move. The close button is 44px on touch and sits clear of the title, which reserves `pr-11` so a long `nwo` never runs underneath it.

Content: title, blurb, Open on GitHub, a 2-column stat grid (stars, forks, lang, license, health with dot, pushed, starred), categories as mono badges, topics as outline badges, homepage link. The bottom block is **related** — the panel filters `graph.edges` for associative edges incident on this repo, sorts by weight, and lists up to 20. Clicking a related repo calls the same `pickSearchResult` handler the search dropdown uses, so it navigates to that repo's leaf and re-selects. The panel *is* the graph's second navigation surface.

## App shell states

The shell renders three non-view states rather than a blank page (`App.tsx:270`):

- **Loading** — `meta.json` or `graph.json` in flight.
- **Error** — either failed: the failing path and message in mono, a hint to run `npm run sync` (or check the nightly build on a fork), and a Retry button that reloads. Without data there is nothing to view, so this is a dead end by design; the old behaviour was a white screen.
- **Degraded** — `search.json` failed but the data loaded: a `search off` badge in the header, and the search box simply stops returning results. Everything else works, so nothing else is blocked. A `rules-only` badge appears the same way when `meta.llm_degraded` is set.

The header wraps to two rows on a phone (title and badges on the first, tabs and search on a full-width second) using flex `order` so desktop reads in the natural left-to-right order, and the breadcrumb row scrolls horizontally with 32px touch targets. The shell is `h-[100dvh]`, not `h-screen`, so a collapsing URL bar on mobile doesn't push the bottom controls off-screen.
