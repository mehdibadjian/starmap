# Classification and Taxonomy

Classification answers one question per repo: which taxonomy leaves does it belong to, what tags describe it, and what one-line blurb should the UI show? It runs in two tiers so the project works with zero secrets.

## Tier 1 — rules (always on, free, deterministic)

`pipeline/taxonomyRules.ts` scores every leaf in the taxonomy against the repo's GitHub topics and primary language:

- `+2` for each of the leaf's declared `topics` present on the repo
- `+1` if the repo's language appears in the leaf's optional `langs`
- the single highest-scoring leaf above zero wins; otherwise `misc/other`

One category out of a possible several, and it never invents anything. Coverage is roughly 60–70% on well-tagged repos; anything with no topics and a one-word description lands in `unsorted`. That floor is accepted, not a bug.

The rules tier also produces tags — the first six GitHub topics, lowercased — and a blurb, which is the repo description trimmed to 90 characters (`…` on truncation), or `No description provided.` when empty.

## Tier 2 — LLM (opt-in, better on sparse repos)

Enabled when `classifier` is `auto` or `llm` **and** `ANTHROPIC_API_KEY` is present. Only records whose cache hash missed are sent, in batches of 25 (`BATCH_SIZE`), with a compact prompt line per repo:

```
id=… nwo=… lang=… topics=[…] desc=…
```

The model must answer through a forced tool call (`classify_repos`), and the tool schema constrains `cat[]` to `enum: [...every leaf id..., "misc/other"]` with 1–3 items, `tags[]` to at most 6, plus `blurb`. **The model cannot invent a category** — this is the guard against taxonomy drift, the failure mode where an unpinned LLM produces `devtools-cli`, `devtools/cli`, and `cli-tools` as three live buckets.

A batch that throws is caught: that batch keeps its rules-tier result, `llmFailed` is set, and the run logs a warning instead of failing. `llmDegraded` (no key, or any batch failure) is published in `meta.json` and surfaces as the `rules-only` badge in the site header.

## The cache

`cache/classifications.json`:

```json
{ "taxonomy_version": 1, "entries": { "28457823": { "id": 28457823, "hash": "…", "cat": ["devtools/cli"], "tags": ["cli","tui"], "blurb": "…", "source": "rules" } } }
```

The key is the repo ID; `hash` is `sha1(desc + "\n" + topics.join(","))`. A record is reused only when both the ID is known and the hash matches, so editing a description or its topics re-classifies just that repo. `source` records which tier produced it.

Two invalidations:

- **Per-entry:** hash mismatch (content changed).
- **Global:** `loadCache` returns `{}` when the file's `taxonomy_version` differs from `taxonomy.json`'s. Bump `version` to force a full reclassification after renaming or removing a leaf, otherwise stale category IDs point at a taxonomy that no longer exists and the tree becomes noise.

This file is committed back by the workflow every run. It is the reason the LLM backlog is a one-off cost rather than a nightly one.

## Taxonomy shape

`taxonomy.json` (default, `version: 1`) is 12 roots and 55 leaves:

`ai-ml` (6), `devtools` (6), `web` (5), `backend` (5), `data` (5), `infra-devops` (5), `security` (5), `mobile-desktop` (3), `languages-compilers` (4), `learning-reference` (4), `design-media` (3), `misc` (4).

Leaf IDs are `root/leaf` strings — `devtools/cli`, `ai-ml/llm-tooling` — and that string is simultaneously the facet value in the data, the graph node ID (`leaf:devtools/cli`), and a URL path segment (`#/devtools/cli`). The frontend derives breadcrumbs from it by splitting on `/`.

Point `config.yml`'s `taxonomy` at your own file to fork the tree. Two hard requirements: keep `misc/other` (it is the fallback for unmatched repos and for a repo with no categories when building graph edges), and bump `version` whenever leaf IDs change.

## Changing the classifier mode

| `classifier` | Behaviour |
|---|---|
| `auto` (default) | rules first, then LLM for cache misses if a key exists |
| `rules` | never calls the API, even with a key present |
| `llm` | attempts LLM for every miss; falls back to rules per batch on failure |
