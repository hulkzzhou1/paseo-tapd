import {useEffect} from "react";
import {invalidateBoard} from "./client/conversation/board-updates";
import { useAgent } from "@getpaseo/plugin/client";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { contributeConversationAccess } from "./client/conversation/ConversationAccess";
import { BatchResultCard } from "./client/conversation/BatchResultCard";
import { EntityResultCard } from "./client/conversation/EntityResultCard";
import { batchResultSchema, entityResultSchema } from "./shared/conversation";
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
  const conversation = contributeConversationAccess(client);
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
  client.addTimelineRenderer({ kind: "tapd-batch-result", version: 1, schema: batchResultSchema, Component: (props) => {
    const workspaceId = useAgent(props.agentId, agent => agent.workspaceId);
    return <BatchResultCard {...props} openPanel={entity => conversation.openEntity(props.agentId, workspaceId, entity)} />;
  } });
  client.addTimelineRenderer({ kind: "tapd-entity-result", version: 1, schema: entityResultSchema, Component: (props) => {
    const workspaceId = useAgent(props.agentId, agent => agent.workspaceId);
    const result=entityResultSchema.safeParse(props.item.data);
    const entity=result.success&&result.data.operation==="status"?result.data.entity:null;
    useEffect(()=>{if(entity)invalidateBoard(entity);},[entity?.workspaceId,entity?.kind,entity?.id,entity?.status]);
    return <EntityResultCard {...props} openPanel={entity => conversation.openEntity(props.agentId, workspaceId, entity)} />;
  } });
  return conversation.dispose;
}
