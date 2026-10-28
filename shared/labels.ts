import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { entityKindSchema } from "./contracts";

const id = z.string().min(1).max(100).regex(/^\d+$/);
export const labelNameSchema = z.string().min(1).max(200).regex(/^[^|\u0000-\u001f\u007f]+$/)
  .refine(value => value.trim().length > 0, "Label names cannot be blank");
export const projectLabelSchema = z.object({ id, name: labelNameSchema, color: z.string().max(20).nullable() });
export const labelsRpc = defineRpc({
  name: "tapd.labels",
  input: z.object({ workspaceId: id, page: z.number().int().min(1).max(10_000).default(1), limit: z.number().int().min(1).max(200).default(30), name: labelNameSchema.optional() }),
  output: z.object({ workspaceId: id, labels: z.array(projectLabelSchema).max(200), page: z.number().int(), limit: z.number().int(), truncated: z.boolean(), nextPage: z.number().int().nullable() }),
});
export const itemLabelTargetSchema = z.object({ kind: entityKindSchema, id, workspaceId: id });
export const itemLabelsRpc = defineRpc({
  name: "tapd.item_labels", input: itemLabelTargetSchema,
  output: z.object({
    returned: z.boolean(), value: z.string().max(20_100).nullable(), labels: z.array(labelNameSchema).max(100).nullable(),
    entity: itemLabelTargetSchema.extend({ title: z.string().max(500), status: z.string().max(200), statusLabel: z.string().max(200), owner: z.string().max(200) }),
  }),
});
export const createLabelRpc = defineRpc({
  name: "tapd.create_label",
  input: z.object({ workspaceId: id, name: labelNameSchema, color: z.number().int().min(1).max(4).optional(), confirmed: z.literal(true) }),
  output: z.object({
    ok: z.boolean(), workspaceId: id, name: labelNameSchema, label: projectLabelSchema.nullable(),
    outcome: z.enum(["unchanged", "verified", "unverified"]), writeState: z.enum(["not_sent", "accepted"]),
  }),
});
