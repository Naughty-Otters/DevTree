import { lucideIcon } from "./icons";
import { attachTooltip } from "./tooltip";
import { t } from "../i18n";
import { FolderOpen, ListChecks, Play, Save, Settings, Square } from "lucide";

const TOOLBAR_ICON = {
  size: 13,
  class: "lucide-icon toolbar-icon",
  "stroke-width": 1.75,
};

export function mountToolbarIcons(): void {
  const btnOpen = document.querySelector<HTMLButtonElement>("#btn-open-project");
  const btnRun = document.querySelector<HTMLButtonElement>("#btn-run-analysis");
  const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop-analysis");
  const btnSave = document.querySelector<HTMLButtonElement>("#btn-save-file");
  const btnWizard = document.querySelector<HTMLButtonElement>("#btn-setup-wizard");
  const btnSettings = document.querySelector<HTMLButtonElement>("#btn-settings");

  if (btnOpen) {
    if (btnOpen.childElementCount === 0) {
      btnOpen.appendChild(lucideIcon(FolderOpen, TOOLBAR_ICON));
    }
    attachTooltip(btnOpen, t("toolbar.openProject"));
  }
  if (btnRun) {
    if (btnRun.childElementCount === 0) {
      btnRun.appendChild(lucideIcon(Play, TOOLBAR_ICON));
    }
    attachTooltip(btnRun, t("toolbar.runAnalysis"));
  }
  if (btnStop) {
    if (btnStop.childElementCount === 0) {
      btnStop.appendChild(lucideIcon(Square, { ...TOOLBAR_ICON, size: 11 }));
    }
    attachTooltip(btnStop, t("toolbar.stopAnalysis"));
  }
  if (btnSave) {
    if (btnSave.childElementCount === 0) {
      btnSave.appendChild(lucideIcon(Save, TOOLBAR_ICON));
    }
    attachTooltip(btnSave, t("toolbar.saveFile"));
  }
  if (btnWizard) {
    if (btnWizard.childElementCount === 0) {
      btnWizard.appendChild(lucideIcon(ListChecks, TOOLBAR_ICON));
    }
    attachTooltip(btnWizard, t("toolbar.setupGuide"));
  }
  if (btnSettings) {
    if (btnSettings.childElementCount === 0) {
      btnSettings.appendChild(lucideIcon(Settings, TOOLBAR_ICON));
    }
    attachTooltip(btnSettings, t("toolbar.settings"));
  }
}
