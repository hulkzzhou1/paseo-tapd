import type { AgentToolContext } from "@getpaseo/plugin/server";
import type { TapdSettingsValues } from "../shared/contracts";
import { suppressTask, type AgentLinks } from "./agent-links";

export function createOwnershipLifecycle(getValues: () => Promise<TapdSettingsValues>, links: Pick<AgentLinks, "state" | "stateTransaction">) {
  async function knownAgents() {
    const [state, values] = await Promise.all([links.state(), getValues()]);
    return [...new Set([
      ...state.links.map(link => link.agentId), ...state.legacyArchive.map(link => link.agentId),
      ...values.links.map(link => link.agentId),
      ...state.offers.flatMap(offer => [offer.actorAgentId, offer.targetAgentId]),
      ...state.history.flatMap(event => [event.agentId, event.previousAgentId, event.actorAgentId]),
    ].filter((id): id is string => !!id && id !== "user" && !state.deletedAgents.includes(id)))];
  }
  async function deleted(agentId: string, removalEvent = false) {
    const pending = (await getValues()).links.some(link => link.agentId === agentId);
    await links.stateTransaction(async state => {
      if (state.deletedAgents.includes(agentId)) return { result: undefined };
      const owned = state.links.filter(link => link.agentId === agentId);
      const recorded = owned.length || pending || state.legacyArchive.some(link => link.agentId === agentId) || state.offers.some(offer => offer.actorAgentId === agentId || offer.targetAgentId === agentId) || state.history.some(event => event.agentId === agentId || event.previousAgentId === agentId || event.actorAgentId === agentId);
      // Created hooks can run before publication; only known relationships or an actual removal establish deletion.
      if (!removalEvent && !recorded) return { result: undefined };
      let next = state;
      for (const link of owned) if (link.responsibility) next = suppressTask(next, link, agentId);
      return { state: {
        ...next, deletedAgents: [...state.deletedAgents, agentId],
        links: state.links.filter(link => link.agentId !== agentId),
        legacyArchive: state.legacyArchive.filter(link => link.agentId !== agentId),
        offers: state.offers.filter(offer => offer.actorAgentId !== agentId && offer.targetAgentId !== agentId),
        // A completed transfer belongs to its surviving target; keep that target's audit trail.
        history: state.history.filter(event => event.agentId ? event.agentId !== agentId && (event.action !== "offer" || event.actorAgentId !== agentId) : event.previousAgentId !== agentId && event.actorAgentId !== agentId),
      }, result: undefined };
    });
  }
  return { knownAgents, deleted,
    async reconcile(context: Pick<AgentToolContext, "paseo">) {
      for (const agentId of await knownAgents()) {
        let result;
        try { result = await context.paseo.agents.ref(agentId).refresh(); }
        catch { continue; } // Permission/connection errors are never evidence of deletion.
        if (result === null) await deleted(agentId);
      }
    },
  };
}
