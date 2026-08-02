import { describe, expect, it, vi } from "vitest";
import type { TreeEntry } from "../project/types";
import { renderProjectTree } from "./projectTree";

function sampleTree(): TreeEntry {
  return {
    name: "proj",
    path: ".",
    kind: "directory",
    children: [
      {
        name: "src",
        path: "src",
        kind: "directory",
        children: [
          {
            name: "nested",
            path: "src/nested",
            kind: "directory",
            children: [
              { name: "deep.ts", path: "src/nested/deep.ts", kind: "file" },
            ],
          },
          { name: "main.ts", path: "src/main.ts", kind: "file" },
        ],
      },
      { name: "README.md", path: "README.md", kind: "file" },
    ],
  };
}

describe("ui/projectTree", () => {
  it("lists folders before files under an expanded folder", () => {
    const container = document.createElement("div");
    const tree: TreeEntry = {
      name: "proj",
      path: ".",
      kind: "directory",
      children: [
        { name: "README.md", path: "README.md", kind: "file" },
        {
          name: "src",
          path: "src",
          kind: "directory",
          children: [{ name: "a.ts", path: "src/a.ts", kind: "file" }],
        },
        { name: "LICENSE", path: "LICENSE", kind: "file" },
        {
          name: "docs",
          path: "docs",
          kind: "directory",
          children: [],
        },
      ],
    };
    renderProjectTree(container, tree, { onFileOpen: vi.fn() });

    const childRows = [
      ...container.querySelectorAll(".tree-root > .tree-node > .tree-children > .tree-node > .tree-row"),
    ] as HTMLElement[];
    expect(childRows.map((r) => r.dataset.path)).toEqual([
      "docs",
      "src",
      "LICENSE",
      "README.md",
    ]);
  });

  it("keeps the project root name above its children when expanded", () => {
    const container = document.createElement("div");
    renderProjectTree(container, sampleTree(), { onFileOpen: vi.fn() });

    const root = container.querySelector(".tree-root > .tree-node")!;
    const first = root.firstElementChild;
    const second = root.children[1];
    expect(first?.classList.contains("tree-row")).toBe(true);
    expect((first as HTMLElement).dataset.path).toBe(".");
    expect(second?.classList.contains("tree-children")).toBe(true);
  });

  it("opens only the root; nested folders stay collapsed until clicked", () => {
    const container = document.createElement("div");
    renderProjectTree(container, sampleTree(), { onFileOpen: vi.fn() });

    const root = container.querySelector(".tree-root > .tree-node");
    expect(root?.classList.contains("expanded")).toBe(true);

    const srcNode = [...container.querySelectorAll(".tree-row")].find(
      (el) => (el as HTMLElement).dataset.path === "src",
    )?.closest(".tree-node");
    expect(srcNode).toBeTruthy();
    expect(srcNode!.classList.contains("expanded")).toBe(false);

    // Nested path not in the DOM yet (lazy) or collapsed — not visible as expanded.
    expect(
      container.querySelector('[data-path="src/nested"]')?.closest(".tree-node")
        ?.classList.contains("expanded") ?? false,
    ).toBe(false);
  });

  it("expands one folder at a time without opening its subfolders", () => {
    const container = document.createElement("div");
    renderProjectTree(container, sampleTree(), { onFileOpen: vi.fn() });

    const srcRow = [...container.querySelectorAll(".tree-row")].find(
      (el) => (el as HTMLElement).dataset.path === "src",
    ) as HTMLElement;
    const srcChevron = srcRow.querySelector(".tree-chevron-wrap") as HTMLElement;
    srcChevron.click();

    const srcNode = srcRow.closest(".tree-node")!;
    expect(srcNode.classList.contains("expanded")).toBe(true);

    const nestedRow = [...container.querySelectorAll(".tree-row")].find(
      (el) => (el as HTMLElement).dataset.path === "src/nested",
    ) as HTMLElement;
    expect(nestedRow).toBeTruthy();
    expect(nestedRow.closest(".tree-node")!.classList.contains("expanded")).toBe(
      false,
    );

    // Deep file is not mounted until nested folder is expanded.
    expect(container.querySelector('[data-path="src/nested/deep.ts"]')).toBeNull();

    nestedRow.querySelector(".tree-chevron-wrap")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(
      nestedRow.closest(".tree-node")!.classList.contains("expanded"),
    ).toBe(true);
    expect(container.querySelector('[data-path="src/nested/deep.ts"]')).toBeTruthy();
  });

  it("lazy-loads folder children via loadChildren when has_children is set", async () => {
    const container = document.createElement("div");
    let resolveLoad!: (entries: TreeEntry[]) => void;
    const loadChildren = vi.fn(
      () =>
        new Promise<TreeEntry[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const tree: TreeEntry = {
      name: "proj",
      path: ".",
      kind: "directory",
      children: [
        { name: "src", path: "src", kind: "directory", has_children: true },
      ],
    };
    renderProjectTree(container, tree, { onFileOpen: vi.fn(), loadChildren });

    const srcRow = [...container.querySelectorAll(".tree-row")].find(
      (el) => (el as HTMLElement).dataset.path === "src",
    ) as HTMLElement;
    srcRow.querySelector(".tree-chevron-wrap")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(container.querySelector(".loading-placeholder")).toBeTruthy();
    expect(container.textContent).toContain("Loading folder");

    resolveLoad([
      { name: "main.ts", path: "src/main.ts", kind: "file" },
      {
        name: "nested",
        path: "src/nested",
        kind: "directory",
        has_children: true,
      },
    ]);

    await vi.waitFor(() => {
      expect(loadChildren).toHaveBeenCalledWith("src");
      expect(container.querySelector('[data-path="src/main.ts"]')).toBeTruthy();
    });
    expect(container.querySelector(".loading-placeholder")).toBeNull();
    expect(container.querySelector('[data-path="src/nested"]')).toBeTruthy();
    // Nested stub not expanded / deep contents not fetched.
    expect(loadChildren).toHaveBeenCalledTimes(1);
  });
});
