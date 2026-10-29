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
const wrappers = { story: "Story", task: "Task", bug: "Bug" };
const paths = { story: "/stories", task: "/tasks", bug: "/bugs" };
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "tapd-iterations-")), prior = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const state = { requests: [], row: { id: target.id, workspace_id: target.workspaceId, iteration_id: "33333333" }, pages: [[]] };
  const http = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1"); state.requests.push({ method: req.method, url });
    if (state.respond && await state.respond(req, res, url)) return;
    let data = [];
    if (Object.values(paths).includes(url.pathname)) {
      const kind = Object.keys(paths).find(kind => paths[kind] === url.pathname);
      data = state.missing ? [] : [{ [state.wrapper ?? wrappers[kind]]: state.row }];
    } else if (url.pathname === "/iterations") data = state.pages[Number(url.searchParams.get("page") ?? 1) - 1] ?? [];
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ status: 1, data }));
  });
  await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
  let values = tapdSettingsSchema.parse({ token: "example-secret", workspaceIds: "12345678,87654321", apiEndpoint: `http://127.0.0.1:${http.address().port}`, siteUrl: "https://example.com" });
  let before, changed; const rpcs = new Map();
  const context = { signal: new AbortController().signal, agent: { id: "example-agent" } };
  const close = contribute({ registerSettings: () => ({ read: async () => ({ status: "ready", values }), subscribe: fn => { changed = fn; return () => {}; } }), handle: (rpc, fn) => rpcs.set(rpc.name, async input => rpc.output.parse(await fn(rpc.input.parse(input), context))), before: (_, fn) => { before = fn; }, on: () => {} });
  const tools = (await before({ request: { purpose: "interactive", agentId: "example-agent", tools: [], env: {} } }, context)).tools;
  t.after(async () => { close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); if (prior === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = prior; await rm(home, { recursive: true, force: true }); });
  return { state, rpc: (name, input) => { assert.ok(rpcs.has(name), `${name} is registered`); return rpcs.get(name)(input); },
    tool: (name, input) => { const tool = tools.find(tool => tool.name === name); assert.ok(tool, `${name} is registered on the session`); return tool.execute(input, context); },
    change: patch => { values = { ...values, ...patch }; changed(); } };
}

test("registered iteration reads preserve the actual raw value of each item kind without writes", async t => {
  const f = await fixture(t);
  for (const kind of ["story", "task", "bug"]) {
    const input = { ...target, kind };
    const result = await f.rpc("tapd.item_iteration", input);
    assert.deepEqual(result, { entity: input, returned: true, value: "33333333", state: "set" });
    const tool = await f.tool("tapd_item_iteration", input);
    assert.equal(tool.isError, undefined);
    assert.deepEqual(tool.structuredContent, result);
  }
  assert.ok(f.state.requests.every(request => request.method === "GET"));
  assert.ok(f.state.requests.every(request => request.url.searchParams.get("fields").includes("iteration_id")));
});

test("iteration reads distinguish absent, unknown and confirmed unset without normalizing raw identifiers", async t => {
  const f = await fixture(t);
  for (const [raw, returned, state, value] of [[undefined, false, "not_returned", null], [null, true, "unknown", null], [false, true, "unknown", null],
    ["", true, "unset", ""], ["0", true, "unset", "0"], [0, true, "unset", 0], [33333333, true, "set", 33333333],
    [" 33333333 ", true, "unknown", " 33333333 "], ["unknown", true, "unknown", "unknown"], [{ id: "33333333" }, true, "unknown", null]]) {
    f.state.row.iteration_id = raw;
    assert.deepEqual(await f.rpc("tapd.item_iteration", target), { entity: target, returned, state, value });
  }
  assert.equal(f.state.requests.filter(request => request.method !== "GET").length, 0);
});

test("registered iteration readers reject unverifiable identities and unconfigured targets before candidates", async t => {
  const f = await fixture(t);
  for (const row of [{ ...f.state.row, id: [target.id] }, { ...f.state.row, workspace_id: [target.workspaceId] },
    { ...f.state.row, id: "22222222" }, { ...f.state.row, workspace_id: "87654321" }, { id: target.id }, { ...f.state.row, entity_type: "bug" }]) {
    f.state.row = row;
    await assert.rejects(f.rpc("tapd.item_iteration", target));
    assert.equal((await f.tool("tapd_item_iteration", target)).isError, true);
  }
  f.state.row = { id: target.id, workspace_id: target.workspaceId, iteration_id: "33333333" };
  f.state.wrapper = "Task";
  await assert.rejects(f.rpc("tapd.item_iteration", target));
  f.state.wrapper = undefined; f.state.missing = true;
  await assert.rejects(f.rpc("tapd.item_iteration", target));
  const before = f.state.requests.length;
  for (const patch of [{ workspaceId: "99999999" }, { id: "invalid" }, { kind: "other" }]) {
    await assert.rejects(f.rpc("tapd.item_iteration", { ...target, ...patch }));
    assert.equal((await f.tool("tapd_item_iteration", { ...target, ...patch })).isError, true);
  }
  assert.equal(f.state.requests.length, before);
});

test("project iteration candidates page by actual item project and retain duplicate names with explicit completeness", async t => {
  const f = await fixture(t);
  f.state.pages = [Array.from({ length: 200 }, (_, i) => ({ Iteration: { id: String(33333000 + i), workspace_id: target.workspaceId, name: "Shared name", status: "open", startdate: "2026-10-01", enddate: "2026-10-31" } })),
    [{ Iteration: { id: "44444444", workspace_id: target.workspaceId, name: "Shared name" } }]];
  const first = await f.rpc("tapd.iterations", target);
  assert.equal(first.iterations.length, 200);
  assert.equal(first.hasMore, true); assert.equal(first.nextPage, 2); assert.equal(first.truncated, true); assert.equal(first.completeness, "partial");
  assert.deepEqual(first.iterations[0], { id: "33333000", workspaceId: target.workspaceId, name: "Shared name", status: "open", startDate: "2026-10-01", endDate: "2026-10-31" });
  const second = (await f.tool("tapd_iterations", { ...target, page: first.nextPage })).structuredContent;
  assert.equal(second.iterations.length, 1); assert.equal(second.iterations[0].id, "44444444");
  assert.equal(second.iterations[0].status, null); assert.equal(second.iterations[0].startDate, null);
  assert.equal(second.hasMore, false); assert.equal(second.nextPage, null); assert.equal(second.completeness, "partial", "page two alone is not the whole collection");
  f.state.pages = [[{ Iteration: { id: "44444444", workspace_id: target.workspaceId, name: "Shared name" } }]];
  assert.equal((await f.rpc("tapd.iterations", target)).completeness, "complete");
  const reads = f.state.requests.filter(request => request.url.pathname === "/iterations");
  assert.deepEqual(reads.map(request => request.url.searchParams.get("page")), ["1", "2", "1"]);
  assert.ok(reads.every(request => request.url.searchParams.get("workspace_id") === target.workspaceId && request.url.searchParams.get("limit") === "200"));
  assert.ok(f.state.requests.every(request => request.method === "GET"));
});

test("each candidate page retains transport failure and unverifiable project rows without claiming an empty collection", async t => {
  const f = await fixture(t);
  const good = { Iteration: { id: "33333333", workspace_id: target.workspaceId, name: "Example iteration" } };
  f.state.pages = [[good, { Iteration: { id: "44444444", workspace_id: "87654321", name: "Example iteration" } }]];
  const partial = await f.rpc("tapd.iterations", target);
  assert.deepEqual(partial.iterations.map(iteration => iteration.id), ["33333333"]);
  assert.equal(partial.completeness, "partial"); assert.equal(partial.failure.code, "iteration_project_mismatch");
  f.state.pages = [[{ Iteration: { id: "44444444", name: "Unknown project" } }]];
  const unknown = await f.rpc("tapd.iterations", target);
  assert.equal(unknown.completeness, "unknown"); assert.equal(unknown.iterations.length, 0); assert.equal(unknown.failure.code, "iteration_project_mismatch");
  f.state.respond = async (_req, res, url) => {
    if (url.pathname !== "/iterations") return false;
    res.writeHead(503).end("private example-secret"); return true;
  };
  const failed = await f.tool("tapd_iterations", { ...target, page: 2 });
  assert.equal(failed.isError, undefined); assert.equal(failed.structuredContent.page, 2);
  assert.equal(failed.structuredContent.completeness, "unknown"); assert.equal(failed.structuredContent.hasMore, null);
  assert.equal(failed.structuredContent.failure.phase, "read"); assert.equal(failed.structuredContent.failure.httpStatus, 503);
  assert.equal(JSON.stringify(failed).includes("private"), false); assert.equal(JSON.stringify(failed).includes("example-secret"), false);
  assert.equal(f.state.requests.filter(request => request.method !== "GET").length, 0);
});

test("fresh iteration reads do not join old requests and reject settings invalidation instead of publishing old connection data", async t => {
  const f = await fixture(t);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  let held = true;
  f.state.respond = async (_req, res, url) => {
    if (url.pathname !== "/stories" || !held) return false;
    held = false; entered(); await new Promise(resolve => { release = resolve; });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ status: 1, data: [{ Story: { ...f.state.row, iteration_id: "22222222" } }] })); return true;
  };
  const old = f.rpc("tapd.item_iteration", target);
  await started;
  try {
    const current = await f.rpc("tapd.item_iteration", target);
    assert.equal(current.value, "33333333", "fresh reads never join a held older request");
    f.change({ workspaceIds: "87654321", token: "replacement-example-secret" });
    const stale = assert.rejects(old, error => error.failure.code === "invalidated");
    release(); await stale;
    const count = f.state.requests.length;
    await assert.rejects(f.rpc("tapd.item_iteration", target));
    assert.equal((await f.tool("tapd_iterations", target)).isError, true);
    assert.equal(f.state.requests.length, count, "removed projects cannot trigger requests");
  } finally { release?.(); await old.catch(() => {}); }
});

test("iteration candidates validate the target for all kinds, preserve page bounds and reject unsafe data", async t => {
  const f = await fixture(t);
  for (const kind of ["story", "task", "bug"]) {
    const result = await f.rpc("tapd.iterations", { ...target, kind });
    assert.equal(result.completeness, "complete"); assert.deepEqual(result.entity, { ...target, kind });
  }
  const count = f.state.requests.length;
  for (const page of [0, 10_001, 1.5]) await assert.rejects(f.rpc("tapd.iterations", { ...target, page }));
  assert.equal(f.state.requests.length, count);
  f.state.row.workspace_id = "87654321";
  await assert.rejects(f.rpc("tapd.iterations", target));
  assert.equal(f.state.requests.filter(request => request.url.pathname === "/iterations").length, 3, "unverified targets do not read candidates");
  f.state.row.workspace_id = target.workspaceId;
  f.state.row.iteration_id = "example-secret";
  await assert.rejects(f.rpc("tapd.item_iteration", target), error => !String(error).includes("example-secret"));
  assert.equal(JSON.stringify(await f.tool("tapd_item_iteration", target)).includes("example-secret"), false);
  f.state.row.iteration_id = "33333333";
  f.state.pages = [[{ Iteration: { id: "33333333", workspace_id: target.workspaceId, name: "example-secret" } }]];
  await assert.rejects(f.rpc("tapd.iterations", target), error => !String(error).includes("example-secret"));
  const protectedResult = await f.tool("tapd_iterations", target);
  assert.equal(protectedResult.isError, true); assert.equal(JSON.stringify(protectedResult).includes("example-secret"), false);
  f.state.pages = [Array.from({ length: 201 }, (_, i) => ({ Iteration: { id: String(33333000 + i), workspace_id: target.workspaceId, name: "Example" } }))];
  const oversized = await f.rpc("tapd.iterations", target);
  assert.equal(oversized.truncated, true); assert.equal(oversized.completeness, "unknown"); assert.equal(oversized.failure.code, "unsupported_iteration_response");
  assert.ok(f.state.requests.every(request => request.method === "GET"));
});

test("the complete iteration RPC output boundary protects credentials even in failure metadata", async t => {
  const f = await fixture(t);
  f.change({ token: "request_failed" });
  f.state.respond = async (_req, res, url) => {
    if (url.pathname !== "/iterations") return false;
    res.writeHead(503).end(); return true;
  };
  await assert.rejects(f.rpc("tapd.iterations", target), error => !String(error).includes("request_failed"));
  assert.equal((await f.tool("tapd_iterations", target)).isError, true);
});

test("candidate pages stay isolated from a held older request and configuration changes", async t => {
  const f = await fixture(t);
  let entered, release; let held = true;
  const started = new Promise(resolve => { entered = resolve; });
  f.state.respond = async (_req, res, url) => {
    if (url.pathname !== "/iterations" || !held) return false;
    held = false; entered(); await new Promise(resolve => { release = resolve; });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ status: 1, data: [{ Iteration: { id: "22222222", workspace_id: target.workspaceId, name: "Old iteration" } }] })); return true;
  };
  const old = f.rpc("tapd.iterations", target);
  await started;
  try {
    f.state.pages = [[{ Iteration: { id: "33333333", workspace_id: target.workspaceId, name: "Current iteration" } }]];
    assert.equal((await f.rpc("tapd.iterations", target)).iterations[0].id, "33333333");
    f.change({ token: "replacement-example-secret", workspaceIds: "87654321" });
    f.state.row.workspace_id = "87654321";
    f.state.pages = [[{ Iteration: { id: "44444444", workspace_id: "87654321", name: "Current iteration" } }]];
    const next = await f.rpc("tapd.iterations", { ...target, workspaceId: "87654321" });
    assert.deepEqual(next.iterations.map(iteration => [iteration.id, iteration.workspaceId]), [["44444444", "87654321"]]);
    const stale = assert.rejects(old, error => error.failure.code === "invalidated"); release(); await stale;
    assert.ok(f.state.requests.every(request => request.method === "GET"));
  } finally { release?.(); await old.catch(() => {}); }
});
