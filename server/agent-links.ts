import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { ownershipScopeSchema, ownershipEventSchema, ownershipOfferSchema, toolLinkSchema, type ToolLink } from "../shared/agent-links";
import type { TapdLink } from "../shared/contracts";
import { randomUUID } from "node:crypto";

type Scope = z.infer<typeof ownershipScopeSchema>;
const suppressedSchema = ownershipScopeSchema.extend({ at: z.string(), actorAgentId: z.string().max(200) });
const stateSchema = z.object({ version: z.literal(1), links: z.array(toolLinkSchema), suppressed: z.array(suppressedSchema), history: z.array(ownershipEventSchema), offers: z.array(ownershipOfferSchema), imports: z.array(z.string()).default([]), legacyArchive: z.array(toolLinkSchema).default([]) }).passthrough();
export type OwnershipState = z.infer<typeof stateSchema>;
const empty = (): OwnershipState => ({ version: 1, links: [], suppressed: [], history: [], offers: [], imports: [], legacyArchive: [] });
const queues = new Map<string, Promise<unknown>>();
export class OwnershipConflict extends Error {
  readonly candidates: readonly TapdLink[];
  constructor(candidates: readonly TapdLink[]) { super("该单据已有负责人或历史关联待确认，请先确认归属或转交。"); this.candidates = candidates; }
}
export function sameTask(a: Scope, b: Scope) {
  return a.apiEndpoint === b.apiEndpoint && (!a.siteUrl || !b.siteUrl || a.siteUrl === b.siteUrl) && a.tapdWorkspaceId === b.tapdWorkspaceId && a.kind === b.kind && a.id === b.id;
}
export function suppressTask(state: OwnershipState, scope: Scope, actorAgentId: string): OwnershipState {
  if (state.suppressed.some(item => sameTask(item, scope))) return state;
  return { ...state, suppressed: [...state.suppressed, { ...ownershipScopeSchema.parse(scope), at: new Date().toISOString(), actorAgentId }] };
}
export function createAgentLinks() {
  const home = process.env.PASEO_HOME ?? "~/.paseo";
  const file = resolve(home.startsWith("~/") ? resolve(homedir(), home.slice(2)) : home, "plugin-data/tapd-workbench/agent-links.json");
  async function read(): Promise<OwnershipState> {
    try {
      const data = JSON.parse(await readFile(file, "utf8"));
      const state = stateSchema.parse(Array.isArray(data) ? { ...empty(), links: data } : data);
      return Array.isArray(data) ? state.links.reduce((current, link) => link.responsibility ? suppressTask(current, link, link.responsibility.actorAgentId) : current, state) : state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty(); throw new Error("Agent 关联记录不可读，请检查本机存储；原数据已保留。"); }
  }
  async function save(state: OwnershipState) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(stateSchema.parse(state))); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
    } catch { await unlink(temporary).catch(() => {}); throw new Error("Agent 关联保存失败；原数据已保留，不要重复派发，请核查已创建的 Agent。"); }
  }
  function stateTransaction<T>(run: (state: OwnershipState) => Promise<{ state?: OwnershipState; result: T }>) {
    const work = (queues.get(file) ?? Promise.resolve()).then(async () => {
      const next = await run(await read());
      if (next.state) await save(next.state);
      return next.result;
    });
    queues.set(file, work.catch(() => {}));
    return work;
  }
  // Preserve the array transaction contract while keeping suppression, history and offers intact.
  function transaction<T>(run: (links: ToolLink[]) => Promise<{ links?: ToolLink[]; result: T }>) {
    return stateTransaction(async state => { const next = await run(state.links); return { state: next.links ? { ...state, links: next.links } : undefined, result: next.result }; });
  }
  function claim(target: ToolLink, legacy: readonly TapdLink[], create: () => Promise<ToolLink> = async () => target) {
    return stateTransaction(async state => {
      const existing = state.links.filter(item => sameTask(item, target));
      const suppressed = state.suppressed.some(item => sameTask(item, target));
      const old = suppressed ? [] : legacy.filter(item => item.kind === target.kind && item.id === target.id);
      if (existing.length === 1 && existing[0].responsibility && existing[0].agentId === target.agentId && !old.some(item => item.agentId !== target.agentId)) return { result: { changed: false, link: existing[0] } };
      if (existing.length || old.length) throw new OwnershipConflict([...existing, ...old]);
      const link = toolLinkSchema.parse(await create());
      if (!sameTask(link, target)) throw new Error("承担关系的目标不一致。");
      const responsibility = link.responsibility;
      const next = { ...suppressTask(state, link, responsibility?.actorAgentId ?? "user"), links: [...state.links, link], history: responsibility ? [...state.history, { ...ownershipScopeSchema.parse(link), action: target.agentId === "dispatch-reservation" ? "dispatch" as const : responsibility.actorAgentId === "user" ? "assign" as const : "claim" as const, actorAgentId: responsibility.actorAgentId, at: responsibility.confirmedAt, reason: "明确接手", agentId: link.agentId, revision: responsibility.revision }] : state.history };
      return { state: next, result: { changed: true, link } };
    });
  }
  return { transaction, stateTransaction, claim,
    state: async () => { await queues.get(file); return read(); },
    list: async () => { await queues.get(file); return (await read()).links; },
    put: (link: ToolLink) => claim(toolLinkSchema.parse(link), []),
    remove: (link: ToolLink) => stateTransaction(async state => ({ state: { ...suppressTask(state, link, "user"), links: state.links.filter(item => !(sameTask(item, link) && item.agentId === link.agentId)) }, result: undefined })),
  };
}
export type AgentLinks = ReturnType<typeof createAgentLinks>;
