import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { imageRpc, addCommentRpc, agentStatusRpc, boardRpc, checkRpc, createFieldsRpc, createRpc, entityRpc, filterFieldsRpc, filterOptionsRpc, membersRpc, searchRpc, statusOptionsRpc, updateCheckRpc, updateStatusRpc } from "../shared/contracts";
import { updateFieldRpc, readFieldRpc, fieldDefinitionsRpc, DEFAULT_FILTERS, type EntityKind, type TapdSettingsValues } from "../shared/contracts";
import { getTurnRecord } from "./agent-state";
import {
  addComment,
  boardWithCache,
  createEntity,
  describeError,
  fetchColumn,
  fetchEntity,
  fetchContentImage,
  fetchFilterFields,
  fetchFilterOptions,
  fetchMe,
  fetchMembers,
  fetchStatusOptions,
  fetchMyCommentedIds,
  fetchCreateFields,
  fetchFieldDefinitions,
  readEntityField,
  updateEntityField,
  fetchRelatedStoryIdsFromTasks,
  isoDateDaysAgo,
  resolveConfig,
  searchEntities,
  updateEntityStatus,
  type ColumnQueryOptions,
  type TapdConfig,
} from "./tapd";
import { checkForUpdate } from "./update-check";

type GetValues = () => Promise<TapdSettingsValues>;

export function createHandlers(getValues: GetValues, execution: Pick<TapdConfig, "writeSignal" | "readWarnings"> = {}) {
  async function requireConfig(): Promise<{ config: TapdConfig; values: TapdSettingsValues }> {
    const values = await getValues();
    const config = { ...resolveConfig(values), ...execution, protectedValues: [values.syncGitToken, process.env.TAPD_TOKEN ?? ""] };
    if (config.token.length === 0) {
      throw new Error("未配置 TAPD Token：请在「TAPD 工作台设置」中填写，或为 daemon 配置环境变量 TAPD_TOKEN。");
    }
    if (config.workspaceIds.length === 0) {
      throw new Error("未配置 TAPD 项目 ID：请在设置中填写，或为 daemon 配置环境变量 TAPD_WORKSPACE_IDS。");
    }
    return { config, values };
  }

  return {
    async board(input: RpcInput<typeof boardRpc>): Promise<RpcOutput<typeof boardRpc>> {
      const key = JSON.stringify(input.filters ?? null);
      return boardWithCache(key, async () => {
        const { config } = await requireConfig();
        const warnings = config.readWarnings ??= [];
        const filters = input.filters ?? DEFAULT_FILTERS;
        const me = await fetchMe(config).catch(() => null);
        if (filters.ownerMode === "mine" && !me?.nick) {
          throw new Error("无法识别当前用户，请重试或检查 TAPD 连接；未执行「我处理的」查询。");
        }
        const owner =
          filters.ownerMode === "mine"
            ? me?.nick ?? ""
            : filters.ownerMode === "custom"
              ? filters.owner.trim()
              : "";
        let relatedOwner = "";
        let commented: Record<EntityKind, string[]> = { story: [], task: [], bug: [] };
        let relatedStoryIds: string[] = [];
        if (filters.ownerMode === "related") {
          if (!me?.nick) {
            throw new Error("无法识别当前用户（获取 Token 用户信息失败），「我相关的」过滤暂不可用。");
          }
          relatedOwner = me.nick;
          commented = await fetchMyCommentedIds(config, me.nick);
          relatedStoryIds = await fetchRelatedStoryIdsFromTasks(config, me.nick, commented.task);
        }
        const baseOptions: Omit<ColumnQueryOptions, "relatedOwner" | "relatedCommentedIds" | "relatedStoryIds"> = {
          owner,
          creator: filters.creator.trim(),
          keyword: filters.keyword.trim(),
          label: filters.label.trim(),
          statusScope: filters.statusScope,
          iterationId: filters.iterationId.trim(),
          modifiedAfter: filters.modifiedWithinDays > 0 ? isoDateDaysAgo(filters.modifiedWithinDays) : "",
          priorities: filters.priorities,
          severities: filters.severities,
          conditions: filters.conditions,
        };
        const [story, task, bug] = await Promise.all([
          fetchColumn(config, "story", {
            ...baseOptions,
            relatedOwner,
            relatedCommentedIds: commented.story,
            relatedStoryIds,
          }),
          fetchColumn(config, "task", {
            ...baseOptions,
            relatedOwner,
            relatedCommentedIds: commented.task,
            relatedStoryIds: [],
          }),
          fetchColumn(config, "bug", {
            ...baseOptions,
            relatedOwner,
            relatedCommentedIds: commented.bug,
            relatedStoryIds: [],
          }),
        ]);
        return {
          warnings: [...new Set(warnings)],
          workspaceCount: config.workspaceIds.length,
          tokenSource: config.tokenSource,
          fetchedAt: new Date().toISOString(),
          columns: { story, task, bug },
        };
      }, input.force === true);
    },

    async filterOptions(): Promise<RpcOutput<typeof filterOptionsRpc>> {
      const { config } = await requireConfig();
      return fetchFilterOptions(config);
    },

    async members(): Promise<RpcOutput<typeof membersRpc>> {
      const { config } = await requireConfig();
      return fetchMembers(config);
    },

    async statusOptions(input: RpcInput<typeof statusOptionsRpc>): Promise<RpcOutput<typeof statusOptionsRpc>> {
      const { config } = await requireConfig();
      return { options: await fetchStatusOptions(config, input.kind, input.workspaceId) };
    },

    async filterFields(): Promise<RpcOutput<typeof filterFieldsRpc>> {
      const { config } = await requireConfig();
      return { fields: await fetchFilterFields(config) };
    },

    async create(input: RpcInput<typeof createRpc>): Promise<RpcOutput<typeof createRpc>> {
      const { config } = await requireConfig();
      const title = input.title.trim();
      if (!title) throw new Error("标题不能为空");
      return createEntity(config, {
        kind: input.kind,
        title,
        description: input.description,
        owner: input.owner,
        priority: input.priority,
        iterationId: input.iterationId,
        storyId: input.storyId,
        workspaceId: input.workspaceId,
        extraFields: input.extraFields,
      });
    },

    async updateField(raw: RpcInput<typeof updateFieldRpc>): Promise<RpcOutput<typeof updateFieldRpc>> {
      const input = updateFieldRpc.input.parse(raw);
      const { config } = await requireConfig();
      return updateEntityField(config, input);
    },

    async readField(raw: RpcInput<typeof readFieldRpc>): Promise<RpcOutput<typeof readFieldRpc>> {
      const input = readFieldRpc.input.parse(raw);
      const { config } = await requireConfig();
      return readEntityField(config, input);
    },

    async fieldDefinitions(raw: RpcInput<typeof fieldDefinitionsRpc>): Promise<RpcOutput<typeof fieldDefinitionsRpc>> {
      const input = fieldDefinitionsRpc.input.parse(raw);
      const { config } = await requireConfig();
      return fetchFieldDefinitions(config, input.kind, input.workspaceId);
    },

    async createFields(input: RpcInput<typeof createFieldsRpc>): Promise<RpcOutput<typeof createFieldsRpc>> {
      const { config } = await requireConfig();
      return fetchCreateFields(config, input.kind, input.workspaceId);
    },

    async updateStatus(input: RpcInput<typeof updateStatusRpc>): Promise<RpcOutput<typeof updateStatusRpc>> {
      const { config } = await requireConfig();
      const status = input.status.trim();
      if (!status) throw new Error("状态不能为空");
      await updateEntityStatus(config, input.workspaceId ?? "", input.kind, input.id, status);
      return { ok: true };
    },

    async addComment(input: RpcInput<typeof addCommentRpc>): Promise<RpcOutput<typeof addCommentRpc>> {
      const { config } = await requireConfig();
      const text = input.text.trim();
      if (!text) throw new Error("评论内容不能为空");
      const me = await fetchMe(config).catch(() => null);
      await addComment(config, input.workspaceId ?? "", input.kind, input.id, text, me?.nick ?? "");
      return { ok: true };
    },

    async image(input: RpcInput<typeof imageRpc>): Promise<RpcOutput<typeof imageRpc>> {
      const { config } = await requireConfig();
      return fetchContentImage(config, input.workspaceId, input.imagePath);
    },

    async entity(input: RpcInput<typeof entityRpc>): Promise<RpcOutput<typeof entityRpc>> {
      const { config } = await requireConfig();
      if ((input.siteUrl !== undefined && input.siteUrl !== config.site)
        || (input.apiEndpoint !== undefined && input.apiEndpoint !== config.endpoint)
        || (input.workspaceId !== undefined && !config.workspaceIds.includes(input.workspaceId))) {
        throw new Error("此单据与当前 TAPD 连接或项目不匹配，请检查插件设置。");
      }
      return fetchEntity({ ...config, freshReads: input.fresh ?? false, ...(input.workspaceId ? { workspaceIds: [input.workspaceId] } : {}) }, input.kind, input.id);
    },

    async search(input: RpcInput<typeof searchRpc>): Promise<RpcOutput<typeof searchRpc>> {
      const query = input.query.trim();
      if (query.length === 0) return { items: [] };
      const { config } = await requireConfig();
      return { items: await searchEntities(config, query) };
    },

    async check(input: RpcInput<typeof checkRpc>): Promise<RpcOutput<typeof checkRpc>> {
      const values = await getValues();
      const merged: TapdSettingsValues = {
        ...values,
        token: input.token === undefined ? values.token : input.token.trim(),
        workspaceIds: input.workspaceIds === undefined ? values.workspaceIds : input.workspaceIds.trim(),
        apiEndpoint: input.apiEndpoint === undefined ? values.apiEndpoint : input.apiEndpoint.trim(),
        siteUrl: input.siteUrl === undefined ? values.siteUrl : input.siteUrl.trim(),
      };
      const config = resolveConfig(merged);
      if (config.token.length === 0) {
        return {
          ok: false,
          message: "未配置 Token（设置与环境变量均为空）",
          me: null,
          workspaceCount: config.workspaceIds.length,
          tokenSource: "none",
        };
      }
      try {
        const me = await fetchMe(config);
        if (!me) {
          return {
            ok: false,
            message: "Token 验证失败：未获取到用户信息",
            me: null,
            workspaceCount: config.workspaceIds.length,
            tokenSource: config.tokenSource,
          };
        }
        return {
          ok: true,
          message: `连接成功，当前用户：${me.nick}`,
          me: me.nick,
          workspaceCount: config.workspaceIds.length,
          tokenSource: config.tokenSource,
        };
      } catch (error) {
        return {
          ok: false,
          message: describeError(error),
          me: null,
          workspaceCount: config.workspaceIds.length,
          tokenSource: config.tokenSource,
        };
      }
    },

    async updateCheck(): Promise<RpcOutput<typeof updateCheckRpc>> {
      return checkForUpdate();
    },

    async agentStatus(
      input: RpcInput<typeof agentStatusRpc>,
      context: PluginHandlerContext,
    ): Promise<RpcOutput<typeof agentStatusRpc>> {
      const ids = [...new Set(input.agentIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
      const agents = new Map<string, { status: string; updatedAt: string }>();
      if (ids.length > 0) {
        try {
          const list = await context.paseo.agents.list({ page: { limit: 200 }, filter: { includeArchived: true } });
          for (const entry of list.entries) {
            if (ids.includes(entry.agent.id)) {
              agents.set(entry.agent.id, { status: entry.agent.status, updatedAt: entry.agent.updatedAt });
            }
          }
        } catch {
          // daemon 查询失败仅缺实时状态，不阻塞详情面板
        }
      }
      return {
        items: ids.map((agentId) => {
          const live = agents.get(agentId);
          const record = getTurnRecord(agentId);
          return {
            agentId,
            status: live?.status ?? "",
            updatedAt: live?.updatedAt ?? "",
            turnOutcome: record?.outcome ?? "",
            turnEndedAt: record?.endedAt ?? "",
            turnSummary: record?.summary ?? "",
            turnError: record?.error ?? "",
          };
        }),
      };
    },

  };
}
