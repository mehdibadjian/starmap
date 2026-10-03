# Output Data Format

`npm run sync` writes everything the site needs into `public/data/`, which Vite copies into `dist/` at build time. The directory is gitignored — a build artifact, not source.

```
data/
  meta.json             # header info + how to find the rest
  repos/000.json …      # shards of ~500 repo records
  search.json           # prebuilt MiniSearch index
  graph.json            # nodes (with coordinates) + pruned edges
  history.json          # daily totals for the timeline
```

## `meta.json`

Written first in importance: the client reads it to know how many shards to load.

```json
{
  "login": "mb",
  "title": "Starmap",
  "theme": "dark",
  "total": 1204,
  "last_sync": "2026-10-01T22:09:07.455Z",
  "taxonomy_version": 1,
  "unsorted_pct": 6.2,
  "shard_count": 3,
  "shard_size": 500,
  "llm_degraded": true
}
```

| Field | Meaning |
|---|---|
| `login`, `title`, `theme` | From `config.yml`; the only place the account name reaches the UI. `login` is also the merge-baseline guard — see [Data Pipeline](Data-Pipeline.md). |
| `total` | Repo count after merge. Shown as the header badge. |
| `last_sync` | ISO timestamp of this build; shown as `synced YYYY-MM-DD`. |
| `taxonomy_version` | From `taxonomy.json`. |
| `unsorted_pct` | Share of repos in `misc/other` or with no category, to one decimal. The M3 target is under 10. |
| `shard_count`, `shard_size` | Drives shard loading and reassembly of the baseline. |
| `llm_degraded` | `true` when no `ANTHROPIC_API_KEY` or any LLM batch failed → renders the `rules-only` badge. |

## `repos/NNN.json`

Array of `RepoRecord`, `SHARD_SIZE = 500` per file, zero-padded names (`000.json`, `001.json`, …). Records are sorted newest-starred first.

The client does not trust these files blindly. `isUsableRepo` in `src/lib/data.ts` drops any row missing a numeric `id`, a string `nwo`, string-array `cat`/`topics`/`tags`, or a `health.state`, before the views ever see it — one malformed record from a partial or hand-edited publish would otherwise throw inside `ListView`'s filter and blank the site. A shard whose rows are all valid is untouched, so this costs nothing in the normal case.

```json
{
  "id": 28457823, "nwo": "owner/name", "desc": "…", "lang": "TypeScript",
  "topics": ["cli", "developer-tools"], "stars": 12043, "forks": 812,
  "license": "MIT", "archived": false, "is_fork": false,
  "pushed_at": "2026-03-14", "created_at": "2019-02-01", "starred_at": "2024-11-02",
  "homepage": "https://…", "cat": ["devtools/cli"], "tags": ["rust", "terminal", "tui"],
  "blurb": "Normalized one-liner, ≤90 chars", "health": { "stale_days": 512, "state": "stale" }
}
```

Dates are `YYYY-MM-DD`; the UI shows them with `.slice(0, 10)`, so full ISO timestamps from the API would render fine too.

## `search.json`

A serialized `MiniSearch` index (`mini.addAll(docs)` then `JSON.stringify`). Built over shadow fields:

```ts
fields: ["nwo", "desc", "blurb", "topicsText", "tagsText"]
storeFields: ["nwo", "stars", "lang", "cat", "tags", "health", "archived", "pushed_at", "blurb"]
```

The `topicsText`/`tagsText` copies exist because MiniSearch tokenizes on spaces — joining arrays into strings is what makes individual topics and tags searchable. Shadowing rather than a custom `extractField` matters: field extraction also runs for stored fields, so joining `topics`/`tags` in place would flatten those real arrays into strings in the results. `cat` and `health` therefore stay genuine arrays and objects.

**The field list is a published contract, not just an indexing detail.** `toJSON()` writes the build-time field-name → field-id map into the payload, and `loadJSON` restores `_fieldIds` *from that payload* — the options the client passes in do not rebuild it. Query-time lookups go through that restored map, so if the client lists a field name the builder didn't use, that field resolves to `undefined`, contributes nothing, and reports no error whatever. A `topics`/`tags` mismatch on a deployed site looks like "this repo just isn't tagged well", not like a broken index.

So both sides import one definition from `shared/searchSchema.ts`:

| Export | Used by |
|---|---|
| `SEARCH_FIELDS` / `SEARCH_STORE_FIELDS` | the shadow-field contract above |
| `SEARCH_OPTIONS` | `pipeline/buildIndex.ts` (index) **and** `src/lib/search.ts` (`loadJSON`) |
| `SEARCH_BOOST` / `SEARCH_QUERY_OPTIONS` | `search()` at query time — `prefix: true`, `fuzzy: 0.2`, `nwo` ×3, `tagsText` ×2 |

Boosts are built from the *indexer's* field names, which is another way the mismatch used to be invisible: `boost: { tags: 2 }` targeted a field the index never had, so it did nothing even when tags matched through another field. Changing a field name now means changing it in one file, and `tests/search.test.ts` asserts a term present only in `topics` still hits after a real serialize → rehydrate → query round trip.

## `graph.json`

```json
{
  "nodes": [
    { "id": "hub:devtools", "kind": "hub", "label": "Devtools", "parent": "root", "count": 218, "x": -140.2, "y": 62.4 },
    { "id": "repo:28457823", "kind": "repo", "label": "owner/name", "parent": "leaf:devtools/cli", "x": -151.4, "y": 74.0 }
  ],
  "edges": [
    { "s": "leaf:devtools/cli", "t": "repo:28457823", "kind": "struct" },
    { "s": "repo:28457823", "t": "repo:9912004", "kind": "assoc", "w": 0.42 }
  ]
}
```

Repo nodes carry no metadata — the client joins them against shard data by `repo:` id. Shape details in [Graph Construction](Graph-Construction.md).

## `history.json`

`[{ "date": "2026-10-01", "total": 1204, "added": 7, "removed": 0 }]`, one entry per day, appended each run with any existing entry for today replaced.

Two things to know: it is **not** committed, so it survives only by being scraped off the live site at the start of the next run — a failed baseline fetch silently restarts it from one entry. And no UI consumes it yet; `fetchHistory()` in `src/lib/data.ts` is currently unused because the Timeline view aggregates `starred_at` from the shards instead.

## Reading order in the browser

`meta.json` + `graph.json` + `search.json` load immediately on mount; repo shards then load sequentially during `requestIdleCallback`, each batch appended to state so the graph is interactive before the list is complete. `shard_count` in `meta.json` must match the files actually published, which it does — both are written in the same run.
