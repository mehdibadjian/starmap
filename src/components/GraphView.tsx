import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Frame, GitFork, Minus, Plus, Star } from "lucide-react";
import type { GraphData, GraphNode, RepoRecord } from "../lib/types";
import { colorForHubIndex, healthColor } from "../lib/palette";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const MAX_VISIBLE_REPOS = 200;
const FLY_DURATION_MS = 450;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface OverflowNode {
  id: string;
  x: number;
  y: number;
  count: number;
  leafId: string;
}

interface Props {
  graph: GraphData;
  reposById: Map<number, RepoRecord>;
  path: string[];
  searchHitIds: Set<number>;
  selectedRepoId: number | null;
  onNavigate: (path: string[]) => void;
  onSelect: (repoId: number | null) => void;
  onOpenList: (leafPath: string[]) => void;
}

function logScale(v: number, base = 1): number {
  return Math.log(v + base);
}

export default function GraphView({
  graph,
  reposById,
  path,
  searchHitIds,
  selectedRepoId,
  onNavigate,
  onSelect,
  onOpenList,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [showAssoc, setShowAssoc] = useState(true);
  const dragState = useRef<{ startX: number; startY: number; camX: number; camY: number; moved: boolean } | null>(
    null,
  );
  const flyRaf = useRef(0);
  // Mirrors `camera` synchronously so flyTo can read the current value
  // immediately — setState's functional updater form only resolves on
  // React's next commit, which is too late for the first animation frame.
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const flyTo = useCallback((target: Camera, duration = FLY_DURATION_MS) => {
    cancelAnimationFrame(flyRaf.current);
    const start = performance.now();
    const from = cameraRef.current;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOutCubic(t);
      const next = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        zoom: from.zoom + (target.zoom - from.zoom) * e,
      };
      cameraRef.current = next;
      setCamera(next);
      if (t < 1) flyRaf.current = requestAnimationFrame(step);
    };
    flyRaf.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(flyRaf.current), []);

  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const n of graph.nodes) {
      if (!n.parent) continue;
      const list = map.get(n.parent) ?? [];
      list.push(n);
      map.set(n.parent, list);
    }
    return map;
  }, [graph]);

  const hubs = useMemo(() => graph.nodes.filter((n) => n.kind === "hub"), [graph]);
  const hubOrder = useMemo(() => hubs.map((n) => n.id), [hubs]);

  const colorForNode = useCallback(
    (node: GraphNode): string => {
      if (node.kind === "root") return "var(--color-text)";
      let current: GraphNode | undefined = node;
      while (current && current.kind !== "hub") {
        current = current.parent ? nodesById.get(current.parent) : undefined;
      }
      if (!current) return "var(--color-text-dim)";
      return colorForHubIndex(hubOrder.indexOf(current.id));
    },
    [nodesById, hubOrder],
  );

  const { visibleNodes, visibleEdges, overflow, focusNodes } = useMemo(() => {
    const visible = new Set<string>(["root", ...hubOrder]);
    const overflowNodes: OverflowNode[] = [];
    // What the camera fits to — narrows as you drill in, so repos aren't
    // dwarfed by the distance back to root and unrelated hubs.
    let focus = new Set<string>(["root", ...hubOrder]);

    if (path[0]) {
      const hubId = `hub:${path[0]}`;
      const leaves = childrenByParent.get(hubId) ?? [];
      for (const leaf of leaves) visible.add(leaf.id);
      focus = new Set([hubId, ...leaves.map((l) => l.id)]);

      if (path[1]) {
        const leafId = `leaf:${path[0]}/${path[1]}`;
        const repos = childrenByParent.get(leafId) ?? [];
        const shown = repos.slice(0, MAX_VISIBLE_REPOS);
        for (const r of shown) visible.add(r.id);
        focus = new Set([leafId, ...shown.map((r) => r.id)]);
        if (repos.length > MAX_VISIBLE_REPOS) {
          const hidden = repos.slice(MAX_VISIBLE_REPOS);
          const avgX = hidden.reduce((s, r) => s + r.x, 0) / hidden.length;
          const avgY = hidden.reduce((s, r) => s + r.y, 0) / hidden.length;
          overflowNodes.push({ id: `more:${leafId}`, x: avgX, y: avgY, count: hidden.length, leafId });
        }
      }
    }

    const edges = graph.edges.filter((e) => visible.has(e.s) && visible.has(e.t));
    const nodes = graph.nodes.filter((n) => visible.has(n.id));
    const focusList = nodes.filter((n) => focus.has(n.id));
    return { visibleNodes: nodes, visibleEdges: edges, overflow: overflowNodes, focusNodes: focusList };
  }, [graph, path, hubOrder, childrenByParent]);

  const fitToView = useCallback(() => {
    const canvas = canvasRef.current;
    const target = focusNodes.length > 0 ? focusNodes : visibleNodes;
    if (!canvas || target.length === 0) return;
    const xs = target.map((n) => n.x);
    const ys = target.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 100);
    const h = Math.max(maxY - minY, 100);
    const rect = canvas.getBoundingClientRect();
    const zoom = Math.min(rect.width / (w + 160), rect.height / (h + 160), 10);
    flyTo({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.max(zoom, 0.05) });
  }, [focusNodes, visibleNodes, flyTo]);

  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.join("/")]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "f" && !isTypingTarget(e.target)) fitToView();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fitToView]);

  const project = useCallback(
    (wx: number, wy: number, rect: DOMRect): [number, number] => [
      rect.width / 2 + (wx - camera.x) * camera.zoom,
      rect.height / 2 + (wy - camera.y) * camera.zoom,
    ],
    [camera],
  );

  const radiusForNode = useCallback(
    (node: GraphNode): number => {
      if (node.kind === "root") return 16;
      if (node.kind === "hub") return 12 + logScale(node.count ?? 0) * 2.5;
      if (node.kind === "leaf") return 7 + logScale(node.count ?? 0) * 1.8;
      const repo = reposById.get(Number(node.id.slice("repo:".length)));
      return 3 + (repo ? logScale(repo.stars) * 1.3 : 0);
    },
    [reposById],
  );

  const hitTest = useCallback(
    (sx: number, sy: number, rect: DOMRect): string | null => {
      let best: { id: string; d: number } | null = null;
      for (const node of visibleNodes) {
        const [px, py] = project(node.x, node.y, rect);
        const r = radiusForNode(node) + 3;
        const d = Math.hypot(px - sx, py - sy);
        if (d <= r && (!best || d < best.d)) best = { id: node.id, d };
      }
      for (const o of overflow) {
        const [px, py] = project(o.x, o.y, rect);
        const d = Math.hypot(px - sx, py - sy);
        if (d <= 14 && (!best || d < best.d)) best = { id: o.id, d };
      }
      return best?.id ?? null;
    },
    [visibleNodes, overflow, project, radiusForNode],
  );

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const pulse = { t: 0 };

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const styles = getComputedStyle(document.documentElement);
      ctx.fillStyle = styles.getPropertyValue("--color-bg").trim() || "#0b0d10";
      ctx.fillRect(0, 0, rect.width, rect.height);

      // edges
      for (const edge of visibleEdges) {
        if (edge.kind === "assoc" && !showAssoc) continue;
        const s = nodesById.get(edge.s);
        const t = nodesById.get(edge.t);
        if (!s || !t) continue;
        const [sx, sy] = project(s.x, s.y, rect);
        const [tx, ty] = project(t.x, t.y, rect);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = edge.kind === "struct" ? "rgba(150,155,165,0.25)" : "rgba(150,155,165,0.12)";
        ctx.lineWidth = edge.kind === "struct" ? 1 : Math.max(0.5, (edge.w ?? 0.2) * 2);
        ctx.stroke();
      }

      const showLabels = camera.zoom > 0.9;
      for (const node of visibleNodes) {
        const [px, py] = project(node.x, node.y, rect);
        const r = radiusForNode(node);
        const isRepo = node.kind === "repo";
        const repoId = isRepo ? Number(node.id.slice("repo:".length)) : null;
        const repo = repoId !== null ? reposById.get(repoId) : undefined;
        const isHit = repoId !== null && searchHitIds.has(repoId);
        const isSelected = repoId !== null && repoId === selectedRepoId;

        let radius = r;
        if (isHit) {
          pulse.t += 0.06;
          radius += Math.sin(pulse.t) * 2 + 2;
        }

        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = colorForNode(node);
        ctx.globalAlpha = node.id === hoverId || isSelected || isHit ? 1 : 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;

        if (repo) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = healthColor(repo.health.state);
          ctx.stroke();
        }
        if (isSelected) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "var(--color-accent)";
          ctx.beginPath();
          ctx.arc(px, py, radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (node.kind !== "repo" && (node.kind === "hub" || node.kind === "leaf" || node.kind === "root" || showLabels || node.id === hoverId)) {
          ctx.fillStyle = styles.getPropertyValue("--color-text").trim() || "#e6e9ec";
          ctx.font = node.kind === "hub" ? "600 12px var(--font-sans)" : "11px var(--font-sans)";
          ctx.textAlign = "center";
          ctx.fillText(node.label, px, py - radius - 6);
        }
      }

      for (const o of overflow) {
        const [px, py] = project(o.x, o.y, rect);
        ctx.beginPath();
        ctx.arc(px, py, 12, 0, Math.PI * 2);
        ctx.fillStyle = "var(--color-surface)";
        ctx.strokeStyle = "var(--color-border)";
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = styles.getPropertyValue("--color-text-dim").trim() || "#8a929c";
        ctx.font = "10px var(--font-mono)";
        ctx.textAlign = "center";
        ctx.fillText(`+${o.count}`, px, py + 3);
      }

      // Focus edges: incident associative edges of the hovered/selected repo,
      // redrawn in accent on top so the connection is legible at a glance.
      const focusId = hoverId ?? (selectedRepoId ? `repo:${selectedRepoId}` : null);
      if (focusId) {
        const incident = visibleEdges.filter((e) => e.kind === "assoc" && (e.s === focusId || e.t === focusId));
        if (incident.length > 0) {
          ctx.strokeStyle = "var(--color-accent)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (const edge of incident) {
            const s = nodesById.get(edge.s);
            const t = nodesById.get(edge.t);
            if (!s || !t) continue;
            const [sx, sy] = project(s.x, s.y, rect);
            const [tx, ty] = project(t.x, t.y, rect);
            ctx.moveTo(sx, sy);
            ctx.lineTo(tx, ty);
          }
          ctx.stroke();
        }
      }

      if (searchHitIds.size > 0) raf = requestAnimationFrame(draw);
    };

    draw();
    if (searchHitIds.size === 0) return undefined;
    return () => cancelAnimationFrame(raf);
  }, [
    visibleNodes,
    visibleEdges,
    overflow,
    camera,
    hoverId,
    selectedRepoId,
    searchHitIds,
    reposById,
    nodesById,
    colorForNode,
    radiusForNode,
    project,
    showAssoc,
  ]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (dragState.current) {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      if (Math.hypot(dx, dy) > 3) dragState.current.moved = true;
      if (dragState.current.moved) {
        setCamera((c) => ({ ...c, x: dragState.current!.camX - dx / c.zoom, y: dragState.current!.camY - dy / c.zoom }));
      }
      return;
    }
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const id = hitTest(localX, localY, rect);
    setHoverId(id);
    setHoverPos(id ? { x: localX, y: localY } : null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const wasDrag = dragState.current?.moved;
    dragState.current = null;
    if (wasDrag || !rect) return;

    const id = hitTest(e.clientX - rect.left, e.clientY - rect.top, rect);
    if (!id) return;
    if (id.startsWith("more:")) {
      const leafId = id.slice("more:".length);
      onOpenList(leafId.slice("leaf:".length).split("/"));
      return;
    }
    if (id.startsWith("hub:")) onNavigate([id.slice("hub:".length)]);
    else if (id.startsWith("leaf:")) onNavigate(id.slice("leaf:".length).split("/"));
    else if (id === "root") onNavigate([]);
    else if (id.startsWith("repo:")) onSelect(Number(id.slice("repo:".length)));
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setCamera((c) => ({ ...c, zoom: Math.min(10, Math.max(0.05, c.zoom * (1 - e.deltaY * 0.001))) }));
  };

  const zoomBy = (factor: number) => setCamera((c) => ({ ...c, zoom: Math.min(10, Math.max(0.05, c.zoom * factor)) }));

  const hoverRepo =
    hoverId?.startsWith("repo:") ? reposById.get(Number(hoverId.slice("repo:".length))) ?? null : null;

  return (
    <div ref={containerRef} className="relative h-full w-full cursor-grab overflow-hidden bg-background active:cursor-grabbing">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />

      {hoverRepo && hoverPos && (
        <Card
          className="pointer-events-none absolute z-10 w-64 gap-1 p-3 text-xs shadow-lg"
          style={{
            left: Math.min(hoverPos.x + 16, (containerRef.current?.clientWidth ?? 0) - 272),
            top: Math.min(hoverPos.y + 16, (containerRef.current?.clientHeight ?? 0) - 140),
          }}
        >
          <p className="truncate font-mono text-sm font-semibold text-foreground">{hoverRepo.nwo}</p>
          <p className="mt-1 line-clamp-2 text-muted-foreground">{hoverRepo.blurb}</p>
          <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
            {hoverRepo.lang && <span>{hoverRepo.lang}</span>}
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {hoverRepo.stars.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <GitFork className="h-3 w-3" />
              {hoverRepo.forks.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: healthColor(hoverRepo.health.state) }} />
              {hoverRepo.pushed_at.slice(0, 10)}
            </span>
          </div>
        </Card>
      )}

      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <Button variant="secondary" size="icon" onClick={() => zoomBy(1.3)} title="Zoom in">
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={() => zoomBy(1 / 1.3)} title="Zoom out">
          <Minus className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={fitToView} title="Fit to view (f)">
          <Frame className="h-4 w-4" />
        </Button>
      </div>

      <Card className="absolute left-3 top-3 max-w-[220px] gap-1 p-2.5">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">categories</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {hubs.map((hub, i) => (
            <span key={hub.id} className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: colorForHubIndex(i) }} />
              <span className="truncate">{hub.label}</span>
            </span>
          ))}
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={showAssoc}
            onChange={(e) => setShowAssoc(e.target.checked)}
            className="h-3 w-3 accent-[var(--color-accent)]"
          />
          <span className="inline-block h-[2px] w-3.5 shrink-0 rounded-full bg-muted-foreground/50" />
          related repos
        </label>
      </Card>

      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground shadow-sm">
        scroll to zoom · drag to pan · click a node · / to search · esc to go back
      </div>
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
