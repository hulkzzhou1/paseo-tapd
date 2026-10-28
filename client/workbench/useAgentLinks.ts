import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { agentLinksRpc, type ToolLink } from "../../shared/agent-links";
import type { TapdLink } from "../../shared/contracts";

const EMPTY: readonly ToolLink[] = [];
export function useAgentLinks(_legacy: readonly TapdLink[], enabled = true) {
  const rpc = useRpc(agentLinksRpc);
  const query = useQuery({ queryKey: ["tapd-agent-links"], enabled, queryFn: () => rpc({}), refetchInterval: 2000 });
  return query.data?.links ?? EMPTY;
}
