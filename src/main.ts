import { runWhenIdle } from "./lazy/defer";

/**
 * Minimal entry point — paints the shell immediately, then loads the main
 * application bundle (graph, canvas, settings, etc.) when idle.
 */
runWhenIdle(() => {
  void import("./boot").then((mod) => mod.startApp().catch(console.error));
}, 0);
