import { type PluginClientContext, type PluginButtonRegistration, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useState, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { conversationEntityKey, conversationFocusRpc, conversationListRpc, conversationRemoveRpc, type ConversationEntity, type ConversationSummary } from "../../shared/conversation";
import { EntityDetailExperience } from "../workbench/EntityDetailExperience";
import type { DetailTarget } from "../workbench/EntityDetailContent";
import { EntitySummary } from "./EntitySummary";

const labels = { story: "需求", task: "任务", bug: "缺陷" };

export function contributeConversationAccess(client: PluginClientContext) {
  const location = Platform.OS === "web" ? "explorer" : "workspace";
  const listId = `tapd-conversation-${location}`;
  const pills = new Map<string, { pill: PluginButtonRegistration; workspaceId: string }>();
  const panels = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  let summaries: ConversationSummary[] = [];
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

  function ConversationPanel({ params: { agentId }, workspaceId, theme }: PluginAgentPanelProps) {
    const conversations = useSyncExternalStore(subscribe, snapshot);
    const entities = conversations.find(c => c.agentId === agentId && c.workspaceId === workspaceId)?.entities ?? [];
    const [focusedKey, setFocusedKey] = useState("");
    const [pending, setPending] = useState(false);
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
    const colors = theme.colors;
    return <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "600", fontSize: 18 }}>本次会话的 TAPD 单据</Text>
        {entities.map(entity => <View key={conversationEntityKey(entity)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onFocus={() => setFocusedKey(conversationEntityKey(entity))} onBlur={() => setFocusedKey("")} accessibilityRole="button" accessibilityLabel={`打开 TAPD ${labels[entity.kind]} #${entity.id}：${entity.title}`} onPress={() => void selectEntity(entity)}
            style={{ flex: 1, padding: 12, gap: 6, borderWidth: 1, borderColor: focusedKey === conversationEntityKey(entity) ? colors.accent : colors.border, borderRadius: 10, backgroundColor: colors.surface1 }}>
            <EntitySummary entity={entity} theme={theme} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`从会话移除 #${entity.id}`} disabled={pending} onPress={() => void removeEntity(entity)} style={{ padding: 12, minHeight: 44 }}>
            <Text style={{ color: colors.foregroundMuted }}>移除</Text>
          </Pressable>
        </View>)}
        {!entities.length ? <Text style={{ color: colors.foregroundMuted }}>当前会话没有 TAPD 单据。</Text> : null}

    </ScrollView>;
  }
  const stopList = client.addAgentPanel({ id: listId, title: "会话 TAPD", icon: "ClipboardList", locations: [location], Component: ConversationPanel });
  function publish() {
    const present = new Set<string>();
    for (const conversation of summaries) {
      const { agentId, workspaceId, entities } = conversation;
      if (!workspaceId || !entities.length) continue;
      for (const entity of entities) detailPanel(entity);
      present.add(agentId);
      const old = pills.get(agentId);
      if (old && old.workspaceId !== workspaceId) { old.pill.remove(); pills.delete(agentId); }
      const button = { title: `会话 TAPD 单据（${entities.length}）`, label: `TAPD · ${entities.length}`, icon: "ClipboardList",
        behavior: { kind: "action" as const, onPress: () => client.openPanel(listId, { workspaceId, agentId, location }) } };
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
    try { const result = await client.rpc(conversationListRpc, {}); if (!stopped) { summaries = result.conversations; publish(); } }
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
