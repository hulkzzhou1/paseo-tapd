import assert from "node:assert/strict";
import { test } from "node:test";
import { clearTapdCache, fetchColumn } from "../server/tapd.ts";

const config = { endpoint: "https://api.example.com", site: "https://example.com", token: "", tokenSource: "none", workspaceIds: ["12345678"] };
const options = { owner: "", creator: "", keyword: "", label: "", statusScope: "active", iterationId: "", modifiedAfter: "", priorities: [], severities: [], relatedOwner: "", relatedCommentedIds: [], relatedStoryIds: [], conditions: [] };

function mockApi(t, { ignoreStatus = false, workflowUnavailable = false, allDone = false, secondProject = false, kind = "story" } = {}) {
  clearTapdCache();
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    const second = secondProject && url.searchParams.get("workspace_id") === "87654321";
    const active = kind === "task" ? "progressing" : "developing";
    const done = kind === "task" ? "done" : "status_99";
    const labels = allDone ? { [done]: "已完成" } : { [active]: "开发中", [done]: second ? "评审中" : "已完成" };
    let data = [];
    if (url.pathname.endsWith("get_fields_info")) data = { status: { options: labels } };
    if (url.pathname === "/workflows/last_steps") {
      if (workflowUnavailable) return Response.json({ status: 0 });
      data = second ? { [active]: "已完成" } : { [done]: "已完成" };
    }
    const path = kind === "story" ? "/stories" : kind === "bug" ? "/bugs" : "/tasks";
    if (url.pathname === path || url.pathname === `${path}/count`) {
      const wrapper = kind === "story" ? "Story" : kind === "bug" ? "Bug" : "Task";
      const rows = Object.keys(labels).map((status, index) => ({ [wrapper]: { id: String(index + 1), name: status, title: status, status } }))
        .filter((row) => ignoreStatus || !url.searchParams.get("status") || url.searchParams.get("status").split("|").includes(row[wrapper].status));
      data = url.pathname.endsWith("count") ? { count: rows.length } : rows;
    }
    return Response.json({ status: 1, data });
  });
}

for (const kind of ["story", "bug", "task"]) {
  for (const relatedOwner of ["", "example-user"]) {
    test(`${kind}: active scope excludes completed items in ${relatedOwner ? "related" : "ordinary"} queries`, async (t) => {
      mockApi(t, { kind });
      const result = await fetchColumn(config, kind, { ...options, relatedOwner, relatedCommentedIds: ["2"] });
      assert.equal(result.error, null);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].status, kind === "task" ? "progressing" : "developing");
      assert.equal(result.items[0].done, false);
      assert.equal(result.total, 1);
    });
  }
}

test("done and all scopes use the same terminal classification", async (t) => {
  mockApi(t);
  const done = await fetchColumn(config, "story", { ...options, statusScope: "done" });
  assert.deepEqual(done.items.map((item) => [item.status, item.done]), [["status_99", true]]);
  const all = await fetchColumn(config, "story", { ...options, statusScope: "all" });
  assert.equal(all.items.length, 2);
  assert.equal(all.items.find((item) => item.status === "status_99").done, true);
});

test("a conflicting advanced status condition cannot override active scope", async (t) => {
  mockApi(t);
  const result = await fetchColumn(config, "story", { ...options, conditions: [{ field: "status", kind: "enum", kinds: [], values: ["status_99"], from: "", to: "" }] });
  assert.equal(result.error, null);
  assert.equal(result.items.length, 0);
  assert.equal(result.total, 0);
});

test("post-filter protects ordinary and related queries when the API ignores status", async (t) => {
  mockApi(t, { ignoreStatus: true });
  for (const relatedOwner of ["", "example-user"]) {
    const result = await fetchColumn(config, "story", { ...options, relatedOwner });
    assert.deepEqual(result.items.map((item) => item.status), ["developing"]);
    assert.equal(result.total, 1);
  }
});

test("status IDs and labels remain scoped to their project", async (t) => {
  mockApi(t, { secondProject: true });
  const result = await fetchColumn({ ...config, workspaceIds: ["12345678", "87654321"] }, "story", options);
  assert.deepEqual(result.items.map((item) => [item.status, item.statusLabel]), [["developing", "开发中"], ["status_99", "评审中"]]);
  assert.equal(result.total, 2);
});

test("an entirely completed workflow produces an empty active board", async (t) => {
  mockApi(t, { allDone: true });
  const result = await fetchColumn(config, "story", options);
  assert.equal(result.items.length, 0);
  assert.equal(result.total, 0);
});

test("unavailable workflow metadata falls back to explicit completion labels", async (t) => {
  mockApi(t, { workflowUnavailable: true });
  const result = await fetchColumn(config, "story", options);
  assert.equal(result.error, null);
  assert.deepEqual(result.items.map((item) => item.status), ["developing"]);
});
