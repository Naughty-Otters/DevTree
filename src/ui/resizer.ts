type ResizeAxis = "horizontal" | "vertical";

interface ResizerConfig {
  handle: HTMLElement;
  axis: ResizeAxis;
  cssVar: string;
  min: number;
  max: number;
  unit: "px" | "%";
  getSize: (event: MouseEvent) => number;
  onResize?: () => void;
}

function setVar(name: string, value: number, unit: "px" | "%"): void {
  document.documentElement.style.setProperty(name, `${value}${unit}`);
}

function getVar(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function initResizers(
  onLayoutChange?: () => void,
  onResizeEnd?: () => void,
): void {
  const notify = () => onLayoutChange?.();

  const configs: ResizerConfig[] = [];

  const leftHandle = document.querySelector<HTMLElement>('[data-resize="left"]');
  const rightHandle = document.querySelector<HTMLElement>('[data-resize="right"]');
  const bottomHandle = document.querySelector<HTMLElement>('[data-resize="bottom"]');
  const leftSplitHandle = document.querySelector<HTMLElement>('[data-resize="left-split"]');
  const leftPanel = document.querySelector<HTMLElement>("#left-panel");
  const mainRow = document.querySelector<HTMLElement>("#main-row");

  if (leftHandle && mainRow) {
    configs.push({
      handle: leftHandle,
      axis: "horizontal",
      cssVar: "--left-width",
      min: 160,
      max: 520,
      unit: "px",
      getSize: (e) => {
        const rect = mainRow.getBoundingClientRect();
        return e.clientX - rect.left;
      },
      onResize: notify,
    });
  }

  if (rightHandle && mainRow) {
    configs.push({
      handle: rightHandle,
      axis: "horizontal",
      cssVar: "--right-width",
      min: 180,
      max: 480,
      unit: "px",
      getSize: (e) => {
        const rect = mainRow.getBoundingClientRect();
        return rect.right - e.clientX;
      },
      onResize: notify,
    });
  }

  if (bottomHandle) {
    const workspace = document.querySelector<HTMLElement>("#workspace")!;
    configs.push({
      handle: bottomHandle,
      axis: "vertical",
      cssVar: "--bottom-height",
      min: 80,
      max: 480,
      unit: "px",
      getSize: (e) => {
        const rect = workspace.getBoundingClientRect();
        return rect.bottom - e.clientY;
      },
      onResize: notify,
    });
  }

  if (leftSplitHandle && leftPanel) {
    configs.push({
      handle: leftSplitHandle,
      axis: "vertical",
      cssVar: "--left-tree-height",
      min: 20,
      max: 80,
      unit: "%",
      getSize: (e) => {
        const rect = leftPanel.getBoundingClientRect();
        return ((e.clientY - rect.top) / rect.height) * 100;
      },
      onResize: notify,
    });
  }

  for (const config of configs) {
    attachResizer(config, onResizeEnd);
  }
}

function attachResizer(config: ResizerConfig, onResizeEnd?: () => void): void {
  const { handle, cssVar, min, max, unit, getSize, onResize } = config;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    document.body.classList.add("is-resizing");
    document.body.classList.add(
      config.axis === "horizontal" ? "is-resizing-h" : "is-resizing-v",
    );

    const onMove = (ev: MouseEvent) => {
      let size = getSize(ev);
      size = Math.max(min, Math.min(max, size));
      setVar(cssVar, Math.round(size * 10) / 10, unit);
      onResize?.();
    };

    const onUp = () => {
      document.body.classList.remove("is-resizing", "is-resizing-h", "is-resizing-v");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onResize?.();
      onResizeEnd?.();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

export { getVar, setVar };
