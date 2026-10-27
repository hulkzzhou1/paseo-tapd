import { useRpc, type PluginClientContext, type PluginButtonIconProps, type PluginButtonRegistration, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { conversationEntityKey, conversationFocusRpc, conversationListRpc, conversationRemoveRpc, type ConversationEntity, type ConversationSummary } from "../../shared/conversation";
import { EntityDetailExperience } from "../workbench/EntityDetailExperience";
import type { DetailTarget } from "../workbench/EntityDetailModal";
import { WorkbenchDialog } from "../workbench/WorkbenchDialog";
import { kindColor, statusTone, toneColor } from "../workbench/status-tones";

const labels = { story: "需求", task: "任务", bug: "缺陷" };
function ConversationAccess({ agentId, theme, access }: PluginButtonIconProps & { agentId: string; access: Access }) {
  const focus = useRpc(conversationFocusRpc);
  const remove = useRpc(conversationRemoveRpc);
  const toast = useToast();
  const [listOpen, setListOpen] = useState(false);
  const [target, setTarget] = useState<DetailTarget | null>(null);
  const [focusedKey, setFocusedKey] = useState("");
  const [pending, setPending] = useState(false);
  const active = useSyncExternalStore(access.subscribe, access.snapshot);
  const handled = useRef(active.request);
  useEffect(() => () => access.closed(), [access]);
  const open = useCallback(async (entity: ConversationEntity) => {
    try {
      await focus({ agentId, entity });
      setListOpen(false);
      setTarget(entity);
      access.refresh();
    } catch { setListOpen(true); toast.error("单据引用暂不可用，可重试、重新查询或从会话移除。"); }
  }, [focus, agentId, access, toast]);
  useEffect(() => {
    if (!active.request || handled.current === active.request) return;
    handled.current = active.request;
    if (active.entities.length === 1) void open(active.entities[0]);
    else setListOpen(true);
  }, [active, open]);
  async function removeEntity(agentId: string, entity: ConversationEntity) {
    if (pending) return;
    setPending(true);
    try { await remove({ agentId, entity }); access.refresh(); }
    catch { toast.error("移除失败，请重试；TAPD 单据未被修改。"); }
    finally { setPending(false); }
  }
  const colors = theme.colors;
  return <>
    <WorkbenchDialog title="会话 TAPD 单据" size="small" open={listOpen} onOpenChange={value => { if (!value) { setListOpen(false); access.closed(); } }} theme={theme}>
      <WorkbenchDialog.Content>
        {active.entities.map(entity => <View key={conversationEntityKey(entity)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onFocus={() => setFocusedKey(conversationEntityKey(entity))} onBlur={() => setFocusedKey("")} accessibilityRole="button" accessibilityLabel={`打开 TAPD ${labels[entity.kind]} #${entity.id}：${entity.title}`} onPress={() => void open(entity)}
            style={{ flex: 1, padding: 12, gap: 6, borderWidth: 1, borderColor: focusedKey === conversationEntityKey(entity) ? colors.accent : colors.border, borderRadius: 10, backgroundColor: colors.surface1 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Text style={{ color: kindColor(entity.kind, theme) }}>{labels[entity.kind]} · #{entity.id}</Text>
              <Text style={{ color: toneColor(statusTone(entity.kind, entity.status, entity.statusLabel), theme) }}>{entity.statusLabel || entity.status}</Text>
            </View>
            <Text numberOfLines={2} style={{ color: colors.foreground, lineHeight: 21 }}>{entity.title || `#${entity.id}`}</Text>
            {entity.owner ? <Text style={{ color: colors.foregroundMuted }}>{entity.owner}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`从会话移除 #${entity.id}`} disabled={pending} onPress={() => void removeEntity(agentId, entity)} style={{ padding: 12, minHeight: 44 }}>
            <Text style={{ color: colors.foregroundMuted }}>移除</Text>
          </Pressable>
        </View>)}
        {!active.entities.length ? <Text style={{ color: colors.foregroundMuted }}>当前会话没有 TAPD 单据。</Text> : null}
      </WorkbenchDialog.Content>
    </WorkbenchDialog>
    <EntityDetailExperience target={target} onTargetChange={setTarget} theme={theme}
      onDismiss={() => access.closed()} onRemoveFromConversation={target && "siteUrl" in target ? () => void removeEntity(agentId, target as ConversationEntity) : undefined} />
  </>;
}

type AccessState = { entities: ConversationEntity[]; request: number };
type Access = { subscribe(listener: () => void): () => void; snapshot(): AccessState; refresh(): void; closed(): void };

// The icon owns the dialogs: the host unmounts popover bodies on dismissal and
// replaces action icons while pending. The popover only forwards the opening gesture.
export function contributeConversationAccess(client: PluginClientContext) {
  const owned = new Map<string, { pill: PluginButtonRegistration; workspaceId: string; active: boolean; state: AccessState; listeners: Set<() => void> }>();
  let stopped = false;
  let pending = false;
  let again = false;
  let summaries: ConversationSummary[] = [];
  const publish = () => {
    if (stopped) return;
    const present = new Set<string>();
    for (const conversation of summaries) {
      if (!conversation.workspaceId || (!conversation.entities.length && !owned.has(conversation.agentId))) continue;
      const id = conversation.agentId;
      present.add(id);
      let entry = owned.get(id);
      if (entry && entry.workspaceId !== conversation.workspaceId) { entry.pill.remove(); owned.delete(id); entry = undefined; }
      if (!entry) {
        const listeners = new Set<() => void>();
        const initial = { entities: conversation.entities, request: 0 };
        const access: Access = {
          subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
          snapshot: () => owned.get(id)?.state ?? initial,
          refresh: () => void refresh(),
          closed() { const current = owned.get(id); if (current) current.active = false; publish(); },
        };
        function ComposerIcon(props: PluginButtonIconProps) {
          return <><Icon name="ClipboardList" size={props.size} color={props.color} /><ConversationAccess {...props} agentId={id} access={access} /></>;
        }
        function OpenAccess({ close }: PluginButtonContentProps) {
          useEffect(() => {
            const current = owned.get(id);
            if (!current || stopped) return;
            current.active = true;
            current.state = { ...current.state, request: current.state.request + 1 };
            for (const listener of current.listeners) listener();
            close();
          }, [close]);
          return null;
        }
        const pill = client.addComposerPill({ id: `tapd-conversation-${id}`, workspaceId: conversation.workspaceId, agentId: id,
          button: { title: `会话 TAPD 单据（${conversation.entities.length}）`, label: `TAPD · ${conversation.entities.length}`, icon: ComposerIcon,
            behavior: { kind: "popover", Content: OpenAccess },
          } });
        entry = { pill, workspaceId: conversation.workspaceId, active: false, state: initial, listeners };
        owned.set(id, entry);
      }
      entry.state = { ...entry.state, entities: conversation.entities };
      entry.pill.update({ title: `会话 TAPD 单据（${conversation.entities.length}）`, label: `TAPD · ${conversation.entities.length}` });
      for (const listener of entry.listeners) listener();
    }
    // Keep an open dialog owner through failed polls/removal until it closes safely.
    for (const [id, entry] of owned) {
      if (!present.has(id) && entry.active) {
        entry.state = { ...entry.state, entities: [] };
        for (const listener of entry.listeners) listener();
      }
      if ((!present.has(id) || !entry.state.entities.length) && !entry.active) { entry.pill.remove(); owned.delete(id); }
    }
  };
  async function refresh() {
    if (stopped) return;
    if (pending) { again = true; return; }
    pending = true;
    try { const result = await client.rpc(conversationListRpc, {}); if (!stopped) { summaries = result.conversations; publish(); } }
    catch { /* A failed poll cannot replace the last known references or dismiss a draft. */ }
    finally { pending = false; if (again && !stopped) { again = false; void refresh(); } }
  }
  const unsubscribe = client.paseo.agents.subscribe(() => void refresh());
  const timer = setInterval(() => void refresh(), 2000);
  void refresh();
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    for (const entry of owned.values()) { entry.pill.remove(); entry.listeners.clear(); }
    owned.clear();
  };
}
