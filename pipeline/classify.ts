import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import type { RawStar } from "./fetch.js";
import type { ClassificationCache, ClassificationCacheEntry, Config, Taxonomy } from "./types.js";
import { leafIds, matchRules, UNSORTED } from "./taxonomyRules.js";

const BATCH_SIZE = 25;
const CLASSIFY_MODEL = "claude-opus-5";

export function hashFor(desc: string | null, topics: string[]): string {
  return createHash("sha1").update(`${desc ?? ""}\n${topics.join(",")}`).digest("hex");
}

interface CacheFile {
  taxonomy_version: number;
  entries: ClassificationCache;
}

/**
 * Bumping taxonomy.json's version invalidates the whole cache — otherwise a
 * renamed or removed leaf would leave stale category IDs classified against
 * a taxonomy that no longer exists.
 */
export async function loadCache(path: string, taxonomyVersion: number): Promise<ClassificationCache> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as CacheFile;
    if (parsed.taxonomy_version !== taxonomyVersion) return {};
    return parsed.entries;
  } catch {
    return {};
  }
}

export async function saveCache(path: string, cache: ClassificationCache, taxonomyVersion: number): Promise<void> {
  const file: CacheFile = { taxonomy_version: taxonomyVersion, entries: cache };
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
}

function normalizeBlurb(desc: string | null): string {
  const text = (desc ?? "").trim();
  if (!text) return "No description provided.";
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function ruleClassify(raw: RawStar, taxonomy: Taxonomy): ClassificationCacheEntry {
  return {
    id: raw.id,
    hash: hashFor(raw.desc, raw.topics),
    cat: matchRules(taxonomy, raw.topics, raw.lang),
    tags: raw.topics.slice(0, 6).map((t) => t.toLowerCase()),
    blurb: normalizeBlurb(raw.desc),
    source: "rules",
  };
}

const LLM_TOOL_NAME = "classify_repos";

function buildLlmTool(allowedLeaves: string[]) {
  return {
    name: LLM_TOOL_NAME,
    description: "Return the classification for each repo in the batch.",
    input_schema: {
      type: "object" as const,
      properties: {
        results: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              id: { type: "integer" as const },
              cat: {
                type: "array" as const,
                items: { type: "string" as const, enum: allowedLeaves },
                minItems: 1,
                maxItems: 3,
              },
              tags: {
                type: "array" as const,
                items: { type: "string" as const },
                maxItems: 6,
              },
              blurb: { type: "string" as const, description: "Normalized one-liner, <=90 chars" },
            },
            required: ["id", "cat", "tags", "blurb"],
            additionalProperties: false,
          },
        },
      },
      required: ["results"],
      additionalProperties: false,
    },
  };
}

async function llmClassifyBatch(
  client: Anthropic,
  batch: RawStar[],
  allowedLeaves: string[],
): Promise<Map<number, { cat: string[]; tags: string[]; blurb: string }>> {
  const prompt = batch
    .map((r) => `id=${r.id} nwo=${r.nwo} lang=${r.lang ?? "?"} topics=[${r.topics.join(",")}] desc=${r.desc ?? ""}`)
    .join("\n");

  const response = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 4096,
    output_config: { effort: "low" },
    tools: [buildLlmTool(allowedLeaves)],
    tool_choice: { type: "tool", name: LLM_TOOL_NAME },
    messages: [
      {
        role: "user",
        content:
          "Classify each GitHub repo below into 1-3 leaf categories from the allowed taxonomy list, " +
          "pick up to 6 short lowercase tags, and write a normalized one-line blurb (<=90 chars). " +
          "Never invent a category outside the allowed list.\n\n" + prompt,
      },
    ],
  });

  const results = new Map<number, { cat: string[]; tags: string[]; blurb: string }>();
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === LLM_TOOL_NAME) {
      const input = block.input as { results: Array<{ id: number; cat: string[]; tags: string[]; blurb: string }> };
      for (const r of input.results) {
        results.set(r.id, { cat: r.cat, tags: r.tags, blurb: r.blurb });
      }
    }
  }
  return results;
}

export interface ClassifyResult {
  cache: ClassificationCache;
  llmUsed: boolean;
  llmFailed: boolean;
}

export async function classifyAll(
  raws: RawStar[],
  taxonomy: Taxonomy,
  cache: ClassificationCache,
  classifierMode: Config["classifier"],
): Promise<ClassifyResult> {
  const next: ClassificationCache = { ...cache };
  const needsClassify: RawStar[] = [];

  for (const raw of raws) {
    const hash = hashFor(raw.desc, raw.topics);
    const existing = cache[String(raw.id)];
    if (existing && existing.hash === hash) {
      next[String(raw.id)] = existing;
      continue;
    }
    next[String(raw.id)] = ruleClassify(raw, taxonomy);
    needsClassify.push(raw);
  }

  const wantsLlm = classifierMode === "auto" || classifierMode === "llm";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!wantsLlm || !apiKey || needsClassify.length === 0) {
    return { cache: next, llmUsed: false, llmFailed: false };
  }

  const client = new Anthropic({ apiKey });
  const allowedLeaves = leafIds(taxonomy).concat(UNSORTED);
  let llmFailed = false;

  for (let i = 0; i < needsClassify.length; i += BATCH_SIZE) {
    const batch = needsClassify.slice(i, i + BATCH_SIZE);
    try {
      const results = await llmClassifyBatch(client, batch, allowedLeaves);
      for (const raw of batch) {
        const llmResult = results.get(raw.id);
        if (!llmResult) continue;
        next[String(raw.id)] = {
          id: raw.id,
          hash: hashFor(raw.desc, raw.topics),
          cat: llmResult.cat,
          tags: llmResult.tags,
          blurb: llmResult.blurb,
          source: "llm",
        };
      }
    } catch (err) {
      llmFailed = true;
      console.warn(`LLM classification batch failed, keeping rules-tier results: ${(err as Error).message}`);
    }
  }

  return { cache: next, llmUsed: true, llmFailed };
}
