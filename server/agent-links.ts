import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toolLinkSchema, type ToolLink } from "../shared/agent-links";

const schema = z.array(toolLinkSchema);
export function createAgentLinks() {
  const home = process.env.PASEO_HOME ?? "~/.paseo";
  const file = resolve(home.startsWith("~/") ? resolve(homedir(), home.slice(2)) : home, "plugin-data/tapd-workbench/agent-links.json");
  let queue = Promise.resolve();
  async function read() {
    try { return schema.parse(JSON.parse(await readFile(file, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error("Agent 关联记录不可读，请检查本机存储。"); }
  }
  function key(link: ToolLink) { return JSON.stringify([link.apiEndpoint, link.tapdWorkspaceId, link.kind, link.id, link.agentId]); }
  function change(link: ToolLink, remove: boolean) {
    const work = queue.then(async () => {
      const parsed = toolLinkSchema.parse(link);
      const links = (await read()).filter(item => key(item) !== key(parsed));
      if (!remove) links.push(parsed);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify(links)); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, file);
      } catch { await unlink(temporary).catch(() => {}); throw new Error("Agent 关联保存失败；不要重复派发，请核查已创建的 Agent。"); }
    });
    queue = work.catch(() => {});
    return work;
  }
  return { list: async () => { await queue; return read(); }, put: (link: ToolLink) => change(link, false), remove: (link: ToolLink) => change(link, true) };
}
export type AgentLinks = ReturnType<typeof createAgentLinks>;
