import assert from "node:assert/strict";
import { test } from "node:test";
import { clearTapdCache, fetchFilterFields, fetchMembers, fetchStatusOptions } from "../server/tapd.ts";

const config = { endpoint: "https://api.example.com", site: "https://example.com", token: "", tokenSource: "none", workspaceIds: ["12345678", "87654321"] };

function mockApi(t, respond) {
  clearTapdCache();
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    requests.push(url);
    return respond(url);
  });
  return requests;
}

test("member candidates include all configured projects, deduplicate nicknames and request only user", async (t) => {
  const requests = mockApi(t, (url) => Response.json({ status: 1, data:
    (url.searchParams.get("workspace_id") === "12345678" ? ["example-b", "example-a"] : ["example-a", "example-c"])
      .map((user) => ({ UserWorkspace: { user } })),
  }));
  assert.deepEqual(await fetchMembers(config), {
    members: ["example-a", "example-b", "example-c"].map((value) => ({ value, label: value })), error: null,
  });
  assert.equal(requests.length, 2);
  for (const url of requests) {
    assert.equal(url.origin, config.endpoint);
    assert.equal(url.pathname, "/workspaces/users");
    assert.equal(url.searchParams.get("fields"), "user");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["fields", "workspace_id"]);
  }
});

test("a member project failure preserves other candidates with safe feedback and is retryable", async (t) => {
  let unavailable = true;
  const requests = mockApi(t, (url) => {
    if (unavailable && url.searchParams.get("workspace_id") === "87654321") {
      return Response.json({ status: 0, info: "untrusted upstream response" });
    }
    return Response.json({ status: 1, data: [{ UserWorkspace: { user: "example-a" } }] });
  });
  const partial = await fetchMembers(config);
  assert.deepEqual(partial.members, [{ value: "example-a", label: "example-a" }]);
  assert.equal(partial.error, "部分项目的人员候选读取失败，请重试；仍可输入准确昵称。");
  unavailable = false;
  assert.equal((await fetchMembers(config)).error, null);
  assert.equal(requests.length, 4);
});

test("malformed member payloads are failures rather than empty success, while valid nicknames remain usable", async (t) => {
  let data = { unexpected: [] };
  mockApi(t, () => Response.json({ status: 1, data }));
  assert.ok((await fetchMembers(config)).error);
  data = [null, { UserWorkspace: { user: {} } }, { UserWorkspace: { user: " " } },
    { UserWorkspace: { user: "x".repeat(201) } }, { UserWorkspace: { user: "example\nuser" } },
    { UserWorkspace: { user: " example-valid " } }];
  const partial = await fetchMembers(config);
  assert.deepEqual(partial.members, [{ value: "example-valid", label: "example-valid" }]);
  assert.ok(partial.error);
  data = [];
  assert.deepEqual(await fetchMembers(config), { members: [], error: null });
});

for (const [kind, path] of [["story", "/stories/get_fields_info"], ["task", "/tasks/get_fields_info"], ["bug", "/bugs/get_fields_info"]]) {
  test(`${kind} status candidates belong only to the requested configured project`, async (t) => {
    const requests = mockApi(t, () => Response.json({ status: 1, data: { status: { options: { custom_open: "待处理", custom_done: "已完成" } } } }));
    assert.deepEqual(await fetchStatusOptions(config, kind, "87654321"), [
      { value: "custom_open", label: "待处理" }, { value: "custom_done", label: "已完成" },
    ]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].pathname, path);
    assert.equal(requests[0].searchParams.get("workspace_id"), "87654321");
    assert.equal(requests[0].searchParams.get("all_options"), null);
  });
}

test("status candidates reject unconfigured projects and invalid kinds before any network request", async (t) => {
  const requests = mockApi(t, () => Response.json({ status: 1, data: { status: { options: {} } } }));
  for (const [kind, workspaceId] of [["story", "99999999"], ["story", ""], ["story", "x".repeat(129)], ["unknown", "12345678"]]) {
    await assert.rejects(fetchStatusOptions(config, kind, workspaceId), /项目|类型/);
  }
  assert.equal(requests.length, 0);
});

test("status candidate failures expose only safe retry feedback and malformed metadata never becomes success", async (t) => {
  let response = { status: 0, info: "untrusted upstream response" };
  const requests = mockApi(t, () => Response.json(response));
  for (const payload of [
    response,
    { status: 1, data: null },
    { status: 1, data: { status: { options: [] } } },
    { status: 1, data: { status: { options: { open: {} } } } },
    { status: 1, data: { status: { options: { ["x".repeat(201)]: "待处理" } } } },
    { status: 1, data: { status: { options: { open: "x".repeat(201) } } } },
    { status: 1, data: { status: { options: { open: " " } } } },
  ]) {
    response = payload;
    await assert.rejects(fetchStatusOptions(config, "task", "12345678"), { message: "读取状态选项失败，请重试。" });
  }
  response = { status: 1, data: { status: { options: { open: "待处理" } } } };
  assert.deepEqual(await fetchStatusOptions(config, "task", "12345678"), [{ value: "open", label: "待处理" }]);
  assert.equal(requests.length, 8);
});

test("advanced filters expose read-only workflow states independently for each entity kind", async (t) => {
  mockApi(t, (url) => Response.json({ status: 1, data: {
    status: { label: "状态", readonly: 1, options: { custom: url.pathname.startsWith("/tasks") ? "任务进行中" : url.pathname.startsWith("/bugs") ? "缺陷待处理" : "需求开发中" } },
    v_status: { label: "状态显示", html_type: "text" },
  } }));
  const fields = await fetchFilterFields(config);
  assert.equal(fields.length, 3);
  for (const [kind, label] of [["story", "需求开发中"], ["task", "任务进行中"], ["bug", "缺陷待处理"]]) {
    const field = fields.find((field) => field.kinds[0] === kind);
    assert.ok(field);
    assert.equal(field.key, "status");
    assert.equal(field.kind, "enum");
    assert.equal(field.single, false);
    assert.deepEqual(field.kinds, [kind]);
    assert.deepEqual(field.options, [{ value: "custom", label }]);
  }
});
