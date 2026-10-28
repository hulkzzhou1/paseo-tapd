import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";

export interface AgentTurnRecord {
  agentId: string;
  outcome: string;
  endedAt: string;
  summary: string;
  error: string;
}

const records = new Map<string, AgentTurnRecord>();
const MAX_RECORDS = 500;

type TurnOutcome = PluginLifecycleEvents["agent.turn_ended"]["outcome"];

/**
 * daemon 内存台账：agentId -> 最近一次 turn 结果。daemon 重启即清空，
 * 详情面板在无台账时回退到 agent 实时状态（RPC handler 内兜底）。
 */
export function recordTurnEnd(event: {
  agentId: string;
  outcome: TurnOutcome;
  endedAt: string;
}): AgentTurnRecord {
  const record: AgentTurnRecord = {
    agentId: event.agentId,
    outcome: event.outcome.kind,
    endedAt: event.endedAt,
    // The deprecated event history cannot establish current-turn authorship.
    summary: "",
    error: event.outcome.kind === "failed" ? "本轮执行失败，请查看会话。" : "",
  };
  records.delete(record.agentId);
  if (records.size >= MAX_RECORDS) {
    records.delete(records.keys().next().value ?? "");
  }
  records.set(record.agentId, record);
  return record;
}

export function getTurnRecord(agentId: string): AgentTurnRecord | undefined {
  return records.get(agentId);
}
