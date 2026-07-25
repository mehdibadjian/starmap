import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchGraph, fetchMeta, fetchSearchIndexRaw, loadAllRepos } from "./lib/data";
import { loadSearchIndex, search } from "./lib/search";
import { buildHash, parseHash } from "./lib/url";
import type { AppState, GraphData, MetaJson, RepoRecord, View } from "./lib/types";
import GraphView from "./components/GraphView";
import ListView from "./components/ListView";
import Timeline from "./components/Timeline";
import Graveyard from "./components/Graveyard";
import RepoPanel from "./components/RepoPanel";
import SearchBox from "./components/SearchBox";

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: "graph", label: "Graph", key: "g" },
  { id: "list", label: "List", key: "l" },
  { id: "timeline", label: "Timeline", key: "t" },
  { id: "graveyard", label: "Graveyard", key: "v" },
];

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export default function App() {
  const [meta, setMeta] = useState<MetaJson | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [searchReady, setSearchReady] = useState(false);
  const [appState, setAppState] = useState<AppState>(() => parseHash(window.location.hash));
  const searchInputRef = useRef<HTMLInputElement>(null);

  const reposById = useMemo(() => {
    const map = new Map<number, RepoRecord>();
    for (const r of repos) map.set(r.id, r);
    return map;
  }, [repos]);

  // Initial load: graph + search index first (perf budget), repo shards during idle time.
  useEffect(() => {
    fetchMeta().then((m) => {
      setMeta(m);
      document.body.classList.remove("dark", "light");
      document.body.classList.add(m.theme);
    });
    fetchGraph().then(setGraph);
    fetchSearchIndexRaw()
      .then(loadSearchIndex)
      .then(() => setSearchReady(true));
  }, []);

  const reposLoadStarted = useRef(false);
  useEffect(() => {
    if (!meta || reposLoadStarted.current) return;
    reposLoadStarted.current = true;
    const seen = new Set<number>();
    loadAllRepos(meta.shard_count, (batch) => {
      const fresh = batch.filter((r) => !seen.has(r.id));
      fresh.forEach((r) => seen.add(r.id));
      if (fresh.length > 0) setRepos((prev) => [...prev, ...fresh]);
    });
  }, [meta]);

  // URL <-> state sync
  useEffect(() => {
    const onHashChange = () => setAppState(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: Partial<AppState>) => {
    setAppState((prev) => {
      const merged = { ...prev, ...next };
      const hash = buildHash(merged);
      if (hash !== window.location.hash) window.history.pushState(null, "", hash);
      return merged;
    });
  }, []);

  const searchHitIds = useMemo(() => {
    if (!searchReady || !appState.query.trim()) return null;
    return new Set(search(appState.query, 500).map((h) => h.id));
  }, [searchReady, appState.query]);

  // Search drives the graph: auto-expand path to the top hit.
  useEffect(() => {
    if (!searchHitIds || searchHitIds.size === 0 || appState.view !== "graph") return;
    const firstId = [...searchHitIds][0];
    const repo = reposById.get(firstId);
    if (repo?.cat[0]) navigate({ path: repo.cat[0].split("/") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchHitIds]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape") {
        if (appState.selected) navigate({ selected: null });
        else if (appState.path.length > 0) navigate({ path: appState.path.slice(0, -1) });
      } else if (e.key === "l") {
        navigate({ view: appState.view === "list" ? "graph" : "list" });
      } else if (e.key === "Enter" && appState.selected) {
        const repo = reposById.get(Number(appState.selected));
        if (repo) window.open(`https://github.com/${repo.nwo}`, "_blank");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [appState, navigate, reposById]);

  const selectedRepo = appState.selected ? reposById.get(Number(appState.selected)) ?? null : null;

  const breadcrumb = ["Home", ...appState.path];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-2">
        <h1 className="font-mono text-sm font-semibold">{meta?.title ?? "Starmap"}</h1>
        <nav className="flex gap-1 text-xs">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`rounded px-2 py-1 ${
                appState.view === v.id ? "bg-accent text-bg" : "text-text-dim hover:bg-surface"
              }`}
              onClick={() => navigate({ view: v.id })}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <SearchBox ref={searchInputRef} value={appState.query} onChange={(query) => navigate({ query })} />
        <div className="ml-auto flex items-center gap-3 font-mono text-[11px] text-text-dim">
          {meta?.llm_degraded && (
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px]" title="LLM classification unavailable; using rules-only categories.">
              rules-only
            </span>
          )}
          {meta && <span>{meta.total.toLocaleString()} repos</span>}
          {meta && <span>synced {meta.last_sync.slice(0, 10)}</span>}
        </div>
      </header>

      {appState.view !== "timeline" && appState.view !== "graveyard" && (
        <div className="flex items-center gap-1 border-b border-border px-4 py-1.5 font-mono text-xs text-text-dim">
          {breadcrumb.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-text-dim">/</span>}
              <button
                className="hover:text-accent"
                onClick={() => navigate({ path: appState.path.slice(0, i) })}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>
      )}

      <main className="relative min-h-0 flex-1">
        {!graph || !meta ? (
          <div className="flex h-full items-center justify-center text-text-dim">Loading…</div>
        ) : appState.view === "graph" ? (
          <GraphView
            graph={graph}
            reposById={reposById}
            path={appState.path}
            searchHitIds={searchHitIds ?? new Set()}
            selectedRepoId={appState.selected ? Number(appState.selected) : null}
            onNavigate={(path) => navigate({ path })}
            onSelect={(id) => navigate({ selected: id === null ? null : String(id) })}
            onOpenList={(leafPath) => navigate({ view: "list", path: leafPath })}
          />
        ) : appState.view === "list" ? (
          <ListView
            repos={repos}
            path={appState.path}
            searchHitIds={searchHitIds}
            onSelect={(id) => navigate({ selected: String(id) })}
          />
        ) : appState.view === "timeline" ? (
          <Timeline repos={repos} onSelectMonth={() => {}} />
        ) : (
          <Graveyard repos={repos} onSelect={(id) => navigate({ selected: String(id) })} />
        )}
        <RepoPanel repo={selectedRepo} onClose={() => navigate({ selected: null })} />
      </main>
    </div>
  );
}
