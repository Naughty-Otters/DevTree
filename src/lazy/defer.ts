/** Run work after the first paint when the browser is idle. */
export function runWhenIdle(task: () => void, timeoutMs = 2500): void {
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => task(), { timeout: timeoutMs });
  } else {
    setTimeout(task, 0);
  }
}

/** Run async work after first paint without blocking initial shell render. */
export function runWhenIdleAsync(task: () => Promise<void>, timeoutMs = 2500): void {
  runWhenIdle(() => {
    void task();
  }, timeoutMs);
}
