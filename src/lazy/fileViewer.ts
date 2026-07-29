import type {
  FileViewerCallbacks,
  FileViewerHandle,
  FileViewerOpenOptions,
} from "../ui/fileViewer";

let viewer: FileViewerHandle | null = null;
let viewerPromise: Promise<FileViewerHandle> | null = null;

export function loadFileViewer(
  container: HTMLElement,
  onRequestGraphView: () => void,
  callbacks: FileViewerCallbacks = {},
): Promise<FileViewerHandle> {
  if (viewer) return Promise.resolve(viewer);
  if (!viewerPromise) {
    viewerPromise = import("../ui/fileViewer").then((mod) => {
      viewer = mod.createFileViewer(container, onRequestGraphView, callbacks);
      return viewer;
    });
  }
  return viewerPromise;
}

/** Proxy that loads the file-viewer chunk on first use. */
export function createLazyFileViewer(
  getContainer: () => HTMLElement,
  onRequestGraphView: () => void,
  callbacks: FileViewerCallbacks = {},
): FileViewerHandle {
  const ensure = () =>
    loadFileViewer(getContainer(), onRequestGraphView, callbacks);

  return {
    open(path: string, content: string, opts?: FileViewerOpenOptions) {
      void ensure().then((v) => v.open(path, content, opts));
    },
    close() {
      viewer?.close();
    },
    isOpen() {
      return viewer?.isOpen() ?? false;
    },
    isDirty() {
      return viewer?.isDirty() ?? false;
    },
    getPath() {
      return viewer?.getPath() ?? null;
    },
    getIssues() {
      return viewer?.getIssues() ?? [];
    },
    scrollToLine(line: number) {
      viewer?.scrollToLine(line);
    },
    async save() {
      const v = await ensure();
      return v.save();
    },
  };
}
