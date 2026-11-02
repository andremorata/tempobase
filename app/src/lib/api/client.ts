const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

// ─── Core fetch wrapper ──────────────────────────────────────────────────────

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  skipAuth?: boolean;
};

type ApiErrorPayload = {
  statusCode?: number;
  message?: string;
  reason?: string;
  title?: string;
  detail?: string;
  error?: string;
  errors?: unknown;
};

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function flattenErrorMessages(errors: ApiErrorPayload["errors"]): string[] {
  const values = new Set<string>();

  const visit = (value: unknown): void => {
    if (!value) return;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) values.add(trimmed);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const prioritized = [record.reason, record.message, record.detail, record.title]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0);

      prioritized.forEach((item) => values.add(item.trim()));

      Object.values(record).forEach((item) => {
        if (!prioritized.includes(item as string)) {
          visit(item);
        }
      });
    }
  };

  visit(errors);
  return [...values];
}

function normalizeApiError(payload: unknown, fallback: string): { message: string; details: string[] } {
  if (!payload) {
    return { message: fallback, details: [] };
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return { message: fallback, details: [] };

    const parsed = parseJsonSafely(trimmed);
    if (parsed !== trimmed) {
      return normalizeApiError(parsed, fallback);
    }

    return { message: trimmed, details: [trimmed] };
  }

  if (typeof payload === "object") {
    const errorPayload = payload as ApiErrorPayload;
    const details = flattenErrorMessages(errorPayload.errors);
    const primaryMessage = [errorPayload.detail, errorPayload.reason, errorPayload.message, errorPayload.title, errorPayload.error]
      .find((value) => typeof value === "string" && value.trim().length > 0)
      ?.trim();

    const genericMessages = new Set([
      "One or more errors occurred!",
      "Validation Failed",
      "Bad Request",
      "Forbidden",
      "Unauthorized",
    ]);

    if (details.length > 0) {
      return {
        message: primaryMessage && !genericMessages.has(primaryMessage) ? primaryMessage : details[0] ?? fallback,
        details,
      };
    }

    if (primaryMessage) {
      return { message: primaryMessage, details: [primaryMessage] };
    }
  }

  return { message: fallback, details: [] };
}

export async function parseApiErrorResponse(
  response: Response,
  fallback = response.statusText || "Request failed",
): Promise<ApiError> {
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : parseJsonSafely(await response.text().catch(() => ""));
  const normalized = normalizeApiError(payload, fallback);

  return new ApiError(response.status, normalized.message, normalized.details, payload);
}

export async function apiFetch<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { body, skipAuth = false, headers: extraHeaders, ...rest } = options;

  const buildHeaders = (): HeadersInit => ({
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(extraHeaders as Record<string, string> | undefined),
  });

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: buildHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: skipAuth ? "same-origin" : "same-origin",
  });

  if (!res.ok) {
    throw await parseApiErrorResponse(res);
  }

  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ─── Error type ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: string[] = [],
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.details[0] ?? error.message ?? fallback;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}
