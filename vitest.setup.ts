import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  open: vi.fn(async () => undefined),
  openUrl: vi.fn(async () => undefined),
}));
