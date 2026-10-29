import { storyFieldsRpc, storyDocumentRpc } from "../shared/story-fields";
import { childrenRpc, childTypesRpc } from "../shared/contracts";
import { labelsRpc, itemLabelsRpc, createLabelRpc, updateLabelsRpc } from "../shared/labels";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { imageRpc, addCommentRpc, boardRpc, checkRpc, createFieldsRpc, createRpc, entityRpc, filterFieldsRpc, filterOptionsRpc, membersRpc, searchRpc, statusOptionsRpc, updateCheckRpc, updateStatusRpc } from "../shared/contracts";
import { updateFieldRpc, readFieldRpc, fieldDefinitionsRpc, DEFAULT_FILTERS, type EntityKind, type TapdSettingsValues } from "../shared/contracts";
import {
  addComment,
  boardWithCache,
  readCacheKey,
  createEntity,
  describeError,
  fetchColumn,
  fetchEntity,
  fetchEntitySummary,
  protectFieldData,
  fetchContentImage,
  fetchFilterFields,
  fetchFilterOptions,
  fetchMe,
  fetchMembers,
  fetchStatusOptions,
  fetchBugTransitions,
  fetchMyCommentedIds,
  fetchCreateFields,
  fetchChildHierarchy,
  fetchChildTypes,
  fetchFieldDefinitions,
  fetchStoryReadingFields,
  fetchStoryDocument,
  fetchProjectLabels,
  readItemLabels,
  updateItemLabels,
  createProjectLabel,
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
import { itemIterationRpc, iterationsRpc, updateIterationRpc } from "../shared/iteration-tools";
import { readItemIteration, fetchItemIterations, updateItemIteration } from "./iterations";

type GetValues = () => Promise<TapdSettingsValues>;

export function createHandlers(getValues: GetValues, execution: Pick<TapdConfig, "writeSignal" | "readWarnings"> = {}) {
  async function requireConfig(): Promise<{ config: TapdConfig; values: TapdSettingsValues }> {
    const values = await getValues();
    const config = { ...resolveConfig(values), ...execution };
    if (config.token.length === 0) {
      throw new Error("未配置 TAPD Token：请在「TAPD 工作台设置」中填写，或为 daemon 配置环境变量 TAPD_TOKEN。");
    }
    if (config.workspaceIds.length === 0) {
      throw new Error("未配置 TAPD 项目 ID：请在设置中填写，或为 daemon 配置环境变量 TAPD_WORKSPACE_IDS。");
    }
    return { config, values };
  }

  function protectedResult<T>(config: TapdConfig, result: T): T {
    protectFieldData(config, result);
    return result;
  }

  return {
    async storyDocument(raw: RpcInput<typeof storyDocumentRpc>): Promise<RpcOutput<typeof storyDocumentRpc>> {
      const input = storyDocumentRpc.input.parse(raw);
      const { config } = await requireConfig();
      return fetchStoryDocument(config, input);
    },
    async updateIteration(raw: RpcInput<typeof updateIterationRpc>): Promise<RpcOutput<typeof updateIterationRpc>> {
      const input = updateIterationRpc.input.parse(raw);
      const { config } = await requireConfig();
      return updateItemIteration(config, input);
    },
    async storyFields(raw: RpcInput<typeof storyFieldsRpc>): Promise<RpcOutput<typeof storyFieldsRpc>> {
      const input = storyFieldsRpc.input.parse(raw);
      const { config } = await requireConfig();
      return fetchStoryReadingFields(config, input);
    },
    async iterations(raw: RpcInput<typeof iterationsRpc>): Promise<RpcOutput<typeof iterationsRpc>> {
      const input = iterationsRpc.input.parse(raw);
      const { config } = await requireConfig();
      return protectedResult(config, await fetchItemIterations(config, input));
    },
    async itemIteration(raw: RpcInput<typeof itemIterationRpc>): Promise<RpcOutput<typeof itemIterationRpc>> {
      const input = itemIterationRpc.input.parse(raw);
      const { config } = await requireConfig();
      return readItemIteration(config, input);
    },
    async children(raw: RpcInput<typeof childrenRpc>): Promise<RpcOutput<typeof childrenRpc>> {
      const input = childrenRpc.input.parse(raw);
      const { config } = await requireConfig();
      const result = await fetchChildHierarchy(config, input.workspaceId, input.id);
      return protectedResult(config, result);
    },
    async childTypes(raw: RpcInput<typeof childTypesRpc>): Promise<RpcOutput<typeof childTypesRpc>> {
      const input = childTypesRpc.input.parse(raw); const { config } = await requireConfig();
      return protectedResult(config, await fetchChildTypes(config, input.workspaceId, input.id));
    },
    async updateLabels(raw: RpcInput<typeof updateLabelsRpc>): Promise<RpcOutput<typeof updateLabelsRpc>> {
      const input = updateLabelsRpc.input.parse(raw);
      const { config } = await requireConfig();
      return updateItemLabels(config, input);
    },
    async createLabel(raw: RpcInput<typeof createLabelRpc>): Promise<RpcOutput<typeof createLabelRpc>> {
      const input = createLabelRpc.input.parse(raw);
      const { config } = await requireConfig();
      return createProjectLabel(config, input);
    },
    async itemLabels(raw: RpcInput<typeof itemLabelsRpc>): Promise<RpcOutput<typeof itemLabelsRpc>> {
      const input = itemLabelsRpc.input.parse(raw);
      const { config } = await requireConfig();
      return readItemLabels(config, input);
    },
    async labels(raw: RpcInput<typeof labelsRpc>): Promise<RpcOutput<typeof labelsRpc>> {
      const input = labelsRpc.input.parse(raw);
      const { config } = await requireConfig();
      return fetchProjectLabels(config, input);
    },
    async board(input: RpcInput<typeof boardRpc>): Promise<RpcOutput<typeof boardRpc>> {
      const { config } = await requireConfig();
      const key = await readCacheKey(config, input.filters ?? null);
      return protectedResult(config, await boardWithCache(key, async () => {
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
      }, input.force === true));
    },

    async filterOptions(): Promise<RpcOutput<typeof filterOptionsRpc>> {
      const { config } = await requireConfig();
      return protectedResult(config, await fetchFilterOptions(config));
    },

    async members(): Promise<RpcOutput<typeof membersRpc>> {
      const { config } = await requireConfig();
      return protectedResult(config, await fetchMembers(config));
    },

    async statusOptions(input: RpcInput<typeof statusOptionsRpc>): Promise<RpcOutput<typeof statusOptionsRpc>> {
      const { config } = await requireConfig();
      if (input.kind === "bug" && input.id) return protectedResult(config, await fetchBugTransitions(config, input.workspaceId, input.id));
      return protectedResult(config, { options: await fetchStatusOptions(config, input.kind, input.workspaceId) });
    },

    async filterFields(): Promise<RpcOutput<typeof filterFieldsRpc>> {
      const { config } = await requireConfig();
      return protectedResult(config, { fields: await fetchFilterFields(config) });
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
        parentStoryId: input.parentStoryId,
        workitemTypeId: input.workitemTypeId,
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
      return protectedResult(config, await fetchCreateFields(config, input.kind, input.workspaceId, input.workitemTypeId));
    },

    async updateStatus(input: RpcInput<typeof updateStatusRpc>): Promise<RpcOutput<typeof updateStatusRpc>> {
      const { config } = await requireConfig();
      protectFieldData(config, input);
      const status = input.status.trim();
      if (!status) throw new Error("状态不能为空");
      const workspaceId = await updateEntityStatus(config, input.workspaceId ?? "", input.kind, input.id, status, input.transitionFields, input.expectedStatus);
      try {
        const actual = await fetchEntitySummary({ ...config, freshReads: true }, input.kind, input.id, workspaceId);
        protectFieldData(config, actual);
        if (actual.status === status) return { ok: true, writeState: "accepted", outcome: "verified", status: actual.status, statusLabel: actual.statusLabel };
        return { ok: false, writeState: "accepted", outcome: "unverified", status: actual.status, warning: "TAPD 已接受修改，但回读状态与请求不一致；请读取核对，勿重复提交。" };
      } catch { return { ok: false, writeState: "accepted", outcome: "unverified", status: null, warning: "TAPD 已接受修改，但当前状态未核实；请读取核对，勿重复提交。" }; }
    },

    async addComment(input: RpcInput<typeof addCommentRpc>): Promise<RpcOutput<typeof addCommentRpc>> {
      const { config } = await requireConfig();
      protectFieldData(config, input);
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
      const result = await fetchEntity({ ...config, freshReads: input.fresh ?? false, ...(input.workspaceId ? { workspaceIds: [input.workspaceId] } : {}) }, input.kind, input.id);
      return protectedResult(config, result);
    },

    async search(input: RpcInput<typeof searchRpc>): Promise<RpcOutput<typeof searchRpc>> {
      const query = input.query.trim();
      if (query.length === 0) return { items: [] };
      const { config } = await requireConfig();
      return protectedResult(config, { items: await searchEntities(config, query) });
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
      const config = { ...resolveConfig(merged), freshReads: true };
      config.protectedValues = [...(config.protectedValues ?? []), values.token];
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
        const me = protectedResult(config, await fetchMe(config));
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

  };
}
