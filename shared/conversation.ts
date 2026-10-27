import { z } from "zod";
import { entityKindSchema } from "./contracts";

const endpoint = z.url().max(4096).refine(value => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
});
export const conversationEntitySchema = z.object({
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
  operation: z.literal("read"),
  entity: conversationEntitySchema,
  warnings: z.array(z.string().max(300)).max(10).default([]),
});
export type ConversationEntity = z.infer<typeof conversationEntitySchema>;
