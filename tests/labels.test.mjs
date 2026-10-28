import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { z } from "zod";
registerHooks({ resolve(s, c, next) {
  try { return next(s, c); } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".") && !/\.[a-z]+$/.test(s)) return next(s + ".ts", c);
    throw e;
  }
} });
const { createTapdTools } = await import("../server/agent-tools.ts");
const { tapdSettingsSchema } = await import("../shared/contracts.ts");
const { clearTapdCache } = await import("../server/tapd.ts");
const { default: contribute } = await import("../index.server.ts");
const { labelsRpc, itemLabelsRpc, createLabelRpc } = await import("../shared/labels.ts");
for (const key of ["TAPD_TOKEN", "TAPD_API_ENDPOINT", "TAPD_SITE_URL", "TAPD_WORKSPACE_IDS"]) delete process.env[key];
const values = tapdSettingsSchema.parse({ token: "example-secret", syncGitToken: "example-git-secret", workspaceIds: "12345678,87654321", apiEndpoint: "https://api.example.com", siteUrl: "https://example.com" });
const project = "87654321";
function fixture(t) {
  clearTapdCache();
  const state = { labels: [
    { id: "11111111", workspace_id: project, name: "Review:Ready", color: "2" },
    { id: "22222222", workspace_id: project, name: "review:ready", color: "3" },
    { id: "33333333", workspace_id: project, name: "  人工分类  ", color: "4" },
  ], requests: [] };
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, values.apiEndpoint);
    assert.equal(init.headers.Authorization, `Bearer ${values.token}`);
    assert.equal(init.redirect, "error");
    const body = new URLSearchParams(init.body);
    state.requests.push({ url, method: init.method, body });
    if (state.failReads && init.method !== "POST") return Response.json({ status: 0, info: "private example-secret example-git-secret" }, { status: 403 });
    if (url.pathname !== "/label") {
      const wrapper = { "/stories": "Story", "/tasks": "Task", "/bugs": "Bug" }[url.pathname];
      assert.ok(wrapper);
      return Response.json({ status: 1, data: [{ [wrapper]: { id: "44444444", workspace_id: state.itemProject ?? project, name: "示例任务", title: "示例缺陷", label: state.value } }] });
    }
    if (init.method === "POST") {
      if (state.postMode === "forbidden") return Response.json({ status: 0, info: "private example-secret" }, { status: 403 });
      if (state.postMode === "rejected") return Response.json({ status: 0, info: "private example-secret" });
      if (state.postMode === "server_error") return new Response("private example-secret", { status: 500 });
      const LabelPool = { id: "55555555", workspace_id: body.get("workspace_id"), name: body.get("name"), color: body.get("color") ?? "4" };
      if (state.postMode === "wrong_color") LabelPool.color = "1";
      state.labels.push(LabelPool);
      if (state.postMode === "lost") throw new Error("private example-secret");
      if (state.postMode === "readback_fail") state.failReads = true;
      if (state.postMode === "malformed") return Response.json({ status: 1, data: {} });
      state.afterPost?.();
      return Response.json({ status: 1, data: { LabelPool } });
    }
    if (Object.hasOwn(state, "listData")) return Response.json({ status: 1, data: state.listData });
    const limit = Number(url.searchParams.get("limit") ?? 30), page = Number(url.searchParams.get("page") ?? 1);
    const labels = state.labels.filter(label => (!url.searchParams.has("id") || label.id === url.searchParams.get("id"))
      && (!url.searchParams.has("name") || label.name.includes(url.searchParams.get("name"))));
    return Response.json({ status: 1, data: labels.slice((page - 1) * limit, page * limit).map(LabelPool => ({ LabelPool })) });
  });
  const tools = createTapdTools(async () => values);
  return { state, tools, call: (name, input, context = { signal: new AbortController().signal }) => tools.find(x => x.name === name).execute(input, context) };
}

test("project labels use explicit fresh pages and preserve generic names and actual project", async t => {
  const { call, state } = fixture(t);
  const first = await call("tapd_labels", { workspaceId: project, limit: 2 });
  assert.equal(first.isError, undefined);
  assert.deepEqual(first.structuredContent, { workspaceId: project, labels: [
    { id: "11111111", name: "Review:Ready", color: "2" },
    { id: "22222222", name: "review:ready", color: "3" },
  ], page: 1, limit: 2, truncated: true, nextPage: 2 });
  const second = await call("tapd_labels", { workspaceId: project, limit: 2, page: 2 });
  assert.equal(second.structuredContent.labels[0].name, "  人工分类  ");
  assert.equal(second.structuredContent.truncated, false);
  assert.equal(second.structuredContent.nextPage, null);
  state.labels = [];
  assert.deepEqual((await call("tapd_labels", { workspaceId: project })).structuredContent.labels, []);
  assert.equal(state.requests.length, 3);
  assert.ok(state.requests.every(x => x.method !== "POST" && x.url.pathname === "/label" && x.url.searchParams.get("workspace_id") === project));
});

test("label schemas reject unapproved or unsafe names, pages and projects before any HTTP request", async t => {
  const { call, state } = fixture(t);
  for (const [name, input] of [
    ["tapd_create_label", { workspaceId: project, name: "new" }],
    ...["", " ", "a|b", "a\nb", "x".repeat(201)].map(name => ["tapd_create_label", { workspaceId: project, name, confirmed: true }]),
    ["tapd_create_label", { workspaceId: project, name: "new", color: 5, confirmed: true }],
    ["tapd_create_label", { workspaceId: "99999999", name: "new", confirmed: true }],
    ["tapd_labels", { workspaceId: project, limit: 201 }],
    ["tapd_labels", { workspaceId: project, page: 0 }],
    ["tapd_item_labels", { workspaceId: project, kind: "story", id: "invalid" }],
  ]) assert.equal((await call(name, input)).isError, true);
  assert.equal(state.requests.length, 0);
});

test("permission denial and unreadable project-label collections never become confirmed empty", async t => {
  const { call, state } = fixture(t);
  state.failReads = true;
  for (const [name, input] of [["tapd_labels", { workspaceId: project }], ["tapd_item_labels", { workspaceId: project, kind: "task", id: "44444444" }]]) {
    const result = await call(name, input);
    assert.equal(result.structuredContent.failure.code, "forbidden");
    assert.equal(result.structuredContent.failure.writeState, "not_sent");
    assert.equal(result.structuredContent.labels, undefined);
    assert.equal(JSON.stringify(result).includes("private"), false);
    assert.equal(JSON.stringify(result).includes(values.token), false);
  }
  state.failReads = false;
  for (const listData of [undefined, null, {}, [{ LabelPool: { id: "11111111", name: "example", workspace_id: "12345678" } }]]) {
    state.listData = listData;
    assert.equal((await call("tapd_labels", { workspaceId: project })).structuredContent.failure.code, "unsupported_label_response");
  }
  assert.ok(state.requests.every(x => x.method !== "POST"));
});

test("label creation distinguishes rejection, uncertainty and accepted-unverified without any automatic retry", async t => {
  const { call, state } = fixture(t);
  let writes = 0;
  for (const [mode, expected] of [["forbidden", "rejected"], ["rejected", "rejected"], ["server_error", "unknown"], ["lost", "unknown"]]) {
    state.postMode = mode;
    const result = await call("tapd_create_label", { workspaceId: project, name: mode, confirmed: true });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.failure.writeState, expected);
    assert.equal(state.requests.filter(x => x.method === "POST").length, ++writes);
    assert.equal(JSON.stringify(result).includes("private"), false);
    assert.equal(JSON.stringify(result).includes(values.token), false);
  }
  const reconciled = await call("tapd_labels", { workspaceId: project, name: "lost" });
  assert.equal(reconciled.structuredContent.labels[0].name, "lost", "a lost creation response can be reconciled by a read");
  for (const mode of ["readback_fail", "malformed"]) {
    state.postMode = mode;
    const result = await call("tapd_create_label", { workspaceId: project, name: mode, confirmed: true });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.writeState, "accepted");
    assert.equal(result.structuredContent.outcome, "unverified");
    assert.equal(result.structuredContent.ok, false);
    assert.equal(state.requests.filter(x => x.method === "POST").length, ++writes);
    state.failReads = false;
  }
});

test("configured secrets cannot become label names or lossy fresh label values", async t => {
  const { call, state } = fixture(t);
  for (const secret of [values.token, values.syncGitToken]) {
    assert.equal((await call("tapd_create_label", { workspaceId: project, name: secret, confirmed: true })).isError, true);
    state.value = secret;
    const item = await call("tapd_item_labels", { workspaceId: project, kind: "bug", id: "44444444" });
    assert.equal(item.isError, true);
    assert.equal(JSON.stringify(item).includes(secret), false);
  }
  assert.equal(state.requests.filter(x => x.method === "POST").length, 0);
});

test("label creation verifies requested color and preserves acceptance after cancellation or malformed success", async t => {
  const { call, state } = fixture(t);
  state.postMode = "wrong_color";
  const result = await call("tapd_create_label", { workspaceId: project, name: "colored", color: 3, confirmed: true });
  assert.equal(result.structuredContent.outcome, "unverified");
  assert.equal(result.structuredContent.writeState, "accepted");
  state.postMode = "";
  const controller = new AbortController();
  state.afterPost = () => controller.abort();
  const canceled = await call("tapd_create_label", { workspaceId: project, name: "accepted", confirmed: true }, { signal: controller.signal });
  assert.equal(canceled.isError, undefined);
  assert.equal(canceled.structuredContent.writeState, "accepted");
  assert.equal(state.requests.filter(x => x.method === "POST").length, 2);
});

test("label duplicate preflight is bounded and never creates after incomplete discovery", async t => {
  const { call, state } = fixture(t);
  state.labels = Array.from({ length: 2001 }, (_, index) => ({ id: String(10000000 + index), workspace_id: project, name: `candidate-${index}`, color: "4" }));
  const result = await call("tapd_create_label", { workspaceId: project, name: "candidate", confirmed: true });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.failure.code, "label_lookup_incomplete");
  assert.equal(result.structuredContent.failure.writeState, "not_sent");
  assert.equal(state.requests.length, 10);
  assert.ok(state.requests.every(x => x.method !== "POST"));
});

test("label RPC and session tool registrations expose schema-validated public reads and creation", async t => {
  const { state } = fixture(t);
  const hooks = new Map(), handlers = new Map();
  const cleanup = contribute({ registerSettings: () => ({ read: async () => ({ status: "ready", values }), subscribe: () => () => {} }),
    handle: (rpc, handler) => handlers.set(rpc.name, handler), on() {}, before: (name, callback) => hooks.set(name, callback) });
  try {
    const session = await hooks.get("agent.session_open")({ request: { purpose: "launch", tools: [], env: {} } });
    for (const [name, rpc] of [["tapd_labels", labelsRpc], ["tapd_item_labels", itemLabelsRpc], ["tapd_create_label", createLabelRpc]]) {
      const tool = session.tools.find(tool => tool.name === name);
      assert.ok(tool);
      assert.ok(handlers.has(rpc.name));
      const schema = z.toJSONSchema(tool.input);
      for (const field of ["token", "apiEndpoint", "siteUrl"]) assert.equal(field in schema.properties, false);
      if (name === "tapd_create_label") assert.equal(schema.properties.confirmed.const, true);
    }
    for (const [rpc, input] of [[labelsRpc, { workspaceId: project }], [itemLabelsRpc, { workspaceId: project, kind: "story", id: "44444444" }], [createLabelRpc, { workspaceId: project, name: "new project label", confirmed: true }]]) {
      const result = await handlers.get(rpc.name)(input);
      assert.equal(rpc.output.safeParse(result).success, true);
    }
    const writes = state.requests.filter(x => x.method === "POST").length;
    await assert.rejects(handlers.get(createLabelRpc.name)({ workspaceId: project, name: "unapproved" }));
    assert.equal(state.requests.filter(x => x.method === "POST").length, writes);
  } finally { cleanup(); }
});

test("approved project label creation is separate from attachment, exact-name idempotent and freshly verified", async t => {
  const { call, state } = fixture(t);
  const input = { workspaceId: project, name: "阶段 / 审查：ready", confirmed: true };
  const created = await call("tapd_create_label", input);
  assert.equal(created.isError, undefined);
  assert.equal(created.structuredContent.outcome, "verified");
  assert.equal(created.structuredContent.writeState, "accepted");
  assert.equal(created.structuredContent.label.name, input.name);
  const repeated = await call("tapd_create_label", input);
  assert.equal(repeated.structuredContent.outcome, "unchanged");
  assert.equal(repeated.structuredContent.writeState, "not_sent");
  const writes = state.requests.filter(x => x.method === "POST");
  assert.equal(writes.length, 1);
  assert.deepEqual([...writes[0].body.entries()], [["workspace_id", project], ["name", input.name]]);
  assert.ok(state.requests.every(x => x.url.pathname === "/label"), "creation never attaches labels or writes comments");
});

test("fresh item labels distinguish missing, null and confirmed empty for each actual item kind", async t => {
  const { call, state } = fixture(t);
  for (const kind of ["story", "task", "bug"]) {
    for (const value of [undefined, null, "", "Review:Ready|review:ready|  人工分类  "]) {
      state.value = value;
      const result = await call("tapd_item_labels", { kind, id: "44444444", workspaceId: project });
      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent.returned, value !== undefined);
      assert.equal(result.structuredContent.value, value ?? null);
      assert.deepEqual(result.structuredContent.labels, value == null ? null : value === "" ? [] : ["Review:Ready", "review:ready", "  人工分类  "]);
      assert.equal(result.structuredContent.entity.workspaceId, project);
      assert.equal(result.structuredContent.entity.kind, kind);
    }
  }
  assert.equal(state.requests.length, 12, "each read bypasses cache");
  assert.ok(state.requests.every(x => x.method !== "POST" && x.url.searchParams.get("fields").includes("label")));
  state.itemProject = "12345678";
  assert.equal((await call("tapd_item_labels", { kind: "task", id: "44444444", workspaceId: project })).structuredContent.failure.code, "item_project_mismatch");
  state.itemProject = project;
  for (const value of [0, [], "a||b", "a|", "x".repeat(201), Array(101).fill("label").join("|")]) {
    state.value = value;
    const result = await call("tapd_item_labels", { kind: "task", id: "44444444", workspaceId: project });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.failure.code, "unsupported_label_response");
    assert.equal(result.structuredContent.labels, undefined);
  }
});
