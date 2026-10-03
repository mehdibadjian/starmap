import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, GitFork, Network, Rows3, Skull, Star } from "lucide-react";
import { fetchGraph, fetchMeta, fetchSearchIndexRaw, loadAllRepos } from "./lib/data";
import { loadSearchIndex, search } from "./lib/search";
import { unsortedBadge, unsortedHint } from "./lib/metaBadges";
import { defaultView, rememberView, storedView } from "./lib/viewPref";
import { buildHash, parseHash } from "./lib/url";
import type { AppState, GraphData, MetaJson, RepoRecord, View } from "./lib/types";
import GraphView from "./components/GraphView";
import ListView from "./components/ListView";
import Timeline from "./components/Timeline";
import Graveyard from "./components/Graveyard";
import RepoPanel from "./components/RepoPanel";
import SearchBox from "./components/SearchBox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VIEWS: { id: View; label: string; icon: typeof Network }[] = [
  { id: "graph", label: "Graph", icon: Network },
  { id: "list", label: "List", icon: Rows3 },
  { id: "timeline", label: "Timeline", icon: Star },
  { id: "graveyard", label: "Graveyard", icon: Skull },
];

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/**
 * What an unnamed home (`#/`) means in this browser: the last view the user
 * chose, or this device's default if they never chose one. Consulted on every
 * hash read, so a back/forward to a bare `#/` stays consistent within a session.
 */
function homeView(): View {
  return storedView() ?? defaultView();
}

export default function App() {
  const [meta, setMeta] = useState<MetaJson | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [searchReady, setSearchReady] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppState>(() => parseHash(window.location.hash, homeView()));
  const searchInputRef = useRef<HTMLInputElement>(null);

  const reposById = useMemo(() => {
    const map = new Map<number, RepoRecord>();
    for (const r of repos) map.set(r.id, r);
    return map;
  }, [repos]);

  // Initial load: graph + search index first (perf budget), repo shards during idle time.
  useEffect(() => {
    fetchMeta()
      .then((m) => {
        setMeta(m);
        const root = document.documentElement;
        root.classList.remove("dark", "light");
        root.classList.add(m.theme);
      })
      .catch((err: Error) => setLoadError(`Could not load data/meta.json — ${err.message}`));
    fetchGraph()
      .then(setGraph)
      .catch((err: Error) => setLoadError(`Could not load data/graph.json — ${err.message}`));
    // A missing search index degrades the app rather than breaking it: the map
    // and every view still render, only the search box stops finding things.
    fetchSearchIndexRaw()
      .then(loadSearchIndex)
      .then(() => setSearchReady(true))
      .catch(() => setSearchUnavailable(true));
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
    const onHashChange = () => setAppState(parseHash(window.location.hash, homeView()));
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

  /**
   * Change view, and record it as this browser's stored preference.
   *
   * Both the tabs and the `l` toggle go through here, so a choice made by hand is
   * the choice honoured next time — there is no second path into `view` that
   * could skip the write while still looking like it worked.
   */
  const selectView = useCallback(
    (view: View) => {
      rememberView(view);
      navigate({ view });
    },
    [navigate],
  );

  const searchHitIds = useMemo(() => {
    if (!searchReady || !appState.query.trim()) return null;
    return new Set(search(appState.query, 500).map((h) => h.id));
  }, [searchReady, appState.query]);

  const searchDropdownResults = useMemo(() => {
    if (!searchReady || !appState.query.trim()) return [];
    return search(appState.query, 8);
  }, [searchReady, appState.query]);

  const pickSearchResult = useCallback(
    (id: number) => {
      const repo = reposById.get(id);
      navigate({ selected: String(id), path: repo?.cat[0] ? repo.cat[0].split("/") : appState.path });
    },
    [reposById, navigate, appState.path],
  );

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
        selectView(appState.view === "list" ? "graph" : "list");
      } else if (e.key === "Enter" && appState.selected) {
        // GraphView claims Enter on the canvas itself (arrow-key cursor). It
        // marks the event so this window-level handler doesn't open a second tab.
        if ((e as KeyboardEvent & { starmapEnterHandled?: boolean }).starmapEnterHandled) return;
        const repo = reposById.get(Number(appState.selected));
        if (repo) window.open(`https://github.com/${repo.nwo}`, "_blank");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [appState, navigate, reposById, selectView]);

  const selectedRepo = appState.selected ? reposById.get(Number(appState.selected)) ?? null : null;

  // Derived once: the badge is shown only when there is something to show, so
  // the condition and the label cannot drift apart.
  const uncategorised = meta ? unsortedBadge(meta.unsorted_pct) : null;

  const breadcrumb = ["Home", ...appState.path];
  const showBreadcrumb = appState.view === "graph" || appState.view === "list";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-[100dvh] flex-col bg-background text-foreground">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-2 sm:px-4">
          <div className="order-1 flex min-w-0 items-center gap-1.5 font-mono text-sm font-semibold">
            <Star className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{meta?.title ?? "Starmap"}</span>
          </div>

          {/* On a phone the nav and search drop to their own row so neither is
              squeezed into 20% of the width; on desktop they join the header. */}
          <div className="order-3 flex w-full items-center gap-2 sm:order-2 sm:w-auto">
            <Tabs value={appState.view} onValueChange={(v) => selectView(v as View)}>
              <TabsList className="h-9 shrink-0 sm:h-8">
                {VIEWS.map((v) => (
                  <TabsTrigger key={v.id} value={v.id} className="gap-1.5 px-2 sm:px-2.5" aria-label={v.label}>
                    <v.icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    <span className="hidden sm:inline">{v.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <SearchBox
              ref={searchInputRef}
              value={appState.query}
              onChange={(query) => navigate({ query })}
              results={searchDropdownResults}
              totalResults={searchHitIds?.size}
              onPick={pickSearchResult}
            />
          </div>

          <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
            {searchUnavailable && (
              <Badge variant="outline" title="Search index failed to load; the views below still work.">
                search off
              </Badge>
            )}
            {meta?.llm_degraded && (
              <Badge variant="outline" title="LLM classification unavailable; using rules-only categories.">
                rules-only
              </Badge>
            )}
            {meta && uncategorised && (
              // The M3 metric used to be a `meta.json` field nobody could see
              // while the site quietly filed most stars into `misc / other`.
              <Badge variant="outline" className="font-mono" title={unsortedHint(meta.unsorted_pct)}>
                {uncategorised}
              </Badge>
            )}
            {meta && (
              <Badge variant="muted" className="gap-1 font-mono">
                <GitFork className="h-3 w-3" />
                {meta.total.toLocaleString()}
              </Badge>
            )}
            {meta && (
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                synced {meta.last_sync.slice(0, 10)}
              </span>
            )}
          </div>
        </header>

        {showBreadcrumb && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card/60 px-3 py-1 font-mono text-xs text-muted-foreground sm:px-4 sm:py-1.5">
            {breadcrumb.map((seg, i) => (
              <span key={i} className="flex shrink-0 items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3" />}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 min-w-[28px] px-1.5 font-mono text-xs text-muted-foreground hover:text-primary sm:h-6",
                    i === breadcrumb.length - 1 && "text-foreground",
                  )}
                  onClick={() => navigate({ path: appState.path.slice(0, i) })}
                >
                  {seg}
                </Button>
              </span>
            ))}
          </div>
        )}

        <main className="relative min-h-0 flex-1">
          {loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="font-mono text-sm text-destructive">{loadError}</p>
              <p className="max-w-md text-xs text-muted-foreground">
                This site reads only static files from <code className="font-mono">data/</code>. If it was built
                locally, run <code className="font-mono">npm run sync</code> and refresh; on a fork, check that the
                nightly build succeeded and that Pages is serving the latest deployment.
              </p>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          ) : !graph || !meta ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              Loading…
            </div>
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
            <Timeline repos={repos} />
          ) : (
            <Graveyard repos={repos} onSelect={(id) => navigate({ selected: String(id) })} />
          )}
          <RepoPanel
            repo={selectedRepo}
            graph={graph}
            reposById={reposById}
            onClose={() => navigate({ selected: null })}
            onSelectRelated={pickSearchResult}
          />
        </main>
      </div>
    </TooltipProvider>
  );
}
