import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, next) {
  try { return next(s, c); } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".") && !/\.[a-z]+$/.test(s)) return next(s + ".ts", c);
    throw e;
  }
} });
const { createHandlers } = await import("../server/handlers.ts");
const { createTapdTools } = await import("../server/agent-tools.ts");
const { tapdSettingsSchema } = await import("../shared/contracts.ts");
const { clearTapdCache } = await import("../server/tapd.ts");
for (const key of ["TAPD_TOKEN", "TAPD_API_ENDPOINT", "TAPD_SITE_URL", "TAPD_WORKSPACE_IDS"]) delete process.env[key];
const values = tapdSettingsSchema.parse({ token: "example-secret", workspaceIds: "12345678,87654321", apiEndpoint: "https://api.example.com", siteUrl: "https://example.com" });
const target = { kind: "story", workspaceId: "12345678", id: "11111111", fieldKey: "custom_field_one" };
function fixture(t) {
  clearTapdCache();
  const state = { fields: {
    description: { label: "正文", html_type: "rich_edit", readonly: 0 },
    custom_field_one: { label: "方案设计", html_type: "textarea", readonly: 0 },
    custom_field_two: { label: "只读", html_type: "text", readonly: 1 },
    custom_field_three: { label: "未知权限", html_type: "text" },
    custom_field_four: { label: "数字", html_type: "integer", readonly: 0 },
    id: { label: "编号", html_type: "text", readonly: 0 },
  }, value: "  原始内容\n", requests: [] };
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, values.apiEndpoint);
    assert.equal(init.redirect, "error");
    const body = new URLSearchParams(init.body);
    state.requests.push({ url, body, method: init.method });
    if (state.failReads && init.method !== "POST") throw new Error("private read failure");
    let data;
    if (url.pathname.endsWith("get_fields_info")) data = state.fields;
    else if (init.method === "POST") {
      if (state.postMode === "forbidden") return Response.json({ status: 0, info: "private example-secret" }, { status: 403 });
      if (state.postMode === "rejected") return Response.json({ status: 0, info: "private example-secret" });
      if (state.postMode === "server_error") return new Response("private example-secret", { status: 500 });
      state.value = body.get(target.fieldKey);
      if (state.postMode === "lost") throw new Error("private example-secret");
      if (state.postMode === "readback_fail") state.failReads = true;
      if (state.postMode === "normalized") state.value = state.value.trim();
      data = { Story: { id: target.id } };
    }
    else data = [{ Story: { id: target.id, workspace_id: url.searchParams.get("workspace_id"), name: "示例需求", [target.fieldKey]: state.value } }];
    return Response.json({ status: 1, data });
  });
  const handlers = createHandlers(async () => values);
  const tools = createTapdTools(async () => values);
  return { state, handlers, call: (name, input, context = { signal: new AbortController().signal }) => tools.find(x => x.name === name).execute(input, context) };
}

test("field discovery preserves readonly, unknown permission and unsupported types for the actual project", async t => {
  const { call, state } = fixture(t);
  const result = await call("tapd_field_definitions", { kind: "story", workspaceId: "87654321" });
  assert.equal(result.isError, undefined);
  const fields = result.structuredContent.fields;
  assert.deepEqual(fields.map(x => [x.key, x.htmlType, x.readonly, x.supported]), [
    ["description", "rich_edit", false, true],
    ["custom_field_one", "textarea", false, true],
    ["custom_field_two", "text", true, true],
    ["custom_field_three", "text", null, true],
    ["custom_field_four", "integer", false, false],
  ]);
  assert.ok(state.requests.every(x => x.url.searchParams.get("workspace_id") === "87654321"));
  assert.ok(state.requests.every(x => x.method !== "POST"));
});

test("reading a discovered story field preserves whitespace and distinguishes null, empty and not returned", async t => {
  const { call, state } = fixture(t);
  for (const value of ["  原始内容\n", "", null, undefined]) {
    state.value = value;
    const result = await call("tapd_read_field", target);
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.returned, value !== undefined);
    assert.equal(result.structuredContent.value, value ?? null);
  }
  const reads = state.requests.filter(x => x.url.pathname === "/stories");
  assert.equal(reads.length, 4, "every field read is fresh");
  assert.ok(reads.every(x => x.url.searchParams.get("fields").includes(target.fieldKey)));
});

test("approved field replacement preserves rich text, checks old value and verifies explicit clearing", async t => {
  const { call, state } = fixture(t);
  state.fields.custom_field_one.html_type = "rich_edit";
  const value = "  <p>人工段落 &amp; 新方案</p>\n";
  const input = { ...target, expectedValue: state.value, value, confirmed: true };
  const written = await call("tapd_update_field", input);
  assert.equal(written.structuredContent.outcome, "verified");
  assert.equal(written.structuredContent.writeState, "accepted");
  assert.equal((await call("tapd_read_field", target)).structuredContent.value, value);
  const unchanged = await call("tapd_update_field", { ...input, expectedValue: value });
  assert.equal(unchanged.structuredContent.outcome, "unchanged");
  assert.equal((await call("tapd_update_field", input)).isError, true, "stale expected value is a conflict");
  const cleared = await call("tapd_update_field", { ...input, expectedValue: value, value: "" });
  assert.equal(cleared.structuredContent.outcome, "verified");
  assert.equal((await call("tapd_read_field", target)).structuredContent.value, "");
  const writes = state.requests.filter(x => x.method === "POST");
  assert.equal(writes.length, 2);
  assert.deepEqual([...writes[0].body.keys()].sort(), ["workspace_id", "id", target.fieldKey].sort());
  assert.equal(writes[0].body.get(target.fieldKey), value);
  assert.ok(writes[1].body.has(target.fieldKey), "clearing must send the empty value");
});

test("write rejection and lost responses are safe and distinguish remote acceptance from uncertainty", async t => {
  const { call, state } = fixture(t);
  for (const [mode, code, writeState] of [["forbidden", "forbidden", "rejected"], ["rejected", "api_rejected", "rejected"], ["server_error", "request_failed", "unknown"]]) {
    state.postMode = mode;
    const result = await call("tapd_update_field", { ...target, expectedValue: state.value, value: "新方案", confirmed: true });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.failure.code, code);
    assert.equal(result.structuredContent.failure.writeState, writeState);
    assert.equal(JSON.stringify(result).includes("example-secret"), false);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
  state.postMode = "lost";
  const result = await call("tapd_update_field", { ...target, expectedValue: state.value, value: "已被服务端接收", confirmed: true });
  assert.equal(result.structuredContent.failure.writeState, "unknown");
  assert.equal((await call("tapd_read_field", target)).structuredContent.value, "已被服务端接收");
  assert.equal(state.requests.filter(x => x.method === "POST").length, 4, "no automatic retries");
});

test("fresh detail recovery bypasses both cached data and an older request still in flight", async t => {
  const { handlers } = fixture(t);
  let release, waiting;
  const started = new Promise(resolve => { waiting = resolve; });
  let held = true;
  t.mock.method(globalThis, "fetch", async source => {
    const url = new URL(source);
    if (url.pathname === "/stories" && url.searchParams.has("id")) {
      if (held) {
        held = false; waiting();
        await new Promise(resolve => { release = resolve; });
        return Response.json({ status: 1, data: [{ Story: { id: target.id, name: "旧标题" } }] });
      }
      return Response.json({ status: 1, data: [{ Story: { id: target.id, name: "新标题" } }] });
    }
    return Response.json({ status: 1, data: [] });
  });
  const input = { kind: "story", id: target.id, workspaceId: target.workspaceId };
  const old = handlers.entity(input);
  await started;
  let current;
  try {
    current = await Promise.race([handlers.entity({ ...input, fresh: true }), new Promise(resolve => setTimeout(() => resolve(null), 100))]);
  } finally { release(); await old; }
  assert.equal(current?.title, "新标题");
  assert.equal((await handlers.entity({ ...input, fresh: true })).title, "新标题");
});

test("shared field handlers reject unauthorized, unsupported, unreadable and stale edits without sending", async t => {
  const { handlers, state, call } = fixture(t);
  const input = { ...target, expectedValue: state.value, value: "更新", confirmed: true };
  for (const patch of [{ confirmed: false }, { kind: "task" }, { workspaceId: "99999999" }, { fieldKey: "status" }]) {
    await assert.rejects(handlers.updateField({ ...input, ...patch }));
  }
  for (const [key, code] of [["custom_field_two", "readonly_field"], ["custom_field_three", "permission_unknown"], ["custom_field_four", "unsupported_field"], ["custom_field_absent", "field_not_returned"]]) {
    const result = await call("tapd_update_field", { ...input, fieldKey: key });
    assert.equal(result.structuredContent.failure.code, code);
    assert.equal(result.structuredContent.failure.writeState, "not_sent");
  }
  state.value = undefined;
  assert.equal((await call("tapd_update_field", input)).structuredContent.failure.code, "value_not_returned");
  state.value = "有人修改";
  assert.equal((await call("tapd_update_field", input)).structuredContent.failure.code, "conflict");
  assert.equal(state.requests.filter(x => x.method === "POST").length, 0);
});

test("field RPCs refuse credential-bearing data instead of returning a lossy old value", async t => {
  const { handlers, state } = fixture(t);
  state.value = "upstream example-secret";
  await assert.rejects(handlers.readField(target), error => !String(error).includes("example-secret"));
  state.value = "原值";
  await assert.rejects(handlers.updateField({ ...target, expectedValue: "原值", value: "example-secret", confirmed: true }));
  state.fields.custom_field_one.label = "example-secret";
  await assert.rejects(handlers.fieldDefinitions({kind:"story",workspaceId:target.workspaceId}));
  assert.equal(state.requests.filter(x => x.method === "POST").length,0);
});

test("accepted edits remain accepted when readback differs, fails or presentation fails", async t => {
  const { call, state } = fixture(t);
  for (const mode of ["readback_fail","normalized"]) {
    state.postMode = mode;
    const result = await call("tapd_update_field",{...target,expectedValue:state.value,value:`  新内容 ${mode}\n`,confirmed:true});
    assert.equal(result.isError,undefined);
    assert.equal(result.structuredContent.writeState,"accepted");
    assert.equal(result.structuredContent.outcome,"unverified");
    assert.equal(result.structuredContent.ok,false);
    state.failReads = false;
  }
  state.postMode = "";
  const result = await call("tapd_update_field",{...target,expectedValue:state.value,value:"最终内容",confirmed:true},{
    signal:new AbortController().signal,agent:{id:"example-agent"},paseo:{agents:{ref:()=>({timeline:{append:async()=>{throw Error("private presentation");}}})}},
  });
  assert.equal(result.structuredContent.outcome,"verified");
  assert.equal(result.structuredContent.ok,true);
  assert.match(result.structuredContent.presentationWarning,/勿重复提交/);
  assert.equal(state.requests.filter(x=>x.method==="POST").length,3);
});

test("metadata failures are distinguishable from an empty definition list, and cancellation prevents submission", async t => {
  const { call, state }=fixture(t);
  state.fields = {};
  assert.deepEqual((await call("tapd_field_definitions",{kind:"story",workspaceId:target.workspaceId})).structuredContent.fields,[]);
  state.failReads=true;
  assert.equal((await call("tapd_field_definitions",{kind:"story",workspaceId:target.workspaceId})).structuredContent.failure.phase,"read");
  state.failReads=false;state.fields={custom_field_one:{label:"方案",html_type:"textarea",readonly:0}};
  const abort=new AbortController();abort.abort();
  const canceled=createHandlers(async()=>values,{writeSignal:abort.signal});
  await assert.rejects(canceled.updateField({...target,expectedValue:state.value,value:"更新",confirmed:true}));
  assert.equal(state.requests.filter(x=>x.method==="POST").length,0);
});

test("a creation accepted without a returned ID is never reported as an unsent write", async t => {
  const {call}=fixture(t);
  t.mock.method(globalThis,"fetch",async()=>Response.json({status:1,data:{}}));
  const result=await call("tapd_create",{kind:"story",workspaceId:target.workspaceId,title:"示例需求",confirmed:true});
  assert.equal(result.isError,true);
  assert.equal(result.structuredContent.failure.writeState,"unknown");
});
