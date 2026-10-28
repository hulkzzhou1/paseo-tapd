import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { conversationEntityKey, type ConversationEntity } from "../../shared/conversation";
import type { TaskBoard } from "../../shared/task-board";
import { kindColor, statusTone, toneColor } from "../workbench/status-tones";
import type { WorkbenchTheme } from "../workbench/bits";
import { BoardChildren } from "./BoardChildren";
import { CardGrid } from "./CardGrid";

const kinds = { story: "需求", task: "任务", bug: "缺陷" };
const classifications = { unfinished: "未完成", completed: "已完成", unknown: "状态待确认" };
export function TaskBoardList({ board, theme, loading, failed, recentCount, onRecent, onRefresh, onOpen }: {
  board: TaskBoard | null; theme: WorkbenchTheme; loading: boolean; failed: boolean; recentCount: number;
  onRecent: () => void; onRefresh: () => void; onOpen: (entity: ConversationEntity) => void;
}) {
  const c = theme.colors;
  const [selected, setSelected] = useState<keyof typeof classifications>("unfinished");
  const [focused, setFocused] = useState("");
  const items = board?.items ?? [];
  const visible = items.filter(item => item.classification === selected);
  return <View style={{ flex: 1, backgroundColor: c.surface0 }}>
    <View style={{ padding: 12, gap: 8, borderBottomWidth: 1, borderColor: c.border }}>
      <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: 16, fontWeight: "600" }}>当前 Agent 的 TAPD 任务</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: failed ? c.statusWarning : c.foregroundMuted, fontSize: 12 }}>{loading ? "正在读取任务…" : failed ? "读取失败，已保留上次任务；请刷新重试" : board?.partial ? "部分状态待确认，未计入完成数量" : "状态来自 TAPD 工作流"}</Text>
        <Pressable accessibilityRole="button" disabled={loading} onPress={onRefresh} style={{ minHeight: 36, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ color: c.accent, fontSize: 12 }}>刷新任务</Text></Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(classifications) as (keyof typeof classifications)[]).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: selected === value }} onPress={() => setSelected(value)} style={{ minHeight: 36, paddingHorizontal: 10, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: selected === value ? c.accent : c.border, backgroundColor: selected === value ? c.surface2 : c.surface0 }}><Text style={{ color: selected === value ? c.foreground : c.foregroundMuted, fontSize: 12 }}>{classifications[value]}（{items.filter(item => item.classification === value).length}）</Text></Pressable>)}
        <Pressable accessibilityRole="button" onPress={onRecent} style={{ minHeight: 36, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>最近查看（{recentCount}）</Text></Pressable>
      </View>
    </View>
    <ScrollView contentContainerStyle={{ padding: 12 }}>
      <CardGrid>{visible.map(item => {
        const entity = item.entity;
        const key = conversationEntityKey(entity);
        return <View key={key}><Pressable accessibilityRole="button" accessibilityLabel={`打开任务 #${entity.id}：${entity.title}`} onFocus={() => setFocused(key)} onBlur={() => setFocused("")} onPress={() => onOpen(entity)} style={({ pressed }) => ({ borderWidth: 1, borderColor: focused === key ? c.accent : c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, gap: 3, backgroundColor: pressed ? c.surface2 : c.surface1 })}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}><Text style={{ color: kindColor(entity.kind, theme), fontSize: 11 }}>{kinds[entity.kind]}</Text><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>#{entity.id}</Text><Text style={{ color: toneColor(statusTone(entity.kind, entity.status, entity.statusLabel), theme), fontSize: 11 }}>{entity.statusLabel || entity.status || "状态待确认"}</Text></View>
          <Text numberOfLines={2} style={{ color: c.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{entity.title || "单据摘要暂不可用"}</Text>
          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>负责 Agent · {item.link.agentTitle || item.link.agentId}</Text>
          {!!item.warning && <Text style={{ color: c.statusWarning, fontSize: 11, lineHeight: 16 }}>{item.warning}</Text>}
        </Pressable>{entity.kind === "story" && <BoardChildren entity={entity} theme={theme} onOpen={onOpen} />}</View>;
      })}</CardGrid>
      {!visible.length && <View style={{ padding: 24, gap: 8, alignItems: "center" }}><Text style={{ color: c.foreground, fontSize: 14 }}>当前分类没有任务</Text><Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>明确接手单据后才会进入任务看板；历史绑定需要确认归属。</Text></View>}
    </ScrollView>
  </View>;
}
