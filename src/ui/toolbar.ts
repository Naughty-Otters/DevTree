import { lucideIcon } from "./icons";
import { attachTooltip } from "./tooltip";
import { Crosshair, FolderOpen, Play, Settings } from "lucide";

const TOOLBAR_ICON = {
  size: 13,
  class: "lucide-icon toolbar-icon",
  "stroke-width": 1.75,
};

export function mountToolbarIcons(): void {
  const btnOpen = document.querySelector<HTMLButtonElement>("#btn-open-project");
  const btnRun = document.querySelector<HTMLButtonElement>("#btn-run-analysis");
  const btnFocus = document.querySelector<HTMLButtonElement>("#btn-focus-view");
  const btnSettings = document.querySelector<HTMLButtonElement>("#btn-settings");

  if (btnOpen) {
    btnOpen.appendChild(lucideIcon(FolderOpen, TOOLBAR_ICON));
    attachTooltip(btnOpen, "Open project folder");
  }
  if (btnRun) {
    btnRun.appendChild(
      lucideIcon(Play, { ...TOOLBAR_ICON, fill: "currentColor" }),
    );
    attachTooltip(btnRun, "Run analysis");
  }
  if (btnFocus) {
    btnFocus.appendChild(lucideIcon(Crosshair, TOOLBAR_ICON));
    attachTooltip(btnFocus, "Focus — fit all visible modules in view");
  }
  if (btnSettings) {
    btnSettings.appendChild(lucideIcon(Settings, TOOLBAR_ICON));
    attachTooltip(btnSettings, "Settings");
  }
}
