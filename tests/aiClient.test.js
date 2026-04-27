import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createAiClient, getProviderDefaults, SUPPORTED_PROVIDERS } from "../src/aiClient.js";
import { createDatabase, seedSystemConfig } from "../src/db.js";
import { createAppService } from "../src/services.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-client-test-"));
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload
  };
}

function captureFetch(payload, status = 200) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(payload, status);
  };
  return { fetchImpl, calls };
}

test("SUPPORTED_PROVIDERS includes openai, openrouter, claude", () => {
  assert.deepEqual(SUPPORTED_PROVIDERS.sort(), ["claude", "openai", "openrouter"]);
});

test("createAiClient throws for unsupported provider", () => {
  assert.throws(
    () => createAiClient({ provider: "invalid", apiKey: "x" }),
    /Unsupported AI provider/
  );
});

test("createAiClient throws when API key missing", () => {
  assert.throws(() => createAiClient({ provider: "openai" }), /Missing API key/);
});

test("openai provider posts to /chat/completions with Bearer auth", async () => {
  const { fetchImpl, calls } = captureFetch({
    choices: [{ message: { content: "Hello!" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    model: "gpt-4o-mini"
  });

  const client = createAiClient({
    provider: "openai",
    apiKey: "sk-test",
    fetchImpl
  });
  const result = await client.chat({
    system: "you are helpful",
    messages: [{ role: "user", content: "hi" }]
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[0].content, "you are helpful");
  assert.equal(body.messages[1].role, "user");

  assert.equal(result.content, "Hello!");
  assert.equal(result.usage.input_tokens, 5);
  assert.equal(result.usage.output_tokens, 2);
});

test("openrouter provider posts to /chat/completions and adds referer headers", async () => {
  const { fetchImpl, calls } = captureFetch({
    choices: [{ message: { content: "Routed!" } }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
  });

  const client = createAiClient({
    provider: "openrouter",
    apiKey: "or-key",
    fetchImpl
  });
  await client.chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer or-key");
  assert.equal(calls[0].options.headers["HTTP-Referer"], "https://github.com/cogloballtd-afk/uploadautoRedbubble");
  assert.equal(calls[0].options.headers["X-Title"], "uploadautoRedbubble");
});

test("claude provider posts to /v1/messages with x-api-key and anthropic-version", async () => {
  const { fetchImpl, calls } = captureFetch({
    content: [
      { type: "text", text: "Hi from Claude" },
      { type: "text", text: " (cont.)" }
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
    stop_reason: "end_turn",
    model: "claude-sonnet-4-6"
  });

  const client = createAiClient({
    provider: "claude",
    apiKey: "sk-ant-test",
    fetchImpl
  });
  const result = await client.chat({
    system: "you are concise",
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 64
  });

  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].options.headers["x-api-key"], "sk-ant-test");
  assert.equal(calls[0].options.headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.system, "you are concise");
  assert.equal(body.max_tokens, 64);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");

  assert.equal(result.content, "Hi from Claude (cont.)");
  assert.equal(result.usage.input_tokens, 10);
  assert.equal(result.usage.output_tokens, 5);
  assert.equal(result.finishReason, "end_turn");
});

test("error response is surfaced with status and body", async () => {
  const fetchImpl = async () => jsonResponse({ error: { message: "bad key" } }, 401);
  const client = createAiClient({ provider: "openai", apiKey: "x", fetchImpl });
  await assert.rejects(
    client.chat({ messages: [{ role: "user", content: "hi" }] }),
    /AI request failed \(401\): bad key/
  );
});

test("custom baseUrl and model override defaults", async () => {
  const { fetchImpl, calls } = captureFetch({ choices: [{ message: { content: "ok" } }] });
  const client = createAiClient({
    provider: "openai",
    apiKey: "k",
    baseUrl: "https://proxy.example.com/v1/",
    model: "gpt-4o",
    fetchImpl
  });
  await client.chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(calls[0].url, "https://proxy.example.com/v1/chat/completions");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "gpt-4o");
});

test("system message inside messages array is extracted into system field for Claude", async () => {
  const { fetchImpl, calls } = captureFetch({
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 1, output_tokens: 1 }
  });
  const client = createAiClient({ provider: "claude", apiKey: "k", fetchImpl });
  await client.chat({
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" }
    ]
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.system, "be brief");
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
});

test("provider defaults expose label, baseUrl, model", () => {
  for (const provider of SUPPORTED_PROVIDERS) {
    const d = getProviderDefaults(provider);
    assert.ok(d.baseUrl);
    assert.ok(d.model);
    assert.ok(d.label);
  }
});

test("service.saveAiSettings persists and getAiSettings reads back", () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: { listProfiles: async () => [] },
    browserClient: {}
  });

  let settings = service.getAiSettings();
  assert.equal(settings.activeProvider, null);

  service.saveAiSettings({
    activeProvider: "claude",
    temperature: 0.3,
    maxTokens: 256,
    openai: { apiKey: "sk-openai", baseUrl: "", model: "gpt-4o" },
    openrouter: { apiKey: "", baseUrl: "", model: "" },
    claude: { apiKey: "sk-ant-test", baseUrl: "", model: "claude-sonnet-4-6" }
  });

  settings = service.getAiSettings();
  assert.equal(settings.activeProvider, "claude");
  assert.equal(settings.temperature, 0.3);
  assert.equal(settings.maxTokens, 256);
  const claudeCfg = settings.providers.find((p) => p.provider === "claude");
  assert.equal(claudeCfg.apiKey, "sk-ant-test");
  assert.equal(claudeCfg.model, "claude-sonnet-4-6");
  const openaiCfg = settings.providers.find((p) => p.provider === "openai");
  assert.equal(openaiCfg.apiKey, "sk-openai");
});

test("service.testAiConnection uses active provider when none specified", async () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: { listProfiles: async () => [] },
    browserClient: {}
  });

  service.saveAiSettings({
    activeProvider: "openai",
    temperature: 0.7,
    maxTokens: 16,
    openai: { apiKey: "sk-test", baseUrl: "", model: "" },
    openrouter: { apiKey: "", baseUrl: "", model: "" },
    claude: { apiKey: "", baseUrl: "", model: "" }
  });

  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      model: "gpt-4o-mini"
    });
  };

  const result = await service.testAiConnection({ fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /openai\.com/);
});

test("service.aiChat raises when provider not configured", async () => {
  const root = makeTempDir();
  const db = createDatabase(path.join(root, "app.sqlite"));
  seedSystemConfig(db, {
    gpmApiBaseUrl: "http://127.0.0.1:19995",
    excelFilenameStandard: "input.xlsx",
    logDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts")
  });

  const service = createAppService({
    db,
    config: { artifactsDir: path.join(root, "artifacts") },
    gpmClient: { listProfiles: async () => [] },
    browserClient: {}
  });

  await assert.rejects(
    service.aiChat({ messages: [{ role: "user", content: "hi" }] }),
    /provider chưa được chọn/
  );

  service.saveAiSettings({
    activeProvider: "claude",
    temperature: 0.7,
    maxTokens: 16,
    openai: { apiKey: "", baseUrl: "", model: "" },
    openrouter: { apiKey: "", baseUrl: "", model: "" },
    claude: { apiKey: "", baseUrl: "", model: "" }
  });

  await assert.rejects(
    service.aiChat({ messages: [{ role: "user", content: "hi" }] }),
    /API key cho Claude/
  );
});
