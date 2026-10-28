import { defineAttachmentSource, defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
export const labelNameSchema = z.string().min(1).max(200).regex(/^[^|\u0000-\u001f\u007f]+$/)
  .refine(value => value.trim().length > 0, "Label names cannot be blank");
// Old snapshots omit labels; null is an unreadable value, while [] confirms an empty set.
export const entityLabelsSchema = z.array(labelNameSchema).max(100).nullable().optional();


export const entityKindSchema = z.enum(["story", "task", "bug"]);
export type EntityKind = z.infer<typeof entityKindSchema>;

// ---------------------------------------------------------------------------
// 过滤条件（工作台工具栏与视图共用同一套维度）
// ---------------------------------------------------------------------------

export const filtersSchema = z.object({
  /** 标题关键字（需求/任务按标题、缺陷按标题模糊匹配） */
  keyword: z.string().default(""),
  /** 处理人：mine=只看我的，related=我相关（处理/创建/抄送/评论），all=全部，custom=指定昵称 */
  ownerMode: z.enum(["mine", "related", "all", "custom"]).default("mine"),
  /** ownerMode=custom 时的昵称 */
  owner: z.string().default(""),
  /** 创建人昵称；空字符串=全部 */
  creator: z.string().default(""),
  /** 状态范围：all=全部，active=仅进行中，done=仅已结束 */
  statusScope: z.enum(["all", "active", "done"]).default("all"),
  /** 迭代 ID；空字符串=全部迭代 */
  iterationId: z.string().default(""),
  /** 更新时间范围：0=不限，N=近 N 天 */
  modifiedWithinDays: z.number().default(0),
  /** 优先级（priority_label）多选值 */
  priorities: z.array(z.string()).default([]),
  /** 严重程度（severity，仅缺陷）多选值 */
  severities: z.array(z.string()).default([]),
  /** 标签（label）精确值；空字符串=全部 */
  label: z.string().default(""),
  /** 高级筛选条件（字段来自 fields_info 动态获取） */
  conditions: z.array(
    z.object({
      field: z.string(),
      label: z.string().default(""),
      kind: z.enum(["text", "enum", "date", "user"]).default("text"),
      kinds: z.array(entityKindSchema).default([]),
      values: z.array(z.string()).default([]),
      from: z.string().default(""),
      to: z.string().default(""),
    }),
  ).default([]),
});
export type TapdFilters = z.infer<typeof filtersSchema>;
export type TapdCondition = TapdFilters["conditions"][number];

export const DEFAULT_FILTERS: TapdFilters = filtersSchema.parse({});

// ---------------------------------------------------------------------------
// 视图（= 可复用的过滤条件预设）
// ---------------------------------------------------------------------------

export const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  filters: filtersSchema.default(DEFAULT_FILTERS),
});
export type TapdView = z.infer<typeof viewSchema>;

export const DEFAULT_VIEWS: readonly TapdView[] = [
  { id: "related", name: "我相关的", filters: { ...DEFAULT_FILTERS, ownerMode: "related" } },
];

export const DEFAULT_VIEW: TapdView = DEFAULT_VIEWS[0];

export function effectiveViews(values: { views: readonly TapdView[] }): readonly TapdView[] {
  return values.views.length > 0 ? values.views : DEFAULT_VIEWS;
}

export function resolveView(
  values: { views: readonly TapdView[]; defaultViewId: string },
  viewId: string,
): TapdView {
  const views = effectiveViews(values);
  const wanted = viewId.trim() || values.defaultViewId.trim();
  return views.find((view) => view.id === wanted) ?? views[0];
}

export const tapdBaseUrlSchema = z.union([
  z.literal(""),
  z.url({ protocol: /^https?$/ }).max(2048).refine((value) => {
    try {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }, "地址不能包含账号、密码、查询参数或片段"),
]);

export const tapdSettingsSchema = z.object({
  token: z.string().default(""),
  apiEndpoint: tapdBaseUrlSchema.default(""),
  siteUrl: tapdBaseUrlSchema.default(""),
  workspaceIds: z.string().default(""),
  views: z.array(viewSchema).default([]),
  defaultViewId: z.string().default(""),
  /** 收藏（置顶）单据，键为 `${kind}-${id}` */
  favorites: z.array(z.string()).default([]),
  /** 看板各类型显示的状态列（kind -> 状态 key 列表）；未设置或为空 = 自动（仅展示有数据的状态） */
  columns: z.record(z.string(), z.array(z.string())).default({}),
  /** 聚合视图：列内按状态分组（可折叠），默认关闭 */
  groupByStatus: z.boolean().default(false),
  /** 单据 ↔ 工作区/Agent 关联（派活记录） */
  links: z.array(
    z.object({
      key: z.string(),
      kind: entityKindSchema,
      id: z.string(),
      workspaceId: z.string(),
      agentId: z.string().default(""),
      workspaceTitle: z.string().default(""),
      agentTitle: z.string().default(""),
      createdAt: z.string().default(""),
    }),
  ).default([]),
  /** 上次派活使用的仓库与模型（默认值） */
  lastRepoPath: z.string().default(""),
  lastProvider: z.string().default(""),
  /** Legacy setting retained for saved configuration compatibility; no longer triggers writes. */
  autoReportAgentResult: z.boolean().default(false),
  /** 看板自动刷新间隔（秒）：0=关闭；>0 时客户端按该间隔定时强制刷新（下限 30 秒，上限 3600 秒） */
  autoRefreshSeconds: z.number().int().min(0).max(3600).default(0),
  /** 挂载创建（需求详情建任务/缺陷）动态字段的布局：kind → { order: 显示顺序, hidden: 隐藏清单 }；order 未覆盖的字段按服务端原序追加 */
  createFieldLayout: z
    .record(
      z.string(),
      z.object({
        order: z.array(z.string()).default([]),
        hidden: z.array(z.string()).default([]),
      }),
    )
    .default({}),
});
export type TapdLink = TapdSettingsValues["links"][number];
export type TapdSettingsValues = z.infer<typeof tapdSettingsSchema>;

export const tapdSettings = defineSettings({
  id: "tapd-workbench-config",
  scope: "host",
  version: 7,
  schema: tapdSettingsSchema,
  migrate: (values, fromVersion) => {
    const previous = (values ?? {}) as Record<string, unknown>;
    let migrated: Record<string, unknown> = previous;

    if (fromVersion < 3) {
      const token = typeof previous.token === "string" ? previous.token : "";
      const workspaceIds = typeof previous.workspaceIds === "string" ? previous.workspaceIds : "";
      let rawViews: Record<string, unknown>[] = [];
      if (Array.isArray(previous.views)) {
        rawViews = previous.views.filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
        );
      } else {
        // v1：平铺的 owner / hideDone
        const owner = typeof previous.owner === "string" ? previous.owner.trim() : "";
        rawViews = [
          {
            id: "mine",
            name: owner ? `处理人 ${owner}` : "我处理的",
            mine: owner.length === 0,
            owner,
            hideDone: previous.hideDone === true,
            iterationId: "",
          },
        ];
      }
      const views = rawViews.map((view, index) => {
        const owner = typeof view.owner === "string" ? view.owner.trim() : "";
        const mine = view.mine === true && owner.length === 0;
        const ownerMode = mine ? "mine" : owner.length > 0 ? "custom" : "all";
        return {
          id: typeof view.id === "string" && view.id ? view.id : `view-${index + 1}`,
          name: typeof view.name === "string" && view.name ? view.name : "未命名视图",
          filters: {
            keyword: "",
            ownerMode,
            owner,
            creator: "",
            statusScope: view.hideDone === true ? "active" : "all",
            iterationId: typeof view.iterationId === "string" ? view.iterationId : "",
            modifiedWithinDays: 0,
            priorities: [],
            severities: [],
            label: "",
            conditions: [],
          },
        };
      });
      migrated = {
        ...migrated,
        token,
        workspaceIds,
        views,
        defaultViewId:
          typeof previous.defaultViewId === "string" && previous.defaultViewId
            ? previous.defaultViewId
            : views[0]?.id ?? "",
      };
    }

    if (fromVersion < 4) {
      const token = typeof migrated.token === "string" ? migrated.token : "";
      const workspaceIds = typeof migrated.workspaceIds === "string" ? migrated.workspaceIds : "";
      const views = Array.isArray(migrated.views) ? [...(migrated.views as Record<string, unknown>[])] : [];
      const hasRelated = views.some((view) => {
        const filters = view?.filters as Record<string, unknown> | undefined;
        return filters?.ownerMode === "related";
      });
      if (views.length > 0 && !hasRelated) {
        views.push({ id: "related", name: "我相关的", filters: { ...DEFAULT_FILTERS, ownerMode: "related" } });
      }
      migrated = {
        ...migrated,
        token,
        workspaceIds,
        views,
        defaultViewId: typeof migrated.defaultViewId === "string" ? migrated.defaultViewId : "",
      };
    }

    if (fromVersion < 5) {
      const token = typeof migrated.token === "string" ? migrated.token : "";
      const workspaceIds = typeof migrated.workspaceIds === "string" ? migrated.workspaceIds : "";
      const rawViews = Array.isArray(migrated.views) ? (migrated.views as Record<string, unknown>[]) : [];
      // 移除预置的「我处理的」视图（id 固定为 mine；用户自建视图 id 为 view-xxx，不受影响）
      const views = rawViews.filter((view) => view?.id !== "mine");
      const previousDefault = typeof migrated.defaultViewId === "string" ? migrated.defaultViewId : "";
      migrated = {
        ...migrated,
        token,
        workspaceIds,
        views,
        defaultViewId: previousDefault === "mine" ? "" : previousDefault,
      };
    }

    if (fromVersion < 7) {
      migrated = { ...migrated };
      for (const key of ["syncGitUrl", "syncGitToken", "syncBranch"]) delete migrated[key];
    }

    return migrated;
  },
});

// ---------------------------------------------------------------------------
// RPC 契约
// ---------------------------------------------------------------------------

const entitySummarySchema = z.object({
  labels: entityLabelsSchema,
  kind: entityKindSchema,
  id: z.string(),
  title: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  owner: z.string(),
  priority: z.string(),
  iterationName: z.string().nullable(),
  modified: z.string(),
  done: z.boolean(),
  url: z.string(),
  /** 仅任务/缺陷：所属需求 ID（空 = 无关联需求） */
  storyId: z.string().default(""),
  /** 所属需求标题（尽力解析，解析失败为空） */
  storyTitle: z.string().default(""),
});

const columnSchema = z.object({
  kind: entityKindSchema,
  total: z.number(),
  items: z.array(entitySummarySchema),
  truncated: z.boolean(),
  error: z.string().nullable(),
});

export const boardRpc = defineRpc({
  name: "tapd.board",
  input: z.object({
    filters: filtersSchema.optional(),
    /** 绕过看板缓存强制重拉（手动刷新按钮用） */
    force: z.boolean().optional(),
  }),
  output: z.object({
    warnings: z.array(z.string()).default([]),
    workspaceCount: z.number(),
    tokenSource: z.enum(["env", "settings", "none"]),
    fetchedAt: z.string(),
    /** 本结果来自已过期的缓存，daemon 正在后台刷新 */
    stale: z.boolean().default(false),
    /** 缓存生成时间（stale 展示用） */
    cachedAt: z.string().default(""),
    columns: z.object({
      story: columnSchema,
      task: columnSchema,
      bug: columnSchema,
    }),
  }),
});

export const filterOptionsRpc = defineRpc({
  name: "tapd.filter_options",
  input: z.object({}),
  output: z.object({
    priorities: z.array(
      z.object({ value: z.string(), label: z.string(), kinds: z.array(entityKindSchema) }),
    ),
    severities: z.array(z.object({ value: z.string(), label: z.string() })),
    iterations: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), startDate: z.string().default(""), endDate: z.string().default("") })),
    statuses: z.object({
      story: z.array(z.object({ value: z.string(), label: z.string() })),
      task: z.array(z.object({ value: z.string(), label: z.string() })),
      bug: z.array(z.object({ value: z.string(), label: z.string() })),
    }),
  }),
});

const candidateTextSchema = z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/);
const candidateOptionSchema = z.object({ value: candidateTextSchema, label: candidateTextSchema });

export const membersRpc = defineRpc({
  name: "tapd.members",
  input: z.object({}),
  output: z.object({
    members: z.array(candidateOptionSchema),
    error: z.string().max(200).nullable(),
  }),
});

export const statusOptionsRpc = defineRpc({
  name: "tapd.status_options",
  input: z.object({
    kind: entityKindSchema,
    workspaceId: z.string().trim().min(1).max(128),
  }),
  output: z.object({ options: z.array(candidateOptionSchema) }),
});

export const filterFieldsRpc = defineRpc({
  name: "tapd.filter_fields",
  input: z.object({}),
  output: z.object({
    fields: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        kind: z.enum(["text", "enum", "date", "user"]),
        /** 单选字段（checkbox/radio） */
        single: z.boolean(),
        options: z.array(z.object({ value: z.string(), label: z.string() })),
        kinds: z.array(entityKindSchema),
      }),
    ),
  }),
});

const fieldProjectSchema = z.object({
  kind: z.literal("story"),
  workspaceId: z.string().regex(/^\d+$/).min(1).max(100),
});
export const fieldDefinitionSchema = z.object({
  key: z.string().max(100), label: z.string().max(500), htmlType: z.string().max(100),
  readonly: z.boolean().nullable(), supported: z.boolean(),
});
export const fieldDefinitionsRpc = defineRpc({
  name: "tapd.field_definitions",
  input: fieldProjectSchema,
  output: z.object({ fields: z.array(fieldDefinitionSchema) }),
});
const fieldTargetSchema = fieldProjectSchema.extend({
  id: z.string().regex(/^\d+$/).min(1).max(100),
  fieldKey: z.string().max(100).regex(/^(description|custom_field_[a-zA-Z0-9_]+)$/),
});
const fieldEntitySchema = fieldProjectSchema.extend({
  id: z.string(), title: z.string(), status: z.string(), statusLabel: z.string(), owner: z.string(),
});
const fieldReadSchema = z.object({
  field: fieldDefinitionSchema, returned: z.boolean(), value: z.string().max(50_000).nullable(),
  modifiedAt: z.string(), entity: fieldEntitySchema,
});
export const readFieldRpc = defineRpc({
  name: "tapd.read_field", input: fieldTargetSchema, output: fieldReadSchema,
});
export const updateFieldRpc = defineRpc({
  name: "tapd.update_field",
  input: fieldTargetSchema.extend({
    expectedValue: z.string().max(50_000).nullable(),
    value: z.string().max(50_000),
    confirmed: z.literal(true),
  }),
  output: z.object({
    ok: z.boolean(), outcome: z.enum(["unchanged", "verified", "unverified"]),
    writeState: z.enum(["not_sent", "accepted", "unknown"]),
    entity: fieldEntitySchema,
  }),
});

export const createRpc = defineRpc({
  name: "tapd.create",
  input: z.object({
    kind: entityKindSchema,
    title: z.string(),
    description: z.string().default(""),
    owner: z.string().default(""),
    priority: z.string().default(""),
    iterationId: z.string().default(""),
    /** 挂载的需求 ID（仅 task/bug；留空不挂载） */
    storyId: z.string().default(""),
    parentStoryId: z.string().max(100).regex(/^\d*$/).default(""),
    workitemTypeId: z.string().max(100).regex(/^\d*$/).default(""),
    /** 单据所在项目，缺省用 daemon 配置的第一个项目 */
    workspaceId: z.string().default(""),
    /** 动态表单收集的其余可写字段（服务端做 denylist 过滤） */
    extraFields: z.record(z.string(), z.string()).default({}),
  }),
  output: z.object({
    id: z.string(),
    kind: entityKindSchema,
    url: z.string(),
    writeState: z.enum(["accepted"]).optional(),
    outcome: z.enum(["verified", "unverified"]).optional(),
  }),
});

/** 挂载创建用的动态字段表：该类型 fields_info 中可写字段 + 当前登录用户 */
export const createFieldsRpc = defineRpc({
  name: "tapd.create_fields",
  input: z.object({
    kind: entityKindSchema,
    workspaceId: z.string().default(""),
    workitemTypeId: z.string().max(100).regex(/^\d*$/).optional(),
  }),
  output: z.object({
    me: z.string().default(""),
    fields: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        inputKind: z.enum(["text", "textarea", "enum", "user", "date"]),
        single: z.boolean(),
        options: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
        required: z.boolean().default(false),
      }),
    ),
  }),
});

export const updateStatusRpc = defineRpc({
  name: "tapd.update_status",
  input: z.object({
    kind: entityKindSchema,
    id: z.string(),
    status: z.string(),
    /** 单据实际所在项目；未指定时读取已配置项目以核实实际归属 */
    workspaceId: z.string().default(""),
  }),
  output: z.object({ ok: z.boolean(), writeState: z.literal("accepted"), outcome: z.enum(["verified", "unverified"]), status: z.string().nullable(), statusLabel: z.string().optional(), warning: z.string().optional() }),
});

export const addCommentRpc = defineRpc({
  name: "tapd.add_comment",
  input: z.object({
    kind: entityKindSchema,
    id: z.string(),
    text: z.string(),
    /** 单据实际所在项目；未指定时读取已配置项目以核实实际归属 */
    workspaceId: z.string().default(""),
  }),
  output: z.object({ ok: z.boolean() }),
});

export const entityChildItemSchema = z.object({
  workspaceId: z.string().default(""), status: z.string().default(""), parentId: z.string().default(""),
  ownershipUnknown: z.boolean().default(false),
  responsibleAgent: z.object({ id: z.string(), title: z.string() }).nullable().default(null),
  kind: entityKindSchema,
  id: z.string(),
  title: z.string(),
  statusLabel: z.string(),
  owner: z.string(),
  priority: z.string(),
  url: z.string(),
});

export const childReadMetaSchema = z.object({ total: z.number().nullable(), partial: z.boolean(), truncated: z.boolean(), error: z.string().nullable() });
export const childrenRpc = defineRpc({ name: "tapd.children", input: z.object({ workspaceId: z.string().regex(/^\d+$/).max(100), id: z.string().regex(/^\d+$/).max(100) }), output: z.object({ items: z.array(entityChildItemSchema), reads: z.object({ story: childReadMetaSchema, task: childReadMetaSchema, bug: childReadMetaSchema }) }) });
export const childTypesRpc = defineRpc({ name: "tapd.child_types", input: childrenRpc.input, output: z.object({ types: z.array(z.object({ id: z.string(), name: z.string() })) }) });

export const entityRpc = defineRpc({
  name: "tapd.entity",
  input: z.object({
    fresh: z.boolean().optional(), kind: entityKindSchema, id: z.string(), workspaceId: z.string().min(1).max(100).optional(),
    siteUrl: z.string().max(4096).optional(), apiEndpoint: z.string().max(4096).optional() }),
  output: z.object({
    labels: entityLabelsSchema,
    kind: entityKindSchema,
    id: z.string(),
    /** 单据实际所在项目（回写状态/评论用） */
    workspaceId: z.string().default(""),
    title: z.string(),
    url: z.string(),
    status: z.string(),
    statusLabel: z.string(),
    owner: z.string(),
    creator: z.string(),
    priority: z.string(),
    iterationName: z.string().nullable(),
    createdAt: z.string(),
    modifiedAt: z.string(),
    description: z.string(),
    descriptionHtml: z.string().default(""),
    comments: z.array(
      z.object({
        id: z.string(),
        author: z.string(),
        createdAt: z.string(),
        text: z.string(),
        html: z.string().default(""),
      }),
    ),
    commentsError: z.string().nullable(),
    /** 仅需求：该需求下挂的任务 */
    childTasks: z.array(entityChildItemSchema).default([]),
    childStories: z.array(entityChildItemSchema).default([]),
    childReads: z.object({ story: childReadMetaSchema, task: childReadMetaSchema, bug: childReadMetaSchema }).optional(),
    /** 仅需求：该需求下挂的缺陷 */
    childBugs: z.array(entityChildItemSchema).default([]),
    /** 仅需求：子单据真实总数（> 上限 200 说明列表被截断；0 = 未统计） */
    childTasksTotal: z.number().nullable().default(null),
    childBugsTotal: z.number().nullable().default(null),
    /** 仅任务/缺陷：所属需求 */
    parentStory: z.object({ id: z.string(), title: z.string(), url: z.string() }).nullable().default(null),
  }),
});

export const searchRpc = defineRpc({
  name: "tapd.search",
  input: z.object({ query: z.string() }),
  output: z.object({
    items: z.array(
      z.object({
        labels: entityLabelsSchema,
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        subtitle: z.string(),
        url: z.url(),
        text: z.string(),
        resourceType: z.string(),
      }),
    ),
  }),
});

export const tapdAttachmentSource = defineAttachmentSource({
  id: "tapd",
  title: "TAPD 单据",
  icon: "ClipboardList",
  pickerTitle: "附加 TAPD 单据",
  searchPlaceholder: "输入标题关键字或单据 ID",
  search: searchRpc,
});

export const checkRpc = defineRpc({
  name: "tapd.check",
  input: z.object({
    apiEndpoint: tapdBaseUrlSchema.optional(),
    siteUrl: tapdBaseUrlSchema.optional(),
    token: z.string().optional(),
    workspaceIds: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    message: z.string(),
    me: z.string().nullable(),
    workspaceCount: z.number(),
    tokenSource: z.enum(["env", "settings", "none"]),
  }),
});

export const updateCheckRpc = defineRpc({
  name: "tapd.update_check",
  input: z.object({}),
  output: z.object({
    currentVersion: z.string(),
    latestVersion: z.string(),
    latestCommit: z.string(),
    updateAvailable: z.boolean(),
    checkedAt: z.string(),
  }),
});

/** Agent 状态 + 最近一次 turn 结果（详情面板展示用） */
export const agentStatusRpc = defineRpc({
  name: "tapd.agent_status",
  input: z.object({ agentIds: z.array(z.string()).max(100).default([]) }),
  output: z.object({
    items: z.array(
      z.object({
        agentId: z.string(),
        status: z.string().default(""),
        updatedAt: z.string().default(""),
        turnOutcome: z.string().default(""),
        turnEndedAt: z.string().default(""),
        turnSummary: z.string().default(""),
        turnError: z.string().default(""),
      }),
    ).default([]),
  }),
});

export const imageRpc = defineRpc({
  name: "tapd.image",
  input: z.object({ workspaceId: z.string().min(1).max(100), imagePath: z.string().min(1).max(4096) }),
  output: z.object({ dataUri: z.string().max(12_000_000).regex(/^data:image\/(?:png|jpeg|gif|bmp);base64,[A-Za-z0-9+/]+=*$/) }),
});
