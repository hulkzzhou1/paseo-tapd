import { EntityLabels } from "../workbench/EntityLabels";
import { Text, View } from "react-native";
import type { ConversationEntity } from "../../shared/conversation";
import type { WorkbenchTheme } from "../workbench/bits";
import { kindColor, statusTone, toneColor } from "../workbench/status-tones";

const labels = { story: "需求", task: "任务", bug: "缺陷" };

/** Shared reading hierarchy for timeline cards and the conversation list. */
export function EntitySummary({ entity, theme }: {
  entity: Pick<ConversationEntity, "kind" | "id" | "title" | "status" | "statusLabel" | "owner" | "labels">;
  theme: WorkbenchTheme;
}) {
  const colors = theme.colors;
  const status = toneColor(statusTone(entity.kind, entity.status, entity.statusLabel), theme);
  return <View style={{ gap: 3, borderLeftWidth: 2, borderLeftColor: status, paddingLeft: 8, minWidth: 0 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <Text style={{ color: kindColor(entity.kind, theme), fontSize: 12, lineHeight: 18, fontWeight: "600" }}>{labels[entity.kind]}</Text>
      <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>#{entity.id}</Text>
    </View>
    <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{entity.title || `#${entity.id}`}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: status, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 0, backgroundColor: colors.surface0 }}>
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: status }} />
        <Text style={{ color: status, fontSize: 12, lineHeight: 18, fontWeight: "600" }}>{entity.statusLabel || entity.status || "状态待读取"}</Text>
      </View>
      {entity.owner ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, flexShrink: 1 }}>处理人 · {entity.owner.replace(/;+$/, "")}</Text> : null}
    </View>
    {entity.labels !== undefined && <EntityLabels labels={entity.labels} theme={theme} />}
  </View>;
}
