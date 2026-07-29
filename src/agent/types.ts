export type LlmProviderId =
  | "deepseek"
  | "kimi"
  | "glm"
  | "openai"
  | "anthropic"
  | "grok";

export interface LlmProviderInfo {
  id: LlmProviderId;
  label: string;
}

export const DEFAULT_LLM_PROVIDER: LlmProviderId = "openai";
