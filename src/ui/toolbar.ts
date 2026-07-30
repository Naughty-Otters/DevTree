import { lucideIcon } from "./icons";
import { attachTooltip } from "./tooltip";
import { Crosshair, FolderOpen, ListChecks, Play, Save, Settings, Square } from "lucide";

const TOOLBAR_ICON = {
  size: 13,
  class: "lucide-icon toolbar-icon",
  "stroke-width": 1.75,
};

export function mountToolbarIcons(): void {
  const btnOpen = document.querySelector<HTMLButtonElement>("#btn-open-project");
  const btnRun = document.querySelector<HTMLButtonElement>("#btn-run-analysis");
  const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop-analysis");
  const btnFocus = document.querySelector<HTMLButtonElement>("#btn-focus-view");
  const btnSave = document.querySelector<HTMLButtonElement>("#btn-save-file");
  const btnWizard = document.querySelector<HTMLButtonElement>("#btn-setup-wizard");
  const btnSettings = document.querySelector<HTMLButtonElement>("#btn-settings");

  if (btnOpen) {
    btnOpen.appendChild(lucideIcon(FolderOpen, TOOLBAR_ICON));
    attachTooltip(btnOpen, "Open project folder");
  }
  if (btnRun) {
    btnRun.appendChild(lucideIcon(Play, TOOLBAR_ICON));
    attachTooltip(btnRun, "Run analysis");
  }
  if (btnStop) {
    btnStop.appendChild(lucideIcon(Square, { ...TOOLBAR_ICON, size: 11 }));
    attachTooltip(btnStop, "Stop running analysis");
  }
  if (btnFocus) {
    btnFocus.appendChild(lucideIcon(Crosshair, TOOLBAR_ICON));
    attachTooltip(btnFocus, "Focus — fit all visible modules in view");
  }
  if (btnSave) {
    btnSave.appendChild(lucideIcon(Save, TOOLBAR_ICON));
    attachTooltip(btnSave, "Save file (⌘S)");
  }
  if (btnWizard) {
    btnWizard.appendChild(lucideIcon(ListChecks, TOOLBAR_ICON));
    attachTooltip(btnWizard, "Setup guide — project, LSP, and LLM");
  }
  if (btnSettings) {
    btnSettings.appendChild(lucideIcon(Settings, TOOLBAR_ICON));
    attachTooltip(btnSettings, "Settings");
  }
}
