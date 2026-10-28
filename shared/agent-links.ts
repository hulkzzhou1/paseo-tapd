import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { tapdSettingsSchema } from "./contracts";

export const toolLinkSchema = tapdSettingsSchema.shape.links.unwrap().element.extend({
  tapdWorkspaceId: z.string().regex(/^\d+$/),
  apiEndpoint: z.string().url(),
  siteUrl: z.string().url().optional(),
  responsibility: z.object({ confirmedAt: z.string(), actorAgentId: z.string().max(200), revision: z.string().min(1).max(200) }).optional(),
});
export type ToolLink = z.infer<typeof toolLinkSchema>;
export const agentLinksRpc = defineRpc({ name: "tapd.agent-links", input: z.object({}), output: z.object({ links: z.array(toolLinkSchema) }) });
export const removeAgentLinkRpc = defineRpc({ name: "tapd.remove-agent-link", input: toolLinkSchema, output: z.object({ ok: z.literal(true) }) });

export const ownershipScopeSchema = toolLinkSchema.pick({ apiEndpoint: true, siteUrl: true, tapdWorkspaceId: true, kind: true, id: true });
export const ownershipEventSchema = ownershipScopeSchema.extend({
  id: z.string(), action: z.enum(["claim", "assign", "dispatch", "offer", "transfer", "release", "migration"]),
  actorAgentId: z.string().max(200), at: z.string(), reason: z.string().max(500),
  previousAgentId: z.string().optional(), agentId: z.string().optional(), revision: z.string().optional(),
});
export const ownershipOfferSchema = ownershipScopeSchema.extend({
  id: z.string(), actorAgentId: z.string().max(200), targetAgentId: z.string().max(200),
  expectedOwnerAgentId: z.string().optional(), expectedRevision: z.string().optional(),
  reason: z.string().max(500), createdAt: z.string(), acceptedRevision: z.string().optional(),
});
