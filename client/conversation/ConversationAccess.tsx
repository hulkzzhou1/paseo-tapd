import { type PluginClientContext, type PluginButtonRegistration, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View, Platform } from "react-native";
import { conversationRefreshRpc, conversationEntityKey, conversationFocusRpc, conversationListRpc, conversationRemoveRpc, type ConversationEntity, type ConversationSummary } from "../../shared/conversation";
import { EntityDetailExperience } from "../workbench/EntityDetailExperience";
import type { DetailTarget } from "../workbench/EntityDetailContent";
import { agentLinksRpc, type ToolLink } from "../../shared/agent-links";
import { taskBoardRpc, type TaskBoard } from "../../shared/task-board";
import { migrationListRpc, migrationConfirmRpc, type MigrationGroup } from "../../shared/ownership-migration";
import { MigrationList } from "./MigrationList";
import { TaskBoardList } from "./TaskBoardList";
import { ConversationList } from "./ConversationList";

const labels = { story: "需求", task: "任务", bug: "缺陷" };

export function contributeConversationAccess(client: PluginClientContext) {
  const location = Platform.OS === "web" ? "explorer" : "workspace";
  const listId = `tapd-conversation-${location}`;
  const pills = new Map<string, { pill: PluginButtonRegistration; workspaceId: string }>();
  const panels = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  let summaries: ConversationSummary[] = [];
  let assignments: ToolLink[] = [];
  let pendingAgents: {agentId:string;workspaceId:string}[] = [];
  const refreshRequests = new Map<string, number>();
  let stopped = false;
  let pending = false;
  let again = false;
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const snapshot = () => summaries;

  function detailPanel(entity: ConversationEntity) {
    // A deterministic full key lets the host restore and reuse each item tab without collisions.
    const id = `tapd-detail-${location}-${conversationEntityKey(entity).split("").map(c => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}`;
    if (!panels.has(id)) {
      function DetailPanel({ theme, navigation }: PluginAgentPanelProps) {
        const [target, setTarget] = useState<DetailTarget | null>(entity);
        return <EntityDetailExperience presentation="panel" target={target} onTargetChange={setTarget} theme={theme} navigation={navigation} />;
      }
      panels.set(id, client.addAgentPanel({ id, title: `${labels[entity.kind]} #${entity.id}`, icon: "ClipboardList", locations: [location], Component: DetailPanel }));
    }
    return id;
  }

  async function openEntity(agentId: string, workspaceId: string | null | undefined, entity: ConversationEntity) {
    if (!workspaceId) return false;
    if (stopped) throw new Error("TAPD 面板已关闭");
    await client.rpc(conversationFocusRpc, { agentId, entity });
    if (stopped) throw new Error("TAPD 面板已关闭");
    client.openPanel(detailPanel(entity), { workspaceId, agentId, location });
    void refresh();
    return true;
  }

  function RecentPanel({ params: { agentId }, workspaceId, theme }: PluginAgentPanelProps) {
    const conversations = useSyncExternalStore(subscribe, snapshot);
    const entities = conversations.find(c => c.agentId === agentId && c.workspaceId === workspaceId)?.entities ?? [];
    const hasEntities = entities.length > 0;
    const [pending, setPending] = useState(false);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(0);
    const [retry, setRetry] = useState(0);
    const requested = useSyncExternalStore(subscribe, () => refreshRequests.get(agentId) ?? 0);
    useEffect(() => {
      let cancelled = false;
      const candidates = snapshot().find(c => c.agentId === agentId && c.workspaceId === workspaceId)?.entities ?? [];
      setFailed(0);
      setLoading(false);
      if (!candidates.length) return;
      setLoading(true);
      void (async () => {
        for (let offset = 0; offset < candidates.length && !cancelled; offset += 2) {
          const results = await Promise.allSettled(candidates.slice(offset, offset + 2).map(entity => client.rpc(conversationRefreshRpc, { agentId, entity })));
          if (!cancelled) { setFailed(count => count + results.filter(result => result.status === "rejected").length); await refresh(); }
        }
        if (!cancelled) setLoading(false);
      })();
      return () => { cancelled = true; };
    }, [agentId, workspaceId, retry, requested, hasEntities]);
    const toast = useToast();
    async function selectEntity(entity: ConversationEntity) {
      try {
        await openEntity(agentId, workspaceId, entity);
      } catch { toast.error("单据引用暂不可用，可重试、重新查询或从会话移除。"); }
    }
    async function removeEntity(entity: ConversationEntity) {
      if (pending) return;
      setPending(true);
      try { await client.rpc(conversationRemoveRpc, { agentId, entity }); await refresh(); }
      catch { toast.error("移除失败，请重试；TAPD 单据未被修改。"); }
      finally { setPending(false); }
    }
    return <ConversationList entities={entities} theme={theme} pending={pending} loading={loading} failed={failed} onRefresh={() => { setRetry(value => value + 1); }} onOpen={entity => void selectEntity(entity)} onRemove={entity => void removeEntity(entity)} />;
  }
  function ConversationPanel(props: PluginAgentPanelProps) {
    const { params: { agentId }, workspaceId, theme } = props;
    const conversations = useSyncExternalStore(subscribe, snapshot);
    const requested = useSyncExternalStore(subscribe, () => refreshRequests.get(agentId) ?? 0);
    const [recent, setRecent] = useState(false);
    const [migrationOpen, setMigrationOpen] = useState(false);
    const [migrationGroups, setMigrationGroups] = useState<MigrationGroup[]>([]);
    const [migrationWarnings, setMigrationWarnings] = useState<string[]>([]);
    const [confirming, setConfirming] = useState(false);
    const [migrationError, setMigrationError] = useState(false);
    const [board, setBoard] = useState<TaskBoard | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const revision = assignments.filter(link => link.agentId === agentId).map(link => link.responsibility?.revision ?? `${link.kind}/${link.id}/${link.agentId}`).sort().join(",");
    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      void Promise.all([client.rpc(taskBoardRpc, { agentId }), client.rpc(migrationListRpc, {agentId})]).then(([result,migration]) => { if (!cancelled) { setBoard(result); setMigrationGroups(migration.groups); setMigrationWarnings(migration.warnings); setFailed(false); } }, () => { if (!cancelled) setFailed(true); }).finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [agentId, workspaceId, requested, retry, revision]);
    const toast = useToast();
    async function confirm(group:MigrationGroup,targetAgentId:string){
      if(confirming)return;
      setConfirming(true);setMigrationError(false);
      try{await client.rpc(migrationConfirmRpc,{kind:group.kind,id:group.id,workspaceId:group.workspaceId,agentId:targetAgentId,expectedRevision:group.revision,confirmed:true});await refresh();setRetry(value=>value+1);}
      catch{setMigrationError(true);}finally{setConfirming(false);}
    }
    if(migrationOpen)return <MigrationList groups={migrationGroups} warnings={migrationWarnings} theme={theme} pending={confirming} error={migrationError} onBack={()=>setMigrationOpen(false)} onConfirm={(group,id)=>void confirm(group,id)} />;
    if (recent) return <View style={{ flex: 1 }}><Pressable accessibilityRole="button" onPress={() => setRecent(false)} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 12, backgroundColor: theme.colors.surface0 }}><Text style={{ color: theme.colors.accent, fontSize: 12 }}>返回任务看板</Text></Pressable><RecentPanel {...props} /></View>;
    return <TaskBoardList migrationCount={migrationGroups.length} onMigration={migrationGroups.length||migrationWarnings.length?()=>setMigrationOpen(true):undefined} board={board} theme={theme} loading={loading} failed={failed} recentCount={conversations.find(item => item.agentId === agentId)?.entities.length ?? 0} onRecent={() => setRecent(true)} onRefresh={() => setRetry(value => value + 1)} onOpen={entity => { void openEntity(agentId, workspaceId, entity).catch(() => toast.error("单据详情暂不可用，请重试。")); }} />;
  }
  const stopList = client.addAgentPanel({ id: listId, title: "TAPD 任务看板", icon: "ClipboardList", locations: [location], Component: ConversationPanel });
  function publish() {
    const present = new Set<string>();
    for (const conversation of summaries) {
      const { agentId, workspaceId, entities } = conversation;
      const owned = assignments.filter(link => link.agentId === agentId && link.responsibility).length;
      if (!workspaceId || (!entities.length && !assignments.some(link => link.agentId === agentId) && !pendingAgents.some(item=>item.agentId===agentId))) continue;
      for (const entity of entities) detailPanel(entity);
      present.add(agentId);
      const old = pills.get(agentId);
      if (old && old.workspaceId !== workspaceId) { old.pill.remove(); pills.delete(agentId); }
      const button = { title: `TAPD 任务看板（${owned}）`, label: `TAPD · ${owned}`, icon: "ClipboardList",
        behavior: { kind: "action" as const, onPress: () => { refreshRequests.set(agentId, (refreshRequests.get(agentId) ?? 0) + 1); client.openPanel(listId, { workspaceId, agentId, location }); for (const listener of listeners) listener(); } } };
      const entry = pills.get(agentId);
      if (entry) entry.pill.update(button);
      else pills.set(agentId, { workspaceId, pill: client.addComposerPill({ id: "tapd-conversation", workspaceId, agentId, button }) });
    }
    for (const [id, entry] of pills) if (!present.has(id)) { entry.pill.remove(); pills.delete(id); }
    for (const listener of listeners) listener();
  }
  async function refresh() {
    if (stopped) return;
    if (pending) { again = true; return; }
    pending = true;
    try {
      const [result, saved] = await Promise.all([client.rpc(conversationListRpc, {}), client.rpc(agentLinksRpc, {})]);
      if (!stopped) {
        assignments = saved.links;
        pendingAgents = saved.pendingAgents??[];
        summaries = [...result.conversations];
        for (const link of [...assignments,...pendingAgents]) if (link.agentId && link.workspaceId && !summaries.some(item => item.agentId === link.agentId)) summaries.push({ agentId: link.agentId, workspaceId: link.workspaceId, entities: [] });
        publish();
      }
    }
    catch { /* Preserve the last known list through temporary connection failures. */ }
    finally { pending = false; if (again && !stopped) { again = false; void refresh(); } }
  }
  const unsubscribe = client.paseo.agents.subscribe(() => void refresh());
  const timer = setInterval(() => void refresh(), 2000);
  void refresh();
  return { openEntity, dispose() {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    for (const { pill } of pills.values()) pill.remove();
    for (const stop of panels.values()) void stop();
    void stopList();
    pills.clear(); panels.clear(); listeners.clear();
  } };
}
