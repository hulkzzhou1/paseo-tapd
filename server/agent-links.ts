import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toolLinkSchema, type ToolLink } from "../shared/agent-links";
import type { TapdLink } from "../shared/contracts";

const schema = z.array(toolLinkSchema);
const queues = new Map<string, Promise<unknown>>();
export class OwnershipConflict extends Error {
  readonly candidates: readonly TapdLink[];
  constructor(candidates: readonly TapdLink[]) { super("该单据已有负责人或历史关联待确认，请先确认归属或转交。"); this.candidates = candidates; }
}
export function sameTask(a: ToolLink, b: ToolLink) {
  return a.apiEndpoint === b.apiEndpoint && (!a.siteUrl || !b.siteUrl || a.siteUrl === b.siteUrl) && a.tapdWorkspaceId === b.tapdWorkspaceId && a.kind === b.kind && a.id === b.id;
}
export function createAgentLinks() {
  const home = process.env.PASEO_HOME ?? "~/.paseo";
  const file = resolve(home.startsWith("~/") ? resolve(homedir(), home.slice(2)) : home, "plugin-data/tapd-workbench/agent-links.json");
  async function read() {
    try { return schema.parse(JSON.parse(await readFile(file, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error("Agent 关联记录不可读，请检查本机存储。"); }
  }
  async function save(links: ToolLink[]) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(schema.parse(links))); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
    } catch { await unlink(temporary).catch(() => {}); throw new Error("Agent 关联保存失败；不要重复派发，请核查已创建的 Agent。"); }
  }
  // One owning daemon serializes validation, resource reservation and durable updates together.
  function transaction<T>(run: (links: ToolLink[]) => Promise<{ links?: ToolLink[]; result: T }>) {
    const work = (queues.get(file) ?? Promise.resolve()).then(async () => {
      const next = await run(await read());
      if (next.links) await save(next.links);
      return next.result;
    });
    queues.set(file, work.catch(() => {}));
    return work;
  }
  function claim(target: ToolLink, legacy: readonly TapdLink[], create: () => Promise<ToolLink> = async () => target) {
    return transaction(async links => {
      const existing = links.filter(item => sameTask(item, target));
      const old = legacy.filter(item => item.kind === target.kind && item.id === target.id);
      if (existing.length === 1 && existing[0].responsibility && existing[0].agentId === target.agentId && !old.some(item => item.agentId !== target.agentId)) return { result: { changed: false, link: existing[0] } };
      if (existing.length || old.length) throw new OwnershipConflict([...existing, ...old]);
      const link = toolLinkSchema.parse(await create());
      if (!sameTask(link, target)) throw new Error("承担关系的目标不一致。");
      return { links: [...links, link], result: { changed: true, link } };
    });
  }
  return { transaction, claim,
    list: async () => { await queues.get(file); return read(); },
    put: (link: ToolLink) => claim(toolLinkSchema.parse(link), []),
    remove: (link: ToolLink) => transaction(async links => ({ links: links.filter(item => !(sameTask(item, link) && item.agentId === link.agentId)), result: undefined })),
  };
}
export type AgentLinks = ReturnType<typeof createAgentLinks>;
