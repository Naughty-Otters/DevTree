import { describe, expect, it } from "vitest";
import { renderPagedGrid } from "./pagedList";

describe("renderPagedGrid", () => {
  it("keeps only the current page mounted and pages with Previous/Next", () => {
    const host = document.createElement("div");
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);

    renderPagedGrid(
      host,
      items,
      (item) => {
        const el = document.createElement("div");
        el.className = "cell";
        el.textContent = item;
        return el;
      },
      { pageSize: 10 },
    );

    expect(host.querySelectorAll(".cell")).toHaveLength(10);
    expect(host.textContent).toContain("item-0");
    expect(host.textContent).not.toContain("item-10");
    expect(host.textContent).toMatch(/Page 1 \/ 3/);

    const navs = [...host.querySelectorAll<HTMLButtonElement>(".paged-grid-nav")];
    const prev = navs.find((b) => b.textContent === "Previous")!;
    const next = navs.find((b) => b.textContent === "Next")!;
    next.click();
    expect(host.querySelectorAll(".cell")).toHaveLength(10);
    expect(host.textContent).toContain("item-10");
    expect(host.textContent).not.toContain("item-0");
    expect(host.textContent).toMatch(/Page 2 \/ 3/);

    prev.click();
    expect(host.textContent).toContain("item-0");
    expect(host.textContent).toMatch(/Page 1 \/ 3/);
  });
});
