import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { conversationFocusRpc, type ConversationEntity } from "../../shared/conversation";
import type { DetailTarget } from "../workbench/EntityDetailContent";

export type OpenConversationEntity = (entity: ConversationEntity) => Promise<boolean>;

export function useEntityNavigation(agentId: string, openPanel?: OpenConversationEntity) {
  const focus = useRpc(conversationFocusRpc);
  const toast = useToast();
  const [target, setTarget] = useState<DetailTarget | null>(null);
  async function open(entity: ConversationEntity) {
    try {
      if (openPanel && await openPanel(entity)) return;
      // Agents without a workspace cannot open host panels; retain their full detail access.
      await focus({ agentId, entity });
      setTarget(entity);
    } catch { toast.error("单据引用暂不可用，请重试或重新查询。"); }
  }
  return { target, setTarget, open };
}
