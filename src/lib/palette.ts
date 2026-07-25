// 12 categorical colors, one per taxonomy root — desaturated, low-chroma
// tones (in the spirit of a code map's per-language fills) so they read
// clearly against the dark panel background without turning into a rainbow.
export const CATEGORY_PALETTE = [
  "#4a6580", // ai-ml — steel blue
  "#9a6848", // devtools — tan
  "#5a7850", // web — olive
  "#6e6a58", // backend — khaki
  "#3d6a5a", // data — teal green
  "#9a8348", // infra-devops — mustard
  "#7a5d8a", // security — purple
  "#5f7a5f", // mobile-desktop — sage
  "#7d6580", // languages-compilers — mauve
  "#806858", // learning-reference — taupe
  "#587a78", // design-media — slate teal
  "#6e5a70", // misc — plum
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
