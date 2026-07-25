import type { RawStar } from "./fetch.js";
import { computeHealth } from "./health.js";
import type { ClassificationCacheEntry, RepoRecord } from "./types.js";

export function enrichRepo(raw: RawStar, classification: ClassificationCacheEntry): RepoRecord {
  return {
    id: raw.id,
    nwo: raw.nwo,
    desc: raw.desc,
    lang: raw.lang,
    topics: raw.topics,
    stars: raw.stars,
    forks: raw.forks,
    license: raw.license,
    archived: raw.archived,
    is_fork: raw.is_fork,
    pushed_at: raw.pushed_at,
    created_at: raw.created_at,
    starred_at: raw.starred_at,
    homepage: raw.homepage,
    cat: classification.cat,
    tags: classification.tags,
    blurb: classification.blurb,
    health: computeHealth(raw.pushed_at, raw.archived),
  };
}
