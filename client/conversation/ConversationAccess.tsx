import { useRpc, type PluginClientContext, type PluginHostProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { conversationEntityKey, conversationFocusRpc, conversationListRpc, conversationRemoveRpc, type ConversationEntity } from "../../shared/conversation";
import { EntityDetailExperience } from "../workbench/EntityDetailExperience";
import type { DetailTarget } from "../workbench/EntityDetailModal";
import { WorkbenchDialog } from "../workbench/WorkbenchDialog";
import { kindColor, statusTone, toneColor } from "../workbench/status-tones";

const labels = { story: "需求", task: "任务", bug: "缺陷" };
export function ConversationAccess({ client, host, theme }: PluginHostProps & { client: PluginClientContext }) {
  const list = useRpc(conversationListRpc);
  const focus = useRpc(conversationFocusRpc);
  const remove = useRpc(conversationRemoveRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ["tapd-conversations", host.id];
  const conversations = useQuery({ queryKey: key, queryFn: () => list({}), refetchInterval: 2000, retry: false });
  const [listAgent, setListAgent] = useState<string | null>(null);
  const [detailAgent, setDetailAgent] = useState<string | null>(null);
  const [target, setTarget] = useState<DetailTarget | null>(null);
  const registrations = useRef(new Map<string, ReturnType<PluginClientContext["addComposerPill"]>>());
  const [focusedKey, setFocusedKey] = useState("");
  const [pending, setPending] = useState(false);
  const active = conversations.data?.conversations.find(item => item.agentId === listAgent);
  const open = useCallback(async (agentId: string, entity: ConversationEntity) => {
    try {
      await focus({ agentId, entity });
      setListAgent(null);
      setDetailAgent(agentId);
      setTarget(entity);
      void queryClient.invalidateQueries({ queryKey: ["tapd-conversations", host.id] });
    } catch { toast.error("单据引用暂不可用，请重试或重新查询。"); }
  }, [focus, host.id, queryClient, toast]);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const owned = registrations.current;
    const present = new Set<string>();
    // A failed reconciliation hides cached entries until their owner can be verified.
    for (const conversation of conversations.isError ? [] : conversations.data?.conversations ?? []) {
      if (!conversation.workspaceId || !conversation.entities.length) continue;
      const id = conversation.agentId;
      present.add(id);
      const button = {
        title: `会话 TAPD 单据（${conversation.entities.length}）`, label: `TAPD · ${conversation.entities.length}`, icon: "ClipboardList" as const,
        behavior: { kind: "action" as const, onPress: () => {
          if (conversation.entities.length === 1) void openRef.current(id, conversation.entities[0]);
          else setListAgent(id);
        } },
      };
      const existing = owned.get(id);
      if (existing) existing.update(button);
      else owned.set(id, client.addComposerPill({ id: `tapd-conversation-${id}`, workspaceId: conversation.workspaceId, agentId: id, button }));
    }
    for (const [id, registration] of owned) if (!present.has(id)) { registration.remove(); owned.delete(id); }
  }, [client, conversations.data, conversations.isError]);
  useEffect(() => {
    const owned = registrations.current;
    return () => { for (const registration of owned.values()) registration.remove(); owned.clear(); };
  }, []);
  async function removeEntity(agentId: string, entity: ConversationEntity) {
    if (pending) return;
    setPending(true);
    try { await remove({ agentId, entity }); await conversations.refetch(); }
    catch { toast.error("移除失败，请重试；TAPD 单据未被修改。"); }
    finally { setPending(false); }
  }
  const colors = theme.colors;
  return <>
    <WorkbenchDialog title="会话 TAPD 单据" size="small" open={!!listAgent} onOpenChange={value => { if (!value) setListAgent(null); }} theme={theme}>
      <WorkbenchDialog.Content>
        {active?.entities.map(entity => <View key={conversationEntityKey(entity)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onFocus={() => setFocusedKey(conversationEntityKey(entity))} onBlur={() => setFocusedKey("")} accessibilityRole="button" accessibilityLabel={`打开 TAPD ${labels[entity.kind]} #${entity.id}：${entity.title}`} onPress={() => void open(active.agentId, entity)}
            style={{ flex: 1, padding: 12, gap: 6, borderWidth: 1, borderColor: focusedKey === conversationEntityKey(entity) ? colors.accent : colors.border, borderRadius: 10, backgroundColor: colors.surface1 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Text style={{ color: kindColor(entity.kind, theme) }}>{labels[entity.kind]} · #{entity.id}</Text>
              <Text style={{ color: toneColor(statusTone(entity.kind, entity.status, entity.statusLabel), theme) }}>{entity.statusLabel || entity.status}</Text>
            </View>
            <Text numberOfLines={2} style={{ color: colors.foreground, lineHeight: 21 }}>{entity.title || `#${entity.id}`}</Text>
            {entity.owner ? <Text style={{ color: colors.foregroundMuted }}>{entity.owner}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`从会话移除 #${entity.id}`} disabled={pending} onPress={() => void removeEntity(active.agentId, entity)} style={{ padding: 12, minHeight: 44 }}>
            <Text style={{ color: colors.foregroundMuted }}>移除</Text>
          </Pressable>
        </View>)}
        {!active?.entities.length ? <Text style={{ color: colors.foregroundMuted }}>当前会话没有 TAPD 单据。</Text> : null}
      </WorkbenchDialog.Content>
    </WorkbenchDialog>
    <EntityDetailExperience target={target} onTargetChange={setTarget} theme={theme}
      onRemoveFromConversation={detailAgent && target && "siteUrl" in target ? () => void removeEntity(detailAgent, target as ConversationEntity) : undefined} />
  </>;
}
