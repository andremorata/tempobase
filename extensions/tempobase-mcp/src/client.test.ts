import assert from "node:assert/strict";
import { test } from "node:test";
import { apiGet, loadConfig } from "./client.ts";

test("requires TEMPOBASE_URL", () => {
  assert.throws(() => loadConfig({}), /TEMPOBASE_URL/);
});

test("refuses plain http outside localhost so the token never travels unencrypted", () => {
  assert.throws(() => loadConfig({ TEMPOBASE_URL: "http://tempobase.example.com" }), /https/);
  assert.equal(loadConfig({ TEMPOBASE_URL: "http://localhost:3000" }).baseUrl.host, "localhost:3000");
  assert.equal(loadConfig({ TEMPOBASE_URL: "https://tempobase.example.com" }).baseUrl.protocol, "https:");
});

test("uses TEMPOBASE_TIMEZONE and the keychain service, with defaults", () => {
  const config = loadConfig({ TEMPOBASE_URL: "https://t.example.com", TEMPOBASE_TIMEZONE: "America/Sao_Paulo" });
  assert.equal(config.timeZone, "America/Sao_Paulo");
  assert.equal(config.keychainService, "tempobase-mcp");
  assert.equal(loadConfig({ TEMPOBASE_URL: "https://t.example.com" }).timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.throws(() => loadConfig({ TEMPOBASE_URL: "https://t.example.com", TEMPOBASE_TIMEZONE: "Nowhere/Land" }), RangeError);
});

const CONFIG = { baseUrl: new URL("https://t.example.com"), keychainService: "svc-test", timeZone: "UTC" };

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchStub = async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetch: fetchStub as typeof fetch };
}

test("apiGet sends the Keychain token as Bearer and serializes only set params", async () => {
  const stub = stubFetch(200, { ok: true });
  const services: string[] = [];
  const result = await apiGet(
    CONFIG,
    "hours",
    { from: "2026-11-16", to: "2026-11-22", projectId: undefined, description: "", roundUp: false },
    { fetch: stub.fetch, readToken: (service) => (services.push(service), "tbp_secret") },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(services, ["svc-test"]);
  assert.equal(stub.calls[0]!.url, "https://t.example.com/api/integrations/v1/hours?from=2026-11-16&to=2026-11-22&roundUp=false");
  assert.equal(new Headers(stub.calls[0]!.init.headers).get("authorization"), "Bearer tbp_secret");
  assert.ok(stub.calls[0]!.init.signal instanceof AbortSignal);
});

test("apiGet explains a 401 and passes other server errors through", async () => {
  await assert.rejects(
    apiGet(CONFIG, "hours", {}, { fetch: stubFetch(401, { error: "Invalid integration token" }).fetch, readToken: () => "t" }),
    /401: Invalid integration token\. The token is invalid, expired or revoked/,
  );
  await assert.rejects(
    apiGet(CONFIG, "hours", {}, { fetch: stubFetch(404, { error: "Project or task not found" }).fetch, readToken: () => "t" }),
    (error: Error) => /404: Project or task not found\.$/.test(error.message),
  );
});

test("apiGet reports a timeout clearly", async () => {
  const timeoutFetch = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;
  await assert.rejects(apiGet(CONFIG, "hours", {}, { fetch: timeoutFetch, readToken: () => "t" }), /did not answer within 15 seconds/);
});

test("apiGet fails clearly on a 200 that is not JSON", async () => {
  const htmlFetch = (async () => new Response("<html></html>", { status: 200 })) as typeof fetch;
  await assert.rejects(apiGet(CONFIG, "hours", {}, { fetch: htmlFetch, readToken: () => "t" }), /did not return JSON/);
});

test("apiGet reports a timeout while reading the body", async () => {
  const stalledBody = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    }) as unknown as Response) as typeof fetch;
  await assert.rejects(apiGet(CONFIG, "hours", {}, { fetch: stalledBody, readToken: () => "t" }), /did not answer within 15 seconds/);
});
