import type { AgentToolContext } from "@getpaseo/plugin/server";
import { createHash } from "node:crypto";
import type { ConversationEntity } from "../shared/conversation";
import type { TapdSettingsValues } from "../shared/contracts";
import { resolveConfig } from "./tapd";

type Paseo = AgentToolContext["paseo"];
type Entry = Awaited<ReturnType<ReturnType<Paseo["agents"]["ref"]>["timeline"]["refetch"]>>["entries"][number];
type Subscription = ReturnType<ReturnType<Paseo["agents"]["ref"]>["timeline"]["subscribe"]>;

function references(text: string, values: TapdSettingsValues, trailing: boolean): ConversationEntity[] {
  const config = resolveConfig(values);
  const site = new URL(config.site);
  const base = site.pathname.replace(/\/$/, "");
  const entities: ConversationEntity[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\[\]()]+/g)) {
    if (!trailing && match.index + match[0].length === text.length) continue;
    try {
      const url = new URL(match[0].replace(/[.,;!?，。；！？]+$/, ""));
      if (url.origin !== site.origin || url.username || url.password) continue;
      if (!url.pathname.startsWith(`${base}/`)) continue;
      const path = url.pathname.slice(base.length);
      const modern = /^\/tapd_fe\/(\d+)\/(story|task|bug)\/detail\/(\d+)\/?$/.exec(path);
      const legacy = /^\/(\d+)\/(prong\/(stories|tasks)\/view\/(\d+)|bugtrace\/bugs\/view)\/?$/.exec(path);
      const workspaceId = modern?.[1] ?? legacy?.[1];
      const kind = modern?.[2] ?? (legacy?.[3] === "stories" ? "story" : legacy?.[3] === "tasks" ? "task" : legacy ? "bug" : undefined);
      const id = modern?.[3] ?? legacy?.[4] ?? (legacy ? url.searchParams.get("bug_id") : null);
      if (!workspaceId || !config.workspaceIds.includes(workspaceId) || !id || !/^\d{1,100}$/.test(id) || !["story", "task", "bug"].includes(kind ?? "")) continue;
      entities.push({ siteUrl: config.site, apiEndpoint: config.endpoint, workspaceId, kind: kind as ConversationEntity["kind"], id, title: "", status: "", statusLabel: "", owner: "" });
    } catch { /* A malformed URL is ordinary message text. */ }
  }
  return entities;
}

export function createMessageObserver(getValues: () => Promise<TapdSettingsValues>, callbacks: {
  collect(paseo: Paseo, agentId: string, entities: ConversationEntity[], sourceId: string): Promise<void>;
  restore(paseo: Paseo, agentId: string): Promise<void>;
}) {
  const observations = new Map<string, { subscription?: Subscription; work?: Promise<void>; again: boolean; full: boolean; restore: boolean; finalized: boolean; released: boolean }>();
  const retry = new Map<string, { paseo: Paseo; agentId: string }>();
  const key = (paseo: Paseo, agentId: string) => JSON.stringify([paseo.agents.ref(agentId).address.serverId, agentId]);
  async function scan(paseo: Paseo, agentId: string, full: boolean, finalized: boolean) {
    const handle = paseo.agents.ref(agentId);
    const values = await getValues();
    let cursor;
    const pages: Entry[][] = [];
    for (;;) {
      const page = await handle.timeline.refetch({ direction: cursor ? "before" : "tail", cursor, limit: 200 });
      if (page.error || page.gap || page.staleCursor || page.reset) throw new Error("会话消息暂不可用，请重试。");
      pages.unshift(page.entries);
      if (!full || !page.hasOlder) break;
      if (!page.startCursor || JSON.stringify(cursor) === JSON.stringify(page.startCursor)) throw new Error("会话消息暂不可用，请重试。");
      cursor = page.startCursor;
    }
    const entries = pages.flat();
    if (!full && entries.some(({ item }) => (item.type === "user_message" && !item.clientMessageId && !item.messageId) || (item.type === "assistant_message" && !item.messageId))) return scan(paseo, agentId, true, finalized);
    const occurrences = new Map<string, number>();
    const lastAssistant = entries.findLast(entry => entry.item.type === "assistant_message");
    for (const entry of entries) {
      if (entry.item.type !== "user_message" && entry.item.type !== "assistant_message") continue;
      const item = entry.item;
      const identity = item.type === "user_message" ? item.clientMessageId ?? item.messageId : item.messageId;
      const group = JSON.stringify([item.type, entry.turnId ?? null]);
      const occurrence = occurrences.get(group) ?? 0;
      occurrences.set(group, occurrence + 1);
      // Ordinary-message order survives projected chunk growth and sequence/epoch replacement.
      const source = createHash("sha256").update(JSON.stringify([item.type, identity ?? [entry.turnId ?? null, occurrence]])).digest("hex");
      const entities = references(item.text, values, finalized || entry !== lastAssistant || !handle.activeTurn);
      if (entities.length) await callbacks.collect(paseo, agentId, entities, `message:${source}`);
    }
  }
  function refresh(paseo: Paseo, agentId: string, full = true, restore = false, finalized = false): Promise<void> {
    const observation = observations.get(key(paseo, agentId));
    if (!observation || observation.released) return Promise.resolve();
    observation.again = true;
    observation.full ||= full;
    observation.restore ||= restore;
    observation.finalized ||= finalized;
    if (!observation.work) {
      observation.work = Promise.resolve().then(async () => {
        do {
          const all = observation.full;
          const presentation = observation.restore;
          const ended = observation.finalized;
          observation.again = observation.full = observation.restore = observation.finalized = false;
          await scan(paseo, agentId, all, ended);
          if (presentation && !observation.released) await callbacks.restore(paseo, agentId);
        } while (observation.again && !observation.released);
      }).catch(error => { if (!observation.released) retry.set(key(paseo, agentId), { paseo, agentId }); throw error; }).finally(() => { observation.work = undefined; });
    }
    return observation.work;
  }
  async function observe(paseo: Paseo, agentId: string, live = true) {
    const id = key(paseo, agentId);
    const existing = observations.get(id);
    if (existing) { if (existing.work) await existing.work; return; }
    const observation: NonNullable<ReturnType<typeof observations.get>> = { again: false, full: true, restore: false, finalized: false, released: false };
    observations.set(id, observation);
    try {
      const timeline = paseo.agents.ref(agentId).timeline;
      // Older synthetic hosts may not expose observation; production mainline always does.
      if (live && timeline.subscribe) {
        observation.subscription = timeline.subscribe(({ event }) => {
          if (observation.released) return;
          if (event.type === "error") { release(paseo, agentId); retry.set(id, { paseo, agentId }); return; }
          const reconnect = event.type === "replacement" || event.type === "subscription_restored";
          if (reconnect || (event.type === "timeline" && ["user_message", "assistant_message"].includes(event.item.type))) {
            // A second event during a scan may exceed its tail window; catch up all history in that case.
            void refresh(paseo, agentId, reconnect || !!observation.work, reconnect).catch(() => {});
          }
        });
        await observation.subscription.ready;
      }
      await refresh(paseo, agentId);
      if (!live) release(paseo, agentId);
    } catch (error) { release(paseo, agentId); throw error; }
  }
  function release(paseo: Paseo, agentId: string) {
    const id = key(paseo, agentId);
    const observation = observations.get(id);
    retry.delete(id);
    if (!observation) return;
    observation.released = true;
    void observation.subscription?.release().catch(() => {});
    observations.delete(id);
  }
  return { observe, refresh, release, settle: async () => {
    for (const [id, context] of [...retry]) {
      release(context.paseo, context.agentId);
      const agent = await context.paseo.agents.ref(context.agentId).refresh();
      if (!agent || agent.agent.archivedAt || agent.agent.status === "closed") continue;
      try { await observe(context.paseo, context.agentId); }
      catch (error) { retry.set(id, context); throw error; }
    }
    await Promise.all([...observations.values()].map(item => item.work));
  }, close() { for (const observation of observations.values()) { observation.released = true; void observation.subscription?.release().catch(() => {}); } observations.clear(); retry.clear(); } };
}
