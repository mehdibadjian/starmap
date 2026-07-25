// 12 categorical colors, one per taxonomy root, chosen for distinctness in both themes.
export const CATEGORY_PALETTE = [
  "#5eead4", // teal
  "#f472b6", // pink
  "#a78bfa", // violet
  "#fb923c", // orange
  "#60a5fa", // blue
  "#facc15", // yellow
  "#4ade80", // green
  "#f87171", // red
  "#c084fc", // purple
  "#38bdf8", // sky
  "#fda4af", // rose
  "#a3e635", // lime
];

export function colorForHubIndex(index: number): string {
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

export function healthColor(state: string): string {
  switch (state) {
    case "active":
      return "var(--health-active)";
    case "slowing":
      return "var(--health-slowing)";
    case "stale":
      return "var(--health-stale)";
    case "dead":
      return "var(--health-dead)";
    case "archived":
      return "var(--health-archived)";
    default:
      return "var(--color-text-dim)";
  }
}
