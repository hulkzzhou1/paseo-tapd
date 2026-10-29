import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { itemIterationRpc, iterationsRpc, iterationTargetSchema, projectIterationSchema } from "../shared/iteration-tools";
import { protectFieldData, requestJson, safeFailure, TapdApiError, type TapdConfig } from "./tapd";

const paths = { story: "/stories", task: "/tasks", bug: "/bugs" } as const;
const wrappers = { story: "Story", task: "Task", bug: "Bug" } as const;
type IterationTarget = RpcInput<typeof itemIterationRpc>;
function readFailure(code: string, message: string) {
  return new TapdApiError(message, undefined, { code, phase: "read", writeState: "not_sent" });
}
function matchesId(value: unknown, expected: string) {
  return (typeof value === "string" && /^\d{1,100}$/.test(value) || typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    && String(value) === expected;
}

/** Always fresh: iteration identity must not be inferred from display names or cached summaries. */
export async function readItemIteration(config: TapdConfig, input: IterationTarget): Promise<RpcOutput<typeof itemIterationRpc>> {
  input = itemIterationRpc.input.parse(input);
  if (!config.workspaceIds.includes(input.workspaceId)) throw readFailure("project_not_configured", "目标项目未配置，未读取迭代。");
  protectFieldData(config, input);
  const data = await requestJson(config, paths[input.kind], { workspace_id: input.workspaceId, id: input.id, limit: 1, fields: "id,workspace_id,iteration_id" }, 0, true);
  if (!Array.isArray(data) || data.length !== 1) throw readFailure("item_not_returned", "无法核实目标单据，未读取迭代。");
  const entry = data[0];
  const row = entry?.[wrappers[input.kind]] ?? entry;
  if (!row || !matchesId(row.id, input.id) || !matchesId(row.workspace_id, input.workspaceId)
    || (row.entity_type !== undefined && row.entity_type !== input.kind)) throw readFailure("item_identity_mismatch", "目标单据的项目、类型或编号不匹配。");
  const returned = Object.hasOwn(row, "iteration_id");
  const raw: unknown = returned ? row.iteration_id : null;
  const value = typeof raw === "string" && raw.length <= 100 || typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  const state: RpcOutput<typeof itemIterationRpc>["state"] = !returned ? "not_returned" : value === "" || value === "0" || value === 0 ? "unset"
    : typeof value === "string" && /^\d+$/.test(value) && !/^0+$/.test(value) || typeof value === "number" && value > 0 ? "set" : "unknown";
  const result = { entity: input, returned, value, state };
  protectFieldData(config, result);
  return result;
}

/** A single bounded page. Only page one ending short without errors establishes a complete collection. */
export async function fetchItemIterations(config: TapdConfig, input: RpcInput<typeof iterationsRpc>): Promise<RpcOutput<typeof iterationsRpc>> {
  input = iterationsRpc.input.parse(input);
  const entity = iterationTargetSchema.parse(input);
  await readItemIteration(config, entity);
  const base = { entity, page: input.page, limit: 200 as const };
  let data;
  try {
    data = await requestJson(config, "/iterations", { workspace_id: entity.workspaceId, page: input.page, limit: 200,
      fields: "id,workspace_id,name,status,startdate,enddate" }, 0, true);
  } catch (error) {
    if (safeFailure(error).code === "invalidated") throw error;
    return { ...base, iterations: [], hasMore: null, nextPage: null, completeness: "unknown", truncated: false, failure: safeFailure(error) };
  }
  if (!Array.isArray(data) || data.length > 200) return { ...base, iterations: [], hasMore: null, nextPage: null,
    completeness: "unknown", truncated: Array.isArray(data) && data.length > 200,
    failure: { code: "unsupported_iteration_response", phase: "read", writeState: "not_sent" } };
  const iterations: RpcOutput<typeof iterationsRpc>["iterations"] = [];
  let failure: RpcOutput<typeof iterationsRpc>["failure"] = null;
  for (const entry of data) {
    const row = entry?.Iteration ?? entry;
    if (!row || !matchesId(row.workspace_id, entity.workspaceId)) {
      failure ??= { code: "iteration_project_mismatch", phase: "read", writeState: "not_sent" };
      continue;
    }
    const id = typeof row.id === "string" || typeof row.id === "number" && Number.isSafeInteger(row.id) ? String(row.id) : "";
    const parsed = projectIterationSchema.safeParse({ id, workspaceId: entity.workspaceId, name: row.name,
      status: row.status ?? null, startDate: row.startdate ?? null, endDate: row.enddate ?? null });
    if (!parsed.success) { failure ??= { code: "unsupported_iteration_response", phase: "read", writeState: "not_sent" }; continue; }
    iterations.push(parsed.data);
  }
  protectFieldData(config, iterations);
  const hasMore = data.length === 200;
  return { ...base, iterations, hasMore, nextPage: hasMore && input.page < 10_000 ? input.page + 1 : null,
    completeness: failure ? iterations.length ? "partial" : "unknown" : input.page === 1 && !hasMore ? "complete" : "partial", truncated: hasMore, failure };
}
