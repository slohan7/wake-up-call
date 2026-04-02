import { z } from 'zod';

export const PersonSchema = z.object({
  id: z.number().optional(),
  email: z.string().email(),
  name: z.string(),
  company: z.string().nullable().optional(),
  importance: z.number().min(1).max(10).default(5),
  last_contact: z.date().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const MeetingSchema = z.object({
  id: z.number().optional(),
  calendar_id: z.string(),
  title: z.string(),
  start_time: z.date(),
  end_time: z.date(),
  attendees: z.array(z.string()),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  prep_notes: z.string().nullable().optional(),
  importance_score: z.number().min(1).max(10).default(5),
  created_at: z.date().optional(),
});

export const TaskSchema = z.object({
  id: z.number().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  due_date: z.date().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  category: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const FollowUpSchema = z.object({
  id: z.number().optional(),
  person_id: z.number(),
  subject: z.string(),
  context: z.string().nullable().optional(),
  due_date: z.date(),
  status: z.enum(['pending', 'sent', 'completed', 'skipped']),
  priority: z.number().min(1).max(10).default(5),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const BriefSchema = z.object({
  id: z.number().optional(),
  date: z.date(),
  full_content: z.string(),
  sms_content: z.string(),
  voice_content: z.string(),
  priority_score: z.number(),
  is_high_priority: z.boolean(),
  created_at: z.date().optional(),
});

export const DeliveryLogSchema = z.object({
  id: z.number().optional(),
  brief_id: z.number(),
  delivery_type: z.enum(['sms', 'voice', 'email', 'webhook']),
  status: z.enum(['pending', 'sent', 'failed', 'retrying']),
  recipient: z.string(),
  error_message: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
  delivered_at: z.date().nullable().optional(),
  created_at: z.date().optional(),
});

export const CalendarEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  start: z.date(),
  end: z.date(),
  attendees: z.array(z.object({
    email: z.string(),
    displayName: z.string().optional(),
    responseStatus: z.string().optional(),
  })).optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  hangoutLink: z.string().optional(),
});

export const AccessibleCalendarSchema = z.object({
  id: z.string(),
  summary: z.string(),
  summaryOverride: z.string().nullable().optional(),
  primary: z.boolean().default(false),
  selected: z.boolean().default(false),
  hidden: z.boolean().default(false),
  accessRole: z.string().default('reader'),
});

export const EmailThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  snippet: z.string(),
  date: z.date(),
  isImportant: z.boolean(),
  isUnread: z.boolean(),
  labels: z.array(z.string()),
  body: z.string().optional(),
});

export const BriefContextSchema = z.object({
  date: z.date(),
  timezone: z.string(),
  meetings: z.array(MeetingSchema),
  tasks: z.array(TaskSchema),
  followUps: z.array(FollowUpSchema.extend({
    person: PersonSchema.optional(),
  })),
  emails: z.array(EmailThreadSchema),
  previousBrief: BriefSchema.nullable().optional(),
});

export const GeneratedBriefSchema = z.object({
  fullBrief: z.string(),
  smsBrief: z.string(),
  voiceBrief: z.string(),
  priorityScore: z.number(),
  isHighPriority: z.boolean(),
  topPriorities: z.array(z.string()).max(3),
});

export const RunChannelStatusSchema = z.enum([
  'sent',
  'failed',
  'suppressed',
  'skipped',
  'dry_run',
]);

export const WorkflowRunSchema = z.object({
  id: z.number().optional(),
  run_type: z.enum(['daily_brief', 'smoke_test']),
  trigger: z.string(),
  date_key: z.string(),
  status: z.enum(['success', 'failed', 'suppressed']),
  dry_run: z.boolean().default(false),
  brief_id: z.number().nullable().optional(),
  sms_status: RunChannelStatusSchema.nullable().optional(),
  voice_status: RunChannelStatusSchema.nullable().optional(),
  integration_failures: z.array(z.string()).optional(),
  error_message: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
  created_at: z.date().optional(),
});

export type Person = z.infer<typeof PersonSchema>;
export type Meeting = z.infer<typeof MeetingSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type FollowUp = z.infer<typeof FollowUpSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type DeliveryLog = z.infer<typeof DeliveryLogSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type AccessibleCalendar = z.infer<typeof AccessibleCalendarSchema>;
export type EmailThread = z.infer<typeof EmailThreadSchema>;
export type BriefContext = z.infer<typeof BriefContextSchema>;
export type GeneratedBrief = z.infer<typeof GeneratedBriefSchema>;
export type RunChannelStatus = z.infer<typeof RunChannelStatusSchema>;
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
