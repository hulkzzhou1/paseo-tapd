import type { EntityKind } from "../../shared/contracts";
import type { WorkbenchTheme } from "./bits";

export type StatusTone = "neutral" | "blue" | "green" | "orange" | "red";

export function statusTone(kind: EntityKind, status: string, label = "", done?: boolean): StatusTone {
  const text = label.trim() || status;
  if (/拒绝|重开|重新打开|rejected|reopened/i.test(text)) return "red";
  if (done === true || /^(?:已完成|已结束|已关闭|已实现|已验证|done|closed|completed|verified)$/i.test(text)) return "green";
  if (/未开始|待规划|挂起|暂停|planning|planned|suspended|^open$/i.test(text)) return "neutral";
  if (/测试|验证|待发布|待确认|testing/i.test(text)) return "orange";
  if (/进行|开发|实现中|评审|处理中|progress|developing|audited/i.test(text)) return "blue";
  if (status === "resolved") return kind === "bug" ? "orange" : "green";
  if (status === "done" || status === "closed" || status === "verified") return "green";
  if (status === "rejected" || status === "reopened") return "red";
  if (status === "new") return "blue";
  return "neutral";
}

export function priorityTone(value: string): StatusTone {
  const label = value.trim().toLowerCase();
  if (/^p[01](?:\b|[_-])/.test(label) || /^(紧急|最高|致命|严重|urgent|highest|critical|blocker|fatal)$/.test(label)) return "red";
  if (/^p2(?:\b|[_-])/.test(label) || /^(高|重要|high|major)$/.test(label)) return "orange";
  if (/^p3(?:\b|[_-])/.test(label) || /^(中|普通|一般|medium|normal)$/.test(label)) return "blue";
  return "neutral";
}

export function kindColor(kind: EntityKind, theme: WorkbenchTheme): string {
  return kind === "story" ? theme.colors.accent : kind === "task" ? theme.colors.statusSuccess : theme.colors.statusDanger;
}

export function toneColor(tone: StatusTone, theme: WorkbenchTheme): string {
  switch (tone) {
    case "blue": return theme.colors.accent;
    case "green": return theme.colors.statusSuccess;
    case "orange": return theme.colors.statusWarning;
    case "red": return theme.colors.statusDanger;
    default: return theme.colors.foregroundMuted;
  }
}
