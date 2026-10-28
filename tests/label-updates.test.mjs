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
for (const key of ["TAPD_TOKEN", "TAPD_API_ENDPOINT", "TAPD_SITE_URL", "TAPD_WORKSPACE_IDS"]) delete process.env[key];
const values = tapdSettingsSchema.parse({ token: "example-secret", syncGitToken: "example-git-secret", workspaceIds: "12345678,87654321", apiEndpoint: "https://api.example.com", siteUrl: "https://example.com" });
const target = { kind: "story", workspaceId: "87654321", id: "11111111" };
function fixture(t) {
  clearTapdCache();
  const state = { value: "人工分类|Review:Ready|  保留空白  ", requests: [], reads: 0 };
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input), body = new URLSearchParams(init.body);
    assert.equal(url.origin, values.apiEndpoint);
    assert.equal(init.headers.Authorization, `Bearer ${values.token}`);
    assert.equal(init.redirect, "error");
    const wrapper = { "/stories": "Story", "/tasks": "Task", "/bugs": "Bug" }[url.pathname];
    assert.ok(wrapper);
    state.requests.push({ url, method: init.method, body });
    if (init.method === "POST") {
      await state.onPost?.(body);
      if (state.postMode === "forbidden") return Response.json({ status: 0, info: "private example-secret" }, { status: 403 });
      if (state.postMode === "rejected") return Response.json({ status: 0, info: "private example-secret" });
      if (state.postMode === "server_error") return new Response("private example-secret", { status: 500 });
      state.value = body.get("label");
      if (state.postMode === "lost") throw new Error("private example-secret");
      if (state.postMode === "readback_fail") state.failReads = true;
      if (state.postMode === "missing") state.value = undefined;
      if (state.postMode === "null") state.value = null;
      if (state.postMode === "dropped_unrelated") state.value = state.value.split("|").slice(1).join("|");
      if (state.postMode === "external_edit") state.value += "|其他人新增";
      if (state.postMode === "reordered") state.value = state.value.split("|").reverse().join("|");
      state.afterWrite?.();
      return Response.json({ status: 1, data: { [wrapper]: { id: target.id } } });
    }
    state.reads++;
    await state.onRead?.(state.reads);
    if (state.failReads) return Response.json({ status: 0, info: "private example-secret" }, { status: 403 });
    return Response.json({ status: 1, data: [{ [wrapper]: { id: target.id, workspace_id: target.workspaceId, label: state.value } }] });
  });
  const tools = createTapdTools(async () => values);
  return { state, call: (name, input, context = { signal: new AbortController().signal }) => tools.find(x => x.name === name).execute(input, context) };
}

test("approved incremental labels preserve unrelated exact names for story, task and bug and verify fresh", async t => {
  const { call, state } = fixture(t);
  for (const kind of ["story", "task", "bug"]) {
    state.value = "人工分类|Review:Ready|  保留空白  ";
    const result = await call("tapd_update_labels", { ...target, kind, expectedValue: state.value, add: ["review:ready"], remove: ["Review:Ready"], confirmed: true });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.outcome, "verified");
    assert.equal(result.structuredContent.writeState, "accepted");
    assert.deepEqual(result.structuredContent.labels, ["人工分类", "  保留空白  ", "review:ready"]);
    assert.equal(result.structuredContent.entity.kind, kind);
  }
  const writes = state.requests.filter(x => x.method === "POST");
  assert.deepEqual(writes.map(x => x.url.pathname), ["/stories", "/tasks", "/bugs"]);
  assert.ok(writes.every(x => x.body.get("workspace_id") === target.workspaceId && x.body.get("id") === target.id));
  assert.ok(writes.every(x => [...x.body.keys()].sort().join(",") === "id,label,workspace_id"));
  assert.equal(state.reads, 9, "fresh initial read, pre-write check and verification per item");
});

test("adding existing names and removing absent names are exact no-ops without POST", async t => {
  const { call, state } = fixture(t);
  for (const patch of [{ add: ["Review:Ready", "Review:Ready"] }, { remove: ["review:ready"] }]) {
    const result = await call("tapd_update_labels", { ...target, expectedValue: state.value, ...patch, confirmed: true });
    assert.equal(result.structuredContent.outcome, "unchanged");
    assert.equal(result.structuredContent.writeState, "not_sent");
  }
  assert.equal(state.requests.filter(x => x.method === "POST").length, 0);
});

test("unknown labels never become empty, while explicit empty permits addition and final removal safely stops", async t => {
  const { call, state } = fixture(t);
  for (const value of [undefined, null]) {
    state.value = value;
    const result = await call("tapd_update_labels", { ...target, expectedValue: "", add: ["new"], confirmed: true });
    assert.equal(result.structuredContent.failure.code, "labels_not_returned");
    assert.equal(result.structuredContent.failure.writeState, "not_sent");
  }
  state.value = "";
  assert.equal((await call("tapd_update_labels", { ...target, expectedValue: "", add: ["new"], confirmed: true })).structuredContent.outcome, "verified");
  const writes = state.requests.filter(x => x.method === "POST").length;
  for (const kind of ["story", "task", "bug"]) {
    const result = await call("tapd_update_labels", { ...target, kind, expectedValue: "new", remove: ["new"], confirmed: true });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.failure.code, "label_clear_unsupported");
    assert.equal(result.structuredContent.failure.writeState, "not_sent");
  }
  assert.equal(state.requests.filter(x => x.method === "POST").length, writes, "no empty string or undocumented clearing sentinel is sent");
});

test("initial expected-value mismatch and external changes before POST stop without overwriting", async t => {
  const { call, state } = fixture(t);
  const stale = await call("tapd_update_labels", { ...target, expectedValue: "outdated", add: ["new"], confirmed: true });
  assert.equal(stale.structuredContent.failure.code, "label_conflict");
  const before = state.value;
  state.onRead = n => { if (n === 3) state.value += "|他人分类"; };
  const changed = await call("tapd_update_labels", { ...target, expectedValue: before, add: ["new"], confirmed: true });
  assert.equal(changed.structuredContent.failure.code, "label_conflict");
  assert.equal(changed.structuredContent.failure.writeState, "not_sent");
  assert.equal(state.requests.filter(x => x.method === "POST").length, 0);
  assert.equal(state.value, before + "|他人分类");
});

test("label mutation schema rejects missing approval, old values, overlap, separators and excessive deltas before HTTP", async t => {
  const { call, state } = fixture(t);
  const input = { ...target, expectedValue: state.value, add: ["new"], confirmed: true };
  for (const patch of [
    { confirmed: false }, { confirmed: undefined }, { expectedValue: undefined }, { expectedValue: null },
    { workspaceId: "99999999" }, { kind: "wiki" }, { id: "invalid" },
    { add: [] }, { add: ["new|other"] }, { add: ["bad\nname"] }, { add: [" "] },
    { add: ["new"], remove: ["new"] }, { add: Array(101).fill("new") },
    { add: [values.token] }, { expectedValue: values.syncGitToken },
  ]) assert.equal((await call("tapd_update_labels", { ...input, ...patch })).isError, true);
  assert.equal(state.requests.length, 0);
});

test("rejected and unknown label writes never retry and can be reconciled with a fresh read", async t => {
  const { call, state } = fixture(t);
  let writes = 0;
  for (const [mode, status] of [["forbidden", "rejected"], ["rejected", "rejected"], ["server_error", "unknown"], ["lost", "unknown"]]) {
    state.postMode = mode;
    const result = await call("tapd_update_labels", { ...target, expectedValue: state.value, add: [mode], confirmed: true });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.failure.writeState, status);
    assert.equal(state.requests.filter(x => x.method === "POST").length, ++writes);
    assert.equal(JSON.stringify(result).includes(values.token), false);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
  assert.ok((await call("tapd_item_labels", target)).structuredContent.labels.includes("lost"));
  assert.equal(state.requests.filter(x => x.method === "POST").length, writes);
});

test("accepted writes require complete exact label preservation and retain uncertainty after read-back failure", async t => {
  const { call, state } = fixture(t);
  for (const mode of ["readback_fail", "missing", "null", "dropped_unrelated", "external_edit"]) {
    state.value = "人工分类|Review:Ready";
    state.postMode = mode;
    const result = await call("tapd_update_labels", { ...target, expectedValue: state.value, add: ["new"], confirmed: true });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.writeState, "accepted");
    assert.equal(result.structuredContent.outcome, "unverified");
    assert.equal(result.structuredContent.ok, false);
    state.failReads = false;
  }
  assert.equal(state.requests.filter(x => x.method === "POST").length, 5);
});

test("cancellation before POST is unsent and cancellation after acceptance never erases the completed write", async t => {
  const { call, state } = fixture(t);
  const controller = new AbortController();
  state.onRead = n => { if (n === 2) controller.abort(); };
  const stopped = await call("tapd_update_labels", { ...target, expectedValue: state.value, add: ["new"], confirmed: true }, { signal: controller.signal });
  assert.equal(stopped.structuredContent.failure.writeState, "not_sent");
  assert.equal(state.requests.filter(x => x.method === "POST").length, 0);
  state.onRead = undefined;
  const next = new AbortController();
  state.afterWrite = () => next.abort();
  const accepted = await call("tapd_update_labels", { ...target, expectedValue: state.value, add: ["new"], confirmed: true }, { signal: next.signal });
  assert.equal(accepted.isError, undefined);
  assert.equal(accepted.structuredContent.writeState, "accepted");
  assert.equal(state.requests.filter(x => x.method === "POST").length, 1);
});

test("same-item label changes serialize across independent tool and RPC callers", async t => {
  const { call, state } = fixture(t);
  const { createHandlers } = await import("../server/handlers.ts");
  const handlers = createHandlers(async () => values);
  let release, announce;
  const started = new Promise(resolve => { announce = resolve; });
  state.onPost = async () => { announce(); await new Promise(resolve => { release = resolve; }); };
  const input = { ...target, expectedValue: state.value, add: ["first"], remove: [], confirmed: true };
  const first = call("tapd_update_labels", input);
  await started;
  state.onPost = undefined;
  const readsBefore = state.reads;
  const second = handlers.updateLabels({ ...input, add: ["second"] }).then(value => ({ value }), error => ({ error }));
  await new Promise(resolve => setImmediate(resolve));
  const readsWhilePending = state.reads;
  release();
  const firstResult = await first;
  const secondResult = await second;
  assert.equal(readsWhilePending, readsBefore, "second caller must wait for first read/write/read cycle");
  assert.equal(firstResult.structuredContent.outcome, "verified");
  assert.equal(secondResult.error?.failure.code, "label_conflict");
  assert.equal(state.requests.filter(x => x.method === "POST").length, 1);
  const next = await call("tapd_update_labels", { ...input, expectedValue: state.value, add: ["second"] });
  assert.equal(next.structuredContent.outcome, "verified");
  assert.deepEqual(next.structuredContent.labels.slice(-2), ["first", "second"]);
});

test("verification permits order changes but rejects merged sets exceeding the bounded item count", async t => {
  const { call, state } = fixture(t);
  state.postMode = "reordered";
  const result = await call("tapd_update_labels", { ...target, expectedValue: state.value, add: ["new"], confirmed: true });
  assert.equal(result.structuredContent.outcome, "verified");
  state.value = Array.from({ length: 100 }, (_, index) => `label-${index}`).join("|");
  const blocked = await call("tapd_update_labels", { ...target, expectedValue: state.value, add: ["over-limit"], confirmed: true });
  assert.equal(blocked.structuredContent.failure.writeState, "not_sent");
  assert.equal(state.requests.filter(x => x.method === "POST").length, 1);
});

test("registered update-label RPC and session tool share confirmation and validated results", async t => {
  const { state } = fixture(t);
  const { default: contribute } = await import("../index.server.ts");
  const { updateLabelsRpc } = await import("../shared/labels.ts");
  const hooks = new Map(), handlers = new Map();
  const cleanup = contribute({ registerSettings: () => ({ read: async () => ({ status: "ready", values }), subscribe: () => () => {} }),
    handle: (rpc, handler) => handlers.set(rpc.name, handler), on() {}, before: (name, callback) => hooks.set(name, callback) });
  try {
    const session = await hooks.get("agent.session_open")({ request: { purpose: "launch", tools: [], env: {} } });
    const tool = session.tools.find(tool => tool.name === "tapd_update_labels");
    assert.ok(tool);
    const schema = z.toJSONSchema(tool.input);
    assert.equal(schema.properties.confirmed.const, true);
    assert.ok(schema.required.includes("expectedValue"));
    for (const field of ["token", "apiEndpoint", "siteUrl"]) assert.equal(field in schema.properties, false);
    const handler = handlers.get(updateLabelsRpc.name);
    await assert.rejects(handler({ ...target, expectedValue: state.value, add: ["new"] }));
    const result = await handler({ ...target, expectedValue: state.value, add: ["new"], confirmed: true });
    assert.equal(result.outcome, "verified");
    assert.equal(updateLabelsRpc.output.safeParse(result).success, true);
    assert.equal(state.requests.filter(x => x.method === "POST").length, 1);
  } finally { cleanup(); }
});
