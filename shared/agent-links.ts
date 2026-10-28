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
