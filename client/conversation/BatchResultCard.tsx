import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import { batchResultSchema, conversationBatchPageRpc } from "../../shared/conversation";
import { EntityDetailExperience } from "../workbench/EntityDetailExperience";
import { useEntityNavigation, type OpenConversationEntity } from "./useEntityNavigation";
import { EntitySummary } from "./EntitySummary";

const kindLabels = { story: "需求", task: "任务", bug: "缺陷" };
export function BatchResultCard({ item, theme, agentId, openPanel }: PluginTimelineItemProps<z.infer<typeof batchResultSchema>> & { openPanel?: OpenConversationEntity }) {
  const data = item.data;
  const loadPage = useRpc(conversationBatchPageRpc);
  const [items, setItems] = useState(data.items);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const { target, setTarget, open } = useEntityNavigation(agentId, openPanel);
  const opener = useRef<View | null>(null);
  const buttons = useRef(new Map<number, View>());
  const busy = useRef(false);
  const colors = theme.colors;
  async function expand() {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(false);
    try {
      const page = await loadPage({ agentId, batchId: data.batchId, siteUrl: data.siteUrl, apiEndpoint: data.apiEndpoint, offset: items.length });
      if (!page.items.length && items.length < data.returned) throw new Error();
      setItems(previous => [...previous, ...page.items]);
    } catch { setError(true); }
    finally { busy.current = false; setLoading(false); }
  }
  return <View style={{ gap: 6, maxWidth: 760, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1 }}>
    <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>TAPD {data.operation === "board" ? "看板" : "搜索"}结果</Text>
    <Text style={{ color: colors.foregroundMuted }}>已返回 {data.returned} 条{data.total === null ? " · 总数未知" : ` · 查询总数 ${data.total}`}</Text>
    <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>查询时的摘要 · 点击单据加入会话并查看最新详情</Text>
    {data.stale ? <Text style={{ color: colors.statusWarning }}>缓存结果{data.cachedAt ? ` · ${data.cachedAt}` : ""}</Text> : null}
    {data.partial ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>部分数据读取失败，结果不完整。</Text> : null}
    {data.truncated ? <Text style={{ color: colors.statusWarning }}>结果已截断，未包含全部匹配单据。</Text> : null}
    {!data.returned ? <Text style={{ color: colors.foregroundMuted }}>{data.partial ? "未取得单据，请重新查询。" : "没有匹配的单据。"}</Text> : null}
    {data.warnings.map((warning, index) => <Text key={index} style={{ color: colors.statusWarning, fontSize: 12 }}>{warning}</Text>)}
    {items.map((row, index) => <Pressable key={`${row.workspaceId}:${row.kind}:${row.id}:${index}`} accessibilityRole="button" accessibilityLabel={`打开 TAPD ${kindLabels[row.kind]} #${row.id}：${row.title}`}
      onFocus={() => setFocusedIndex(index)} onBlur={() => setFocusedIndex(null)}
      ref={button => { if (button) buttons.current.set(index, button); else buttons.current.delete(index); }}
      onPress={() => {
        opener.current = buttons.current.get(index) ?? null;
        const entity = { siteUrl: data.siteUrl, apiEndpoint: data.apiEndpoint, ...row };
        void open(entity);
      }} style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, gap: 5, borderRadius: 10, backgroundColor: pressed ? colors.surface2 : colors.surface0, borderWidth: 1, borderColor: focusedIndex === index ? colors.accent : colors.border })}>
      <EntitySummary entity={row} theme={theme} />
    </Pressable>)}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>其余结果暂时无法加载，请重试。</Text> : null}
    {items.length < data.returned ? <Pressable accessibilityRole="button" accessibilityLabel={error ? "重试加载其余单据" : `展开更多已返回单据（${items.length}/${data.returned}）`} disabled={loading} onPress={() => { void expand(); }} style={{ paddingVertical: 8 }}>
      <Text style={{ color: colors.accent }}>{loading ? "加载中…" : error ? "重试加载其余单据" : `展开更多已返回单据（${items.length}/${data.returned}）`}</Text>
    </Pressable> : null}
    <EntityDetailExperience target={target} onTargetChange={setTarget} onDismiss={() => opener.current?.focus()} theme={theme} />
  </View>;
}
