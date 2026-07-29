import type { GraphNavigation, NavCrumb } from "../graph/navigation";

export interface GraphNavOptions {
  stats?: { nodes: number; edges: number };
  staleImports?: boolean;
}

export interface GraphNavCallbacks {
  onBack: () => void;
  onForward: () => void;
  onNavigate: (crumb: NavCrumb) => void;
}

export function renderGraphNav(
  container: HTMLElement,
  nav: GraphNavigation,
  canBack: boolean,
  canForward: boolean,
  callbacks: GraphNavCallbacks,
  options: GraphNavOptions = {},
): void {
  container.innerHTML = "";

  const bar = document.createElement("div");
  bar.className = "graph-nav-bar";

  const controls = document.createElement("div");
  controls.className = "graph-nav-controls";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-icon btn-ghost graph-nav-btn";
  backBtn.title = "Back";
  backBtn.disabled = !canBack;
  backBtn.textContent = "←";
  backBtn.addEventListener("click", callbacks.onBack);

  const forwardBtn = document.createElement("button");
  forwardBtn.type = "button";
  forwardBtn.className = "btn btn-icon btn-ghost graph-nav-btn";
  forwardBtn.title = "Forward";
  forwardBtn.disabled = !canForward;
  forwardBtn.textContent = "→";
  forwardBtn.addEventListener("click", callbacks.onForward);

  controls.append(backBtn, forwardBtn);

  const crumbs = document.createElement("nav");
  crumbs.className = "graph-nav-crumbs";
  crumbs.setAttribute("aria-label", "Graph location");

  nav.crumbs.forEach((crumb, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "graph-nav-sep";
      sep.textContent = "›";
      crumbs.appendChild(sep);
    }

    const isLast = i === nav.crumbs.length - 1;
    if (isLast) {
      const current = document.createElement("span");
      current.className = "graph-nav-crumb graph-nav-crumb-current";
      current.textContent = crumb.label;
      crumbs.appendChild(current);
    } else {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "graph-nav-crumb graph-nav-crumb-link";
      link.textContent = crumb.label;
      link.addEventListener("click", () => callbacks.onNavigate(crumb));
      crumbs.appendChild(link);
    }
  });

  if (options.stats) {
    const stats = document.createElement("span");
    stats.className = "graph-nav-stats";
    stats.textContent = `${options.stats.nodes} modules · ${options.stats.edges} deps`;
    crumbs.appendChild(stats);
  }

  bar.append(controls, crumbs);
  container.appendChild(bar);

  if (options.staleImports) {
    const warn = document.createElement("p");
    warn.className = "graph-nav-warning";
    warn.textContent =
      "Import data looks outdated — run analysis again to see file and package dependencies.";
    container.appendChild(warn);
  }
}
