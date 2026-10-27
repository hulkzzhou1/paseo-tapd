import { useMemo } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { agentLinksRpc } from "../../shared/agent-links";
import type { TapdLink } from "../../shared/contracts";

export function useAgentLinks(legacy: readonly TapdLink[], enabled = true) {
  const rpc = useRpc(agentLinksRpc);
  const query = useQuery({ queryKey: ["tapd-agent-links"], enabled, queryFn: () => rpc({}), refetchInterval: 2000 });
  return useMemo(() => {
    const remote = query.data?.links ?? [];
    return [...legacy.filter(link => !remote.some(item => item.key === link.key && item.agentId === link.agentId)), ...remote];
  }, [legacy, query.data]);
}
