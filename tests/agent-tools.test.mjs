import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";

// The daemon bundles extensionless TS imports; native Node needs this test-only resolver.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    throw error;
  }
} });
const { createTapdTools } = await import("../server/agent-tools.ts");
const { default: contribute } = await import("../index.server.ts");
const { tapdSettingsSchema } = await import("../shared/contracts.ts");
const { clearTapdCache } = await import("../server/tapd.ts");
for (const key of ["TAPD_TOKEN", "TAPD_WORKSPACE_IDS", "TAPD_API_ENDPOINT", "TAPD_SITE_URL"]) delete process.env[key];
const initial = tapdSettingsSchema.parse({ token: "example-secret", syncGitToken: "example-git-secret", workspaceIds: "12345678,87654321", apiEndpoint: "https://api.example.com", siteUrl: "https://example.com" });
const context = () => ({ signal: new AbortController().signal });
function setup(t, respond = () => []) {
  clearTapdCache();
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, initial.apiEndpoint);
    assert.equal(init.headers.Authorization, `Bearer ${initial.token}`);
    assert.equal(init.redirect, "error");
    const request = { url, init, body: new URLSearchParams(init.body) };
    requests.push(request);
    return Response.json({ status: 1, data: respond(request) });
  });
  let values = initial;
  const tools = createTapdTools(async () => values);
  const call = (name, input = {}, ctx = context()) => tools.find(tool => tool.name === name).execute(input, ctx);
  return { tools, call, requests, settings: next => { values = next; } };
}
function entityApi({ url, init, body }) {
  if (init.method === "POST") return { [url.pathname === "/tasks" ? "Task" : "Story"]: { id: body.get("id") || "11111111" } };
  if (url.pathname.endsWith("get_fields_info")) return { status: { options: { open: "待处理", done: "已完成" } } };
  if (url.pathname === "/users/info") return { User: { nick: "example-user" } };
  if (url.pathname === "/stories" && url.searchParams.get("id") && url.searchParams.get("workspace_id") === "87654321") {
    return [{ Story: { id: url.searchParams.get("id"), name: "示例需求", status: "open", description: "<p>完整正文</p>" } }];
  }
  return [];
}

test("main SDK tools expose valid schemas, names and required write confirmation without connection overrides", (t) => {
  const { tools } = setup(t);
  for (const name of ["tapd_projects", "tapd_entity", "tapd_labels", "tapd_item_labels", "tapd_create_label"]) assert.ok(tools.some(tool => tool.name === name));
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.match(tool.name, /^tapd_[a-z_]+$/);
    assert.ok(tool.name.length <= 64);
    const schema = z.toJSONSchema(tool.input);
    for (const key of ["token", "apiEndpoint", "siteUrl", "syncGitToken"]) assert.equal(key in schema.properties, false);
    if (["tapd_create", "tapd_update_status", "tapd_add_comment", "tapd_update_field", "tapd_create_label"].includes(tool.name)) {
      assert.ok(schema.required.includes("confirmed"));
      assert.equal(schema.properties.confirmed.const, true);
      assert.ok(schema.required.includes("workspaceId"));
    }
  }
});

test("projects use current settings, and missing configuration or cancellation never hits TAPD", async (t) => {
  const { call, settings, requests } = setup(t);
  assert.deepEqual((await call("tapd_projects")).structuredContent, { workspaceIds: ["12345678", "87654321"] });
  settings({ ...initial, workspaceIds: "87654321" });
  assert.deepEqual((await call("tapd_projects")).structuredContent, { workspaceIds: ["87654321"] });
  settings({ ...initial, workspaceIds: "" });
  assert.equal((await call("tapd_search", { query: "sample" })).isError, true);
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await call("tapd_projects", {}, { signal: aborted.signal })).isError, true);
  assert.equal(requests.length, 0);
});

test("tool validation rejects invalid targets, confirmation, oversized input and unconfigured projects before requests", async (t) => {
  const { call, requests } = setup(t);
  for (const [name, input] of [
    ["tapd_add_comment", { kind: "story", id: "11111111", workspaceId: "87654321", text: "示例评论" }],
    ["tapd_add_comment", { kind: "story", id: "11111111", workspaceId: "87654321", text: "示例评论", confirmed: false }],
    ["tapd_update_status", { kind: "story", id: "invalid", workspaceId: "87654321", status: "done", confirmed: true }],
    ["tapd_status_options", { kind: "story", workspaceId: "99999999" }],
    ["tapd_board", { filters: { modifiedWithinDays: -1 } }],
    ["tapd_board", { filters: { keyword: "x".repeat(64_001) } }],
    ["tapd_board", { filters: { keyword: "示例".repeat(12_000) } }],
    ["tapd_create", { kind: "task", title: "示例", workspaceId: "99999999", confirmed: true }],
  ]) assert.equal((await call(name, input)).isError, true, name);
  assert.equal(requests.length, 0);
});

test("detail and metadata tools reuse configured authenticated reads and preserve actual project", async (t) => {
  const { call, requests } = setup(t, entityApi);
  const detail = await call("tapd_entity", { kind: "story", id: "11111111" });
  assert.equal(detail.structuredContent.workspaceId, "87654321");
  assert.equal(detail.structuredContent.description, "完整正文");
  assert.equal(detail.structuredContent.descriptionHtml, "<p>完整正文</p>");
  for (const [name, input] of [
    ["tapd_search", { query: "示例" }], ["tapd_board", { filters: { ownerMode: "all" } }],
    ["tapd_filter_options", {}], ["tapd_filter_fields", {}], ["tapd_members", {}],
    ["tapd_status_options", { kind: "story", workspaceId: "87654321" }],
    ["tapd_create_fields", { kind: "task", workspaceId: "87654321" }], ["tapd_check", {}],
  ]) assert.ok((await call(name, input)).structuredContent, name);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(({ init }) => init.method !== "POST"));
});

test("confirmed writes verify the actual project and preserve field denylist and plain-text escaping", async (t) => {
  const { call, requests } = setup(t, entityApi);
  const item = { kind: "story", id: "11111111", workspaceId: "87654321", confirmed: true };
  assert.equal((await call("tapd_update_status", { ...item, status: "done" })).structuredContent.ok, true);
  assert.equal((await call("tapd_add_comment", { ...item, text: "<script>example</script>" })).structuredContent.ok, true);
  const created = await call("tapd_create", { kind: "task", title: "示例任务", workspaceId: item.workspaceId, storyId: item.id, confirmed: true,
    extraFields: { workspace_id: "12345678", story_id: "99999999", custom_text: "示例字段" } });
  assert.equal(created.structuredContent.kind, "task");
  const writes = requests.filter(({ init }) => init.method === "POST");
  assert.equal(writes.length, 3);
  assert.ok(writes.every(({ body }) => body.get("workspace_id") === "87654321"));
  assert.equal(writes[0].body.get("status"), "done");
  assert.match(writes[1].body.get("description"), /&lt;script&gt;/);
  assert.equal(writes[2].body.get("story_id"), "11111111");
  assert.equal(writes[2].body.get("custom_text"), "示例字段");
});

test("wrong project, invalid status, unchanged status and wrong parent cannot write", async (t) => {
  const { call, requests } = setup(t, entityApi);
  const item = { kind: "story", id: "11111111", workspaceId: "12345678", confirmed: true };
  assert.equal((await call("tapd_add_comment", { ...item, text: "示例评论" })).isError, true);
  assert.equal((await call("tapd_update_status", { ...item, workspaceId: "87654321", status: "invalid" })).isError, true);
  assert.equal((await call("tapd_update_status", { ...item, workspaceId: "87654321", status: "open" })).structuredContent.unchanged, true);
  assert.equal((await call("tapd_create", { ...item, kind: "task", title: "示例", storyId: item.id })).isError, true);
  assert.equal(requests.filter(({ init }) => init.method === "POST").length, 0);
});

test("raw failures and credentials never reach tool results, including partial failures", async (t) => {
  const { call } = setup(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error(`upstream ${initial.token} ${initial.syncGitToken}`); });
  for (const [name, input] of [["tapd_entity", { kind: "story", id: "11111111" }], ["tapd_board", { filters: { ownerMode: "all" } }], ["tapd_check", {}]]) {
    const result = JSON.stringify(await call(name, input));
    for (const secret of [initial.token, initial.syncGitToken, "upstream"]) assert.equal(result.includes(secret), false);
  }
});

test("successful item content redacts configured credentials without dropping readable fields", async (t) => {
  const { call } = setup(t, request => {
    const data = entityApi(request);
    if (Array.isArray(data) && data[0]?.Story) data[0].Story.description = `<p>${initial.token} ${initial.syncGitToken} 示例正文</p>`;
    return data;
  });
  const result = await call("tapd_entity", { kind: "story", id: "11111111" });
  assert.equal(result.isError, undefined);
  assert.match(result.structuredContent.description, /示例正文/);
  assert.match(result.structuredContent.descriptionHtml, /\[redacted\]/);
  assert.equal(JSON.stringify(result).includes(initial.token), false);
  assert.equal(JSON.stringify(result).includes(initial.syncGitToken), false);
});

test("cancellation during target verification prevents the subsequent write", async (t) => {
  const controller = new AbortController();
  const { call, requests } = setup(t, request => {
    if (request.url.pathname === "/stories") controller.abort();
    return entityApi(request);
  });
  const result = await call("tapd_add_comment", { kind: "story", id: "11111111", workspaceId: "87654321", text: "示例评论", confirmed: true }, { signal: controller.signal });
  assert.equal(result.isError, true);
  assert.equal(requests.filter(({ init }) => init.method === "POST").length, 0);
});

test("cancellation during author lookup prevents a comment POST", async (t) => {
  const controller = new AbortController();
  const { call, requests } = setup(t, request => {
    if (request.url.pathname === "/users/info") controller.abort();
    return entityApi(request);
  });
  const result = await call("tapd_add_comment", { kind: "story", id: "11111111", workspaceId: "87654321", text: "示例评论", confirmed: true }, { signal: controller.signal });
  assert.equal(result.isError, true);
  assert.ok(requests.some(({ url }) => url.pathname === "/users/info"));
  assert.equal(requests.filter(({ init }) => init.method === "POST").length, 0);
});

test("search and metadata failures, including shared pending requests, carry explicit warnings", async (t) => {
  const { call } = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: 0, info: "untrusted response" }));
  for (const [name, input] of [["tapd_search", { query: "example" }], ["tapd_filter_options", {}], ["tapd_filter_fields", {}], ["tapd_create_fields", { kind: "task", workspaceId: "87654321" }]]) {
    const results = await Promise.all([call(name, input), call(name, input)]);
    for (const result of results) {
      assert.ok(result.structuredContent.warnings.length, name);
      assert.equal(JSON.stringify(result).includes("untrusted response"), false);
    }
  }
});

test("failed child reads preserve the item with a completeness warning", async (t) => {
  const { call } = setup(t, request => {
    if (request.url.pathname === "/tasks" && request.url.searchParams.has("story_id")) throw new Error("untrusted child failure");
    return entityApi(request);
  });
  const result = await call("tapd_entity", { kind: "story", id: "11111111" });
  assert.equal(result.structuredContent.title, "示例需求");
  assert.ok(result.structuredContent.warnings.length);
});

test("search exposes per-project and total truncation instead of implying an exhaustive list", async (t) => {
  const { call } = setup(t, request => {
    if (["/stories", "/tasks", "/bugs"].includes(request.url.pathname)) {
      const wrapper = request.url.pathname === "/bugs" ? "Bug" : request.url.pathname === "/tasks" ? "Task" : "Story";
      return Array.from({ length: 5 }, (_, index) => ({ [wrapper]: { id: String(11111111 + index), name: "示例", title: "示例", status: "open" } }));
    }
    return entityApi(request);
  });
  const result = await call("tapd_search", { query: "example" });
  assert.equal(result.structuredContent.items.length, 15);
  assert.ok(result.structuredContent.warnings.some(warning => warning.includes("5")));
  assert.ok(result.structuredContent.warnings.some(warning => warning.includes("15")));
});

test("board completeness warnings survive cache hits, including a board warmed through the UI handler", async (t) => {
  const { call } = setup(t, request => {
    if (request.url.pathname.endsWith("last_steps")) throw new Error("untrusted workflow failure");
    return entityApi(request);
  });
  const { createHandlers } = await import("../server/handlers.ts");
  const input = { filters: { ...(await import("../shared/contracts.ts")).DEFAULT_FILTERS, ownerMode: "all" } };
  const ui = await createHandlers(async () => initial).board(input);
  assert.ok(ui.warnings.length);
  for (let index = 0; index < 2; index++) {
    const result = await call("tapd_board", input);
    assert.ok(result.structuredContent.warnings.length);
    assert.equal(result.structuredContent.stale, false);
  }
});

test("mine lookup failure cannot silently broaden the board to everyone", async (t) => {
  const { call, requests } = setup(t, request => {
    if (request.url.pathname === "/users/info") throw new Error("untrusted user failure");
    return entityApi(request);
  });
  assert.equal((await call("tapd_board")).isError, true);
  assert.equal(requests.filter(({ url }) => ["/stories", "/tasks", "/bugs"].includes(url.pathname)).length, 0);
});

test("session-open attaches tools alongside existing tools, skips history, and preserves explicit environment", async () => {
  const hooks = new Map();
  const cleanup = contribute({ registerSettings: () => ({ read: async () => ({ status: "ready", values: initial }), subscribe: () => () => {} }),
    handle() {}, on() {}, before: (name, callback) => hooks.set(name, callback) });
  try {
    const hook = hooks.get("agent.session_open");
    const request = { purpose: "launch", tools: [{ name: "example_existing" }], env: { TAPD_TOKEN: "example-existing", EXAMPLE: "keep" } };
    const updated = await hook({ request });
    assert.equal(new Set(updated.tools.map(tool => tool.name)).size, updated.tools.length);
    for (const name of ["tapd_agent_options", "tapd_bind_agent", "tapd_dispatch_agent"]) assert.ok(updated.tools.some(tool => tool.name === name));
    assert.equal(updated.tools[0].name, "example_existing");
    assert.equal(updated.env.TAPD_TOKEN, "example-existing");
    assert.equal(updated.env.EXAMPLE, "keep");
    assert.deepEqual(request.tools, [{ name: "example_existing" }]);
    const history = { ...request, purpose: "history" };
    assert.equal(await hook({ request: history }), history);
  } finally { cleanup(); }
});

test("main SDK setup rejects a checkout without tool support before replacing an existing dependency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapd-sdk-test-"));
  try {
    await mkdir(join(directory, "packages/plugin/dist/server"), { recursive: true });
    await writeFile(join(directory, "packages/plugin/package.json"), JSON.stringify({ name: "@getpaseo/plugin" }));
    await writeFile(join(directory, "packages/plugin/dist/server/index.d.ts"), "export {};\n");
    const installed = await realpath(new URL("../node_modules/@getpaseo/plugin", import.meta.url));
    assert.throws(() => execFileSync(process.execPath, [new URL("../scripts/use-main-sdk.mjs", import.meta.url).pathname, directory], { stdio: "pipe" }));
    assert.equal(await realpath(new URL("../node_modules/@getpaseo/plugin", import.meta.url)), installed);
    assert.ok((await readFile(join(installed, "dist/server/index.d.ts"), "utf8")).includes("defineAgentTool"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("single entity tool appends a bounded actual-project card without copying content or extra reads", async (t) => {
  const { call, requests } = setup(t, entityApi);
  const rows = [];
  const result = await call("tapd_entity", { kind: "story", id: "11111111" }, {
    ...context(), agent: { id: "example-agent" }, paseo: { agents: { ref: agentId => ({ timeline: { append: async row => { assert.equal(agentId, "example-agent"); rows.push(row); } } }) } },
  });
  assert.ok(result.structuredContent);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "tapd-entity-result");
  assert.equal(rows[0].data.entity.workspaceId, "87654321");
  assert.equal(rows[0].data.entity.title, "示例需求");
  assert.equal(rows[0].data.operation, "read");
  assert.equal(JSON.stringify(rows).includes("完整正文"), false);
  assert.equal(JSON.stringify(rows).includes(initial.token), false);
  assert.equal(requests.filter(({ url }) => url.pathname === "/stories").length, 2);
});

test("single entity keeps read success when presentation fails, and a failed read never appends success", async (t) => {
  const { call } = setup(t, entityApi);
  let appends = 0;
  const ctx = { ...context(), agent: { id: "example-agent" }, paseo: { agents: { ref: () => ({ timeline: { append: async () => { appends++; throw new Error("untrusted host error"); } } }) } } };
  const result = await call("tapd_entity", { kind: "story", id: "11111111" }, ctx);
  assert.equal(result.structuredContent.title, "示例需求");
  assert.ok(result.structuredContent.presentationWarning);
  assert.equal(JSON.stringify(result).includes("untrusted host error"), false);
  const failed = await call("tapd_entity", { kind: "task", id: "22222222" }, ctx);
  assert.equal(failed.isError, true);
  assert.equal(appends, 1);
});

test("registered detail RPC rejects changed connection and restricts guarded reads to the recorded project", async (t) => {
  const { requests } = setup(t, entityApi);
  const handlers = new Map();
  const cleanup = contribute({ registerSettings: () => ({ read: async () => ({ status: "ready", values: initial }), subscribe: () => () => {} }),
    handle: (rpc, handler) => handlers.set(rpc.name, handler), on() {}, before() {} });
  try {
    const read = handlers.get("tapd.entity");
    for (const guard of [{ workspaceId: "99999999" }, { siteUrl: "https://other.example.com" }, { apiEndpoint: "https://other.example.com" }]) {
      await assert.rejects(read({ kind: "story", id: "11111111", ...guard }), /不匹配/);
    }
    assert.equal(requests.length, 0);
    const item = await read({ kind: "story", id: "11111111", workspaceId: "87654321", siteUrl: initial.siteUrl, apiEndpoint: initial.apiEndpoint });
    assert.equal(item.workspaceId, "87654321");
    assert.ok(requests.every(({ url }) => !url.searchParams.has("workspace_id") || url.searchParams.get("workspace_id") === "87654321"));
  } finally { cleanup(); }
});

test("single card keeps partial-read warnings, bounds untrusted summaries and excludes credentials", async (t) => {
  const { call } = setup(t, request => {
    if (request.url.pathname === "/tasks" && request.url.searchParams.has("story_id")) throw new Error("untrusted failure");
    const result = entityApi(request);
    if (Array.isArray(result) && result[0]?.Story) result[0].Story.name = initial.token + "x".repeat(1000);
    return result;
  });
  const rows = [];
  const result = await call("tapd_entity", { kind: "story", id: "11111111" }, { ...context(), agent: { id: "example-agent" },
    paseo: { agents: { ref: () => ({ timeline: { append: async row => rows.push(row) } }) } } });
  assert.equal(result.isError, undefined);
  assert.equal(rows[0].data.entity.title.length, 500);
  assert.equal(rows[0].data.warnings[0], "部分数据读取失败，请在详情中重试。");
  assert.equal(JSON.stringify(rows).includes(initial.token), false);
  assert.equal(JSON.stringify(rows).includes("untrusted failure"), false);
});
