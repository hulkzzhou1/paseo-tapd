import {defineRpc} from "@getpaseo/plugin";
import {z} from "zod";
import {taskTargetSchema} from "./task-board";
import {toolLinkSchema} from "./agent-links";
export const migrationGroupSchema=taskTargetSchema.extend({revision:z.string(),candidates:z.array(toolLinkSchema)});
export type MigrationGroup=z.infer<typeof migrationGroupSchema>;
export const migrationListRpc=defineRpc({name:"tapd.task.migration",input:z.object({agentId:z.string().min(1).max(200)}),output:z.object({groups:z.array(migrationGroupSchema),warnings:z.array(z.string())})});
export const migrationConfirmRpc=defineRpc({name:"tapd.task.migration.confirm",input:taskTargetSchema.extend({agentId:z.string().min(1).max(200),expectedRevision:z.string().min(1).max(200),confirmed:z.literal(true)}),output:z.object({ok:z.literal(true),changed:z.boolean(),link:toolLinkSchema})});
