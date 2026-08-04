export type LlmProviderId =
  | "deepseek"
  | "kimi"
  | "glm"
  | "openai"
  | "anthropic"
  | "grok"
  | "claude_code"
  | "codex"
  | "gemini_cli";

export interface LlmProviderInfo {
  id: LlmProviderId;
  label: string;
}

export const DEFAULT_LLM_PROVIDER: LlmProviderId = "openai";

const CLI_LLM_PROVIDERS: ReadonlySet<LlmProviderId> = new Set([
  "claude_code",
  "codex",
  "gemini_cli",
]);

/** Local coding-agent CLIs (no API key; spawn headless process). */
export function isCliLlmProvider(provider: LlmProviderId): boolean {
  return CLI_LLM_PROVIDERS.has(provider);
}
