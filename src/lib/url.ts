import type { AppState, View } from "./types";

const VIEWS: View[] = ["graph", "list", "timeline", "graveyard"];

export function parseHash(hash: string): AppState {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);

  let view: View = "graph";
  let pathSegments = segments;
  if (segments.length > 0 && (VIEWS as string[]).includes(segments[0]) && segments[0] !== "graph") {
    view = segments[0] as View;
    pathSegments = segments.slice(1);
  }

  const params = new URLSearchParams(queryPart ?? "");
  return {
    view,
    path: pathSegments,
    query: params.get("q") ?? "",
    selected: params.get("r") ? params.get("r") : null,
  };
}

export function buildHash(state: AppState): string {
  const prefix = state.view === "graph" ? "" : `${state.view}/`;
  const pathStr = state.path.join("/");
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.selected) params.set("r", state.selected);
  const qs = params.toString();
  return `#/${prefix}${pathStr}${qs ? `?${qs}` : ""}`;
}
