import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { tapdAttachmentSource } from "./shared/contracts";
import { WorkbenchScreen } from "./client/workbench/WorkbenchScreen";
import { TapdSettingsScreen } from "./client/workbench/SettingsForm";

function TapdSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ClipboardList"
      active={currentScreen?.screenId === "tapd-board"}
      onPress={() => openScreen({ screenId: "tapd-board" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "tapd-board", title: "TAPD 工作台", Component: WorkbenchScreen });
  client.addSettingsScreen({
    id: "tapd-settings-page",
    title: "TAPD 工作台",
    icon: "ClipboardList",
    Component: TapdSettingsScreen,
  });
  client.addSidebarHeaderItem({ id: "tapd-board", title: "TAPD 工作台", Component: TapdSidebarItem });
  client.addCommandCenterItem({
    id: "tapd-open-board",
    title: "打开 TAPD 工作台",
    icon: "ClipboardList",
    keywords: ["tapd", "需求", "任务", "缺陷", "工作台"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "tapd-board" });
    },
  });
  client.addCommandCenterItem({
    id: "tapd-open-settings",
    title: "TAPD 工作台设置",
    icon: "Settings",
    keywords: ["tapd", "设置"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("tapd-settings-page");
    },
  });
  client.addAttachmentSource(tapdAttachmentSource);
  // Hide retired TAPD result cards without rewriting conversation history.
  client.addTimelineTransformer({
    id: "hide-retired-results",
    query: { itemType: "plugin" },
    transform({ item }) {
      if (item.pluginId === "tapd-workbench" && ["tapd-entity-result", "tapd-batch-result"].includes(item.kind)) return { items: [] };
    },
  });
}
