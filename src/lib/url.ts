import type { AppState, View } from "./types";

const VIEWS: View[] = ["graph", "list", "timeline", "graveyard"];

/**
 * Read the view out of a hash.
 *
 * `homeView` is what an *unnamed* home (`#/`, or `#/?q=…`) means on this device;
 * it defaults to `graph` so the pure round trip keeps its old behaviour and so a
 * `#/` link stays a graph on a desktop.
 *
 * It is deliberately not consulted when the hash drills a path. `#/web/frameworks`
 * names a graph position, and a shared link has to show what its author saw —
 * which is why the phone default for the landing view cannot leak into deep links.
 */
export function parseHash(hash: string, homeView: View = "graph"): AppState {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);

  let view: View = homeView;
  let pathSegments = segments;
  if (segments.length > 0 && (VIEWS as string[]).includes(segments[0]) && segments[0] !== "graph") {
    view = segments[0] as View;
    pathSegments = segments.slice(1);
  } else if (pathSegments.length > 0) {
    view = "graph";
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
