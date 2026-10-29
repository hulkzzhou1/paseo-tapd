import {defineRpc} from '@getpaseo/plugin';
import {z} from 'zod';

const scalar = z.union([z.string().max(50_000), z.number().finite(), z.boolean()]);
export const storyReadingFieldSchema = z.object({
  key: z.string().regex(/^custom_field_[a-zA-Z0-9_]+$/).max(100), label: z.string().max(500), htmlType: z.string().max(100),
  kind: z.enum(['text','number','boolean','enum','user','date','richtext','unknown']), readonly: z.boolean().nullable(),
  options: z.array(z.object({value:z.string().max(500),label:z.string().max(500)})).max(500),
  state: z.enum(['value','empty','unknown','not_returned','unrecognized','failed','unread']),
  value: z.union([scalar,z.array(scalar).max(1000)]).nullable(), display: z.string().max(50_000).nullable(), warning: z.string().max(500).nullable(),
});
export const storyFieldsRpc = defineRpc({
  name:'tapd.story-fields',
  input:z.object({workspaceId:z.string().regex(/^\d{1,100}$/),id:z.string().regex(/^\d{1,100}$/)}),
  output:z.object({workspaceId:z.string(),id:z.string(),workitemTypeId:z.string().nullable(),fields:z.array(storyReadingFieldSchema).max(200),readError:z.string().nullable()}),
});
export type StoryReadingField = z.infer<typeof storyReadingFieldSchema>;
export type StoryFieldsResult = z.infer<typeof storyFieldsRpc.output>;
