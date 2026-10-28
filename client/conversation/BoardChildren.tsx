import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { childrenRpc } from "../../shared/contracts";
import type { ConversationEntity } from "../../shared/conversation";
import type { WorkbenchTheme } from "../workbench/bits";

export function BoardChildren({ entity, theme, onOpen, refreshToken }: { entity: ConversationEntity; refreshToken?: string; theme: WorkbenchTheme; onOpen: (entity: ConversationEntity) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(5);
  const rpc = useRpc(childrenRpc);
  const query = useQuery({ queryKey: ["tapd-children", entity.apiEndpoint, entity.workspaceId, entity.id, refreshToken], queryFn: () => rpc({ workspaceId: entity.workspaceId, id: entity.id }), enabled: expanded, staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const c = theme.colors;
  return <View style={{ paddingHorizontal: 10, paddingBottom: 6, gap: 5 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`展开需求 #${entity.id} 的子单据`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ minHeight: 32, justifyContent: "center" }}><Text style={{ color: c.accent, fontSize: 12 }}>{expanded ? "收起子单据" : "查看子单据"}</Text></Pressable>
    {expanded && <>
      {query.isPending ? <Text style={{ color: c.foregroundMuted }}>正在读取子单据…</Text> : query.isError ? <Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text style={{ color: c.statusWarning }}>子单据读取失败，点击重试；数量未知</Text></Pressable> : (["story", "task", "bug"] as const).map(kind => {
        const items = query.data?.items.filter(item => item.kind === kind) ?? [], meta = query.data?.reads[kind];
        return <View key={kind} style={{ gap: 4 }}><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{kind === "story" ? "子需求" : kind === "task" ? "子任务" : "相关缺陷"} · {items.length} 条已读取 / 共 {meta?.total ?? "未知"} 条{meta?.truncated ? " · 已截断" : ""}</Text>
          {!!meta?.error && <Text style={{ color: c.statusWarning, fontSize: 11 }}>{meta.error}</Text>}
          {items.slice(0, limit).map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`打开子单据 #${item.id}`} onPress={() => onOpen({ ...entity, ...item })} style={{ minHeight: 40, padding: 6, gap: 3, borderBottomWidth: 1, borderColor: c.border }}><Text numberOfLines={2} style={{ color: c.foreground, fontSize: 12 }}>#{item.id} {item.title}</Text><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{item.statusLabel || item.status || "状态待确认"} · {item.responsibleAgent ? `负责 Agent · ${item.responsibleAgent.title || item.responsibleAgent.id}` : item.ownershipUnknown ? "Agent 归属待确认" : "未关联 Agent"}</Text></Pressable>)}
          {items.length > limit && <Pressable accessibilityRole="button" onPress={() => setLimit(value => value + 10)}><Text style={{ color: c.accent }}>展开更多已读取子单据</Text></Pressable>}
        </View>;
      })}
    </>}
  </View>;
}
