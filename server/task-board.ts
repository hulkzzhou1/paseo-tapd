import type { AgentToolContext } from "@getpaseo/plugin/server";
import { conversationEntitySchema } from "../shared/conversation";
import { taskBoardSchema, type TaskBoard } from "../shared/task-board";
import type { TapdSettingsValues } from "../shared/contracts";
import { createOwnershipLifecycle } from "./ownership-lifecycle";
import type { AgentLinks } from "./agent-links";
import { fetchEntitySummary, fetchTaskClassification, resolveConfig } from "./tapd";

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
      if ([config.token, values.syncGitToken].filter(Boolean).some(secret => JSON.stringify(assigned).includes(secret))) throw new Error("承担关系含敏感配置，无法安全展示，请检查本机记录。");
      const items: TaskBoard["items"] = [];
      for (const link of assigned) {
        let entity = conversationEntitySchema.parse({ siteUrl: config.site, apiEndpoint: config.endpoint, workspaceId: link.tapdWorkspaceId, kind: link.kind, id: link.id });
        let classification: "unfinished" | "completed" | "unknown" = "unknown";
        let fetchedAt = "", warning = "";
        try {
          const summary = await fetchEntitySummary(config, link.kind, link.id, link.tapdWorkspaceId);
          entity = conversationEntitySchema.parse({ ...entity, ...summary });
          classification = summary.workflowAmbiguous ? "unknown" : await fetchTaskClassification(config, link.kind, link.tapdWorkspaceId, entity.status);
          fetchedAt = new Date().toISOString();
          if (classification === "unknown") warning = "无法可靠判断工作流，状态待确认。";
        } catch { warning = "单据或工作流读取失败，承担关系已保留。"; }
        for (const secret of [config.token, values.syncGitToken].filter(Boolean)) if (JSON.stringify(entity).includes(secret)) { entity = conversationEntitySchema.parse({ ...entity, title: "", status: "", statusLabel: "", owner: "" }); classification = "unknown"; warning = "摘要包含敏感配置，已隐藏。"; }
        items.push({ entity, link, classification, fetchedAt, warning });
      }
      return taskBoardSchema.parse({ agentId, workspaceId: agent.workspaceId ?? null, items, fetchedAt: new Date().toISOString(), partial: items.some(item => !!item.warning) });
    },
  };
}
