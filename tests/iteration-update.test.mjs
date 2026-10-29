import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
registerHooks({ resolve(s, c, next) { try { return next(s, c); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".") && !/\.[a-z]+$/.test(s)) return next(s + ".ts", c); throw e; } } });
const { default: contribute } = await import("../index.server.ts");
const { tapdSettingsSchema } = await import("../shared/contracts.ts");
for (const key of ["TAPD_TOKEN", "TAPD_API_ENDPOINT", "TAPD_SITE_URL", "TAPD_WORKSPACE_IDS"]) delete process.env[key];
const target = { kind: "story", id: "11111111", workspaceId: "12345678" };
const approved = { ...target, iterationId: "44444444", expectedValue: "33333333", confirmed: true };
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "tapd-iteration-update-")), prior = process.env.PASEO_HOME; process.env.PASEO_HOME = home;
  const state = { posts: [], reads: [], value: "33333333", iteration: { id: "44444444", workspace_id: target.workspaceId, name: "Example iteration" }, cards: [] };
  const http = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST") {
      let text = ""; for await (const chunk of req) text += chunk;
      const body = new URLSearchParams(text); state.posts.push({ path: url.pathname, fields: Object.fromEntries(body) });
      if (state.post === "forbidden") { res.writeHead(403).end("private example-secret"); return; }
      if (state.post !== "mismatch") state.value = body.get("iteration_id");
      state.afterPost?.();
      if (state.post === "unknown") { req.socket.destroy(); return; }
      if (state.post === "server_error") { res.writeHead(500).end("private example-secret"); return; }
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ status: 1, data: {} })); return;
    }
    state.reads.push(url);
    if (state.respond && await state.respond(req, res, url)) return;
    if (state.offline || state.posts.length && state.post === "unverified") { res.writeHead(503).end(); return; }
    let data = [];
    if (["/stories", "/tasks", "/bugs"].includes(url.pathname)) {
      const kind = { "/stories": "Story", "/tasks": "Task", "/bugs": "Bug" }[url.pathname];
      data = [{ [state.wrapper ?? kind]: { id: target.id, workspace_id: state.project ?? target.workspaceId,
        iteration_id: state.value, name: "Example item", title: "Example defect", status: "open", owner: "example-user", ...(state.row ?? {}) } }];
    } else if (url.pathname === "/iterations") data = state.iteration ? [{ Iteration: state.iteration }] : [];
    else if (url.pathname.endsWith("get_fields_info")) data = { status: { options: { open: "Open" } } };
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ status: 1, data }));
  });
  await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
  let values = tapdSettingsSchema.parse({ token: "example-secret", workspaceIds: "12345678,87654321", apiEndpoint: `http://127.0.0.1:${http.address().port}`, siteUrl: "https://example.com" });
  const rpcs = new Map(); let before, changed;
  const agent = { id: "example-agent", workspaceId: "example-workspace", archivedAt: null };
  const ref = () => ({ address: { serverId: "example-host", agentId: agent.id }, workspaceId: agent.workspaceId, refresh: async () => ({ agent }),
    timeline: { append: async row => { if (state.failAppend) throw Error("private example-secret"); state.cards.push({ ...row, pluginId: "tapd-workbench" }); return { epoch: "example", seq: state.cards.length }; },
      refetch: async () => ({ entries: state.cards.map((item, i) => ({ item, seqStart: i + 1, seqEnd: i + 1 })), hasOlder: false, hasNewer: false, epoch: "example" }) } });
  const paseo = { agents: { ref, list: async () => ({ entries: [{ agent }], pageInfo: { hasMore: false }, subscription: { ready: Promise.resolve(), subscribe: () => () => {}, release: async () => {} } }) } };
  const context = { signal: new AbortController().signal, agent, paseo };
  const close = contribute({ registerSettings: () => ({ read: async () => ({ status: "ready", values }), subscribe: fn => { changed = fn; return () => {}; } }), handle: (rpc, fn) => rpcs.set(rpc.name, async input => rpc.output.parse(await fn(rpc.input.parse(input), context))), before: (_, fn) => { before = fn; }, on: () => {} });
  const tools = (await before({ request: { purpose: "interactive", agentId: "example-agent", tools: [], env: {} } }, context)).tools;
  t.after(async () => { close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); if (prior === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = prior; await rm(home, { recursive: true, force: true }); });
  return { state, rpc: (name, input) => { assert.ok(rpcs.has(name), `${name} is registered`); return rpcs.get(name)(input); },
    tool: (input, extra = {}) => { const tool = tools.find(tool => tool.name === "tapd_update_iteration"); assert.ok(tool, "iteration write tool registered"); return tool.execute(input, { ...context, ...extra }); },
    change: patch => { values = { ...values, ...patch }; changed(); } };
}

test("registered iteration RPC and tool update each kind with exactly identity and iteration fields", async t => {
  const f = await fixture(t);
  for (const kind of ["story", "task", "bug"]) {
    f.state.value = approved.expectedValue;
    const result = await f.rpc("tapd.update_iteration", { ...approved, kind });
    assert.equal(result.outcome, "verified"); assert.equal(result.writeState, "accepted"); assert.equal(result.ok, true);
    assert.equal((await f.rpc("tapd.item_iteration", { ...target, kind })).value, approved.iterationId);
    f.state.value = approved.expectedValue;
    const tool = await f.tool({ ...approved, kind });
    assert.equal(tool.isError, undefined); assert.equal(tool.structuredContent.outcome, "verified");
  }
  assert.deepEqual(f.state.posts.map(post => post.path), ["/stories", "/stories", "/tasks", "/tasks", "/bugs", "/bugs"]);
  assert.ok(f.state.posts.every(post => JSON.stringify(post.fields) === JSON.stringify({ workspace_id: target.workspaceId, id: target.id, iteration_id: approved.iterationId })));
  assert.ok(f.state.reads.filter(url => url.pathname === "/iterations").every(url => url.searchParams.get("id") === approved.iterationId && url.searchParams.get("workspace_id") === target.workspaceId));
});

test("an accepted iteration write survives cancellation and card append failure without becoming retryable", async t => {
  const f = await fixture(t), abort = new AbortController();
  f.state.afterPost = () => abort.abort(); f.state.failAppend = true;
  const result = await f.tool(approved, { signal: abort.signal });
  assert.equal(result.isError, undefined); assert.equal(result.structuredContent.writeState, "accepted");
  assert.equal(result.structuredContent.outcome, "verified");
  assert.match(result.structuredContent.presentationWarning, /勿重复提交/);
  assert.equal(JSON.stringify(result).includes("example-secret"), false);
  assert.equal(f.state.posts.length, 1);
});

test("iteration writes reject missing authorization, unsafe targets, unverifiable old values and stale plans before POST", async t => {
  const f = await fixture(t);
  for (const patch of [{ confirmed: false }, { confirmed: undefined }, { iterationId: "" }, { iterationId: "0" }, { iterationId: "000" },
    { iterationId: "new iteration" }, { iterationId: ["44444444"] }, { expectedValue: null }, { workspaceId: "99999999" }, { kind: "other" }, { id: "bad" }]) {
    await assert.rejects(f.rpc("tapd.update_iteration", { ...approved, ...patch }));
    assert.equal((await f.tool({ ...approved, ...patch })).isError, true);
  }
  for (const value of [null, undefined, { id: "33333333" }, "unknown"]) {
    f.state.value = value;
    assert.equal((await f.tool(approved)).structuredContent.failure.code, "value_not_returned");
  }
  f.state.value = 33333333;
  assert.equal((await f.tool(approved)).structuredContent.failure.code, "conflict", "raw old-value type must be exact");
  f.state.value = "22222222";
  assert.equal((await f.tool(approved)).structuredContent.failure.code, "conflict");
  f.state.value = approved.expectedValue;
  for (const iteration of [null, { id: approved.iterationId, workspace_id: "87654321" }, { id: "55555555", workspace_id: target.workspaceId }, { id: approved.iterationId }]) {
    f.state.iteration = iteration;
    assert.equal((await f.tool(approved)).structuredContent.failure.code, "iteration_identity_mismatch");
  }
  assert.equal(f.state.posts.length, 0);
});

test("unchanged selections do not write or create success cards, and changes during candidate validation stop", async t => {
  const f = await fixture(t);
  f.state.value = approved.iterationId;
  const result = await f.tool({ ...approved, expectedValue: approved.iterationId });
  assert.equal(result.structuredContent.outcome, "unchanged"); assert.equal(result.structuredContent.writeState, "not_sent");
  assert.equal(f.state.cards.length, 0); assert.equal(f.state.posts.length, 0);
  f.state.value = approved.expectedValue;
  f.state.respond = async (_req, _res, url) => { if (url.pathname === "/iterations") f.state.value = "22222222"; return false; };
  assert.equal((await f.tool(approved)).structuredContent.failure.code, "conflict"); assert.equal(f.state.posts.length, 0);
  f.state.value = approved.iterationId;
  assert.equal((await f.tool({ ...approved, expectedValue: approved.iterationId })).structuredContent.failure.code, "conflict", "an apparent no-op must not hide a changed old value during validation");
});

test("rejection, uncertain transport and accepted-unverified outcomes never replay a POST", async t => {
  for (const mode of ["forbidden", "unknown", "server_error", "unverified", "mismatch"]) await t.test(mode, async t => {
    const f = await fixture(t); f.state.post = mode;
    const result = await f.tool(approved);
    if (["forbidden", "unknown", "server_error"].includes(mode)) {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.failure.writeState, mode === "forbidden" ? "rejected" : "unknown");
      assert.equal(f.state.cards.length, 0);
      if (mode === "unknown") assert.equal((await f.rpc("tapd.item_iteration", target)).value, approved.iterationId, "read reconciles an ambiguous result without replay");
    } else {
      assert.equal(result.isError, undefined); assert.equal(result.structuredContent.writeState, "accepted");
      assert.equal(result.structuredContent.outcome, "unverified"); assert.equal(result.structuredContent.ok, false);
      assert.equal(f.state.cards.length, 1); assert.equal(f.state.cards[0].data.verification, "unverified");
      assert.match(f.state.cards[0].data.warnings[0], /勿重复提交/);
    }
    assert.equal(f.state.posts.length, 1); assert.equal(JSON.stringify(result).includes("example-secret"), false);
  });
});

test("cancelled or invalidated preflights never send, and protected post-acceptance data stays accepted", async t => {
  const f = await fixture(t), abort = new AbortController(); abort.abort();
  assert.equal((await f.tool(approved, { signal: abort.signal })).isError, true); assert.equal(f.state.posts.length, 0);
  f.state.respond = async (_req, _res, url) => { if (url.pathname === "/iterations") f.change({ token: "replacement-example-secret" }); return false; };
  const invalidated = await f.tool(approved); assert.equal(invalidated.structuredContent.failure.code, "invalidated"); assert.equal(f.state.posts.length, 0);
  f.state.respond = undefined;
  f.state.afterPost = () => { f.state.value = "replacement-example-secret"; };
  const accepted = await f.tool(approved);
  assert.equal(accepted.isError, undefined); assert.equal(accepted.structuredContent.outcome, "unverified"); assert.equal(accepted.structuredContent.writeState, "accepted");
  assert.equal(JSON.stringify(accepted).includes("replacement-example-secret"), false); assert.equal(f.state.posts.length, 1);
});
