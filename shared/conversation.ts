import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { entityKindSchema, entityLabelsSchema } from "./contracts";

const endpoint = z.url().max(4096).refine(value => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
});
export const conversationEntitySchema = z.object({
  labels: entityLabelsSchema,
  siteUrl: endpoint,
  apiEndpoint: endpoint,
  workspaceId: z.string().min(1).max(100).regex(/^\d+$/),
  kind: entityKindSchema,
  id: z.string().min(1).max(100).regex(/^\d+$/),
  title: z.string().max(500).default(""),
  status: z.string().max(200).default(""),
  statusLabel: z.string().max(200).default(""),
  owner: z.string().max(200).default(""),
});
export const entityResultSchema = z.object({
  operation: z.enum(["read", "create", "comment", "status", "field"]),
  entity: conversationEntitySchema,
  warnings: z.array(z.string().max(300)).max(10).default([]),
});
export type ConversationEntity = z.infer<typeof conversationEntitySchema>;

export const conversationOwnerSchema = z.object({ agentId: z.string().min(1).max(200) });
export const conversationSummarySchema = z.object({
  agentId: z.string().min(1).max(200),
  workspaceId: z.string().nullable(),
  entities: z.array(conversationEntitySchema),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationListRpc = defineRpc({
  name: "tapd.conversations", input: z.object({}),
  output: z.object({ conversations: z.array(conversationSummarySchema) }),
});
export const conversationFocusRpc = defineRpc({
  name: "tapd.conversation.focus", input: conversationOwnerSchema.extend({ entity: conversationEntitySchema }),
  output: z.object({ ok: z.literal(true) }),
});
export const conversationRemoveRpc = defineRpc({
  name: "tapd.conversation.remove", input: conversationOwnerSchema.extend({ entity: conversationEntitySchema }),
  output: z.object({ ok: z.literal(true) }),
});
export function conversationEntityKey(entity: ConversationEntity): string {
  return JSON.stringify([entity.siteUrl, entity.apiEndpoint, entity.workspaceId, entity.kind, entity.id]);
}

export const batchEntitySchema = conversationEntitySchema.omit({ siteUrl: true, apiEndpoint: true });
export const batchResultSchema = z.object({
  batchId: z.string().min(1).max(200),
  operation: z.enum(["search", "board"]),
  siteUrl: endpoint, apiEndpoint: endpoint,
  items: z.array(batchEntitySchema).max(5),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().nullable(),
  partial: z.boolean(), truncated: z.boolean(), stale: z.boolean(),
  fetchedAt: z.string().max(100), cachedAt: z.string().max(100),
  warnings: z.array(z.string().max(300)).max(10),
});
export const conversationBatchPageRpc = defineRpc({
  name: "tapd.conversation.batch_page",
  input: conversationOwnerSchema.extend({ batchId: z.string().min(1).max(200), siteUrl: endpoint, apiEndpoint: endpoint, offset: z.number().int().nonnegative() }),
  output: z.object({ items: z.array(batchEntitySchema).max(5), nextOffset: z.number().int().nonnegative().nullable() }),
});

export const conversationRefreshRpc = defineRpc({
  name: "tapd.conversation.refresh", input: conversationOwnerSchema.extend({ entity: conversationEntitySchema }),
  output: z.object({ ok: z.literal(true) }),
});
