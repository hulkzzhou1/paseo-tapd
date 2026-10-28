import type { AgentToolContext } from "@getpaseo/plugin/server";
import { conversationEntitySchema } from "../shared/conversation";
import { taskBoardSchema, type TaskBoard } from "../shared/task-board";
import type { TapdSettingsValues } from "../shared/contracts";
import { createOwnershipLifecycle } from "./ownership-lifecycle";
import type { AgentLinks } from "./agent-links";
import {boardSnapshotKey,getBoardSnapshot,saveBoardSnapshot,deleteBoardSnapshot,taskBoardRevision} from "./task-board-state";
import { fetchEntitySummary, fetchTaskClassification, resolveConfig, protectFieldData } from "./tapd";

export function createTaskBoard(getValues: () => Promise<TapdSettingsValues>, links: AgentLinks) {
  return {
    async read(agentId: string, context: Pick<AgentToolContext, "paseo">): Promise<TaskBoard> {
      await createOwnershipLifecycle(getValues, links).reconcile(context);
      const values = await getValues();
      const config = resolveConfig(values);
      const agent = context.paseo.agents.ref(agentId);
      await agent.refresh();
      if (!agent.current()) throw new Error("目标 Agent 不可用。");
      const assigned = (await links.list()).filter(link => link.agentId === agentId && link.responsibility && link.apiEndpoint === config.endpoint && (!link.siteUrl || link.siteUrl === config.site) && config.workspaceIds.includes(link.tapdWorkspaceId));
      protectFieldData(config, assigned);
      const items: TaskBoard["items"] = [];
      for (const link of assigned.slice(0,200)) {
        const snapshotKey = boardSnapshotKey(config,link.tapdWorkspaceId,link.kind,link.id);
        const previous = getBoardSnapshot(snapshotKey);
        let stale = false;
        let entity = conversationEntitySchema.parse({ siteUrl: config.site, apiEndpoint: config.endpoint, workspaceId: link.tapdWorkspaceId, kind: link.kind, id: link.id });
        let classification: "unfinished" | "completed" | "unknown" = "unknown";
        let fetchedAt = "", warning = "";
        try {
          const summary = await fetchEntitySummary(config, link.kind, link.id, link.tapdWorkspaceId);
          entity = conversationEntitySchema.parse({ ...entity, ...summary });
          protectFieldData(config, entity);
          classification = await fetchTaskClassification(config, link.kind, link.tapdWorkspaceId, entity.status, { workitemTypeId: summary.workitemTypeId, parallel: summary.workflowParallel });
          fetchedAt = new Date().toISOString();
          if (classification === "unknown") warning = "无法可靠判断工作流，状态待确认。";
        } catch {
          if (previous) { entity = previous.entity; fetchedAt = previous.fetchedAt; stale = true; }
          warning = previous ? "读取失败，显示上次成功摘要（已过期）；当前状态待确认。" : "单据读取失败，承担关系已保留，状态待确认。";
        }
        try { protectFieldData(config, entity); } catch {
          deleteBoardSnapshot(snapshotKey);
          entity = conversationEntitySchema.parse({ siteUrl: config.site, apiEndpoint: config.endpoint, workspaceId: link.tapdWorkspaceId, kind: link.kind, id: link.id, labels: null });
          classification = "unknown"; fetchedAt = ""; stale = false; warning = "摘要包含敏感配置，已隐藏。";
        }
        const item = { entity, link, classification, fetchedAt, warning, stale };
        if (fetchedAt && !stale) saveBoardSnapshot(snapshotKey,item);
        items.push(item);
      }
      const result = taskBoardSchema.parse({ agentId, workspaceId: agent.workspaceId ?? null, items, fetchedAt: new Date().toISOString(), partial: assigned.length>200 || items.some(item => !!item.warning), revision: taskBoardRevision(config), truncated: assigned.length>200, total: assigned.length, warnings: assigned.length>200?["看板达到每次 200 张读取上限，计数仅含已返回任务。"]:[] });
      protectFieldData(config, result); return result;
    },
  };
}
