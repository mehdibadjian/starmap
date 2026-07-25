import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import type { Config } from "./types.js";

export async function loadConfig(path = "config.yml"): Promise<Config> {
  const raw = await readFile(path, "utf-8");
  const parsed = yaml.load(raw) as Partial<Config>;

  if (!parsed.login) {
    throw new Error(`config.yml is missing required field "login"`);
  }

  return {
    login: parsed.login,
    title: parsed.title ?? "Starmap",
    theme: parsed.theme ?? "dark",
    taxonomy: parsed.taxonomy ?? "default",
    classifier: parsed.classifier ?? "auto",
    schedule: parsed.schedule ?? "0 18 * * *",
    exclude_forks: parsed.exclude_forks ?? false,
  };
}

export function taxonomyPath(config: Config): string {
  return config.taxonomy === "default" ? "taxonomy.json" : config.taxonomy;
}
