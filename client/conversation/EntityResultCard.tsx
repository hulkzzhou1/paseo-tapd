import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import { conversationFocusRpc, entityResultSchema } from "../../shared/conversation";
import { EntityDetailExperience } from "../workbench/EntityDetailExperience";
import type { DetailTarget } from "../workbench/EntityDetailModal";
import { kindColor, statusTone, toneColor } from "../workbench/status-tones";

const kindLabels = { story: "需求", task: "任务", bug: "缺陷" };
export function EntityResultCard({ item, theme, agentId }: PluginTimelineItemProps<z.infer<typeof entityResultSchema>>) {
  const { entity, warnings, operation } = item.data;
  const caption = { read: "查询时的摘要", create: "单据已创建 · 创建时的摘要", comment: "评论已发表 · 操作时的摘要", status: "状态已修改 · 操作时的摘要" }[operation];
  const focus = useRpc(conversationFocusRpc);
  const [target, setTarget] = useState<DetailTarget | null>(null);
  const button = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  const colors = theme.colors;
  const status = toneColor(statusTone(entity.kind, entity.status, entity.statusLabel), theme);
  return <View style={{ gap: 6, maxWidth: 760 }}>
    <Pressable ref={button} accessibilityRole="button" accessibilityLabel={`打开 TAPD ${kindLabels[entity.kind]} #${entity.id}：${entity.title}`}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={() => { setTarget(entity); void focus({ agentId, entity }).catch(() => {}); }}
      style={{ padding: 14, gap: 8, backgroundColor: colors.surface1, borderWidth: 1, borderColor: focused ? colors.accent : colors.border, borderRadius: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Text style={{ color: kindColor(entity.kind, theme), fontWeight: "600" }}>{kindLabels[entity.kind]}</Text>
        <Text style={{ color: colors.foregroundMuted }}>#{entity.id}</Text>
        <Text style={{ color: status }}>{entity.statusLabel || entity.status}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 15, lineHeight: 22, fontWeight: "600" }}>{entity.title || `#${entity.id}`}</Text>
      {entity.owner ? <Text style={{ color: colors.foregroundMuted }}>{entity.owner}</Text> : null}
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{caption} · 打开查看最新详情</Text>
    </Pressable>
    {warnings.map((warning, index) => <Text key={index} accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 12 }}>{warning}</Text>)}
    <EntityDetailExperience target={target} onTargetChange={setTarget} onDismiss={() => button.current?.focus()} theme={theme} />
  </View>;
}
