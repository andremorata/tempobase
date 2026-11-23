import { execFileSync } from "node:child_process";

export interface Config {
  baseUrl: URL;
  keychainService: string;
  timeZone: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!env.TEMPOBASE_URL) throw new Error("Set TEMPOBASE_URL to your TempoBase address, e.g. https://tempobase.example.com");
  const baseUrl = new URL(env.TEMPOBASE_URL);
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && LOCAL_HOSTS.has(baseUrl.hostname))) {
    throw new Error("TEMPOBASE_URL must use https (plain http is allowed only for localhost).");
  }

  const timeZone = env.TEMPOBASE_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
  new Intl.DateTimeFormat("en-US", { timeZone }); // throws RangeError on an unknown zone

  return { baseUrl, keychainService: env.TEMPOBASE_KEYCHAIN_SERVICE || "tempobase-mcp", timeZone };
}

/** Read on every call so a rotated token is picked up without restarting the server. */
export function readKeychainToken(service: string): string {
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(`No token found in the macOS Keychain under service "${service}". See the README to add one.`);
  }
}

const TIMEOUT_MS = 15_000;

type Deps = { fetch: typeof fetch; readToken: (service: string) => string };
const defaultDeps: Deps = { fetch, readToken: readKeychainToken };

const isTimeout = (error: unknown) => error instanceof DOMException && error.name === "TimeoutError";

async function send(config: Config, url: URL, init: RequestInit, deps: Deps): Promise<unknown> {
  let res: Response;
  let body: { error?: string } | null;
  try {
    res = await deps.fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        authorization: `Bearer ${deps.readToken(config.keychainService)}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // The timeout also covers the body; only a non-JSON body becomes null.
    body = await res.json().catch((error: unknown) => {
      if (isTimeout(error)) throw error;
      return null;
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new NoAnswerError(`TempoBase at ${config.baseUrl.origin} did not answer within ${TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  }

  if (res.ok && body === null) {
    throw new Error(`TempoBase at ${config.baseUrl.origin} did not return JSON. Check TEMPOBASE_URL.`);
  }
  if (!res.ok) {
    const hint =
      res.status === 401
        ? " The token is invalid, expired or revoked: create a new one in TempoBase Settings > Integrations."
        : "";
    throw new Error(`TempoBase returned ${res.status}: ${(body?.error ?? res.statusText).replace(/\.$/, "")}.${hint}`);
  }
  return body;
}

class NoAnswerError extends Error {}

const apiUrl = (config: Config, path: string) => new URL(`/api/integrations/v1/${path}`, config.baseUrl);

export async function apiGet(
  config: Config,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  deps: Deps = defaultDeps,
): Promise<unknown> {
  const url = apiUrl(config, path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return send(config, url, {}, deps);
}

/**
 * POST with one retry after a connection failure or timeout. Callers send an idempotency key,
 * so the retry cannot write twice. Answers from the server are never retried.
 */
export async function apiPost(config: Config, path: string, body: object, deps: Deps = defaultDeps): Promise<unknown> {
  const init = { method: "POST", body: JSON.stringify(body) };
  try {
    return await send(config, apiUrl(config, path), init, deps);
  } catch (error) {
    // fetch rejects with a TypeError when the connection fails.
    if (!(error instanceof TypeError || error instanceof NoAnswerError)) throw error;
    return send(config, apiUrl(config, path), init, deps);
  }
}
