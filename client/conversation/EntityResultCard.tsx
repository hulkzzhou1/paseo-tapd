import { type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import { entityResultSchema } from "../../shared/conversation";
import { EntityDetailExperience } from "../workbench/EntityDetailExperience";
import { useEntityNavigation, type OpenConversationEntity } from "./useEntityNavigation";
import { EntitySummary } from "./EntitySummary";

const kindLabels = { story: "需求", task: "任务", bug: "缺陷" };
export function EntityResultCard({ item, theme, agentId, openPanel }: PluginTimelineItemProps<z.infer<typeof entityResultSchema>> & { openPanel?: OpenConversationEntity }) {
  const { entity, warnings, operation } = item.data;
  const caption = { read: "查询时的摘要", create: "单据已创建 · 创建时的摘要", comment: "评论已发表 · 操作时的摘要", status: "状态已修改 · 操作时的摘要", field: "字段值已回读核实 · 操作时的摘要" }[operation];
  const { target, setTarget, open } = useEntityNavigation(agentId, openPanel);
  const button = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  const colors = theme.colors;
  return <View style={{ gap: 6, maxWidth: 760 }}>
    <Pressable ref={button} accessibilityRole="button" accessibilityLabel={`打开 TAPD ${kindLabels[entity.kind]} #${entity.id}：${entity.title}`}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={() => { void open(entity); }}
      style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 8, gap: 6, backgroundColor: pressed ? colors.surface2 : colors.surface1, borderWidth: 1, borderColor: focused ? colors.accent : colors.border, borderRadius: 12 })}>
      <EntitySummary entity={entity} theme={theme} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderColor: colors.border, paddingTop: 6 }}>
        <Text style={{ color: operation === "read" ? colors.foregroundMuted : colors.statusSuccess, fontSize: 12, fontWeight: "600" }}>{operation === "read" ? "TAPD 单据" : "✓ 操作成功"}</Text>
        <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "600" }}>查看详情 →</Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{caption} · 打开查看最新详情</Text>
    </Pressable>
    {warnings.map((warning, index) => <Text key={index} accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 12 }}>{warning}</Text>)}
    <EntityDetailExperience target={target} onTargetChange={setTarget} onDismiss={() => button.current?.focus()} theme={theme} />
  </View>;
}
