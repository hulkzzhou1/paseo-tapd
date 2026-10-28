import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { entityKindSchema } from "./contracts";
import { conversationEntitySchema } from "./conversation";
import { toolLinkSchema } from "./agent-links";

export const taskTargetSchema = z.object({ kind: entityKindSchema, id: z.string().regex(/^\d+$/).max(100), workspaceId: z.string().regex(/^\d+$/).max(100) });
export const taskClaimSchema = taskTargetSchema.extend({ agentId: z.string().min(1).max(200).optional(), confirmed: z.literal(true) });
export const taskBoardItemSchema = z.object({
  entity: conversationEntitySchema, link: toolLinkSchema,
  classification: z.enum(["unfinished", "completed", "unknown"]),
  fetchedAt: z.string(), warning: z.string().default(""),
});
export const taskBoardSchema = z.object({ agentId: z.string(), workspaceId: z.string().nullable(), items: z.array(taskBoardItemSchema), fetchedAt: z.string(), partial: z.boolean() });
export type TaskBoard = z.infer<typeof taskBoardSchema>;
export type TaskBoardItem = z.infer<typeof taskBoardItemSchema>;
export const taskBoardRpc = defineRpc({ name: "tapd.task-board", input: z.object({ agentId: z.string().min(1).max(200) }), output: taskBoardSchema });
export const taskClaimRpc = defineRpc({ name: "tapd.task.claim", input: taskClaimSchema.required({ agentId: true }), output: z.object({ ok: z.literal(true), changed: z.boolean(), link: toolLinkSchema }) });
export const taskDispatchSchema = taskTargetSchema.extend({ repoPath: z.string().min(1).max(4096), provider: z.string().min(1).max(300), branchName: z.string().min(1).max(200), prompt: z.string().trim().min(1).max(50_000), confirmed: z.literal(true) });
export const taskDispatchRpc = defineRpc({ name: "tapd.task.dispatch", input: taskDispatchSchema, output: z.object({ ok: z.boolean(), partial: z.boolean().optional(), phase: z.string().optional(), workspaceId: z.string().optional(), agentId: z.string().optional(), bound: z.boolean(), promptSent: z.union([z.boolean(), z.literal("unknown")]), warning: z.string().optional(), link: toolLinkSchema.optional() }) });
