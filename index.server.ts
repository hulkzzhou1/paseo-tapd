import { dispatchRpc } from "./shared/dispatch";
import { createDispatch } from "./server/dispatch";
import { storyFieldsRpc, storyDocumentRpc } from "./shared/story-fields";
import { itemIterationRpc, iterationsRpc, updateIterationRpc } from "./shared/iteration-tools";

import { childrenRpc, childTypesRpc } from "./shared/contracts";
import { labelsRpc, itemLabelsRpc, createLabelRpc, updateLabelsRpc } from "./shared/labels";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { updateFieldRpc, readFieldRpc, fieldDefinitionsRpc, imageRpc, addCommentRpc, boardRpc, checkRpc, createFieldsRpc, createRpc, entityRpc, filterFieldsRpc, filterOptionsRpc, membersRpc, searchRpc, statusOptionsRpc, tapdSettings, updateCheckRpc, updateStatusRpc } from "./shared/contracts";
import { createHandlers } from "./server/handlers";
import { createTapdTools } from "./server/agent-tools";
import { clearTapdCache, resolveConfig, protectFieldData, type TapdConfigInput } from "./server/tapd";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(tapdSettings);

  const getValues = async () => {
    const state = await settings.read();
    if (state.status === "ready") return state.values;
    throw new Error("TAPD 工作台配置数据无效，请到插件设置中重置。");
  };

  const handlers = createHandlers(getValues);
  server.handle(itemIterationRpc, handlers.itemIteration);
  server.handle(updateIterationRpc, handlers.updateIteration);
  server.handle(iterationsRpc, handlers.iterations);
  server.handle(childrenRpc, handlers.children);
  server.handle(childTypesRpc, handlers.childTypes);
  server.handle(labelsRpc, handlers.labels);
  server.handle(itemLabelsRpc, handlers.itemLabels);
  server.handle(createLabelRpc, handlers.createLabel);
  server.handle(updateLabelsRpc, handlers.updateLabels);
  const dispatch = createDispatch(getValues);
  server.handle(dispatchRpc, dispatch.dispatch);
  const tools = [...createTapdTools(getValues), ...dispatch.tools];
  server.handle(storyFieldsRpc, handlers.storyFields);
  server.handle(storyDocumentRpc, handlers.storyDocument);
  server.handle(boardRpc, handlers.board);
  server.handle(updateFieldRpc, handlers.updateField);
  server.handle(readFieldRpc, handlers.readField);
  server.handle(fieldDefinitionsRpc, handlers.fieldDefinitions);
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
  const unsubscribe = settings.subscribe(() => clearTapdCache());

  // 给每个 agent 会话注册 TAPD 工具并注入 TAPD 环境变量（不覆盖已有同名变量），便于 agent 直接调用 TAPD OpenAPI
  server.before("agent.session_open", async ({ request }) => {
    if (request.purpose === "history") return request;
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

  console.log("[tapd-workbench] server ready");
  return unsubscribe;
}
