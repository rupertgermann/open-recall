const OPENAI_API_KEY_REJECTED_MESSAGE =
  "OpenAI rejected the API key. Validate or update it in Settings, then try again.";

const OPENAI_API_KEY_MISSING_MESSAGE =
  "OpenAI API key is missing. Add one in Settings, then try again.";

const OPENAI_API_KEY_FORBIDDEN_MESSAGE =
  "OpenAI accepted the API key but it is not authorized for this request. Check the key's project and permissions in Settings.";

const AI_MODEL_UNAVAILABLE_MESSAGE =
  "The selected AI model is unavailable. Choose a different model in Settings, then try again.";

const AI_RATE_LIMIT_MESSAGE =
  "The AI provider rate limit or quota was reached. Wait a moment, then try again.";

const AI_PROVIDER_UNREACHABLE_MESSAGE =
  "The AI provider could not be reached. Check the provider URL and network connection in Settings.";

const DEFAULT_AI_ERROR_MESSAGE =
  "The AI request failed. Check Settings and try again.";

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStatusCode(error: unknown, depth = 0): number | undefined {
  if (!isRecord(error) || depth > 3) return undefined;

  const direct =
    readNumber(error.statusCode) ??
    readNumber(error.status) ??
    (isRecord(error.response) ? readNumber(error.response.status) : undefined);

  if (direct) return direct;
  return getStatusCode(error.cause, depth + 1);
}

function collectErrorText(error: unknown, parts: string[] = [], depth = 0): string[] {
  if (depth > 3) return parts;

  if (typeof error === "string") {
    parts.push(error);
    return parts;
  }

  if (error instanceof Error) {
    parts.push(error.name, error.message);
    collectErrorText(error.cause, parts, depth + 1);
    return parts;
  }

  if (!isRecord(error)) return parts;

  for (const key of ["name", "message", "code", "type", "responseBody"] as const) {
    const value = readString(error[key]);
    if (value) parts.push(value);
  }

  if (isRecord(error.data)) {
    const dataError = isRecord(error.data.error) ? error.data.error : undefined;
    const dataMessage = readString(error.data.message) ?? readString(dataError?.message);
    const dataCode = readString(error.data.code) ?? readString(dataError?.code);
    const dataType = readString(error.data.type) ?? readString(dataError?.type);
    if (dataMessage) parts.push(dataMessage);
    if (dataCode) parts.push(dataCode);
    if (dataType) parts.push(dataType);
  }

  collectErrorText(error.cause, parts, depth + 1);
  return parts;
}

function hasAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function getReadableErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim()) return error.message;
  return readString(error);
}

export function getAIErrorMessage(error: unknown): string {
  const statusCode = getStatusCode(error);
  const text = collectErrorText(error).join(" ").toLowerCase();

  if (
    hasAny(text, [
      "missing api key",
      "missing openai api key",
      "api key is missing",
      "api key is required",
      "api key not set",
      "didn't provide an api key",
      "no auth credentials",
      "loadapikeyerror",
      "openai_api_key",
    ])
  ) {
    return OPENAI_API_KEY_MISSING_MESSAGE;
  }

  if (
    statusCode === 401 ||
    hasAny(text, [
      "invalid_api_key",
      "incorrect api key",
      "invalid api key",
      "api key is invalid",
      "unauthorized",
    ])
  ) {
    return OPENAI_API_KEY_REJECTED_MESSAGE;
  }

  if (statusCode === 403 || hasAny(text, ["permission", "forbidden", "not authorized"])) {
    return OPENAI_API_KEY_FORBIDDEN_MESSAGE;
  }

  if (
    statusCode === 404 ||
    hasAny(text, ["model_not_found", "model not found", "no such model", "does not exist"])
  ) {
    return AI_MODEL_UNAVAILABLE_MESSAGE;
  }

  if (
    statusCode === 429 ||
    hasAny(text, ["rate limit", "quota", "insufficient_quota", "too many requests"])
  ) {
    return AI_RATE_LIMIT_MESSAGE;
  }

  if (
    hasAny(text, [
      "econnrefused",
      "enotfound",
      "fetch failed",
      "networkerror",
      "network error",
      "connection refused",
      "connect timeout",
      "terminated",
    ])
  ) {
    return AI_PROVIDER_UNREACHABLE_MESSAGE;
  }

  const readable = getReadableErrorMessage(error);
  return readable || DEFAULT_AI_ERROR_MESSAGE;
}

export function createAIErrorResponse(error: unknown, status = 500): Response {
  return Response.json({ error: getAIErrorMessage(error) }, { status });
}
