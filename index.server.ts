import type { PluginServerContext } from "@getpaseo/plugin/server";
import { imageRpc, addCommentRpc, agentStatusRpc, boardRpc, checkRpc, createFieldsRpc, createRpc, entityRpc, filterFieldsRpc, filterOptionsRpc, membersRpc, searchRpc, statusOptionsRpc, syncPullRpc, syncPushRpc, tapdSettings, updateCheckRpc, updateStatusRpc } from "./shared/contracts";
import { createHandlers } from "./server/handlers";
import { createConversationRuntime } from "./server/conversation";
import { conversationListRpc, conversationFocusRpc, conversationRemoveRpc } from "./shared/conversation";
import { createTapdTools } from "./server/agent-tools";
import { recordTurnEnd } from "./server/agent-state";
import { clearTapdCache, resolveConfig, type TapdConfigInput } from "./server/tapd";
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

  const handlers = createHandlers(getValues);
  const conversations = createConversationRuntime(getValues);
  const tools = createTapdTools(getValues, conversations);
  server.handle(conversationListRpc, (_input, context) => conversations.list(context));
  server.handle(conversationFocusRpc, ({ agentId, entity }, context) => conversations.focus({ paseo: context.paseo, agentId }, entity));
  server.handle(conversationRemoveRpc, ({ agentId, entity }, context) => conversations.remove({ paseo: context.paseo, agentId }, entity));
  for (const event of ["agent.created", "agent.archived", "agent.closed"] as const) server.on(event, async ({ agent }, context) => {
    try { await conversations.bootstrap(context); await conversations.reconcile(agent.id); if (event === "agent.created") await conversations.observeMessages({ paseo: context.paseo, agentId: agent.id }); } catch { /* Retry through the next public context. */ }
  });
  server.handle(boardRpc, handlers.board);
  server.handle(createRpc, handlers.create);
  server.handle(createFieldsRpc, handlers.createFields);
  server.handle(updateStatusRpc, handlers.updateStatus);
  server.handle(addCommentRpc, handlers.addComment);
  server.handle(entityRpc, handlers.entity);
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

  // Agent turn 结束：记台账；开关打开且该 agent 关联了 TAPD 单据时自动回写评论
  server.on("agent.turn_ended", async (event, context) => {
    if (!event.agent.id) return;
    if (context?.paseo) { try { await conversations.observeMessages({ paseo: context.paseo, agentId: event.agent.id }, true); } catch { /* Retry message catch-up on reconnect. */ } }
    const record = recordTurnEnd({
      agentId: event.agent.id,
      outcome: event.outcome,
      endedAt: new Date().toISOString(),
      timeline: event.timeline,
    });
    void handlers.autoReportAfterTurn({ agentId: event.agent.id, record });
  });

  console.log("[tapd-workbench] server ready");
  return () => {
    unsubscribe();
    conversations.close();
  };
}
