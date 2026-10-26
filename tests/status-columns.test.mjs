import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStatusColumns } from "../client/workbench/status-columns.ts";

const canonical = [
  { value: "open", label: "待处理" },
  { value: "review", label: "评审中" },
  { value: "done", label: "已完成" },
];
const item = { id: "12345678", status: "review", statusLabel: "评审中" };

test("default columns omit empty workflow states while retaining all picker options and counts", () => {
  const result = buildStatusColumns([item], canonical, null);
  assert.deepEqual(result.columns.map(column => column.status), ["review"]);
  assert.deepEqual(result.columns[0].items, [item]);
  assert.deepEqual(result.pickerStatuses, canonical);
  assert.equal(result.pickerCounts.review, 1);
  assert.equal(result.pickerCounts.open ?? 0, 0);
});

test("a filtered empty board has no default columns, but explicit empty columns remain visible", () => {
  assert.deepEqual(buildStatusColumns([], canonical, null).columns, []);
  assert.deepEqual(buildStatusColumns([], canonical, []).columns, []);
  assert.deepEqual(buildStatusColumns([], canonical, ["done"]).columns, [{status:"done",label:"已完成",items:[]}]);
});

test("default columns follow workflow order and retain populated statuses missing from candidates", () => {
  const missing = { id: "87654321", status: "custom", statusLabel: "自定义状态" };
  const open = { ...item, status: "open", statusLabel: "待处理" };
  const result = buildStatusColumns([missing, item, open], canonical, null);
  assert.deepEqual(result.columns.map(column => column.status), ["open", "review", "custom"]);
  assert.equal(result.columns[2].label, "自定义状态");
  assert.equal(result.pickerCounts.custom, 1);
});

test("explicit selections retain canonical order and unknown saved columns; restoring default hides empties", () => {
  const result = buildStatusColumns([item], canonical, ["missing", "done", "open"]);
  assert.deepEqual(result.columns.map(column => column.status), ["open", "done", "missing"]);
  assert.equal(result.columns[2].label, "missing");
  assert.deepEqual(buildStatusColumns([item], canonical, null).columns.map(column => column.status), ["review"]);
});
