import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./client.ts";

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
