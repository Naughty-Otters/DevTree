/** Append items in pages so large lists don't freeze the UI (cumulative "Show more"). */
export function appendPagedItems<T>(
  host: HTMLElement,
  items: T[],
  renderItem: (item: T) => HTMLElement,
  pageSize = 80,
  moreHost: HTMLElement = host,
): void {
  let shown = 0;

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "btn btn-ghost paged-list-more";

  const paint = (): void => {
    const end = Math.min(shown + pageSize, items.length);
    const fragment = document.createDocumentFragment();
    for (let i = shown; i < end; i++) {
      fragment.appendChild(renderItem(items[i]!));
    }
    host.appendChild(fragment);
    shown = end;
    if (shown >= items.length) {
      moreBtn.remove();
      return;
    }
    moreBtn.textContent = `Show more (${shown.toLocaleString()} / ${items.length.toLocaleString()})`;
    if (!moreBtn.isConnected) moreHost.appendChild(moreBtn);
  };

  moreBtn.addEventListener("click", paint);
  paint();
}

export interface PagedGridOptions<T> {
  pageSize?: number;
  emptyText?: string;
  className?: string;
  /** Called the first time a page is painted (lazy source hydration). */
  ensureItems?: () => T[] | Promise<T[]>;
}

/**
 * One page of a grid at a time with Prev / Next controls.
 * Only the current page's DOM nodes are kept mounted.
 */
export function renderPagedGrid<T>(
  host: HTMLElement,
  itemsOrLoader: T[] | (() => T[] | Promise<T[]>),
  renderItem: (item: T) => HTMLElement,
  options: PagedGridOptions<T> = {},
): void {
  const pageSize = options.pageSize ?? 24;
  const emptyText = options.emptyText ?? "No items";

  host.replaceChildren();
  host.classList.add("paged-grid");
  if (options.className) host.classList.add(options.className);

  const grid = document.createElement("div");
  grid.className = "paged-grid-cells";
  grid.setAttribute("role", "list");

  const pager = document.createElement("div");
  pager.className = "paged-grid-pager";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "btn btn-ghost paged-grid-nav";
  prevBtn.textContent = "Previous";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "btn btn-ghost paged-grid-nav";
  nextBtn.textContent = "Next";

  const meta = document.createElement("span");
  meta.className = "paged-grid-meta";

  pager.append(prevBtn, meta, nextBtn);
  host.append(grid, pager);

  let items: T[] = Array.isArray(itemsOrLoader) ? itemsOrLoader : [];
  let page = 0;
  let loading = false;
  let hydrated = Array.isArray(itemsOrLoader);

  const totalPages = () => Math.max(1, Math.ceil(items.length / pageSize) || 1);

  const paint = (): void => {
    grid.replaceChildren();

    if (!hydrated) {
      meta.textContent = "Loading…";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "panel-empty paged-grid-empty";
      empty.textContent = emptyText;
      grid.appendChild(empty);
      meta.textContent = "0 items";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    const pages = totalPages();
    page = Math.min(Math.max(0, page), pages - 1);
    const start = page * pageSize;
    const end = Math.min(start + pageSize, items.length);
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const cell = renderItem(items[i]!);
      cell.setAttribute("role", "listitem");
      fragment.appendChild(cell);
    }
    grid.appendChild(fragment);

    meta.textContent = `Page ${page + 1} / ${pages} · ${start + 1}–${end} of ${items.length.toLocaleString()}`;
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page >= pages - 1;
  };

  const ensureHydrated = (): void => {
    if (hydrated) {
      paint();
      return;
    }
    if (loading) {
      paint();
      return;
    }

    const loader =
      typeof itemsOrLoader === "function" ? itemsOrLoader : options.ensureItems;
    if (!loader) {
      hydrated = true;
      paint();
      return;
    }

    const result = loader();
    if (result && typeof (result as Promise<T[]>).then === "function") {
      loading = true;
      paint();
      void (result as Promise<T[]>).then((resolved) => {
        items = resolved;
        hydrated = true;
        loading = false;
        paint();
      });
      return;
    }

    items = result as T[];
    hydrated = true;
    paint();
  };

  prevBtn.addEventListener("click", () => {
    if (page > 0) {
      page -= 1;
      paint();
    }
  });
  nextBtn.addEventListener("click", () => {
    if (page < totalPages() - 1) {
      page += 1;
      paint();
    }
  });

  ensureHydrated();
}
