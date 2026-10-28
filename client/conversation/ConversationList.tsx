import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { conversationEntityKey, type ConversationEntity } from "../../shared/conversation";
import type { WorkbenchTheme } from "../workbench/bits";
import { kindColor, statusTone, toneColor } from "../workbench/status-tones";

import { CardGrid } from "./CardGrid";

const labels = { story: "需求", task: "任务", bug: "缺陷" };
export function ConversationList({ entities, theme, pending, loading, failed, onRefresh, onOpen, onRemove }: {
  entities: readonly ConversationEntity[];
  theme: WorkbenchTheme;
  pending: boolean;
  loading: boolean;
  failed: number;
  onRefresh: () => void;
  onOpen: (entity: ConversationEntity) => void;
  onRemove: (entity: ConversationEntity) => void;
}) {
  const c = theme.colors;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ConversationEntity["kind"]>("all");
  const [focused, setFocused] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const visible = entities.filter(e => (kind === "all" || e.kind === kind) && `${e.title} ${e.id} ${e.owner} ${e.statusLabel}`.toLocaleLowerCase().includes(needle));
  const unread = entities.filter(e => !e.title).length;
  return <View style={{ flex: 1, backgroundColor: c.surface0 }}>
    <View style={{ padding: 16, gap: 14, borderBottomWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}><Icon name="ClipboardList" size={20} color={c.accent} /></View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: 18, fontWeight: "600" }}>本次会话的 TAPD 单据</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>共 {entities.length} 张 · 最近涉及优先{unread ? ` · ${unread} 张待补全` : ""}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: failed ? c.statusWarning : c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{loading ? "正在读取单据摘要…" : failed ? `${failed} 张单据读取失败，可刷新重试` : "摘要供快速定位，详情显示最新内容"}</Text>
        <Pressable accessibilityRole="button" disabled={loading || !entities.length} onPress={onRefresh} style={{ minHeight: 36, paddingHorizontal: 10, justifyContent: "center", opacity: loading ? 0.5 : 1 }}><Text style={{ color: c.accent, fontSize: 12 }}>刷新摘要</Text></Pressable>
      </View>
      <TextInput accessibilityLabel="搜索会话单据" placeholder="搜索标题、编号、处理人或状态" placeholderTextColor={c.foregroundMuted} value={query} onChangeText={setQuery}
        style={{ color: c.foreground, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 42, fontSize: 13 }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["all", "story", "task", "bug"] as const).map(value => {
          const count = value === "all" ? entities.length : entities.filter(e => e.kind === value).length;
          return <Pressable key={value} accessibilityRole="button" accessibilityLabel={`筛选${value === "all" ? "全部" : labels[value]}`} accessibilityState={{ selected: kind === value }} onPress={() => setKind(value)}
            style={({ pressed }) => ({ paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderWidth: 1, borderColor: kind === value ? c.accent : c.border, borderRadius: 8, backgroundColor: pressed || kind === value ? c.surface2 : c.surface0 })}>
            <Text style={{ fontSize: 12, fontWeight: kind === value ? "600" : "400", color: kind === value ? c.foreground : c.foregroundMuted }}>{value === "all" ? "全部" : labels[value]}  {count}</Text>
          </Pressable>;
        })}
      </View>
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 6 }} keyboardShouldPersistTaps="handled">
      <CardGrid>{visible.map(entity => {
        const key = conversationEntityKey(entity);
        const tone = toneColor(statusTone(entity.kind, entity.status, entity.statusLabel), theme);
        const known = !!entity.title;
        return <View key={key} style={{ borderWidth: 1, borderColor: focused === key ? c.accent : c.border, borderRadius: 8, backgroundColor: c.surface1, overflow: "hidden" }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`打开 TAPD ${labels[entity.kind]} #${entity.id}：${entity.title}`} onFocus={() => setFocused(key)} onBlur={() => setFocused("")} onPress={() => onOpen(entity)}
            style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, gap: 3, backgroundColor: pressed ? c.surface2 : c.surface1 })}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Icon name={entity.kind === "bug" ? "Bug" : entity.kind === "task" ? "ListTodo" : "FileText"} size={14} color={kindColor(entity.kind, theme)} /><Text style={{ fontSize: 12, fontWeight: "600", color: kindColor(entity.kind, theme) }}>{labels[entity.kind]}</Text></View>
              <Text style={{ color: c.foregroundMuted, fontSize: 11, flexShrink: 1 }}>#{entity.id}</Text>
              {!!entity.status && <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }} /><Text style={{ fontSize: 12, color: tone }}>{entity.statusLabel || entity.status}</Text></View>}
            </View>
            <Text numberOfLines={2} style={{ color: known ? c.foreground : c.foregroundMuted, fontSize: 13, fontWeight: known ? "600" : "400", lineHeight: 18 }}>{known ? entity.title : "已从对话收录，标题与状态尚未读取"}</Text>
          </Pressable>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", borderTopWidth: 1, borderColor: c.border, paddingLeft: 10, gap: 4 }}>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 70, fontSize: 12, color: c.foregroundMuted }}>{entity.owner ? `处理人 · ${entity.owner.replace(/;+$/, "")}` : known ? "处理人未提供" : "点击读取完整单据"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`从会话移除 #${entity.id}`} disabled={pending} onPress={() => onRemove(entity)} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 10, justifyContent: "center", backgroundColor: pressed ? c.surface2 : c.surface1, opacity: pending ? 0.5 : 1 })}><Text style={{ fontSize: 12, color: c.foregroundMuted }}>移除</Text></Pressable>
          </View>
        </View>;
      })}</CardGrid>
      {!visible.length && <View style={{ padding: 24, gap: 10, alignItems: "center" }}><Icon name="Search" size={28} color={c.foregroundMuted} /><Text style={{ color: c.foreground, fontSize: 15 }}>{entities.length ? "没有匹配的单据" : "当前会话没有 TAPD 单据。"}</Text><Text style={{ color: c.foregroundMuted, lineHeight: 20, textAlign: "center", fontSize: 13 }}>{entities.length ? "试试其他关键词或切换单据类型。" : "对话中涉及的 TAPD 单据会出现在这里，点击即可继续处理。"}</Text></View>}
    </ScrollView>
  </View>;
}
