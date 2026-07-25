import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { GraphData, GraphEdge, GraphNode, RepoRecord, Taxonomy } from "./types.js";
import { rootOfLeaf } from "./taxonomyRules.js";

const ASSOC_THRESHOLD = 0.15;
const ASSOC_TOP_K = 6;
const CANDIDATE_LIST_CAP = 400;
const TICKS = 300;

interface SimNode extends GraphNode {
  index?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink {
  source: string;
  target: string;
  edge: GraphEdge;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function buildAssociativeEdges(repos: RepoRecord[]): GraphEdge[] {
  const topicSets = repos.map((r) => new Set(r.topics.map((t) => t.toLowerCase())));
  const owners = repos.map((r) => r.nwo.split("/")[0]?.toLowerCase() ?? "");
  const langs = repos.map((r) => r.lang?.toLowerCase() ?? null);

  const topicIndex = new Map<string, number[]>();
  const ownerIndex = new Map<string, number[]>();
  repos.forEach((r, i) => {
    for (const topic of topicSets[i]) {
      const list = topicIndex.get(topic) ?? [];
      list.push(i);
      topicIndex.set(topic, list);
    }
    const owner = owners[i];
    const list = ownerIndex.get(owner) ?? [];
    list.push(i);
    ownerIndex.set(owner, list);
  });

  const candidatePairs = new Set<string>();
  const addCandidatesFrom = (index: Map<string, number[]>) => {
    for (const list of index.values()) {
      if (list.length < 2 || list.length > CANDIDATE_LIST_CAP) continue;
      for (let a = 0; a < list.length; a += 1) {
        for (let b = a + 1; b < list.length; b += 1) {
          const i = Math.min(list[a], list[b]);
          const j = Math.max(list[a], list[b]);
          candidatePairs.add(`${i},${j}`);
        }
      }
    }
  };
  addCandidatesFrom(topicIndex);
  addCandidatesFrom(ownerIndex);

  const byNode: Map<number, { other: number; weight: number }[]> = new Map();
  for (const key of candidatePairs) {
    const [i, j] = key.split(",").map(Number);
    let weight = jaccard(topicSets[i], topicSets[j]);
    if (owners[i] && owners[i] === owners[j]) weight += 0.1;
    if (langs[i] && langs[i] === langs[j]) weight += 0.1;
    weight = Math.min(weight, 1);
    if (weight < ASSOC_THRESHOLD) continue;
    if (!byNode.has(i)) byNode.set(i, []);
    if (!byNode.has(j)) byNode.set(j, []);
    byNode.get(i)!.push({ other: j, weight });
    byNode.get(j)!.push({ other: i, weight });
  }

  const kept = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const [node, neighbors] of byNode) {
    neighbors.sort((a, b) => b.weight - a.weight);
    for (const { other, weight } of neighbors.slice(0, ASSOC_TOP_K)) {
      const key = `${Math.min(node, other)},${Math.max(node, other)}`;
      if (kept.has(key)) continue;
      kept.add(key);
      edges.push({
        s: `repo:${repos[Math.min(node, other)].id}`,
        t: `repo:${repos[Math.max(node, other)].id}`,
        kind: "assoc",
        w: Math.round(weight * 100) / 100,
      });
    }
  }
  return edges;
}

export function buildGraph(
  login: string,
  taxonomy: Taxonomy,
  repos: RepoRecord[],
  prevPositions: Record<string, { x: number; y: number }>,
): GraphData {
  const nodes: SimNode[] = [];
  const seed = (id: string, fallbackX: number, fallbackY: number) =>
    prevPositions[id] ?? { x: fallbackX, y: fallbackY };

  const rootPos = seed("root", 0, 0);
  nodes.push({ id: "root", kind: "root", label: login, x: rootPos.x, y: rootPos.y });

  const hubCount = taxonomy.roots.length;
  taxonomy.roots.forEach((root, i) => {
    const angle = (i / hubCount) * 2 * Math.PI;
    const pos = seed(`hub:${root.id}`, Math.cos(angle) * 300, Math.sin(angle) * 300);
    const count = repos.filter((r) => r.cat.some((c) => rootOfLeaf(taxonomy, c) === root.id)).length;
    nodes.push({ id: `hub:${root.id}`, kind: "hub", label: root.label, parent: "root", count, x: pos.x, y: pos.y });

    root.leaves.forEach((leaf, j) => {
      const leafAngle = angle + ((j - root.leaves.length / 2) * 0.15);
      const pos2 = seed(`leaf:${leaf.id}`, Math.cos(leafAngle) * 450, Math.sin(leafAngle) * 450);
      const leafCount = repos.filter((r) => r.cat.includes(leaf.id)).length;
      nodes.push({
        id: `leaf:${leaf.id}`,
        kind: "leaf",
        label: leaf.label,
        parent: `hub:${root.id}`,
        count: leafCount,
        x: pos2.x,
        y: pos2.y,
      });
    });
  });

  const structEdges: GraphEdge[] = [];
  taxonomy.roots.forEach((root) => {
    const hubCount2 = repos.filter((r) => r.cat.some((c) => rootOfLeaf(taxonomy, c) === root.id)).length;
    if (hubCount2 > 0) structEdges.push({ s: "root", t: `hub:${root.id}`, kind: "struct" });
    root.leaves.forEach((leaf) => {
      const leafCount = repos.filter((r) => r.cat.includes(leaf.id)).length;
      if (leafCount > 0) structEdges.push({ s: `hub:${root.id}`, t: `leaf:${leaf.id}`, kind: "struct" });
    });
  });

  repos.forEach((repo, i) => {
    const primaryLeaf = repo.cat[0] ?? "misc/other";
    const parentId = `leaf:${primaryLeaf}`;
    const parentNode = nodes.find((n) => n.id === parentId);
    const pos = seed(`repo:${repo.id}`, (parentNode?.x ?? 0) + (i % 20) - 10, (parentNode?.y ?? 0) + Math.floor(i / 20));
    nodes.push({
      id: `repo:${repo.id}`,
      kind: "repo",
      label: repo.nwo,
      parent: parentId,
      x: pos.x,
      y: pos.y,
    });
    structEdges.push({ s: parentId, t: `repo:${repo.id}`, kind: "struct" });
  });

  const assocEdges = buildAssociativeEdges(repos);
  const allEdges = [...structEdges, ...assocEdges];

  const links: SimLink[] = allEdges.map((e) => ({ source: e.s, target: e.t, edge: e }));

  const simulation = forceSimulation<SimNode>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => (l.edge.kind === "struct" ? 60 : 40))
        .strength((l) => (l.edge.kind === "struct" ? 0.8 : 0.1)),
    )
    .force("charge", forceManyBody().strength(-40))
    .force("center", forceCenter(0, 0))
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => (d.kind === "root" ? 30 : d.kind === "hub" ? 20 : d.kind === "leaf" ? 12 : 4)),
    )
    .stop();

  for (let i = 0; i < TICKS; i += 1) simulation.tick();

  const outNodes: GraphNode[] = nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    parent: n.parent,
    count: n.count,
    x: Math.round((n.x ?? 0) * 10) / 10,
    y: Math.round((n.y ?? 0) * 10) / 10,
  }));

  return { nodes: outNodes, edges: allEdges };
}

export function extractPositions(graph: GraphData): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of graph.nodes) positions[node.id] = { x: node.x, y: node.y };
  return positions;
}
