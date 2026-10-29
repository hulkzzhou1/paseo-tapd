import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { entityKindSchema } from "./contracts";

const id = z.string().min(1).max(100).regex(/^\d+$/);
export const iterationTargetSchema = z.object({ kind: entityKindSchema, id, workspaceId: id });
export const itemIterationRpc = defineRpc({
  name: "tapd.item_iteration", input: iterationTargetSchema,
  output: z.object({
    entity: iterationTargetSchema, returned: z.boolean(),
    value: z.union([z.string().max(100), z.number().int().nonnegative().safe(), z.null()]),
    state: z.enum(["not_returned", "unknown", "unset", "set"]),
  }),
});

export const projectIterationSchema = z.object({
  id: id.refine(value => !/^0+$/.test(value)), workspaceId: id, name: z.string().max(1000),
  status: z.string().max(200).nullable(), startDate: z.string().max(50).nullable(), endDate: z.string().max(50).nullable(),
});
export const iterationsRpc = defineRpc({
  name: "tapd.iterations",
  input: iterationTargetSchema.extend({ page: z.number().int().min(1).max(10_000).default(1) }),
  output: z.object({
    entity: iterationTargetSchema, iterations: z.array(projectIterationSchema).max(200),
    page: z.number().int().min(1).max(10_000), limit: z.literal(200),
    hasMore: z.boolean().nullable(), nextPage: z.number().int().min(1).max(10_000).nullable(),
    completeness: z.enum(["complete", "partial", "unknown"]), truncated: z.boolean(),
    failure: z.object({ code: z.string().max(100), phase: z.enum(["validation", "read", "write"]), writeState: z.enum(["not_sent", "rejected", "unknown"]), httpStatus: z.number().int().optional() }).nullable(),
  }),
});

export const updateIterationRpc = defineRpc({
  name: "tapd.update_iteration",
  input: iterationTargetSchema.extend({
    iterationId: id.refine(value => !/^0+$/.test(value)),
    expectedValue: z.union([z.string().max(100).regex(/^\d*$/), z.number().int().nonnegative().safe()]),
    confirmed: z.literal(true),
  }),
  output: z.object({
    ok: z.boolean(), outcome: z.enum(["unchanged", "verified", "unverified"]), writeState: z.enum(["not_sent", "accepted"]),
    iterationId: id, entity: iterationTargetSchema.extend({ title: z.string().max(500).default(""), status: z.string().max(200).default(""),
      statusLabel: z.string().max(200).default(""), owner: z.string().max(200).default("") }),
    warning: z.string().max(300).optional(),
  }),
});
