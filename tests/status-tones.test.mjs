import assert from "node:assert/strict";
import { test } from "node:test";
import { kindColor, priorityTone, statusTone, toneColor } from "../client/workbench/status-tones.ts";

const theme = { colors: { accent: "accent", statusSuccess: "success", statusWarning: "warning", statusDanger: "danger", foregroundMuted: "muted" } };

test("custom status IDs use labels and completion metadata instead of fixed project numbers", () => {
  assert.equal(statusTone("story", "status_99", "已完成"), "green");
  assert.equal(statusTone("story", "status_7", "开发中", false), "blue");
  assert.equal(statusTone("story", "custom", "归档", true), "green");
  assert.equal(statusTone("bug", "custom", "已拒绝", true), "red");
  assert.equal(statusTone("story", "custom", "未完成"), "neutral");
  assert.equal(statusTone("story", "custom", "待测试"), "orange");
  assert.equal(statusTone("task", "open", "未开始"), "neutral");
  assert.equal(statusTone("bug", "resolved", "已解决"), "orange");
});

test("priority labels retain an urgency hierarchy and unknown labels stay neutral", () => {
  for (const value of ["P0", "P1 - 高", "紧急", "critical"]) assert.equal(priorityTone(value), "red");
  for (const value of ["P2", "高", "major"]) assert.equal(priorityTone(value), "orange");
  for (const value of ["P3", "中", "normal"]) assert.equal(priorityTone(value), "blue");
  for (const value of ["P4", "低", "P10", "custom", ""]) assert.equal(priorityTone(value), "neutral");
});

test("all badge colors follow the active host theme", () => {
  assert.equal(kindColor("story", theme), "accent");
  assert.equal(kindColor("task", theme), "success");
  assert.equal(kindColor("bug", theme), "danger");
  assert.deepEqual(["neutral", "blue", "green", "orange", "red"].map((tone) => toneColor(tone, theme)), ["muted", "accent", "success", "warning", "danger"]);
});
