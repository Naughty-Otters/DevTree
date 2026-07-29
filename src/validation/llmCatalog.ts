import type { LlmProviderId } from "../agent/types";

export function formatModelLabel(model: string): string {
  return model
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function effectiveLlmModel(model: string): string {
  return model.trim();
}

/** Browser-mode provider catalog (mirrors Rust `list_providers`). */
export function mockLlmProviders(): { id: LlmProviderId; label: string }[] {
  return [
    { id: "deepseek", label: "DeepSeek" },
    { id: "kimi", label: "Kimi (Moonshot)" },
    { id: "glm", label: "GLM (Z.AI)" },
    { id: "openai", label: "OpenAI" },
    { id: "anthropic", label: "Anthropic" },
    { id: "grok", label: "Grok (xAI)" },
  ];
}
