import { Text, View } from "react-native";
import type { WorkbenchTheme } from "./bits";

export function EntityLabels({ labels, theme, compact = true }: { labels?: readonly string[] | null; theme: WorkbenchTheme; compact?: boolean }) {
  const c = theme.colors;
  if (labels == null) return <Text accessibilityLabel="标签数据待确认" style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 16 }}>标签待确认</Text>;
  if (!labels.length) return null;
  const visible = compact ? labels.slice(0, 2) : labels;
  return <View accessibilityLabel={compact ? "单据标签摘要" : "单据全部标签"} style={{ flexDirection: "row", flexWrap: compact ? "nowrap" : "wrap", alignItems: "flex-start", gap: 5, minWidth: 0, maxWidth: "100%" }}>
    {visible.map((name, index) => <View key={`${index}-${name}`} style={{ flexShrink: 1, minWidth: 0, maxWidth: compact ? "42%" : "100%", borderRadius: 4, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface2, paddingHorizontal: 5 }}><Text accessibilityLabel={`标签：${name}`} numberOfLines={compact ? 1 : undefined} ellipsizeMode="tail" style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 16, flexShrink: 1 }}>{name}</Text></View>)}
    {compact && labels.length > visible.length && <Text accessibilityLabel={`另有 ${labels.length - visible.length} 个标签`} style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 18, flexShrink: 0 }}>+{labels.length - visible.length}</Text>}
  </View>;
}
