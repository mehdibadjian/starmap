/**
 * Single source of truth for the MiniSearch schema, imported by both the
 * build-time indexer (`pipeline/buildIndex.ts`) and the browser client
 * (`src/lib/search.ts`).
 *
 * A serialized MiniSearch index carries its own field-name → field-id map, and
 * `loadJSON` restores that map from the payload rather than from the options
 * passed in. So if the two sides disagree about a field name, the name only
 * the client knows resolves to `undefined` at query time and that field
 * contributes no matches — silently, with no error and no console warning.
 * Duplicating the list across the boundary is what caused topic and tag search
 * to stop working; sharing one list makes the divergence unrepresentable.
 */
export const SEARCH_ID_FIELD = "id";

/**
 * `topicsText`/`tagsText` shadow the real `topics`/`tags` arrays.
 *
 * MiniSearch tokenizes on whitespace, so arrays must be joined to become
 * searchable. It also runs field extraction over `storeFields`, which means
 * joining `topics`/`tags` in place would collapse those arrays into strings in
 * the results the UI reads — `ListView`'s facets and `RepoPanel`'s badges both
 * expect arrays. Indexing the copies keeps the originals intact.
 */
export const SEARCH_FIELDS = ["nwo", "desc", "blurb", "topicsText", "tagsText"];

export const SEARCH_STORE_FIELDS = [
  "nwo",
  "stars",
  "lang",
  "cat",
  "tags",
  "health",
  "archived",
  "pushed_at",
  "blurb",
];

export const SEARCH_OPTIONS = {
  idField: SEARCH_ID_FIELD,
  fields: SEARCH_FIELDS,
  storeFields: SEARCH_STORE_FIELDS,
};

/** Query-time weighting: a repo-name hit outranks a tag hit, which outranks prose. */
export const SEARCH_BOOST = { nwo: 3, tagsText: 2 };

/** Query options shared by every surface that calls `search()`. */
export const SEARCH_QUERY_OPTIONS = {
  prefix: true,
  fuzzy: 0.2,
  boost: SEARCH_BOOST,
};
