// TAPD OpenAPI 客户端核心逻辑。
// 本文件刻意保持零导入（无 zod、无 SDK），既用于插件后端，也可被 node 直接加载做集成测试。

export type EntityKind = "story" | "task" | "bug";

export interface TapdConfig {
  endpoint: string;
  site: string;
  token: string;
  tokenSource: "env" | "settings" | "none";
  workspaceIds: string[];
  writeSignal?: AbortSignal;
  readWarnings?: string[];
  freshReads?: boolean;
  protectedValues?: string[];
}

export interface TapdConfigInput {
  token: string;
  workspaceIds: string;
  apiEndpoint?: string;
  siteUrl?: string;
}

export interface EntitySummary {
  kind: EntityKind;
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  owner: string;
  priority: string;
  iterationName: string | null;
  modified: string;
  done: boolean;
  url: string;
  /** 仅任务/缺陷：所属需求 ID（story_id；为空或 0 表示无） */
  storyId?: string;
  /** 所属需求标题（尽力解析，未解析时为空） */
  storyTitle?: string;
}

export interface ColumnResult {
  kind: EntityKind;
  total: number;
  items: EntitySummary[];
  truncated: boolean;
  error: string | null;
}

export interface EntityComment {
  html: string;
  id: string;
  author: string;
  createdAt: string;
  text: string;
}

/** 需求详情中的子单据行（关联任务/关联缺陷） */
export interface EntityChildItem {
  kind: EntityKind;
  id: string;
  title: string;
  statusLabel: string;
  owner: string;
  priority: string;
  url: string;
}

export interface EntityDetailResult {
  kind: EntityKind;
  id: string;
  /** 单据实际所在项目（回写状态/评论必须发到这个项目） */
  workspaceId: string;
  title: string;
  url: string;
  status: string;
  statusLabel: string;
  owner: string;
  creator: string;
  priority: string;
  iterationName: string | null;
  createdAt: string;
  modifiedAt: string;
  description: string;
  descriptionHtml: string;
  comments: EntityComment[];
  commentsError: string | null;
  /** 仅需求：该需求下挂的任务（TAPD task.story_id） */
  childTasks: EntityChildItem[];
  /** 仅需求：该需求下挂的缺陷（TAPD bug.story_id） */
  childBugs: EntityChildItem[];
  /** 仅需求：任务/缺陷真实总数（> 列表长度说明列表被 limit 200 截断；0 = 未知/未统计） */
  childTasksTotal: number;
  childBugsTotal: number;
  /** 仅任务/缺陷：所属需求（TAPD task.story_id / bug.story_id） */
  parentStory: { id: string; title: string; url: string } | null;
}

export interface AttachmentSearchItem {
  id: string;
  identifier: string;
  title: string;
  subtitle: string;
  url: string;
  text: string;
  resourceType: string;
}

export class TapdApiError extends Error {
  detail?: string;
  failure: TapdFailure;
  constructor(message: string, detail?: string, failure: TapdFailure = { code: "invalid_input", phase: "validation", writeState: "not_sent" }) {
    super(message);
    this.name = "TapdApiError";
    this.detail = detail;
    this.failure = failure;
  }
}

export interface TapdFailure {
  code: string;
  phase: "validation" | "read" | "write";
  writeState: "not_sent" | "rejected" | "unknown";
  httpStatus?: number;
}
export function safeFailure(error: unknown): TapdFailure {
  return error instanceof TapdApiError ? error.failure : { code: "invalid_input", phase: "validation", writeState: "not_sent" };
}
function requestFailure(phase: "read" | "write", code: string, httpStatus?: number, rejected = false) {
  const writeState = phase === "read" ? "not_sent" : rejected ? "rejected" : "unknown";
  return new TapdApiError(
    writeState === "unknown" ? "TAPD 写入结果未知；请重新读取核对，勿重复提交。"
      : writeState === "rejected" ? "TAPD 拒绝了写入；请核查权限、字段或工作流条件。"
        : "TAPD 读取失败；未发送写入，请检查连接或权限。",
    undefined, { code, phase, writeState, ...(httpStatus === undefined ? {} : { httpStatus }) });
}

export const KIND_LABELS: Record<EntityKind, string> = { story: "需求", task: "任务", bug: "缺陷" };

const KIND_WRAPPER: Record<EntityKind, string> = { story: "Story", task: "Task", bug: "Bug" };
const LIST_PATH: Record<EntityKind, string> = { story: "/stories", task: "/tasks", bug: "/bugs" };
const COUNT_PATH: Record<EntityKind, string> = { story: "/stories/count", task: "/tasks/count", bug: "/bugs/count" };
const FIELDS_INFO_PATH: Record<EntityKind, string> = {
  story: "/stories/get_fields_info",
  task: "/tasks/get_fields_info",
  bug: "/bugs/get_fields_info",
};

const LIST_FIELDS: Record<EntityKind, string> = {
  story: "id,name,status,owner,priority_label,iteration_id,modified",
  task: "id,name,status,owner,priority_label,iteration_id,modified,story_id",
  bug: "id,title,status,current_owner,priority_label,iteration_id,modified,story_id",
};

// 终态状态：默认「隐藏已完成」时过滤掉这些状态。
export const TERMINAL_STATUSES: Record<EntityKind, readonly string[]> = {
  story: ["resolved", "rejected", "done", "closed"],
  task: ["done"],
  bug: ["closed", "rejected"],
};

const TASK_STATUS_LABELS: Record<string, string> = {
  open: "未开始",
  progressing: "进行中",
  done: "已完成",
};

// 无法读取字段信息接口时的兜底「进行中」状态集合。
const FALLBACK_ACTIVE_STATUSES: Record<EntityKind, readonly string[]> = {
  story: [
    "planning", "planned", "status_4", "status_14", "status_10", "audited", "status_15",
    "status_16", "status_17", "status_13", "status_2", "status_9", "developing", "status_19",
    "status_11", "testing", "status_20", "status_21", "status_8", "workflow_suspended",
  ],
  task: ["open", "progressing"],
  bug: ["new", "in_progress", "suspended", "resolved", "verified", "reopened", "status_1", "status_3"],
};

export function resolveConfig(settings: TapdConfigInput): TapdConfig {
  const endpoint = normalizeBaseUrl(settings.apiEndpoint?.trim() || process.env.TAPD_API_ENDPOINT || "https://api.tapd.cn");
  const site = normalizeBaseUrl(settings.siteUrl?.trim() || process.env.TAPD_SITE_URL || "https://www.tapd.cn");
  const settingsToken = settings.token.trim();
  const envToken = (process.env.TAPD_TOKEN || "").trim();
  const token = settingsToken || envToken;
  const tokenSource: TapdConfig["tokenSource"] = settingsToken ? "settings" : envToken ? "env" : "none";
  const rawWorkspaces = settings.workspaceIds.trim() || process.env.TAPD_WORKSPACE_IDS || "";
  // 去重：重复的项目 ID 会让按项目遍历的查询产出重复卡片
  const workspaceIds = [...new Set(
    rawWorkspaces
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )];
  return { endpoint, site, token, tokenSource, workspaceIds };
}

function normalizeBaseUrl(value: string): string {
  try {
    if (value.trim().length > 2048) throw new Error();
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch {
    throw new Error("TAPD 地址需为完整 HTTP(S) URL，不能包含账号、密码、查询参数或片段");
  }
}

export function describeError(error: unknown): string {
  if (error instanceof TapdApiError) {
    return error.detail ? `${error.message}（${error.detail}）` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

const DEFAULT_CACHE_TTL_MS = 20_000;
const responseCache = new Map<string, { at: number; value: unknown }>();
const inflightRequests = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;

// ---------------------------------------------------------------------------
// 看板整体缓存（SWR）：过期先回旧数据 + 后台刷新，避免进工作台全量重拉白屏
// ---------------------------------------------------------------------------
const BOARD_CACHE_TTL_MS = 90_000;
const boardCache = new Map<string, { at: number; result: unknown }>();
const boardRefreshes = new Map<string, Promise<unknown>>();

export function clearTapdCache(): void {
  cacheGeneration++;
  responseCache.clear();
  inflightRequests.clear();
  boardCache.clear();
  boardRefreshes.clear();
}

export type StaleBoardResult<T> = T & { stale: boolean; cachedAt: string };

export async function boardWithCache<T extends Record<string, unknown>>(
  key: string,
  fetcher: () => Promise<T>,
  force: boolean,
): Promise<StaleBoardResult<T>> {
  const cached = boardCache.get(key) as { at: number; result: T } | undefined;
  if (force || !cached) {
    const result = await fetcher();
    boardCache.set(key, { at: Date.now(), result });
    return { ...result, stale: false, cachedAt: "" };
  }
  if (Date.now() - cached.at < BOARD_CACHE_TTL_MS) {
    return { ...cached.result, stale: false, cachedAt: "" };
  }
  // 过期：后台已在刷新则复用，否则启动后台刷新；后台失败时保留旧缓存
  let running = boardRefreshes.get(key) ?? null;
  if (!running) {
    running = fetcher()
      .then((result) => {
        boardCache.set(key, { at: Date.now(), result });
        return result;
      })
      .catch(() => null)
      .finally(() => {
        boardRefreshes.delete(key);
      });
    boardRefreshes.set(key, running);
  }
  return { ...cached.result, stale: true, cachedAt: new Date(cached.at).toISOString() };
}

type QueryValue = string | number | undefined;

function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const text = String(value);
    if (text.length === 0) continue;
    parts.push(`${key}=${encodeURIComponent(text)}`);
  }
  return parts.join("&");
}

async function requestJson(
  config: TapdConfig,
  path: string,
  params: Record<string, QueryValue>,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
  fresh = config.freshReads ?? false,
): Promise<any> {
  const query = buildQuery(params);
  const generation = cacheGeneration;
  const url = `${config.endpoint}${path}${query ? `?${query}` : ""}`;
  const cached = responseCache.get(url);
  if (!fresh && cached && Date.now() - cached.at < ttlMs) return cached.value;
  const pending = fresh ? undefined : inflightRequests.get(url);
  if (pending) {
    try { return await pending; } catch (error) {
      config.readWarnings?.push("部分 TAPD 读取失败，结果可能不完整。");
      throw error;
    }
  }

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        redirect: "error", headers: { Authorization: `Bearer ${config.token}` }, signal: controller.signal,
      });
      if (!response.ok) throw requestFailure("read", response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : "request_failed", response.status);
      let payload;
      try { payload = await response.json(); } catch { throw requestFailure("read", "invalid_response", response.status); }
      if (!payload || typeof payload !== "object" || payload.status !== 1) throw requestFailure("read", "api_rejected", response.status);
      if (!fresh && generation === cacheGeneration) responseCache.set(url, { at: Date.now(), value: payload.data });
      return payload.data;
    } catch (error) {
      if (error instanceof TapdApiError) throw error;
      throw requestFailure("read", controller.signal.aborted ? "timeout" : "request_failed");
    } finally { clearTimeout(timer); }
  })();

  if (!fresh) inflightRequests.set(url, request);
  try {
    return await request;
  } catch (error) {
    config.readWarnings?.push("部分 TAPD 读取失败，结果可能不完整。");
    throw error;
  } finally {
    if (!fresh && inflightRequests.get(url) === request) inflightRequests.delete(url);
  }
}

function unwrapRow(row: unknown, wrappers: readonly string[]): any {
  if (row && typeof row === "object") {
    for (const wrapper of wrappers) {
      if (wrapper in (row as Record<string, unknown>)) {
        return (row as Record<string, unknown>)[wrapper];
      }
    }
  }
  return row;
}

function unwrapRows(data: unknown, wrappers: readonly string[]): any[] {
  if (!Array.isArray(data)) return [];
  return data.map((row) => unwrapRow(row, wrappers));
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|svg|math|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export async function fetchMe(config: TapdConfig): Promise<{ nick: string; name: string } | null> {
  const data = await requestJson(config, "/users/info", {}, 60_000);
  if (data && typeof data === "object") {
    const nick = String(data.nick ?? data.name ?? "").trim();
    const name = String(data.name ?? data.nick ?? "").trim();
    if (nick || name) return { nick: nick || name, name: name || nick };
  }
  return null;
}

export async function fetchStatusLabels(config: TapdConfig, kind: EntityKind): Promise<Record<string, string>> {
  if (kind === "task") return { ...TASK_STATUS_LABELS };
  const path = kind === "story" ? "/stories/get_fields_info" : "/bugs/get_fields_info";
  const labels: Record<string, string> = {};
  for (const workspaceId of config.workspaceIds) {
    try {
      const data = await requestJson(
        config,
        path,
        { workspace_id: workspaceId, field: "status", fields: "status" },
        30 * 60_000,
      );
      const options = data?.status?.options;
      if (options && typeof options === "object") {
        for (const [key, value] of Object.entries(options)) {
          if (typeof value === "string") labels[key] = value;
        }
      }
    } catch {
      // 单个项目读取失败时使用兜底标签
    }
  }
  return labels;
}

export interface IterationInfo {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

function candidateText(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim() || null;
}

export async function fetchStatusOptions(config: TapdConfig, kind: EntityKind, workspaceId: string): Promise<FilterOption[]> {
  if (kind !== "story" && kind !== "task" && kind !== "bug") throw new Error("单据类型无效。");
  if (typeof workspaceId !== "string" || workspaceId.length > 128 || !config.workspaceIds.includes(workspaceId.trim())) {
    throw new Error("单据项目未配置，请检查项目设置。");
  }
  try {
    const data = await requestJson(config, FIELDS_INFO_PATH[kind], {
      workspace_id: workspaceId.trim(), field: "status", fields: "status",
    }, 0);
    const options = data?.status?.options;
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error();
    return Object.entries(options).map(([value, label]) => {
      const statusValue = candidateText(value);
      const statusLabel = candidateText(label);
      if (!statusValue || !statusLabel) throw new Error();
      return { value: statusValue, label: statusLabel };
    });
  } catch {
    throw new Error("读取状态选项失败，请重试。");
  }
}

export async function fetchMembers(config: TapdConfig): Promise<{ members: FilterOption[]; error: string | null }> {
  const members = new Set<string>();
  let failed = false;
  for (const workspaceId of config.workspaceIds) {
    try {
      const data = await requestJson(config, "/workspaces/users", { workspace_id: workspaceId, fields: "user" }, 0);
      if (!Array.isArray(data)) throw new Error();
      for (const row of unwrapRows(data, ["UserWorkspace"])) {
        const user = candidateText(row?.user);
        if (user) members.add(user);
        else failed = true;
      }
    } catch {
      failed = true;
    }
  }
  return {
    members: [...members].sort().map((value) => ({ value, label: value })),
    error: failed ? "部分项目的人员候选读取失败，请重试；仍可输入准确昵称。" : null,
  };
}

function commentEntryKind(entryType: string): EntityKind | null {
  if (entryType === "stories" || entryType === "story") return "story";
  if (entryType === "tasks" || entryType === "task") return "task";
  if (entryType === "bug" || entryType === "bug_remark") return "bug";
  return null;
}

/** 拉取当前用户最近评论过的实体 ID（按类型分组，供「我相关的」并集查询使用） */
export async function fetchMyCommentedIds(
  config: TapdConfig,
  author: string,
): Promise<Record<EntityKind, string[]>> {
  const sets: Record<EntityKind, Set<string>> = { story: new Set(), task: new Set(), bug: new Set() };
  for (const workspaceId of config.workspaceIds) {
    try {
      const data = await requestJson(
        config,
        "/comments",
        { workspace_id: workspaceId, author, limit: 200, order: "created desc" },
        60_000,
      );
      for (const row of unwrapRows(data, ["Comment"])) {
        const kind = commentEntryKind(String(row?.entry_type ?? ""));
        const entryId = String(row?.entry_id ?? "");
        if (kind && entryId) sets[kind].add(entryId);
      }
    } catch {
      // 评论来源读取失败时忽略
    }
  }
  return {
    story: [...sets.story].slice(0, 100),
    task: [...sets.task].slice(0, 100),
    bug: [...sets.bug].slice(0, 100),
  };
}

export async function fetchFilterOptions(config: TapdConfig): Promise<{
  priorities: { value: string; label: string; kinds: EntityKind[] }[];
  severities: FilterOption[];
  iterations: IterationInfo[];
  statuses: Record<EntityKind, FilterOption[]>;
}> {
  const priorityMap = new Map<string, { label: string; kinds: EntityKind[] }>();
  for (const kind of ["story", "task", "bug"] as const) {
    const path =
      kind === "story"
        ? "/stories/get_fields_info"
        : kind === "task"
          ? "/tasks/get_fields_info"
          : "/bugs/get_fields_info";
    try {
      const data = await requestJson(
        config,
        path,
        { workspace_id: config.workspaceIds[0], field: "priority_label", fields: "priority_label" },
        30 * 60_000,
      );
      const options = data?.priority_label?.options;
      if (options && typeof options === "object") {
        for (const [value, label] of Object.entries(options)) {
          const labelText = typeof label === "string" ? label : value;
          const existing = priorityMap.get(value);
          if (existing) {
            if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
          } else {
            priorityMap.set(value, { label: labelText, kinds: [kind] });
          }
        }
      }
    } catch {
      // 忽略单个类型的失败
    }
  }
  const priorities = [...priorityMap.entries()].map(([value, entry]) => ({
    value,
    label: entry.label,
    kinds: entry.kinds,
  }));
  const severities: FilterOption[] = [];
  try {
    const data = await requestJson(
      config,
      "/bugs/get_fields_info",
      { workspace_id: config.workspaceIds[0], field: "severity", fields: "severity" },
      30 * 60_000,
    );
    const options = data?.severity?.options;
    if (options && typeof options === "object") {
      for (const [value, label] of Object.entries(options)) {
        severities.push({ value, label: typeof label === "string" ? label : value });
      }
    }
  } catch {
    // 忽略
  }
  const iterations = await fetchIterations(config);
  const statuses: Record<EntityKind, FilterOption[]> = { story: [], task: [], bug: [] };
  for (const kind of ["story", "task", "bug"] as const) {
    const labels = await fetchStatusLabels(config, kind);
    statuses[kind] = Object.entries(labels).map(([value, label]) => ({ value, label }));
  }
  return { priorities, severities, iterations, statuses };
}

/** 状态流转：POST 更新单据状态（workspaceId 为空时回退首个项目） */
export async function updateEntityStatus(
  config: TapdConfig,
  workspaceId: string,
  kind: EntityKind,
  id: string,
  status: string,
): Promise<void> {
  const resolved = workspaceId.trim() || (config.workspaceIds[0] ?? "");
  await requestPost(config, LIST_PATH[kind], { workspace_id: resolved, id, status });
  clearTapdCache();
}

/** 回写评论：POST 新评论（HTML 格式）（workspaceId 为空时回退首个项目） */
export async function addComment(
  config: TapdConfig,
  workspaceId: string,
  kind: EntityKind,
  id: string,
  text: string,
  author: string,
): Promise<void> {
  const resolved = workspaceId.trim() || (config.workspaceIds[0] ?? "");
  const entryType = kind === "story" ? "stories" : kind === "bug" ? "bug" : "tasks";
  const params: Record<string, QueryValue> = {
    workspace_id: resolved,
    entry_type: entryType,
    entry_id: id,
    description: `<p>${escapeHtmlText(text).replace(/\n/g, "<br/>")}</p>`,
  };
  if (author) params.author = author;
  await requestPost(config, "/comments", params);
  clearTapdCache();
}

export async function fetchIterations(config: TapdConfig): Promise<IterationInfo[]> {
  const seen = new Map<string, IterationInfo>();
  for (const workspaceId of config.workspaceIds) {
    try {
      const data = await requestJson(
        config,
        "/iterations",
        { workspace_id: workspaceId, limit: 200, fields: "id,name,status,startdate,enddate" },
        10 * 60_000,
      );
      const rows = unwrapRows(data, ["Iteration"]);
      if (rows.length >= 200) config.readWarnings?.push("迭代候选达到每项目 200 条上限，可能截断。");
      for (const row of rows) {
        if (row?.id) {
          seen.set(String(row.id), {
            id: String(row.id),
            name: String(row.name ?? ""),
            status: String(row.status ?? ""),
            startDate: String(row.startdate ?? ""),
            endDate: String(row.enddate ?? ""),
          });
        }
      }
    } catch {
      // 单个项目读取失败不影响其他项目
    }
  }
  return [...seen.values()].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

export async function fetchIterationMap(config: TapdConfig): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const workspaceId of config.workspaceIds) {
    try {
      const data = await requestJson(
        config,
        "/iterations",
        { workspace_id: workspaceId, limit: 200, fields: "id,name" },
        10 * 60_000,
      );
      const rows = unwrapRows(data, ["Iteration"]);
      if (rows.length >= 200) config.readWarnings?.push("迭代候选达到每项目 200 条上限，可能截断。");
      for (const row of rows) {
        if (row?.id) map.set(String(row.id), String(row.name ?? ""));
      }
    } catch {
      // 迭代信息缺失不致命
    }
  }
  return map;
}

async function fetchTerminalStatuses(config: TapdConfig, kind: EntityKind, labels: Record<string, string>): Promise<Set<string>> {
  if (kind !== "task") {
    try {
      const data = await requestJson(config, "/workflows/last_steps", {
        workspace_id: config.workspaceIds[0], system: kind,
      }, 30 * 60_000);
      if (data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length > 0 && Object.values(data).every((label) => typeof label === "string")) {
        return new Set(Object.keys(data));
      }
    } catch {
      // shortcut: 工作流接口不可用时按标准状态和明确的结束标签兜底，恢复权限后以项目工作流为准。
    }
  }
  return new Set([
    ...TERMINAL_STATUSES[kind],
    ...Object.keys(labels).filter((status) => /^(?:已完成|已结束|已关闭|已拒绝|已取消|done|closed|completed|rejected|cancelled)$/i.test(labels[status].trim())),
  ]);
}

function activeStatuses(kind: EntityKind, labels: Record<string, string>, terminal: ReadonlySet<string>): string[] {
  const known = Object.keys(labels);
  const source = known.length > 0 ? known : [...FALLBACK_ACTIVE_STATUSES[kind]];
  const active = source.filter((status) => !terminal.has(status));
  return active;
}

function ownerParamName(kind: EntityKind): string {
  return kind === "bug" ? "current_owner" : "owner";
}

export function entityUrl(config: TapdConfig, workspaceId: string, kind: EntityKind, id: string): string {
  return `${config.site}/tapd_fe/${workspaceId}/${kind}/detail/${id}`;
}

function toSummary(
  config: TapdConfig,
  workspaceId: string,
  kind: EntityKind,
  row: any,
  labels: Record<string, string>,
  iterationMap: Map<string, string>,
  terminal: ReadonlySet<string>,
  storyTitles?: Map<string, string>,
): EntitySummary {
  const id = String(row?.id ?? "");
  const status = String(row?.status ?? "");
  const iterationId = String(row?.iteration_id ?? "");
  const storyId = kind === "story" ? "" : String(row?.story_id ?? "").trim();
  const storyKey = storyId && storyId !== "0" ? `${workspaceId}-${storyId}` : "";
  return {
    kind,
    id,
    title: String((kind === "bug" ? row?.title : row?.name) ?? ""),
    status,
    statusLabel: labels[status] ?? status,
    owner: String((kind === "bug" ? row?.current_owner : row?.owner) ?? "").trim(),
    priority: String(row?.priority_label ?? "").trim(),
    iterationName: iterationId && iterationId !== "0" ? iterationMap.get(iterationId) ?? null : null,
    modified: String(row?.modified ?? ""),
    done: terminal.has(status),
    url: entityUrl(config, workspaceId, kind, id),
    storyId: storyKey ? storyId : "",
    storyTitle: storyTitles?.get(storyKey) ?? "",
  };
}

/** 按工作区批量解析任务/缺陷所属需求的标题（TAPD 支持 id 逗号列表查询） */
async function resolveStoryTitles(
  config: TapdConfig,
  refs: EntityRowRef[],
): Promise<Map<string, string>> {
  const idsByWorkspace = new Map<string, Set<string>>();
  for (const ref of refs) {
    const storyId = String(ref.row?.story_id ?? "").trim();
    if (!storyId || storyId === "0") continue;
    const set = idsByWorkspace.get(ref.workspaceId) ?? new Set();
    set.add(storyId);
    idsByWorkspace.set(ref.workspaceId, set);
  }
  const titles = new Map<string, string>();
  for (const [workspaceId, set] of idsByWorkspace) {
    const ids = [...set];
    for (let start = 0; start < ids.length; start += 100) {
      try {
        const data = await requestJson(config, "/stories", {
          workspace_id: workspaceId,
          id: ids.slice(start, start + 100).join(","),
          limit: 100,
          fields: "id,name",
        });
        for (const row of unwrapRows(data, ["Story"])) {
          const key = `${workspaceId}-${String(row?.id ?? "")}`;
          titles.set(key, String(row?.name ?? "").trim());
        }
      } catch {
        // 需求标题解析失败不阻塞看板
      }
    }
  }
  return titles;
}

export interface ColumnQueryOptions {
  owner: string;
  creator: string;
  keyword: string;
  label: string;
  statusScope: "all" | "active" | "done";
  iterationId: string;
  modifiedAfter: string;
  priorities: string[];
  severities: string[];
  /** 「我相关的」模式：非空时按 处理人/创建人/抄送人/评论人 四路并集查询 */
  relatedOwner: string;
  /** relatedOwner 模式下，该类型下当前用户评论过的实体 ID */
  relatedCommentedIds: string[];
  /** relatedOwner 模式下，关联任务里当前用户参与的 story ID（仅 story 使用） */
  relatedStoryIds: string[];
  /** 高级筛选条件（动态字段） */
  conditions: ConditionInput[];
}

export interface ConditionInput {
  field: string;
  kind: "text" | "enum" | "date" | "user";
  kinds: string[];
  values: string[];
  from: string;
  to: string;
  label?: string;
}

export interface FilterField {
  key: string;
  label: string;
  kind: "text" | "enum" | "date" | "user";
  single: boolean;
  options: FilterOption[];
  kinds: EntityKind[];
}

// 已有一等公民过滤维度的字段不放进「更多筛选」，避免重复与语义冲突
// 说明：name/title 由「关键词」覆盖；status 仅通过专用分支提供各类型独立的具体工作流状态。
// 其余列表字段已有一等公民控件，workspace_id 是内部查询参数。
const FIELD_DENYLIST = new Set([
  "name",
  "title",
  "status",
  "v_status",
  "owner",
  "current_owner",
  "creator",
  "reporter",
  "iteration_id",
  "priority",
  "priority_label",
  "severity",
  "label",
  "modified",
  "workspace_id",
]);

function mapHtmlType(htmlType: string): { kind: FilterField["kind"]; single: boolean } | null {
  switch (htmlType) {
    case "select":
    case "multi_select":
      return { kind: "enum", single: false };
    case "radio":
    case "checkbox":
      return { kind: "enum", single: true };
    case "user_chooser":
    case "single_user_chooser":
    case "mix_chooser":
      return { kind: "user", single: true };
    case "dateinput":
    case "datetime":
      return { kind: "date", single: true };
    case "text":
    case "input":
    case "textarea":
    case "rich_edit":
    case "float":
    case "integer":
      return { kind: "text", single: true };
    default:
      return null;
  }
}

export async function fetchFieldKeySet(config: TapdConfig, kind: EntityKind): Promise<Set<string> | null> {
  try {
    const data = await requestJson(
      config,
      FIELDS_INFO_PATH[kind],
      { workspace_id: config.workspaceIds[0] },
      30 * 60_000,
    );
    if (data && typeof data === "object") return new Set(Object.keys(data));
  } catch {
    // 失败时返回 null，条件将不做字段级校验
  }
  return null;
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function requestPost(
  config: TapdConfig,
  path: string,
  params: Record<string, QueryValue>,
  preserveEmpty = false,
): Promise<any> {
  if (config.writeSignal?.aborted) throw new TapdApiError("TAPD 操作已取消");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const text = String(value);
    if (text.length === 0 && !preserveEmpty) continue;
    body.set(key, text);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${config.endpoint}${path}`, {
      redirect: "error", method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(), signal: controller.signal,
    });
    if (!response.ok) {
      const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
      throw requestFailure("write", response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : "request_failed", response.status, rejected);
    }
    let payload;
    try { payload = await response.json(); } catch { throw requestFailure("write", "invalid_response", response.status); }
    if (!payload || payload.status !== 1) throw requestFailure("write", "api_rejected", response.status, payload?.status === 0);
    return payload.data;
  } catch (error) {
    if (error instanceof TapdApiError) throw error;
    throw requestFailure("write", controller.signal.aborted ? "timeout" : "request_failed");
  } finally {
    clearTimeout(timer);
    clearTapdCache();
  }
}

/** 「我相关的」：找到我参与（处理/创建/抄送/评论）的任务所关联的 story ID */
export async function fetchRelatedStoryIdsFromTasks(
  config: TapdConfig,
  me: string,
  commentedTaskIds: string[],
): Promise<string[]> {
  const ids = new Set<string>();
  const memberships: Record<string, QueryValue>[] = [{ owner: me }, { creator: me }, { cc: me }];
  if (commentedTaskIds.length > 0) memberships.push({ id: commentedTaskIds.join(",") });
  for (const membership of memberships) {
    for (const workspaceId of config.workspaceIds) {
      try {
        const data = await requestJson(
          config,
          "/tasks",
          { workspace_id: workspaceId, limit: 200, order: "modified desc", fields: "id,story_id", ...membership },
          60_000,
        );
        for (const row of unwrapRows(data, ["Task"])) {
          const storyId = String(row?.story_id ?? "");
          if (storyId && storyId !== "0") ids.add(storyId);
        }
      } catch {
        // 忽略单个来源失败
      }
    }
  }
  return [...ids].slice(0, 100);
}

export interface CreateEntityInput {
  kind: EntityKind;
  title: string;
  description: string;
  owner: string;
  priority: string;
  iterationId: string;
  /** 挂载的所属需求 ID（仅 task/bug 生效） */
  storyId?: string;
  /** 单据所在项目；缺省仍取 workspaceIds[0] */
  workspaceId?: string;
  /** 动态表单收集的其余可写字段（key 会经 denylist 过滤） */
  extraFields?: Record<string, string>;
}

/** 创建接口额外透传字段时禁止的系统列/受控列（含动态表单里已静态化的列） */
const CREATE_FIELD_DENYLIST = new Set([
  "id", "workspace_id", "story_id", "parent_id", "name", "title", "description",
  "owner", "current_owner", "priority_label", "iteration_id", "status",
  "created", "modified", "creator", "reporter", "cc", "follower",
]);

export interface FieldDefinition {
  key: string;
  label: string;
  htmlType: string;
  readonly: boolean | null;
  supported: boolean;
}

function validateFieldProject(config: TapdConfig, kind: string, workspaceId: string) {
  if (kind !== "story" || !/^\d{1,100}$/.test(workspaceId) || !config.workspaceIds.includes(workspaceId)) {
    throw new TapdApiError("需求字段的项目或类型无效。");
  }
}

const designFieldKey = /^(description|custom_field_[a-zA-Z0-9_]+)$/;
const fieldFailureMessages = {
  field_not_returned: "项目元数据未返回该字段，不能判断其是否存在或有权限。",
  unsupported_field: "该字段类型暂不支持。",
  readonly_field: "字段元数据标记为只读，未提交。",
  permission_unknown: "字段可编辑性未知，未提交。",
  value_not_returned: "接口未返回字段旧值，未提交。",
  conflict: "字段旧值冲突，请重新读取并保留已有内容。",
};
function fieldFailure(code: keyof typeof fieldFailureMessages) {
  return new TapdApiError(fieldFailureMessages[code], undefined, { code, phase: "validation", writeState: "not_sent" });
}
function protectFieldData(config: TapdConfig, data: unknown) {
  const text = JSON.stringify(data);
  if ([config.token, ...(config.protectedValues ?? [])].filter(Boolean)
    .some(secret => text.includes(JSON.stringify(secret).slice(1, -1)))) {
    throw new TapdApiError("字段数据包含受保护内容，无法安全读取或写入。");
  }
}

export interface LabelQuery { workspaceId: string; page: number; limit: number; name?: string }
export interface ProjectLabel { id: string; name: string; color: string | null }
export interface ItemLabelTarget { kind: EntityKind; id: string; workspaceId: string }
function validateLabelProject(config: TapdConfig, workspaceId: string) {
  if (!/^\d{1,100}$/.test(workspaceId) || !config.workspaceIds.includes(workspaceId)) throw new TapdApiError("标签项目无效。");
}
function validLabelName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && value.trim().length > 0 && !/[|\u0000-\u001f\u007f]/.test(value);
}
function parseProjectLabel(row: unknown, workspaceId: string): ProjectLabel {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw requestFailure("read", "unsupported_label_response");
  const value = row as Record<string, unknown>;
  const id = String(value.id ?? "");
  if (!/^\d{1,100}$/.test(id) || String(value.workspace_id ?? "") !== workspaceId || !validLabelName(value.name)
    || (value.color != null && !/^[1-4]$/.test(String(value.color)))) throw requestFailure("read", "unsupported_label_response");
  return { id, name: value.name, color: value.color == null ? null : String(value.color) };
}
export async function fetchProjectLabels(config: TapdConfig, input: LabelQuery) {
  validateLabelProject(config, input.workspaceId);
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > 10_000
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200
    || (input.name !== undefined && !validLabelName(input.name))) throw new TapdApiError("标签查询无效。");
  protectFieldData(config, input);
  const data = await requestJson(config, "/label", { workspace_id: input.workspaceId, page: input.page, limit: input.limit, name: input.name, order: "id asc" }, 0, true);
  if (!Array.isArray(data) || data.length > input.limit) throw requestFailure("read", "unsupported_label_response");
  const labels = data.map(row => parseProjectLabel(unwrapRow(row, ["LabelPool"]), input.workspaceId));
  protectFieldData(config, labels);
  const truncated = data.length === input.limit;
  return { workspaceId: input.workspaceId, labels, page: input.page, limit: input.limit, truncated, nextPage: truncated && input.page < 10_000 ? input.page + 1 : null };
}
export async function readItemLabels(config: TapdConfig, input: ItemLabelTarget) {
  validateLabelProject(config, input.workspaceId);
  if (!["story", "task", "bug"].includes(input.kind) || !/^\d{1,100}$/.test(input.id)) throw new TapdApiError("标签单据目标无效。");
  const data = await requestJson(config, LIST_PATH[input.kind], { workspace_id: input.workspaceId, id: input.id, limit: 1,
    fields: `id,workspace_id,${input.kind === "bug" ? "title,current_owner" : "name,owner"},status,label` }, 0, true);
  if (!Array.isArray(data) || data.length > 1) throw requestFailure("read", "unsupported_label_response");
  const row = unwrapRows(data, [KIND_WRAPPER[input.kind]])[0];
  if (!row || String(row.id) !== input.id) throw requestFailure("read", "item_not_returned");
  if (String(row.workspace_id ?? "") !== input.workspaceId) throw requestFailure("read", "item_project_mismatch");
  const returned = Object.hasOwn(row, "label");
  const value: unknown = returned ? row.label : null;
  if (value !== null && (typeof value !== "string" || value.length > 20_100)) throw requestFailure("read", "unsupported_label_response");
  const labels = value === null ? null : value === "" ? [] : (value as string).split("|");
  if (labels && (labels.length > 100 || !labels.every(validLabelName))) throw requestFailure("read", "unsupported_label_response");
  const result = { returned, value: value as string | null, labels, entity: { ...input,
    title: String(row[input.kind === "bug" ? "title" : "name"] ?? "").slice(0, 500), status: String(row.status ?? "").slice(0, 200),
    statusLabel: "", owner: String(row[input.kind === "bug" ? "current_owner" : "owner"] ?? "").slice(0, 200) } };
  protectFieldData(config, result);
  return result;
}
export async function createProjectLabel(config: TapdConfig, input: { workspaceId: string; name: string; color?: number; confirmed: true }) {
  validateLabelProject(config, input.workspaceId);
  if (input.confirmed !== true || !validLabelName(input.name)
    || (input.color !== undefined && (!Number.isInteger(input.color) || input.color < 1 || input.color > 4))) throw new TapdApiError("标签创建输入无效。");
  protectFieldData(config, input);
  const base = { workspaceId: input.workspaceId, name: input.name };
  for (let page = 1; page <= 10; page++) {
    const current = await fetchProjectLabels(config, { ...base, page, limit: 200 });
    const existing = current.labels.find(label => label.name === input.name);
    if (existing) return { ...base, ok: true, outcome: "unchanged" as const, writeState: "not_sent" as const, label: existing };
    if (!current.truncated) break;
    if (page === 10) throw new TapdApiError("标签查重未完成，未提交。", undefined, { code: "label_lookup_incomplete", phase: "validation", writeState: "not_sent" });
  }
  const data = await requestPost(config, "/label", { workspace_id: input.workspaceId, name: input.name, color: input.color });
  // Accepted creation must stay accepted even when its response or fresh verification is incomplete.
  let label: ProjectLabel | null = null;
  try {
    label = parseProjectLabel(unwrapRow(data, ["LabelPool"]), input.workspaceId);
    protectFieldData(config, label);
    if (label.name !== input.name) throw new Error();
    const current = await requestJson(config, "/label", { workspace_id: input.workspaceId, id: label.id, limit: 1 }, 0, true);
    if (!Array.isArray(current) || current.length !== 1) throw new Error();
    const verified = parseProjectLabel(unwrapRow(current[0], ["LabelPool"]), input.workspaceId);
    protectFieldData(config, verified);
    if (verified.id !== label.id || verified.name !== input.name || (input.color !== undefined && verified.color !== String(input.color))) throw new Error();
    return { ...base, ok: true, outcome: "verified" as const, writeState: "accepted" as const, label: verified };
  } catch {
    return { ...base, ok: false, outcome: "unverified" as const, writeState: "accepted" as const, label: null };
  }
}
export async function fetchFieldDefinitions(config: TapdConfig, kind: string, workspaceId: string): Promise<{ fields: FieldDefinition[] }> {
  validateFieldProject(config, kind, workspaceId);
  const data = await requestJson(config, FIELDS_INFO_PATH.story, { workspace_id: workspaceId }, 0, true);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TapdApiError("字段元数据格式不支持。");
  const fields: FieldDefinition[] = [];
  for (const [key, raw] of Object.entries(data)) {
    if (!designFieldKey.test(key) || key.length > 100) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TapdApiError("字段元数据格式不支持。");
    const info = raw as Record<string, unknown>;
    const htmlType = typeof info.html_type === "string" ? info.html_type.slice(0, 100) : "";
    fields.push({ key, label: typeof info.label === "string" ? info.label.slice(0, 500) : "", htmlType,
      readonly: info.readonly === true || info.readonly === 1 || info.readonly === "1" ? true
        : info.readonly === false || info.readonly === 0 || info.readonly === "0" ? false : null,
      supported: ["text", "input", "textarea", "rich_edit", "rich_text"].includes(htmlType),
    });
  }
  protectFieldData(config, fields);
  return { fields };
}

export interface FieldTarget { kind: "story"; workspaceId: string; id: string; fieldKey: string }
export async function readEntityField(config: TapdConfig, input: FieldTarget) {
  validateFieldProject(config, input.kind, input.workspaceId);
  if (!/^\d{1,100}$/.test(input.id) || input.fieldKey.length > 100 || !designFieldKey.test(input.fieldKey)) throw new TapdApiError("字段目标无效。");
  const { fields } = await fetchFieldDefinitions(config, input.kind, input.workspaceId);
  const field = fields.find(field => field.key === input.fieldKey);
  if (!field) throw fieldFailure("field_not_returned");
  if (!field.supported) throw fieldFailure("unsupported_field");
  const data = await requestJson(config, "/stories", { workspace_id: input.workspaceId, id: input.id, limit: 1,
    fields: `id,workspace_id,name,status,owner,modified,${input.fieldKey}` }, 0, true);
  const row = unwrapRows(data, ["Story"])[0];
  if (!row || String(row.id) !== input.id || (row.workspace_id !== undefined && String(row.workspace_id) !== input.workspaceId)) throw new TapdApiError("目标需求未返回或项目不匹配。");
  const returned = Object.hasOwn(row, input.fieldKey);
  const value: unknown = returned ? row[input.fieldKey] : null;
  if (value !== null && (typeof value !== "string" || value.length > 50_000)) throw new TapdApiError("字段值格式或长度不支持。");
  const result = { field, returned, value, modifiedAt: String(row.modified ?? ""),
    entity: { kind: input.kind, workspaceId: input.workspaceId, id: input.id, title: String(row.name ?? ""),
      status: String(row.status ?? ""), statusLabel: "", owner: String(row.owner ?? "") } };
  protectFieldData(config, result);
  return result;
}

export async function updateEntityField(config: TapdConfig, input: FieldTarget & { expectedValue: string | null; value: string; confirmed: true }) {
  if (input.confirmed !== true || typeof input.value !== "string" || input.value.length > 50_000
    || (input.expectedValue !== null && (typeof input.expectedValue !== "string" || input.expectedValue.length > 50_000))) throw new TapdApiError("字段更新输入无效。");
  protectFieldData(config, [input.expectedValue, input.value]);
  const before = await readEntityField(config, input);
  if (before.field.readonly !== false) throw fieldFailure(before.field.readonly ? "readonly_field" : "permission_unknown");
  if (!before.returned) throw fieldFailure("value_not_returned");
  if (before.value !== input.expectedValue) throw fieldFailure("conflict");
  if (before.value === input.value) return { ok: true, outcome: "unchanged" as const, writeState: "not_sent" as const, entity: before.entity };
  await requestPost(config, "/stories", { workspace_id: input.workspaceId, id: input.id, [input.fieldKey]: input.value }, true);
  clearTapdCache();
  try {
    const after = await readEntityField(config, input);
    const verified = after.returned && after.value === input.value;
    return { ok: verified, outcome: verified ? "verified" as const : "unverified" as const, writeState: "accepted" as const, entity: after.entity };
  } catch {
    return { ok: false, outcome: "unverified" as const, writeState: "accepted" as const, entity: before.entity };
  }
}

export interface CreateFieldInfo {
  key: string;
  label: string;
  inputKind: "text" | "textarea" | "enum" | "user" | "date";
  single: boolean;
  options: { value: string; label: string }[];
  required: boolean;
}

/** 挂载创建的动态字段表：单类型 fields_info 中可写、非系统列的字段，附当前登录用户昵称 */
export async function fetchCreateFields(
  config: TapdConfig,
  kind: EntityKind,
  workspaceId?: string,
): Promise<{ me: string; fields: CreateFieldInfo[] }> {
  const ws = (workspaceId ?? "").trim() || config.workspaceIds[0] || "";
  let data: unknown;
  try {
    data = await requestJson(config, FIELDS_INFO_PATH[kind], { workspace_id: ws }, 30 * 60_000);
  } catch {
    return { me: "", fields: [] };
  }
  const me = await fetchMe(config).then((value) => value?.nick ?? "").catch(() => "");
  const fields: CreateFieldInfo[] = [];
  if (!data || typeof data !== "object") return { me, fields };
  for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
    const info = raw as Record<string, unknown>;
    if (!info || typeof info !== "object") continue;
    if (CREATE_FIELD_DENYLIST.has(key)) continue;
    const readonlyFlag = info.readonly;
    if (readonlyFlag === 1 || readonlyFlag === "1" || readonlyFlag === true) continue;
    const htmlType = String(info.html_type ?? "");
    const mapped = mapHtmlType(htmlType);
    if (!mapped) continue;
    const label = String(info.label ?? "").trim();
    if (!label) continue;
    const options: { value: string; label: string }[] = [];
    const optionsRaw = info.options;
    if (optionsRaw && typeof optionsRaw === "object" && !Array.isArray(optionsRaw)) {
      for (const [value, optionLabel] of Object.entries(optionsRaw as Record<string, unknown>)) {
        options.push({ value, label: typeof optionLabel === "string" ? optionLabel : value });
      }
    }
    const inputKind: CreateFieldInfo["inputKind"] =
      htmlType.includes("rich_edit") || htmlType.includes("textarea")
        ? "textarea"
        : mapped.kind === "enum"
          ? "enum"
          : mapped.kind === "user"
            ? "user"
            : mapped.kind === "date"
              ? "date"
              : "text";
    fields.push({
      key,
      label,
      inputKind,
      single: mapped.single,
      options: inputKind === "enum" || inputKind === "user" ? options : [],
      required: info.required === 1 || info.required === "1" || info.required === true,
    });
  }
  fields.sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label, "zh-Hans-CN"));
  return { me, fields };
}

export async function createEntity(
  config: TapdConfig,
  input: CreateEntityInput,
): Promise<{ id: string; kind: EntityKind; url: string }> {
  const workspaceId = (input.workspaceId ?? "").trim() || config.workspaceIds[0] || "";
  const params: Record<string, QueryValue> = { workspace_id: workspaceId };
  if (input.kind === "bug") params.title = input.title;
  else params.name = input.title;
  if (input.description.trim()) {
    params.description = `<p>${escapeHtmlText(input.description.trim()).replace(/\n/g, "<br/>")}</p>`;
  }
  if (input.owner.trim()) {
    params[input.kind === "bug" ? "current_owner" : "owner"] = input.owner.trim();
  }
  if (input.priority.trim()) params.priority_label = input.priority.trim();
  if (input.iterationId.trim()) params.iteration_id = input.iterationId.trim();
  if (input.kind !== "story" && (input.storyId ?? "").trim()) {
    params.story_id = (input.storyId ?? "").trim();
  }
  for (const [rawKey, rawValue] of Object.entries(input.extraFields ?? {})) {
    const key = rawKey.trim();
    // 系统列/静态行专用字段一律拒绝，story_id/workspace_id 由挂载上下文决定，防动态注入
    if (!key || key === "story_id" || key === "workspace_id" || CREATE_FIELD_DENYLIST.has(key)) continue;
    const value = (rawValue ?? "").trim();
    if (value) params[key] = value;
  }
  const data = await requestPost(config, LIST_PATH[input.kind], params);
  const row = unwrapRow(data, [KIND_WRAPPER[input.kind]]);
  const id = String(row?.id ?? "");
  if (!id) throw requestFailure("write", "missing_created_id");
  return { id, kind: input.kind, url: entityUrl(config, workspaceId, input.kind, id) };
}

export async function fetchFilterFields(config: TapdConfig): Promise<FilterField[]> {
  const merged = new Map<string, FilterField>();
  for (const kind of ["story", "task", "bug"] as const) {
    let data: any;
    try {
      data = await requestJson(
        config,
        FIELDS_INFO_PATH[kind],
        { workspace_id: config.workspaceIds[0] },
        30 * 60_000,
      );
    } catch {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    for (const [key, rawInfo] of Object.entries(data)) {
      const info = rawInfo as Record<string, unknown>;
      if (!info || typeof info !== "object") continue;
      if (key === "status") {
        const options: FilterOption[] = [];
        if (info.options && typeof info.options === "object" && !Array.isArray(info.options)) {
          for (const [value, label] of Object.entries(info.options)) {
            const statusValue = candidateText(value);
            const statusLabel = candidateText(label);
            if (statusValue && statusLabel) options.push({ value: statusValue, label: statusLabel });
          }
        }
        merged.set(`status\u0000${kind}`, {
          key, label: `${KIND_LABELS[kind]}状态`, kind: "enum", single: false, options, kinds: [kind],
        });
        continue;
      }
      if (FIELD_DENYLIST.has(key)) continue;
      const readonly = info.readonly;
      if (readonly === 1 || readonly === "1" || readonly === true) continue;
      const mapped = mapHtmlType(String(info.html_type ?? ""));
      if (!mapped) continue;
      const label = String(info.label ?? "").trim();
      if (!label) continue;
      const options: FilterOption[] = [];
      const optionsRaw = info.options;
      if (optionsRaw && typeof optionsRaw === "object" && !Array.isArray(optionsRaw)) {
        for (const [value, optionLabel] of Object.entries(optionsRaw as Record<string, unknown>)) {
          options.push({ value, label: typeof optionLabel === "string" ? optionLabel : value });
        }
      }
      const mapKey = `${key}\u0000${label}`;
      const existing = merged.get(mapKey);
      if (existing) {
        if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
        const seen = new Set(existing.options.map((option) => option.value));
        for (const option of options) {
          if (!seen.has(option.value)) existing.options.push(option);
        }
      } else {
        merged.set(mapKey, { key, label, kind: mapped.kind, single: mapped.single, options, kinds: [kind] });
      }
    }
  }
  const fields = [...merged.values()];
  fields.sort((a, b) => {
    if (a.kinds.length !== b.kinds.length) return b.kinds.length - a.kinds.length;
    return a.label.localeCompare(b.label, "zh-Hans-CN");
  });
  return fields;
}

function buildConditionParams(
  kind: EntityKind,
  conditions: ConditionInput[],
  keySet: Set<string> | null,
): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};
  for (const condition of conditions) {
    if (!condition.field) continue;
    if (condition.kinds.length > 0 && !condition.kinds.includes(kind)) continue;
    if (keySet && !keySet.has(condition.field)) continue;
    let value: string | undefined;
    if (condition.kind === "enum") {
      value = condition.values.length > 0 ? condition.values.join("|") : undefined;
    } else if (condition.kind === "date") {
      const from = condition.from.trim();
      const to = condition.to.trim();
      value = from || to ? `${from || "2000-01-01"}~${to || "2099-12-31"}` : undefined;
    } else {
      value = condition.values[0]?.trim() || undefined;
    }
    if (value) params[condition.field] = value;
  }
  return params;
}

export function isoDateDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildDimensionParams(
  kind: EntityKind,
  options: ColumnQueryOptions,
  labels: Record<string, string>,
  terminal: ReadonlySet<string>,
): Record<string, QueryValue> {
  const statusFilter =
    options.statusScope === "all"
      ? undefined
      : options.statusScope === "done"
        ? [...terminal].join("|")
        : activeStatuses(kind, labels, terminal).join("|");
  const params: Record<string, QueryValue> = {
    status: statusFilter,
    iteration_id: options.iterationId || undefined,
    priority_label: options.priorities.length > 0 ? options.priorities.join("|") : undefined,
    modified: options.modifiedAfter ? `${options.modifiedAfter}~2099-12-31` : undefined,
    label: options.label || undefined,
  };
  if (kind === "bug" && options.severities.length > 0) params.severity = options.severities.join("|");
  if (options.creator) params[kind === "bug" ? "reporter" : "creator"] = options.creator;
  if (options.keyword) params[kind === "bug" ? "title" : "name"] = options.keyword;
  return params;
}

interface EntityRowRef {
  workspaceId: string;
  row: any;
}

async function queryEntityRows(
  config: TapdConfig,
  kind: EntityKind,
  params: Record<string, QueryValue>,
): Promise<EntityRowRef[]> {
  const groups = await Promise.all(
    config.workspaceIds.map(async (workspaceId) => {
      const data = await requestJson(config, LIST_PATH[kind], {
        workspace_id: workspaceId,
        limit: 200,
        order: "modified desc",
        fields: LIST_FIELDS[kind],
        ...params,
      });
      return unwrapRows(data, [KIND_WRAPPER[kind]]).map((row) => ({ workspaceId, row }));
    }),
  );
  return groups.flat();
}

export async function fetchColumn(
  config: TapdConfig,
  kind: EntityKind,
  options: ColumnQueryOptions,
): Promise<ColumnResult> {
  // 自定义状态编号只在项目内有效，不能混用不同项目的标签和终态。
  if (config.workspaceIds.length > 1) {
    const columns = await Promise.all([...new Set(config.workspaceIds)].map((workspaceId) =>
      fetchColumn({ ...config, workspaceIds: [workspaceId] }, kind, options)));
    const items = columns.flatMap((column) => column.items).sort((a, b) => b.modified.localeCompare(a.modified));
    return {
      kind, items: items.slice(0, 300), total: columns.reduce((sum, column) => sum + column.total, 0),
      truncated: items.length > 300 || columns.some((column) => column.truncated),
      error: columns.map((column) => column.error).filter(Boolean).join("；") || null,
    };
  }
  const items: EntitySummary[] = [];
  let total = 0;
  let truncated = false;
  try {
    const labels = await fetchStatusLabels(config, kind);
    const terminal = await fetchTerminalStatuses(config, kind, labels);
    const iterationMap = await fetchIterationMap(config);
    const fieldKeys = await fetchFieldKeySet(config, kind);
    const dimensionParams = buildDimensionParams(kind, options, labels, terminal);
    const conditions = buildConditionParams(kind, options.conditions, fieldKeys);
    if (options.statusScope !== "all") {
      const allowed = String(dimensionParams.status ?? "").split("|").filter(Boolean);
      const selected = conditions.status ? String(conditions.status).split("|") : allowed;
      conditions.status = selected.filter((status) => allowed.includes(status)).join("|");
      if (!conditions.status) return { kind, total: 0, items: [], truncated: false, error: null };
    }
    Object.assign(dimensionParams, conditions);
    const matchesStatus = (row: any) => {
      const status = String(row?.status ?? "");
      return (options.statusScope === "all" || terminal.has(status) === (options.statusScope === "done")) &&
        (!dimensionParams.status || String(dimensionParams.status).split("|").includes(status));
    };

    if (options.relatedOwner) {
      const membershipQueries: Record<string, QueryValue>[] = [
        { [ownerParamName(kind)]: options.relatedOwner },
        { [kind === "bug" ? "reporter" : "creator"]: options.relatedOwner },
        { cc: options.relatedOwner },
      ];
      // 开发人员 / 参与人（按字段定义存在性启用；缺陷的开发人员字段名为 de）
      const developerParam = kind === "bug" ? "de" : "developer";
      if (!fieldKeys || fieldKeys.has(developerParam)) {
        membershipQueries.push({ [developerParam]: options.relatedOwner });
      }
      if (!fieldKeys || fieldKeys.has("participator")) {
        membershipQueries.push({ participator: options.relatedOwner });
      }
      const idMembers = new Set<string>(options.relatedCommentedIds);
      if (kind === "story") {
        for (const id of options.relatedStoryIds) idMembers.add(id);
      }
      if (idMembers.size > 0) {
        membershipQueries.push({ id: [...idMembers].join(",") });
      }
      const batches = await Promise.all(
        membershipQueries.map((membership) => queryEntityRows(config, kind, { ...dimensionParams, ...membership })),
      );
      const seen = new Set<string>();
      const merged: EntitySummary[] = [];
      const mergedRefs: EntityRowRef[] = [];
      for (const batch of batches) {
        for (const ref of batch) {
          if (!matchesStatus(ref.row)) continue;
          const key = `${ref.workspaceId}-${String(ref.row?.id ?? "")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(toSummary(config, ref.workspaceId, kind, ref.row, labels, iterationMap, terminal));
          mergedRefs.push(ref);
        }
        if (batch.length >= 200) truncated = true;
      }
      if (kind !== "story" && merged.length > 0) {
        const storyTitles = await resolveStoryTitles(config, mergedRefs);
        for (let index = 0; index < merged.length; index += 1) {
          merged[index] = toSummary(config, mergedRefs[index].workspaceId, kind, mergedRefs[index].row, labels, iterationMap, terminal, storyTitles);
        }
      }
      merged.sort((a, b) => b.modified.localeCompare(a.modified));
      total = merged.length;
      if (merged.length > 300) truncated = true;
      return { kind, total, items: merged.slice(0, 300), truncated, error: null };
    }

    for (const workspaceId of config.workspaceIds) {
      const countData = await requestJson(config, COUNT_PATH[kind], {
        workspace_id: workspaceId,
        [ownerParamName(kind)]: options.owner || undefined,
        ...dimensionParams,
      });
      const count = Number(countData?.count ?? 0);
      total += Number.isFinite(count) ? count : 0;
    }
    const refs = await queryEntityRows(config, kind, {
      [ownerParamName(kind)]: options.owner || undefined,
      ...dimensionParams,
    });
    let storyTitles: Map<string, string> | undefined;
    if (kind !== "story" && refs.length > 0) {
      storyTitles = await resolveStoryTitles(config, refs);
    }
    const seenIds = new Set<string>();
    for (const ref of refs) {
      if (!matchesStatus(ref.row)) continue;
      const key = `${ref.workspaceId}-${String(ref.row?.id ?? "")}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      items.push(toSummary(config, ref.workspaceId, kind, ref.row, labels, iterationMap, terminal, storyTitles));
    }
    if (total > refs.length) truncated = true;
    total = truncated ? Math.max(items.length, total - refs.filter((ref) => !matchesStatus(ref.row)).length) : items.length;
    if (items.length > 300) truncated = true;
  } catch (error) {
    return { kind, total, items, truncated, error: describeError(error) };
  }
  items.sort((a, b) => b.modified.localeCompare(a.modified));
  return { kind, total, items: items.slice(0, 300), truncated, error: null };
}

/** Conversation summaries read only list fields; descriptions, comments and related items stay lazy. */
export async function fetchEntitySummary(config: TapdConfig, kind: EntityKind, id: string, workspaceId: string) {
  if (!config.workspaceIds.includes(workspaceId)) throw new TapdApiError("项目未配置");
  const data = await requestJson(config, LIST_PATH[kind], {
    workspace_id: workspaceId, id, limit: 1,
    fields: kind === "bug" ? "id,title,status,current_owner" : "id,name,status,owner",
  }, 0);
  const row = unwrapRows(data, [KIND_WRAPPER[kind]])[0];
  if (!row || String(row.id) !== id) throw new TapdApiError("单据摘要不可用");
  const labels = await fetchStatusLabels({ ...config, workspaceIds: [workspaceId] }, kind);
  const status = String(row.status ?? "");
  return { kind, id, workspaceId, title: String((kind === "bug" ? row.title : row.name) ?? ""),
    status, statusLabel: labels[status] ?? status, owner: String((kind === "bug" ? row.current_owner : row.owner) ?? "").trim() };
}

export async function fetchEntity(config: TapdConfig, kind: EntityKind, id: string): Promise<EntityDetailResult> {
  let row: any = null;
  let workspaceId = config.workspaceIds[0] ?? "";
  for (const candidate of config.workspaceIds) {
    const data = await requestJson(config, LIST_PATH[kind], { workspace_id: candidate, id, limit: 1 });
    const rows = unwrapRows(data, [KIND_WRAPPER[kind]]);
    if (rows.length > 0) {
      row = rows[0];
      workspaceId = candidate;
      break;
    }
  }
  if (!row) {
    throw new TapdApiError(`未找到${KIND_LABELS[kind]} #${id}`);
  }

  const labels = await fetchStatusLabels(config, kind);
  const iterationMap = await fetchIterationMap(config);
  const status = String(row.status ?? "");
  const iterationId = String(row.iteration_id ?? "");
  const detail: EntityDetailResult = {
    kind,
    id: String(row.id ?? id),
    workspaceId,
    title: String((kind === "bug" ? row.title : row.name) ?? ""),
    url: entityUrl(config, workspaceId, kind, id),
    status,
    statusLabel: labels[status] ?? status,
    owner: String((kind === "bug" ? row.current_owner : row.owner) ?? "").trim(),
    creator: String((kind === "bug" ? row.reporter : row.creator) ?? "").trim(),
    priority: String(row.priority_label ?? "").trim(),
    iterationName: iterationId && iterationId !== "0" ? iterationMap.get(iterationId) ?? null : null,
    createdAt: String(row.created ?? ""),
    modifiedAt: String(row.modified ?? ""),
    description: htmlToText(String(row.description ?? "")),
    descriptionHtml: String(row.description ?? ""),
    comments: [],
    commentsError: null,
    childTasks: [],
    childBugs: [],
    childTasksTotal: 0,
    childBugsTotal: 0,
    parentStory: null,
  };

  // 任务/缺陷详情：解析所属需求（story_id），点击可跳回需求详情
  if (kind !== "story") {
    const storyId = String(row.story_id ?? "").trim();
    if (storyId && storyId !== "0") {
      const parent = { id: storyId, title: "", url: entityUrl(config, workspaceId, "story", storyId) };
      try {
        const data = await requestJson(config, "/stories", {
          workspace_id: workspaceId,
          id: storyId,
          limit: 1,
          fields: "id,name",
        });
        const storyRow = unwrapRows(data, ["Story"])[0];
        parent.title = String(storyRow?.name ?? "").trim();
      } catch {
        // 需求标题读取失败时仅展示 ID
      }
      detail.parentStory = parent;
    }
  }

  const entryType = kind === "story" ? "stories" : kind === "bug" ? "bug|bug_remark" : "tasks";
  try {
    const data = await requestJson(config, "/comments", {
      workspace_id: workspaceId,
      entry_type: entryType,
      entry_id: id,
      limit: 30,
      order: "created desc",
    });
    detail.comments = unwrapRows(data, ["Comment"]).map((comment) => ({
      id: String(comment?.id ?? ""),
      author: String(comment?.author ?? "").trim(),
      createdAt: String(comment?.created ?? ""),
      text: htmlToText(String(comment?.description ?? "")),
      html: String(comment?.description ?? ""),
    }));
  } catch (error) {
    detail.commentsError = describeError(error);
  }

  // 需求详情：拉取该需求下挂的任务与缺陷（task.story_id / bug.story_id）
  if (kind === "story") {
    const labelsFor: Record<EntityKind, Record<string, string>> = {
      task: await fetchStatusLabels(config, "task"),
      bug: await fetchStatusLabels(config, "bug"),
      story: {},
    };
    const loadChildren = async (childKind: Exclude<EntityKind, "story">): Promise<EntityChildItem[]> => {
      try {
        const data = await requestJson(config, LIST_PATH[childKind], {
          workspace_id: workspaceId,
          story_id: id,
          limit: 200,
          order: "modified desc",
          fields: LIST_FIELDS[childKind],
        });
        return unwrapRows(data, [KIND_WRAPPER[childKind]])
          .map((row) => {
            const childId = String(row?.id ?? "");
            const status = String(row?.status ?? "");
            return {
              kind: childKind,
              id: childId,
              title: String((childKind === "bug" ? row?.title : row?.name) ?? ""),
              statusLabel: labelsFor[childKind][status] ?? status,
              owner: String((childKind === "bug" ? row?.current_owner : row?.owner) ?? "").trim(),
              priority: String(row?.priority_label ?? "").trim(),
              url: entityUrl(config, workspaceId, childKind, childId),
            };
          })
          .filter((item) => item.id.length > 0);
      } catch {
        return []; // 子单据读取失败不阻塞需求详情
      }
    };
    const countChildren = async (childKind: Exclude<EntityKind, "story">): Promise<number> => {
      try {
        const data = await requestJson(config, COUNT_PATH[childKind], {
          workspace_id: workspaceId,
          story_id: id,
        });
        const count = Number(data?.count ?? 0);
        return Number.isFinite(count) ? count : 0;
      } catch {
        return 0;
      }
    };
    const [tasks, bugs] = await Promise.all([loadChildren("task"), loadChildren("bug")]);
    const [taskTotal, bugTotal] = await Promise.all([
      tasks.length >= 200 ? countChildren("task") : Promise.resolve(0),
      bugs.length >= 200 ? countChildren("bug") : Promise.resolve(0),
    ]);
    detail.childTasks = tasks;
    detail.childBugs = bugs;
    detail.childTasksTotal = taskTotal;
    detail.childBugsTotal = bugTotal;
  }
  return detail;
}

export async function searchEntities(config: TapdConfig, query: string): Promise<AttachmentSearchItem[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const numeric = /^\d{4,}$/.test(trimmed);
  const kinds: EntityKind[] = ["story", "task", "bug"];
  const items: AttachmentSearchItem[] = [];
  for (const kind of kinds) {
    const labels = await fetchStatusLabels(config, kind);
    const iterationMap = await fetchIterationMap(config);
    for (const workspaceId of config.workspaceIds) {
      const base: Record<string, QueryValue> = {
        workspace_id: workspaceId,
        limit: 5,
        order: "modified desc",
        fields: LIST_FIELDS[kind],
      };
      if (numeric) base.id = trimmed;
      else base[kind === "bug" ? "title" : "name"] = trimmed;
      try {
        const data = await requestJson(config, LIST_PATH[kind], base);
        const rows = unwrapRows(data, [KIND_WRAPPER[kind]]);
        if (rows.length >= 5) config.readWarnings?.push("搜索结果达到每项目每类型 5 条上限，可能截断。");
        for (const row of rows) {
          const summary = toSummary(config, workspaceId, kind, row, labels, iterationMap, new Set(TERMINAL_STATUSES[kind]));
          const lines = [
            `TAPD ${KIND_LABELS[kind]}单据快照（#${summary.id}）`,
            `- 标题：${summary.title}`,
            `- 状态：${summary.statusLabel}`,
            `- 处理人：${summary.owner || "未指派"}`,
            summary.iterationName ? `- 迭代：${summary.iterationName}` : null,
            `- 链接：${summary.url}`,
          ].filter((line): line is string => line !== null);
          items.push({
            id: `${kind}-${summary.id}`,
            identifier: `#${summary.id}`,
            title: summary.title,
            subtitle: `${KIND_LABELS[kind]} · ${summary.statusLabel}${summary.owner ? ` · ${summary.owner}` : ""}`,
            url: summary.url,
            text: lines.join("\n"),
            resourceType: KIND_LABELS[kind],
          });
        }
      } catch {
        // 单类搜索失败不影响其他类别
        config.readWarnings?.push("部分项目或类型搜索失败，结果不完整。");
      }
    }
  }
  if (items.length > 15) config.readWarnings?.push("搜索结果已截断为前 15 条。");
  return items.slice(0, 15);
}

/** Download once: protected TAPD links may return HTML after their first read. */
export async function fetchContentImage(config: TapdConfig, workspaceId: string, imagePath: string): Promise<{ dataUri: string }> {
  const failure = "图片读取失败，请重试或在 TAPD 查看原图。";
  if (!config.workspaceIds.includes(workspaceId) || imagePath.length > 4096
    || !/^\/tfl\/(?:captures|pictures)\/[^\s?#\\]+\.(?:png|gif|jpe?g|bmp)$/i.test(imagePath)
    || new URL(imagePath, config.site).pathname !== imagePath) throw new Error(failure);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const metadata = await requestJson(config, "/files/get_image", { workspace_id: workspaceId, image_path: imagePath }, 0);
    if (metadata?.Attachment?.workspace_id != null && String(metadata.Attachment.workspace_id) !== workspaceId) throw new Error();
    const safeUrl = (value: unknown): URL => {
      if (typeof value !== "string" || value.length > 16384) throw new Error();
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || (config.token && [config.token, encodeURIComponent(config.token)].some(token => url.href.includes(token)))) throw new Error();
      return url;
    };
    let url = safeUrl(metadata?.Attachment?.download_url);
    const signal = controller.signal;
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      // No Authorization or cookies follow the API-issued download URL, including redirects.
      response = await fetch(url, { redirect: "manual", signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects >= 3) throw new Error();
      url = safeUrl(new URL(location, url).href);
    }
    const maxBytes = 8 * 1024 * 1024;
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel(); throw new Error();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error();
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks);
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpeg"
      : ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString()) ? "gif"
      : bytes[0] === 66 && bytes[1] === 77 ? "bmp" : undefined;
    if (!mime) throw new Error();
    return { dataUri: `data:image/${mime};base64,${bytes.toString("base64")}` };
  } catch { throw new Error(failure); }
  finally { clearTimeout(timer); }
}
