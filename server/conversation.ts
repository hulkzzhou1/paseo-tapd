import type { AgentToolContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { batchResultSchema, batchEntitySchema, conversationEntityKey, conversationEntitySchema, entityResultSchema, type ConversationEntity, type ConversationSummary } from "../shared/conversation";
import type { TapdSettingsValues } from "../shared/contracts";
import { resolveConfig } from "./tapd";
import { createMessageObserver } from "./conversation-messages";

type Paseo = AgentToolContext["paseo"];
export type ConversationContext = { paseo: Paseo; agentId: string };
const owner = z.string().min(1).max(200);
const sourceSchema = z.record(z.string().max(500), z.array(z.string().max(10000)));
const recordSchema = z.object({
  hostId: owner, agentId: owner, workspaceId: z.string().nullable(),
  entities: z.array(conversationEntitySchema),
  sources: sourceSchema,
  cards: z.array(z.union([
    z.object({ id: z.string().min(1).max(200), data: entityResultSchema }).strict(),
    z.object({ id: z.string().min(1).max(200), data: batchResultSchema, entities: z.array(batchEntitySchema) }).strict(),
  ])),
}).strict();
const stateSchema = z.object({ version: z.literal(1), records: z.array(recordSchema) }).strict().refine(state =>
  new Set(state.records.map(record => JSON.stringify([record.hostId, record.agentId]))).size === state.records.length);
type State = z.infer<typeof stateSchema>;
type Record = State["records"][number];
function cardEntities(card: Record["cards"][number]): ConversationEntity[] {
  return "entities" in card ? card.entities.map(entity => ({ siteUrl: card.data.siteUrl, apiEndpoint: card.data.apiEndpoint, ...entity })) : [card.data.entity];
}
const storageError = "会话单据本机记录暂不可用，请重试；TAPD 单据不会因此重复提交。";

function storageFile() {
  const home = process.env.PASEO_HOME ?? "~/.paseo";
  const expanded = home === "~" ? homedir() : home.startsWith("~/") ? resolve(homedir(), home.slice(2)) : home;
  return resolve(expanded, "plugin-data/tapd-workbench/conversations.json");
}

export function createConversationRuntime(getValues: () => Promise<TapdSettingsValues>) {
  const file = storageFile();
  let state: State | undefined;
  let queue = Promise.resolve();
  let closed = false;
  let bootstrapPromise: Promise<void> | undefined;
  let livePaseo: Paseo | undefined;
  const releases: (() => void)[] = [];
  const recovered = new Map<string, string>();
  let presentationQueue = Promise.resolve();
  const messages = createMessageObserver(getValues, {
    collect: async (paseo, agentId, entities, sourceId) => {
      if (closed) return;
      const parsed = await validate(entities);
      if (!await reconcile(paseo, agentId)) return;
      await change(next => collectInto(record(next, { paseo, agentId }), parsed, sourceId));
    },
    restore: async (paseo, agentId) => {
      if (!await reconcile(paseo, agentId)) return;
      recovered.delete(JSON.stringify([hostId(paseo, agentId), agentId]));
      await restoreSerial(paseo, agentId);
    },
  });

  async function load() {
    if (state) return state;
    try { state = stateSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") state = { version: 1, records: [] };
      else throw new Error(storageError);
    }
    return state;
  }
  async function change<T>(update: (next: State) => T): Promise<T> {
    const work = queue.then(async () => {
      const current = await load();
      const next = structuredClone(current);
      const result = update(next);
      stateSchema.parse(next);
      if (JSON.stringify(next) === JSON.stringify(current)) return result;
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, file);
        state = next;
      } catch { await unlink(temporary).catch(() => {}); throw new Error(storageError); }
      return result;
    });
    queue = work.then(() => {}, () => {});
    return work;
  }
  function hostId(paseo: Paseo, agentId = "tapd-conversation-address") {
    return owner.parse(paseo.agents.ref(agentId).address.serverId);
  }
  function record(next: State, context: ConversationContext): Record {
    const host = hostId(context.paseo, context.agentId);
    const agent = owner.parse(context.agentId);
    let result = next.records.find(item => item.hostId === host && item.agentId === agent);
    if (!result) { result = { hostId: host, agentId: agent, workspaceId: context.paseo.agents.ref(agent).workspaceId, entities: [], cards: [], sources: {} }; next.records.push(result); }
    return result;
  }
  async function validate(entities: ConversationEntity[], warnings: string[] = []) {
    const values = await getValues();
    const config = resolveConfig(values);
    return entities.map(raw => {
      const entity = conversationEntitySchema.parse(raw);
      if (entity.siteUrl !== config.site || entity.apiEndpoint !== config.endpoint || !config.workspaceIds.includes(entity.workspaceId)) throw new Error("单据引用与当前 TAPD 连接或项目不匹配，请重新查询。");
      const serialized = JSON.stringify([entity, warnings]);
      if ([config.token, values.syncGitToken, process.env.TAPD_TOKEN].filter(Boolean).some(secret => serialized.includes(secret!))) throw new Error(storageError);
      return entity;
    });
  }
  function collectInto(target: Record, entities: ConversationEntity[], sourceId?: string) {
    const seen = sourceId && Object.hasOwn(target.sources, sourceId) ? target.sources[sourceId] : [];
    for (const entity of entities) {
      const key = conversationEntityKey(entity);
      if (seen.includes(key)) continue;
      const previous = target.entities.find(item => conversationEntityKey(item) === key) ?? target.cards.toReversed().flatMap(cardEntities).find(item => conversationEntityKey(item) === key);
      target.entities = target.entities.filter(item => conversationEntityKey(item) !== key);
      target.entities.unshift({ ...entity, title: entity.title || previous?.title || "", status: entity.status || previous?.status || "", statusLabel: entity.statusLabel || previous?.statusLabel || "", owner: entity.owner || previous?.owner || "" });
      if (sourceId) seen.push(key);
    }
    if (sourceId) Object.defineProperty(target.sources, z.string().min(1).max(500).parse(sourceId), { value: seen, enumerable: true, configurable: true, writable: true });
  }
  async function reconcile(paseo: Paseo, agentId: string): Promise<boolean> {
    const handle = paseo.agents.ref(agentId);
    const result = await handle.refresh();
    const host = hostId(paseo, agentId);
    if (result === null) {
      messages.release(paseo, agentId);
      await change(next => { next.records = next.records.filter(item => item.hostId !== host || item.agentId !== agentId); });
      recovered.delete(JSON.stringify([host, agentId]));
      return false;
    }
    if (result.agent.archivedAt || result.agent.status === "closed") messages.release(paseo, agentId);
    await change(next => { const found = next.records.find(item => item.hostId === host && item.agentId === agentId); if (found) found.workspaceId = handle.workspaceId; });
    return true;
  }
  async function restore(paseo: Paseo, agentId: string) {
    const key = JSON.stringify([hostId(paseo, agentId), agentId]);
    const stored = (await load()).records.find(item => item.hostId === hostId(paseo, agentId) && item.agentId === agentId);
    const fingerprint = JSON.stringify(stored?.cards.map(card => card.id) ?? []);
    if (recovered.get(key) === fingerprint) return;
    if (!stored?.cards.length) { recovered.set(key, fingerprint); return; }
    const timeline = paseo.agents.ref(agentId).timeline;
    const present = new Set<string>();
    let cursor;
    for (;;) {
      const page = await timeline.refetch({ direction: cursor ? "before" : "tail", cursor, limit: 200 });
      if (page.error || page.gap || page.staleCursor || page.reset) throw new Error(storageError);
      for (const entry of page.entries) if (entry.item.type === "plugin" && entry.item.pluginId === "tapd-workbench") present.add(entry.item.id);
      if (!page.hasOlder) break;
      if (!page.startCursor || JSON.stringify(cursor) === JSON.stringify(page.startCursor)) throw new Error(storageError);
      cursor = page.startCursor;
    }
    for (const card of stored.cards) if (!present.has(card.id)) await timeline.append({ type: "plugin", id: card.id, kind: "entities" in card ? "tapd-batch-result" : "tapd-entity-result", version: 1, data: card.data });
    recovered.set(key, fingerprint);
  }
  function restoreSerial(paseo: Paseo, agentId: string) {
    const work = presentationQueue.then(() => restore(paseo, agentId));
    presentationQueue = work.then(() => {}, () => {});
    return work;
  }
  async function initialize(paseo: Paseo) {
    livePaseo = paseo;
    let cursor: string | undefined;
    do {
      const directory = await paseo.agents.list({ includeBackground: true, filter: { includeArchived: true }, page: { limit: 200, ...(cursor ? { cursor } : {}) }, subscribe: {} });
      if (closed) { await directory.subscription.release(); return; }
      await directory.subscription.ready;
      directory.subscription.subscribe({ update(message) {
        if (message.type !== "agent_update") return;
        const id = message.payload.kind === "remove" ? message.payload.agentId : message.payload.agent.id;
        void (async () => {
          if (!await reconcile(paseo, id)) return;
          if (message.payload.kind === "upsert" && !message.payload.agent.archivedAt && message.payload.agent.status !== "closed") await messages.observe(paseo, id);
        })().catch(() => {});
      }, snapshot(snapshot) {
        recovered.clear();
        void (async () => {
          await reconcileKnown(paseo);
          for (const entry of snapshot.entries) if (!entry.agent.archivedAt) {
            await messages.observe(paseo, entry.agent.id, entry.agent.status !== "closed");
            await messages.refresh(paseo, entry.agent.id, true, true);
          }
        })().catch(() => {});
      }, error() {} });
      releases.push(() => { void directory.subscription.release(); });
      for (const entry of directory.entries) if (!entry.agent.archivedAt) await messages.observe(paseo, entry.agent.id, entry.agent.status !== "closed");
      if (!directory.pageInfo.hasMore) break;
      if (!directory.pageInfo.nextCursor || cursor === directory.pageInfo.nextCursor) throw new Error(storageError);
      cursor = directory.pageInfo.nextCursor;
    } while (!closed);
    await reconcileKnown(paseo);
  }
  async function reconcileKnown(paseo: Paseo) {
    const own = (await load()).records.filter(item => item.hostId === hostId(paseo));
    for (const item of own) {
      try { if (await reconcile(paseo, item.agentId)) await restoreSerial(paseo, item.agentId); } catch { /* Reconcile again before presentation; a failed read never proves deletion. */ }
    }
  }
  function bootstrap(context: { paseo: Paseo }) {
    if (!bootstrapPromise) bootstrapPromise = Promise.resolve().then(() => initialize(context.paseo)).catch(error => {
      messages.close();
      for (const release of releases.splice(0)) release();
      bootstrapPromise = undefined; throw error;
    });
    return bootstrapPromise;
  }
  async function collect(context: ConversationContext, entities: ConversationEntity[], sourceId?: string) {
    await bootstrap(context);
    const parsed = await validate(entities);
    if (!await reconcile(context.paseo, context.agentId)) throw new Error(storageError);
    await change(next => collectInto(record(next, context), parsed, sourceId));
  }
  async function recordResult(context: ConversationContext, raw: z.input<typeof entityResultSchema>, sourceId = randomUUID()) {
    await bootstrap(context);
    const data = entityResultSchema.parse(raw);
    await validate([data.entity], data.warnings);
    if (!await reconcile(context.paseo, context.agentId)) throw new Error(storageError);
    await change(next => {
      const target = record(next, context);
      const previous = target.cards.find(item => item.id === sourceId);
      if (previous) return previous;
      const item = { id: z.string().min(1).max(200).parse(sourceId), data };
      target.cards.push(item);
      collectInto(target, [data.entity], `card:${sourceId}`);
      return item;
    });
    await restoreSerial(context.paseo, context.agentId);
  }
  async function recordBatch(context: ConversationContext, raw: z.input<typeof batchResultSchema>, entities: ConversationEntity[]) {
    await bootstrap(context);
    const data = batchResultSchema.parse(raw);
    const parsed = await validate(entities, data.warnings);
    if (data.returned !== parsed.length || parsed.some(entity => entity.siteUrl !== data.siteUrl || entity.apiEndpoint !== data.apiEndpoint)) throw new Error(storageError);
    if (Buffer.byteLength(JSON.stringify(data), "utf8") > 64000) throw new Error(storageError);
    if (!await reconcile(context.paseo, context.agentId)) throw new Error(storageError);
    await change(next => {
      const target = record(next, context);
      if (!target.cards.some(card => card.id === data.batchId)) target.cards.push({ id: data.batchId, data, entities: parsed.map(entity => batchEntitySchema.parse(entity)) });
    });
    await restoreSerial(context.paseo, context.agentId);
  }
  async function batchPage(context: ConversationContext, input: { batchId: string; siteUrl: string; apiEndpoint: string; offset: number }) {
    await bootstrap(context);
    if (!await reconcile(context.paseo, context.agentId)) throw new Error("批量结果不可用，请重新查询。");
    const stored = (await load()).records.find(item => item.hostId === hostId(context.paseo, context.agentId) && item.agentId === context.agentId);
    const card = stored?.cards.find(item => item.id === input.batchId);
    if (!card || !("entities" in card) || card.data.siteUrl !== input.siteUrl || card.data.apiEndpoint !== input.apiEndpoint || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > card.entities.length) throw new Error("批量结果不可用，请重新查询。");
    const refs = card.entities.map(entity => ({ siteUrl: card.data.siteUrl, apiEndpoint: card.data.apiEndpoint, ...entity }));
    await validate(refs, card.data.warnings);
    const end = Math.min(input.offset + 5, refs.length);
    return { items: card.entities.slice(input.offset, end), nextOffset: end < refs.length ? end : null };
  }
  async function list(context: { paseo: Paseo }): Promise<{ conversations: ConversationSummary[] }> {
    await bootstrap(context);
    await messages.settle();
    const conversations: ConversationSummary[] = [];
    const own = (await load()).records.filter(item => item.hostId === hostId(context.paseo));
    for (const item of own) {
      if (!await reconcile(context.paseo, item.agentId)) continue;
      await restoreSerial(context.paseo, item.agentId);
      const fresh = (await load()).records.find(candidate => candidate.hostId === item.hostId && candidate.agentId === item.agentId);
      if (fresh) conversations.push({ agentId: fresh.agentId, workspaceId: fresh.workspaceId, entities: fresh.entities });
    }
    return { conversations };
  }
  async function remove(context: ConversationContext, raw: ConversationEntity) {
    await bootstrap(context);
    const entity = conversationEntitySchema.parse(raw);
    if (!await reconcile(context.paseo, context.agentId)) throw new Error(storageError);
    await change(next => { const target = record(next, context); target.entities = target.entities.filter(item => conversationEntityKey(item) !== conversationEntityKey(entity)); });
    return { ok: true as const };
  }
  return { bootstrap, collect, recordResult, recordBatch, batchPage, list, remove,
    observeMessages: async (context: ConversationContext, finalized = false) => {
      await bootstrap(context);
      if (!await reconcile(context.paseo, context.agentId)) return;
      const agent = context.paseo.agents.ref(context.agentId);
      if (agent.archivedAt) return;
      await messages.observe(context.paseo, context.agentId, agent.status !== "closed");
      await messages.refresh(context.paseo, context.agentId, true, false, finalized);
    },
    focus: async (context: ConversationContext, entity: ConversationEntity) => {
      await bootstrap(context);
      const stored = (await load()).records.find(item => item.hostId === hostId(context.paseo, context.agentId) && item.agentId === context.agentId);
      const known = [...(stored?.entities ?? []), ...(stored?.cards.toReversed().flatMap(cardEntities) ?? [])].find(item => conversationEntityKey(item) === conversationEntityKey(entity));
      if (!known) throw new Error("单据引用不可用，请重新查询。");
      await collect(context, [known]); return { ok: true as const };
    },
    restorePresentation: async (context: ConversationContext) => {
      recovered.delete(JSON.stringify([hostId(context.paseo, context.agentId), context.agentId]));
      await restoreSerial(context.paseo, context.agentId);
    },
    reconcile: async (agentId: string) => { if (livePaseo) return reconcile(livePaseo, agentId); },
    close() { closed = true; messages.close(); for (const release of releases.splice(0)) release(); },
  };
}
export type ConversationRuntime = ReturnType<typeof createConversationRuntime>;
