export function showAnalysisDialog(ruleCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-labelledby", "analysis-dialog-title");

    dialog.innerHTML = `
      <h2 id="analysis-dialog-title" class="modal-title">Run Analysis</h2>
      <p class="modal-subtitle">${ruleCount} rule(s) selected. Builds a package-level dependency map — drill into packages and files to explore.</p>
    `;

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-ghost-modal";
    cancelBtn.textContent = "Cancel";

    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "btn btn-primary";
    runBtn.textContent = "Run";

    actions.append(cancelBtn, runBtn);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const close = (result: boolean) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };

    cancelBtn.addEventListener("click", () => close(false));
    runBtn.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => runBtn.focus());
  });
}
