import { createOwnershipLifecycle } from "./server/ownership-lifecycle";

import { childrenRpc, childTypesRpc } from "./shared/contracts";
import { createOwnershipMigration } from "./server/ownership-migration";
import { migrationListRpc, migrationConfirmRpc } from "./shared/ownership-migration";
import {taskBoardRevision} from "./server/task-board-state";
import { createAgentLinks, sameTask, suppressTask } from "./server/agent-links";
import { createAssignmentService, createAssignmentTools } from "./server/agent-assignment";
import { createTaskBoard } from "./server/task-board";
import { taskBoardRpc, taskClaimRpc, taskDispatchRpc, taskReleaseRpc, taskTransferRpc } from "./shared/task-board";
import { labelsRpc, itemLabelsRpc, createLabelRpc, updateLabelsRpc } from "./shared/labels";
import { agentLinksRpc, removeAgentLinkRpc } from "./shared/agent-links";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { updateFieldRpc, readFieldRpc, fieldDefinitionsRpc, imageRpc, addCommentRpc, agentStatusRpc, boardRpc, checkRpc, createFieldsRpc, createRpc, entityRpc, filterFieldsRpc, filterOptionsRpc, membersRpc, searchRpc, statusOptionsRpc, syncPullRpc, syncPushRpc, tapdSettings, updateCheckRpc, updateStatusRpc } from "./shared/contracts";
import { createHandlers } from "./server/handlers";
import { createConversationRuntime } from "./server/conversation";
import { conversationRefreshRpc, conversationBatchPageRpc, conversationListRpc, conversationFocusRpc, conversationRemoveRpc } from "./shared/conversation";
import { createTapdTools } from "./server/agent-tools";
import { recordTurnEnd } from "./server/agent-state";
import { clearTapdCache, resolveConfig, protectFieldData, type TapdConfigInput } from "./server/tapd";
import { pullSettings, pushSettings, type SyncSettingsAccess } from "./server/git-sync";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(tapdSettings);

  const getValues = async () => {
    const state = await settings.read();
    if (state.status === "ready") return state.values;
    throw new Error("TAPD 工作台配置数据无效，请到插件设置中重置。");
  };

  // Git 配置同步：推送读当前设置；拉取返回非密字段，由客户端写回设置
  const syncAccess: SyncSettingsAccess = { read: getValues };

  const agentLinks = createAgentLinks();
  const ownership = createOwnershipLifecycle(getValues, agentLinks);
  const migration = createOwnershipMigration(getValues, agentLinks);
  server.handle(migrationListRpc, ({agentId}, context) => migration.list(agentId, context));
  server.handle(migrationConfirmRpc, (input, context) => migration.confirm(input, context));
  const assignments = createAssignmentService(getValues, agentLinks);
  const taskBoard = createTaskBoard(getValues, agentLinks);
  server.handle(taskBoardRpc, ({ agentId }, context) => taskBoard.read(agentId, context));
  server.handle(taskClaimRpc, (input, context) => assignments.claim(input, context, "user", true));
  server.handle(taskDispatchRpc, (input, context) => assignments.dispatch(input, context, "user"));
  server.handle(taskTransferRpc, (input, context) => assignments.transfer(input, context));
  server.handle(taskReleaseRpc, (input, context) => assignments.release(input, context, "user", input.agentId));
  const visibleLinks = async (context: Parameters<typeof ownership.reconcile>[0]) => {
    await ownership.reconcile(context);
    const values = await getValues(), config = resolveConfig(values);
    const result = (await agentLinks.list()).filter(link => link.apiEndpoint === config.endpoint && (!link.siteUrl || link.siteUrl === config.site) && config.workspaceIds.includes(link.tapdWorkspaceId));
    protectFieldData(config, result);
    return result;
  };
  server.handle(agentLinksRpc, async (_input, context) => ({ links: await visibleLinks(context), pendingAgents: await migration.pendingAgents(), boardRevision: taskBoardRevision(resolveConfig(await getValues())) }));
  server.handle(removeAgentLinkRpc, link => agentLinks.stateTransaction(async state => {
    const matches = (item: typeof link) => sameTask(item, link) && item.agentId === link.agentId;
    if (state.links.some(item => matches(item) && item.responsibility)) throw new Error("已确认承担关系请使用退出操作并填写原因。");
    return { state: { ...suppressTask(state, link, "user"), links: state.links.filter(item => !matches(item)) }, result: { ok: true as const } };
  }));
  const handlers = createHandlers(getValues, {}, agentLinks);
  server.handle(childrenRpc, async (input, context) => { await ownership.reconcile(context).catch(() => {}); return handlers.children(input); });
  server.handle(childTypesRpc, handlers.childTypes);
  server.handle(labelsRpc, handlers.labels);
  server.handle(itemLabelsRpc, handlers.itemLabels);
  server.handle(createLabelRpc, handlers.createLabel);
  server.handle(updateLabelsRpc, handlers.updateLabels);
  const conversations = createConversationRuntime(getValues, ownership);
  const tools = [...createTapdTools(getValues, conversations, agentLinks), ...createAssignmentTools(getValues, agentLinks)];
  server.handle(conversationBatchPageRpc, (input, context) => conversations.batchPage({ paseo: context.paseo, agentId: input.agentId }, input));
  server.handle(conversationRefreshRpc, ({ agentId, entity }, context) => conversations.refreshEntity({ paseo: context.paseo, agentId }, entity).catch(() => { throw new Error("单据摘要读取失败，请刷新重试。"); }));
  server.handle(conversationListRpc, (_input, context) => conversations.list(context));
  server.handle(conversationFocusRpc, ({ agentId, entity }, context) => conversations.focus({ paseo: context.paseo, agentId }, entity));
  server.handle(conversationRemoveRpc, ({ agentId, entity }, context) => conversations.remove({ paseo: context.paseo, agentId }, entity));
  for (const event of ["agent.created", "agent.archived", "agent.closed"] as const) server.on(event, async ({ agent }, context) => {
    try { await conversations.bootstrap(context); await conversations.reconcile(agent.id); if (event === "agent.created") await conversations.observeMessages({ paseo: context.paseo, agentId: agent.id }); } catch { /* Retry through the next public context. */ }
  });
  server.handle(boardRpc, handlers.board);
  server.handle(updateFieldRpc, handlers.updateField);
  server.handle(readFieldRpc, handlers.readField);
  server.handle(fieldDefinitionsRpc, handlers.fieldDefinitions);
  server.handle(createRpc, handlers.create);
  server.handle(createFieldsRpc, handlers.createFields);
  server.handle(updateStatusRpc, handlers.updateStatus);
  server.handle(addCommentRpc, handlers.addComment);
  server.handle(entityRpc, async (input, context) => { await ownership.reconcile(context).catch(() => {}); return handlers.entity(input); });
  server.handle(imageRpc, handlers.image);
  server.handle(searchRpc, handlers.search);
  server.handle(filterOptionsRpc, handlers.filterOptions);
  server.handle(filterFieldsRpc, handlers.filterFields);
  server.handle(membersRpc, handlers.members);
  server.handle(statusOptionsRpc, handlers.statusOptions);
  server.handle(checkRpc, handlers.check);
  server.handle(updateCheckRpc, handlers.updateCheck);
  server.handle(agentStatusRpc, handlers.agentStatus);
  server.handle(syncPushRpc, async () => ({ message: await pushSettings(syncAccess) }));
  server.handle(syncPullRpc, async () => await pullSettings(syncAccess));

  // 设置变更时清缓存，并在配置了 Git 同步后自动推送备份：
  // 尾随去抖 10 秒（连续改动合并为一次推送），未配置/推送失败都静默忽略；推送/拉取本身不改设置，不会成环
  let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = settings.subscribe(() => {
    clearTapdCache();
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = null;
      void (async () => {
        try {
          const values = await getValues();
          if (!values.syncGitUrl.trim()) return;
          await pushSettings(syncAccess);
        } catch {
          // 自动推送失败不打扰用户（手动推送按钮可重试并看到错误）
        }
      })();
    }, 10_000);
  });

  // 给每个 agent 会话注册 TAPD 工具并注入 TAPD 环境变量（不覆盖已有同名变量），便于 agent 直接调用 TAPD OpenAPI
  server.before("agent.session_open", async ({ request }, context) => {
    if (context?.paseo) void conversations.bootstrap(context).catch(() => {});
    if (request.purpose === "history") return request;
    if (context?.paseo) void conversations.observeMessages({ paseo: context.paseo, agentId: request.agentId }).catch(() => {});
    const withTools = { ...request, tools: [...request.tools, ...tools] };
    let values: TapdConfigInput | null = null;
    try {
      const state = await settings.read();
      if (state.status === "ready") values = state.values;
    } catch {
      values = null;
    }
    const config = resolveConfig(values ?? { token: "", workspaceIds: "" });
    const { token, endpoint, site } = config;
    const workspaces = config.workspaceIds.join(",");
    if (!token && !workspaces) return withTools;
    const env: Record<string, string> = { ...(request.env ?? {}) };
    if (token && !env.TAPD_TOKEN) env.TAPD_TOKEN = token;
    if (endpoint && !env.TAPD_API_ENDPOINT) env.TAPD_API_ENDPOINT = endpoint;
    if (site && !env.TAPD_SITE_URL) env.TAPD_SITE_URL = site;
    if (workspaces && !env.TAPD_WORKSPACE_IDS) env.TAPD_WORKSPACE_IDS = workspaces;
    return { ...withTools, env };
  });

  // 回合结束仅记录本机状态；阶段成果由明确授权的评论工具提交。
  server.on("agent.turn_ended", async (event, context) => {
    if (!event.agent.id) return;
    if (context?.paseo) { try { await conversations.observeMessages({ paseo: context.paseo, agentId: event.agent.id }, true); } catch { /* Retry message catch-up on reconnect. */ } }
    recordTurnEnd({
      agentId: event.agent.id,
      outcome: event.outcome,
      endedAt: new Date().toISOString(),
    });
  });

  console.log("[tapd-workbench] server ready");
  return () => {
    unsubscribe();
    conversations.close();
  };
}
