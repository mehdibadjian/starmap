import { Octokit } from "@octokit/rest";

export interface RawStar {
  id: number;
  nwo: string;
  desc: string | null;
  lang: string | null;
  topics: string[];
  stars: number;
  forks: number;
  license: string | null;
  archived: boolean;
  is_fork: boolean;
  pushed_at: string;
  created_at: string;
  starred_at: string;
  homepage: string | null;
}

interface FetchOptions {
  login: string;
  token: string;
  /** Repo IDs already known from a previous run (from the classification cache). */
  knownIds: Set<number>;
  /** Full pass walks every page to detect unstars; incremental stops at the first known repo. */
  full: boolean;
  excludeForks: boolean;
}

const MAX_RETRIES = 5;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const retryable = status === 403 || status === 429 || status === 502 || status === 503;
      if (!retryable || attempt >= MAX_RETRIES) throw err;
      const delayMs = 2 ** attempt * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
}

export async function fetchStars({ login, token, knownIds, full, excludeForks }: FetchOptions): Promise<RawStar[]> {
  const octokit = new Octokit({ auth: token });
  const results: RawStar[] = [];
  let page = 1;

  for (;;) {
    const response = await withRetry(() =>
      octokit.request("GET /users/{username}/starred", {
        username: login,
        per_page: 100,
        page,
        headers: { accept: "application/vnd.github.star+json" },
      }),
    );

    const batch = response.data as unknown as Array<{ starred_at: string; repo: any }>;
    if (batch.length === 0) break;

    let hitKnown = false;
    for (const { starred_at, repo } of batch) {
      if (excludeForks && repo.fork) continue;

      if (!full && knownIds.has(repo.id)) {
        hitKnown = true;
        break;
      }

      results.push({
        id: repo.id,
        nwo: repo.full_name,
        desc: repo.description,
        lang: repo.language,
        topics: repo.topics ?? [],
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        license: repo.license?.spdx_id ?? null,
        archived: repo.archived,
        is_fork: repo.fork,
        pushed_at: repo.pushed_at,
        created_at: repo.created_at,
        starred_at,
        homepage: repo.homepage || null,
      });
    }

    if (hitKnown || batch.length < 100) break;
    page += 1;
  }

  return results;
}

export function shouldRunFullPass(now = new Date(), force = false): boolean {
  return force || now.getUTCDay() === 0;
}
