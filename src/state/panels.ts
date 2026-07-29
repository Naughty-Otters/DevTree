import type { PanelSizes } from "./types";

const CSS_MAP: { key: keyof PanelSizes; cssVar: string; unit: "px" | "%" }[] = [
  { key: "leftWidth", cssVar: "--left-width", unit: "px" },
  { key: "rightWidth", cssVar: "--right-width", unit: "px" },
  { key: "bottomHeight", cssVar: "--bottom-height", unit: "px" },
  { key: "leftTreeHeight", cssVar: "--left-tree-height", unit: "%" },
];

export function applyPanelSizes(sizes: PanelSizes): void {
  for (const { key, cssVar, unit } of CSS_MAP) {
    document.documentElement.style.setProperty(`${cssVar}`, `${sizes[key]}${unit}`);
  }
}

export function readPanelSizes(): PanelSizes {
  const read = (cssVar: string, fallback: number) => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(cssVar)
      .trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    leftWidth: read("--left-width", 240),
    rightWidth: read("--right-width", 260),
    bottomHeight: read("--bottom-height", 200),
    leftTreeHeight: read("--left-tree-height", 50),
  };
}
