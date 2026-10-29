import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { entityKindSchema } from "./contracts";

export const dispatchSchema = z.object({
  kind: entityKindSchema,
  id: z.string().regex(/^\d+$/).max(100),
  workspaceId: z.string().regex(/^\d+$/).max(100),
  repoPath: z.string().min(1).max(4096),
  provider: z.string().min(1).max(300),
  branchName: z.string().min(1).max(200),
  prompt: z.string().trim().min(1).max(50_000),
  confirmed: z.literal(true),
});
export const dispatchRpc = defineRpc({
  name: "tapd.dispatch_agent", input: dispatchSchema,
  output: z.object({
    ok: z.boolean(), phase: z.enum(["workspace", "agent", "prompt"]),
    workspaceId: z.string().optional(), agentId: z.string().optional(),
    promptSent: z.union([z.boolean(), z.literal("unknown")]), warning: z.string().optional(),
  }),
});
