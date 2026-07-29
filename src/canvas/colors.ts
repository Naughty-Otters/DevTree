const PALETTE = [
  "#3d7bd9", "#34d399", "#f472b6", "#fbbf24", "#a78bfa",
  "#fb923c", "#2dd4bf", "#f87171", "#60a5fa", "#c084fc",
  "#4ade80", "#facc15", "#38bdf8", "#e879f9", "#86efac",
];

export function nodeColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function buildNodeColorMap(ids: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of ids) {
    map.set(id, nodeColor(id));
  }
  return map;
}
