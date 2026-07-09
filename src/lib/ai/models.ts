export const LOCAL_CHAT_MODELS = [
  "qwen3.5:9b",
  "mistral:7b",
  "qwen2.5:7b",
] as const;

export const LOCAL_EMBEDDING_MODELS = [
  "nomic-embed-text",
  "mxbai-embed-large",
] as const;

export const OPENAI_CHAT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
] as const;

export const REMOVED_OPENAI_CHAT_MODELS = [
  "gpt-5.2",
] as const;

export const OPENAI_EMBEDDING_MODELS = [
  "text-embedding-3-small",
  "text-embedding-3-large",
] as const;

export const DEFAULT_OPENAI_CHAT_MODEL = OPENAI_CHAT_MODELS[0];
export const DEFAULT_LOCAL_CHAT_MODEL = LOCAL_CHAT_MODELS[0];
export const DEFAULT_OPENAI_EMBEDDING_MODEL = OPENAI_EMBEDDING_MODELS[0];
export const DEFAULT_LOCAL_EMBEDDING_MODEL = LOCAL_EMBEDDING_MODELS[0];

export function isRemovedOpenAIChatModel(model: string): boolean {
  return (REMOVED_OPENAI_CHAT_MODELS as readonly string[]).includes(model);
}

export function normalizeOpenAIChatModel(model: string): string {
  return isRemovedOpenAIChatModel(model) ? DEFAULT_OPENAI_CHAT_MODEL : model;
}

export function getOpenAIChatModelOptions(
  discoveredModels: readonly string[] = [],
  configuredModel?: string
): string[] {
  return mergeModelOptions(
    OPENAI_CHAT_MODELS,
    discoveredModels.filter((model) => !isRemovedOpenAIChatModel(model)),
    configuredModel && !isRemovedOpenAIChatModel(configuredModel) ? configuredModel : undefined
  );
}

export function mergeModelOptions(
  preferredModels: readonly string[],
  discoveredModels: readonly string[] = [],
  configuredModel?: string
): string[] {
  const ordered = [
    ...(configuredModel ? [configuredModel] : []),
    ...preferredModels,
    ...discoveredModels,
  ];

  return Array.from(new Set(ordered.filter(Boolean)));
}
