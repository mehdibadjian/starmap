import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Frame, Minus, Plus } from "lucide-react";
import type { GraphData, GraphNode, RepoRecord } from "../lib/types";
import { colorForHubIndex } from "../lib/palette";
import { readCanvasTheme } from "../lib/canvasTheme";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const FLY_DURATION_MS = 450;
/**
 * Coarse pointers get a much smaller window than fine ones: a phone screen
 * cannot legibly show 200 labelled dots, and the point of the cap is
 * legibility rather than an arbitrary ceiling.
 */
const MAX_VISIBLE_REPOS_FINE = 200;
const MAX_VISIBLE_REPOS_COARSE = 60;
/** Extra slop when hit-testing with a finger instead of a cursor. */
const HIT_SLOP_FINE = 3;
const HIT_SLOP_COARSE = 12;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * CSS transitions cannot animate a canvas paint, so "reduce motion" is honoured
 * by making the camera jump instead of flying, and by freezing the search
 * pulse rather than oscillating it.
 */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isCoarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
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
  const [coarse] = useState(isCoarsePointer);
  // On a phone the legend covers a third of the map, so it starts folded.
  const [legendOpen, setLegendOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  /**
   * Bumped whenever the theme could have changed. The canvas paints from
   * resolved token values, and the render loop only runs on a React state
   * change, so swapping `<html>`'s class from outside React (App.tsx applies
   * meta.json's theme after boot) would otherwise leave the old colours up.
   */
  const [themeTick, setThemeTick] = useState(0);
  const dragState = useRef<{ startX: number; startY: number; camX: number; camY: number; moved: boolean } | null>(
    null,
  );

  /**
   * The paint loop only runs when a dependency changes, so anything that alters
   * what should be drawn — a theme swap applied to `<html>` outside React, or a
   * viewport change from rotating a phone or the URL bar collapsing — has to
   * nudge it. Without this the canvas keeps the previous size and colours.
   */
  useEffect(() => {
    const repaint = () => setThemeTick((t) => t + 1);
    const observer = new MutationObserver(repaint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    media?.addEventListener?.("change", repaint);
    window.addEventListener("resize", repaint);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", repaint);
      window.removeEventListener("resize", repaint);
    };
  }, []);
  const flyRaf = useRef(0);
  // Mirrors `camera` synchronously so flyTo can read the current value
  // immediately — setState's functional updater form only resolves on
  // React's next commit, which is too late for the first animation frame.
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const flyTo = useCallback((target: Camera, duration = prefersReducedMotion() ? 0 : FLY_DURATION_MS) => {
    cancelAnimationFrame(flyRaf.current);
    if (duration <= 0) {
      cameraRef.current = target;
      setCamera(target);
      return;
    }
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
  const maxVisible = coarse ? MAX_VISIBLE_REPOS_COARSE : MAX_VISIBLE_REPOS_FINE;

  const colorForHub = useCallback(
    (hubId: string | undefined): string =>
      hubId === undefined ? "transparent" : colorForHubIndex(hubOrder.indexOf(hubId)),
    [hubOrder],
  );

  /** Hub a node descends from, or undefined for the root. */
  const hubOf = useCallback(
    (node: GraphNode): string | undefined => {
      let current: GraphNode | undefined = node;
      while (current && current.kind !== "hub") current = current.parent ? nodesById.get(current.parent) : undefined;
      return current?.id;
    },
    [nodesById],
  );

  const { visibleNodes, visibleEdges, overflow, focusNodes, activeHubId } = useMemo(() => {
    const visible = new Set<string>(["root", ...hubOrder]);
    const overflowNodes: OverflowNode[] = [];
    // What the camera fits to — narrows as you drill in, so repos aren't
    // dwarfed by the distance back to root and unrelated hubs.
    let focus = new Set<string>(["root", ...hubOrder]);
    let activeHub: string | undefined;

    if (path[0]) {
      const hubId = `hub:${path[0]}`;
      activeHub = hubId;
      const leaves = childrenByParent.get(hubId) ?? [];
      for (const leaf of leaves) visible.add(leaf.id);
      focus = new Set([hubId, ...leaves.map((l) => l.id)]);

      if (path[1]) {
        const leafId = `leaf:${path[0]}/${path[1]}`;
        // Show the largest, most-maintained repos when the leaf overflows the
        // cap, rather than whatever happens to be newest-starred in shard order.
        const repos = (childrenByParent.get(leafId) ?? []).slice().sort((a, b) => {
          const ra = reposById.get(Number(a.id.slice("repo:".length)));
          const rb = reposById.get(Number(b.id.slice("repo:".length)));
          return (rb?.stars ?? 0) - (ra?.stars ?? 0);
        });
        const shown = repos.slice(0, maxVisible);
        for (const r of shown) visible.add(r.id);
        focus = new Set([leafId, ...shown.map((r) => r.id)]);
        if (repos.length > maxVisible) {
          const hidden = repos.slice(maxVisible);
          const avgX = hidden.reduce((s, r) => s + r.x, 0) / hidden.length;
          const avgY = hidden.reduce((s, r) => s + r.y, 0) / hidden.length;
          overflowNodes.push({ id: `more:${leafId}`, x: avgX, y: avgY, count: hidden.length, leafId });
        }
      }
    }

    const edges = graph.edges.filter((e) => visible.has(e.s) && visible.has(e.t));
    const nodes = graph.nodes.filter((n) => visible.has(n.id));
    const focusList = nodes.filter((n) => focus.has(n.id));
    return { visibleNodes: nodes, visibleEdges: edges, overflow: overflowNodes, focusNodes: focusList, activeHubId: activeHub };
  }, [graph, path, hubOrder, childrenByParent, reposById, maxVisible]);

  /**
   * Everything the keyboard can walk to, in a stable order. The root view holds
   * no repos, so without hubs and leaves here the canvas would be inert exactly
   * where a keyboard user starts.
   */
  const navNodes = useMemo(() => visibleNodes.filter((n) => n.kind !== "root"), [visibleNodes]);
  const [navIndex, setNavIndex] = useState(-1);
  // The keyboard cursor is drawn like a hover, but must survive the mouse.
  const navId = navIndex >= 0 ? navNodes[Math.min(navIndex, navNodes.length - 1)]?.id ?? null : null;

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
    // Pad proportionally to the viewport: 160 units of margin on a phone is
    // most of the screen, so the fit zooms out too far to read anything.
    const pad = Math.min(160, Math.max(40, Math.min(rect.width, rect.height) * 0.18));
    const zoom = Math.min((rect.width - pad) / w, (rect.height - pad) / h, 10);
    flyTo({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.max(zoom, MIN_ZOOM) });
  }, [focusNodes, visibleNodes, flyTo]);

  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.join("/")]);

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
      // A repo's radius encodes star count, so clamp the floor: below this a
      // dot is un-tappable on glass and the health ring has nothing to sit on.
      const base = 3 + (repo ? logScale(repo.stars) * 1.3 : 0);
      return Math.max(coarse ? 6 : 3, base);
    },
    [reposById, coarse],
  );

  const hitSlop = coarse ? HIT_SLOP_COARSE : HIT_SLOP_FINE;

  const hitTest = useCallback(
    (sx: number, sy: number, rect: DOMRect): string | null => {
      let best: { id: string; d: number } | null = null;
      for (const node of visibleNodes) {
        const [px, py] = project(node.x, node.y, rect);
        const r = radiusForNode(node) + hitSlop;
        const d = Math.hypot(px - sx, py - sy);
        if (d <= r && (!best || d < best.d)) best = { id: node.id, d };
      }
      for (const o of overflow) {
        const [px, py] = project(o.x, o.y, rect);
        const d = Math.hypot(px - sx, py - sy);
        const r = 12 + hitSlop;
        if (d <= r && (!best || d < best.d)) best = { id: o.id, d };
      }
      return best?.id ?? null;
    },
    [visibleNodes, overflow, project, radiusForNode, hitSlop],
  );

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let pulseT = 0;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Canvas parses fillStyle/strokeStyle/font as CSS *values*, so custom
      // properties must be resolved to literals first — assigning "var(--x)"
      // is silently ignored and leaves the previous colour in place.
      const theme = readCanvasTheme();
      const reduced = prefersReducedMotion();
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Zoom-dependent legibility: at a distance only hubs are labelled, and
      // the active hub's leaves join in once they have room to breathe.
      const showLeafLabels = camera.zoom > 0.55;
      const showRepoLabels = camera.zoom > 0.9;

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

      for (const node of visibleNodes) {
        const [px, py] = project(node.x, node.y, rect);
        const radius = radiusForNode(node);
        const isRepo = node.kind === "repo";
        const repoId = isRepo ? Number(node.id.slice("repo:".length)) : null;
        const repo = repoId !== null ? reposById.get(repoId) : undefined;
        const isHit = repoId !== null && searchHitIds.has(repoId);
        const isSelected = repoId !== null && repoId === selectedRepoId;

        // Siblings of the drilled-into hub recede instead of competing for
        // attention; the active branch stays at full strength.
        const hubId = hubOf(node);
        const recede = node.kind !== "root" && activeHubId !== undefined && hubId !== undefined && hubId !== activeHubId;
        const emphasized = node.id === hoverId || node.id === navId || isSelected || isHit;
        let drawRadius = radius;
        if (isHit) {
          if (!reduced) pulseT += 0.02;
          drawRadius += Math.sin(pulseT) * 2 + 2;
        }

        ctx.globalAlpha = recede && !emphasized ? 0.22 : 1;
        ctx.beginPath();
        ctx.arc(px, py, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = node.kind === "root" ? theme.text : colorForHub(hubId);
        ctx.fill();

        if (repo) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = theme.health[repo.health.state] ?? theme.textDim;
          ctx.stroke();
        }
        if (isSelected || node.id === navId) {
          // The selected repo gets a solid ring; the keyboard cursor gets a
          // dashed one so both can be on screen at once and still read apart.
          ctx.lineWidth = 2;
          ctx.strokeStyle = theme.accent;
          ctx.setLineDash(node.id === navId && !isSelected ? [3, 3] : []);
          ctx.beginPath();
          ctx.arc(px, py, drawRadius + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const wantsLabel =
          node.kind === "root" ||
          node.kind === "hub" ||
          (node.kind === "leaf" && (showLeafLabels || node.id === hoverId || node.id === navId)) ||
          (isRepo && (showRepoLabels || node.id === hoverId || node.id === navId)) ||
          node.id === hoverId ||
          node.id === navId;
        if (wantsLabel && !(recede && node.kind !== "hub")) {
          ctx.fillStyle = emphasized ? theme.text : theme.textDim;
          ctx.font = node.kind === "hub" ? `600 12px ${theme.fontSans}` : `11px ${theme.fontSans}`;
          ctx.textAlign = "center";
          ctx.fillText(node.label, px, py - drawRadius - 6);
        }
        ctx.globalAlpha = 1;
      }

      for (const o of overflow) {
        const [px, py] = project(o.x, o.y, rect);
        ctx.beginPath();
        ctx.arc(px, py, 12, 0, Math.PI * 2);
        ctx.fillStyle = theme.surface;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = theme.border;
        ctx.stroke();
        ctx.fillStyle = theme.textDim;
        ctx.font = `10px ${theme.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText(`+${o.count}`, px, py + 3);
      }

      // Focus edges: incident associative edges of the hovered/selected repo,
      // redrawn in accent on top so the connection is legible at a glance.
      const focusId = hoverId ?? navId ?? (selectedRepoId ? `repo:${selectedRepoId}` : null);
      if (focusId) {
        const incident = visibleEdges.filter((e) => e.kind === "assoc" && (e.s === focusId || e.t === focusId));
        if (incident.length > 0) {
          ctx.strokeStyle = theme.accent;
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

      if (searchHitIds.size > 0 && !reduced) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [
    visibleNodes,
    visibleEdges,
    overflow,
    camera,
    hoverId,
    navId,
    selectedRepoId,
    searchHitIds,
    reposById,
    nodesById,
    colorForHub,
    hubOf,
    radiusForNode,
    project,
    showAssoc,
    activeHubId,
    themeTick,
  ]);

  /* ------------------------------------------------------------------ *
   * Pointer input: one finger/mouse drags, two fingers pinch-zoom about
   * the midpoint, a tap without movement selects.
   * ------------------------------------------------------------------ */
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; zoom: number; midX: number; midY: number; camX: number; camY: number } | null>(
    null,
  );

  const zoomAboutPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCamera((c) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      // Keep the world point under the cursor/midpoint fixed as zoom changes.
      const wx = (clientX - rect.left - rect.width / 2) / c.zoom + c.x;
      const wy = (clientY - rect.top - rect.height / 2) / c.zoom + c.y;
      return { x: wx - (clientX - rect.left - rect.width / 2) / z, y: wy - (clientY - rect.top - rect.height / 2) / z, zoom: z };
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      // A second finger means the drag is now a pinch; drop the pan intent so
      // releasing either finger cannot also fire a tap.
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: cameraRef.current.zoom,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        camX: cameraRef.current.x,
        camY: cameraRef.current.y,
      };
      dragState.current = null;
      return;
    }
    dragState.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const scale = dist / pinch.current.dist;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.current.zoom * scale));
      setCamera((c) => {
        const start = pinch.current!;
        const wx = (start.midX - rect.left - rect.width / 2) / c.zoom + start.camX;
        const wy = (start.midY - rect.top - rect.height / 2) / c.zoom + start.camY;
        const panDx = (midX - start.midX) / c.zoom;
        const panDy = (midY - start.midY) / c.zoom;
        return {
          x: wx - (midX - rect.left - rect.width / 2) / nextZoom - panDx,
          y: wy - (midY - rect.top - rect.height / 2) / nextZoom - panDy,
          zoom: nextZoom,
        };
      });
      return;
    }

    if (dragState.current) {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      // Higher threshold under a finger: taps tremble, drags do not.
      const threshold = coarse ? 10 : 3;
      if (Math.hypot(dx, dy) > threshold) dragState.current.moved = true;
      if (dragState.current.moved) {
        setCamera((c) => ({ ...c, x: dragState.current!.camX - dx / c.zoom, y: dragState.current!.camY - dy / c.zoom }));
      }
      return;
    }
    if (coarse) return; // hover is a cursor affordance; a finger has no hover
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const id = hitTest(localX, localY, rect);
    setHoverId(id);
    setHoverPos(id ? { x: localX, y: localY } : null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const rect = containerRef.current?.getBoundingClientRect();
    const wasDrag = dragState.current?.moved;
    dragState.current = null;
    if (wasDrag || !rect) return;

    const id = hitTest(e.clientX - rect.left, e.clientY - rect.top, rect);
    if (!id) {
      setHoverId(null);
      return;
    }
    if (id.startsWith("more:")) {
      const leafId = id.slice("more:".length);
      onOpenList(leafId.slice("leaf:".length).split("/"));
      return;
    }
    if (id.startsWith("hub:")) onNavigate([id.slice("hub:".length)]);
    else if (id.startsWith("leaf:")) onNavigate(id.slice("leaf:".length).split("/"));
    else if (id === "root") onNavigate([]);
    else if (id.startsWith("repo:")) {
      const repoId = Number(id.slice("repo:".length));
      onSelect(repoId);
      const repo = reposById.get(repoId);
      if (repo) setAnnounce(`${repo.nwo}, ${repo.health.state}, ${repo.stars.toLocaleString()} stars`);
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    dragState.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    zoomAboutPoint(camera.zoom * (1 - e.deltaY * 0.001), e.clientX, e.clientY);
  };

  const zoomBy = (factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAboutPoint(camera.zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  /* ------------------------------------------------------------------ *
   * Keyboard: the canvas is a focusable surface, not a dead region.
   * Arrows walk every visible node — hubs and leaves at root, where there
   * are no repos — Enter/Space descends, and +, -, 0 zoom and fit.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const announceNode = (node: GraphNode) => {
      if (node.kind === "repo") {
        const repo = reposById.get(Number(node.id.slice("repo:".length)));
        if (repo) {
          setAnnounce(`${repo.nwo}, ${repo.health.state}, ${repo.stars.toLocaleString()} stars`);
          onSelect(repo.id);
        }
      } else {
        const count = node.count ?? 0;
        setAnnounce(`${node.label}, ${node.kind}, ${count.toLocaleString()} repos. Press Enter to open.`);
      }
    };
    const move = (delta: number) => {
      if (navNodes.length === 0) return;
      const next = (navIndex + delta + navNodes.length) % navNodes.length;
      setNavIndex(next);
      announceNode(navNodes[next]);
    };
    const descend = () => {
      const node = navIndex >= 0 ? navNodes[navIndex] : undefined;
      if (!node) return;
      if (node.kind === "repo") {
        const repo = reposById.get(Number(node.id.slice("repo:".length)));
        if (repo) window.open(`https://github.com/${repo.nwo}`, "_blank");
      } else if (node.kind === "hub") {
        onNavigate([node.id.slice("hub:".length)]);
      } else if (node.kind === "leaf") {
        onNavigate(node.id.slice("leaf:".length).split("/"));
      }
    };
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          move(1);
          e.preventDefault();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          move(-1);
          e.preventDefault();
          break;
        case "Enter":
        case " ":
          if (navIndex >= 0) {
            // Mark the event so App's window-level Enter handler stands down:
            // descend() already opens the repo, and a second opener would launch
            // two GitHub tabs for a single keypress.
            Object.defineProperty(e, "starmapEnterHandled", { value: true });
            descend();
            e.preventDefault();
          }
          break;
        case "+":
        case "=":
          zoomBy(1.3);
          e.preventDefault();
          break;
        case "-":
        case "_":
          zoomBy(1 / 1.3);
          e.preventDefault();
          break;
        case "0":
          fitToView();
          e.preventDefault();
          break;
        default:
          break;
      }
    };
    canvas.addEventListener("keydown", handler);
    return () => canvas.removeEventListener("keydown", handler);
  }, [navNodes, navIndex, reposById, onSelect, onNavigate, zoomBy, fitToView]);

  // Reset the cursor when the visible set changes so it does not point at a
  // node that just left the screen.
  useEffect(() => {
    setNavIndex(-1);
  }, [path.join("/")]);

  const hoverRepo =
    hoverId?.startsWith("repo:") ? reposById.get(Number(hoverId.slice("repo:".length))) ?? null : null;

  const canvasLabel = useMemo(() => {
    const hub = path[0];
    const leaf = path[1];
    const where = leaf ? `${hub} / ${leaf}` : hub ? hub : "all categories";
    const shown = visibleNodes.filter((n) => n.kind === "repo").length;
    return `Star map, showing ${where}. ${shown} repos visible${
      overflow.length ? `, ${overflow.reduce((s, o) => s + o.count, 0)} hidden behind +N` : ""
    }. Arrow keys move between categories and repos, Enter opens what the cursor is on, plus and minus zoom, zero fits the view.`;
  }, [path, visibleNodes, overflow]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full cursor-grab overflow-hidden bg-background active:cursor-grabbing"
    >
      <canvas
        ref={canvasRef}
        // touch-action: none is what lets a drag reach the handler instead of
        // the browser scrolling or pinch-zooming the page.
        className="h-full w-full touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="img"
        aria-label={canvasLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      />

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

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
            <span>{hoverRepo.stars.toLocaleString()}★</span>
            <span>{hoverRepo.forks.toLocaleString()}⑂</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
              {hoverRepo.pushed_at.slice(0, 10)}
            </span>
          </div>
        </Card>
      )}

      {/* 40px on a phone, 32px from `sm` up: `size="icon"` is 32px, which is a
          small target for a thumb, and these are the only zoom controls on touch. */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 sm:gap-1">
        <Button variant="secondary" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" onClick={() => zoomBy(1.3)} title="Zoom in" aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" onClick={() => zoomBy(1 / 1.3)} title="Zoom out" aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" onClick={fitToView} title="Fit to view" aria-label="Fit to view">
          <Frame className="h-4 w-4" />
        </Button>
      </div>

      {/* Twelve hubs is taller than a phone screen and 220px of a 375px viewport
          is most of the map, so on coarse pointers it starts collapsed to a chip
          and scrolls when opened. */}
      <Card className="absolute left-2 top-2 flex max-h-[50%] w-[min(220px,calc(100%-4.5rem))] flex-col overflow-y-auto p-2.5 sm:left-3 sm:top-3 sm:max-w-[220px]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">categories</p>
          {coarse && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 font-mono text-[10px] text-muted-foreground"
              aria-expanded={legendOpen}
              onClick={() => setLegendOpen((v) => !v)}
            >
              {legendOpen ? "hide" : "show"}
            </Button>
          )}
        </div>
        {(!coarse || legendOpen) && (
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {hubs.map((hub, i) => (
              <button
                key={hub.id}
                onClick={() => onNavigate([hub.id.slice("hub:".length)])}
                className="flex min-h-[28px] items-center gap-1.5 truncate rounded px-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title={hub.count ? `${hub.count} repos` : "no repos"}
                disabled={!hub.count}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: colorForHubIndex(i), opacity: hub.count ? 1 : 0.3 }}
                />
                <span className="truncate">{hub.label}</span>
              </button>
            ))}
          </div>
        )}
        <label className="mt-2 flex min-h-9 cursor-pointer items-center gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground sm:min-h-[28px]">
          <input
            type="checkbox"
            checked={showAssoc}
            onChange={(e) => setShowAssoc(e.target.checked)}
            className="h-4 w-4 shrink-0 accent-[var(--color-accent)] sm:h-3.5 sm:w-3.5"
          />
          <span className="inline-block h-[2px] w-3.5 shrink-0 rounded-full bg-muted-foreground/50" />
          related repos
        </label>
      </Card>

      {/* Desktop hint only: on a phone the gestures are the obvious ones and
          this string would be the widest element on the screen. */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground shadow-sm sm:block">
        scroll to zoom · drag to pan · click a node · / to search · esc to go back
      </div>
    </div>
  );
}
