import assert from "node:assert/strict";
import { test } from "node:test";
import { apiGet, apiPost, loadConfig } from "./client.ts";

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

test("apiPost retries once after a connection failure with the same body", async () => {
  const bodies: string[] = [];
  let calls = 0;
  const flaky = (async (_url: URL | string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    if (++calls === 1) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ id: "op-1" }), { status: 201 });
  }) as typeof fetch;

  const result = await apiPost(CONFIG, "operations", { idempotencyKey: "k1", a: 1 }, { fetch: flaky, readToken: () => "t" });

  assert.deepEqual(result, { id: "op-1" });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[0]!).idempotencyKey, "k1");
});

test("apiPost gives up after the second connection failure and does not retry HTTP errors", async () => {
  let calls = 0;
  const down = (async () => {
    calls++;
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(apiPost(CONFIG, "operations", {}, { fetch: down, readToken: () => "t" }), /fetch failed/);
  assert.equal(calls, 2);

  const stub = stubFetch(409, { error: "idempotencyKey was already used for a different entry" });
  await assert.rejects(apiPost(CONFIG, "operations", {}, { fetch: stub.fetch, readToken: () => "t" }), /409/);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0]!.init.method, "POST");
  assert.equal(new Headers(stub.calls[0]!.init.headers).get("content-type"), "application/json");
});

test("apiPost retries a timeout but not a missing Keychain item", async () => {
  let calls = 0;
  const slowThenOk = (async () => {
    if (++calls === 1) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return new Response(JSON.stringify({ id: "op-1" }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await apiPost(CONFIG, "operations", {}, { fetch: slowThenOk, readToken: () => "t" }), { id: "op-1" });

  let reads = 0;
  const noToken = () => {
    reads++;
    throw new Error("No token found in the macOS Keychain");
  };
  await assert.rejects(apiPost(CONFIG, "operations", {}, { fetch: stubFetch(200, {}).fetch, readToken: noToken }), /Keychain/);
  assert.equal(reads, 1);
});

test("does not double the period of a server message", async () => {
  const stub = stubFetch(409, { error: "This project is not active. Activate it before logging time." });
  await assert.rejects(apiGet(CONFIG, "hours", {}, { fetch: stub.fetch, readToken: () => "t" }), (error: Error) =>
    error.message.endsWith("logging time.") && !error.message.includes(".."),
  );
});
