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

export async function apiGet(
  config: Config,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  deps: { fetch: typeof fetch; readToken: (service: string) => string } = { fetch, readToken: readKeychainToken },
): Promise<unknown> {
  const url = new URL(`/api/integrations/v1/${path}`, config.baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await deps.fetch(url, {
      headers: { authorization: `Bearer ${deps.readToken(config.keychainService)}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`TempoBase at ${config.baseUrl.origin} did not answer within ${TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;

  if (!res.ok) {
    const hint =
      res.status === 401
        ? " The token is invalid, expired or revoked: create a new one in TempoBase Settings > Integrations."
        : "";
    throw new Error(`TempoBase returned ${res.status}: ${body?.error ?? res.statusText}.${hint}`);
  }
  return body;
}
