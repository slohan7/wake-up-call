import type { Brief, DeliveryLog, WorkflowRun } from '../models/types';
import { getLocalDateKey } from '../utils/date';

function toIsoString(value?: Date | null): string | null {
  if (!value) {
    return null;
  }

  return value.toISOString();
}

export function serializeBrief(brief: Brief) {
  return {
    id: brief.id,
    date: getLocalDateKey(brief.date),
    fullContent: brief.full_content,
    smsContent: brief.sms_content,
    voiceContent: brief.voice_content,
    priorityScore: brief.priority_score,
    isHighPriority: brief.is_high_priority,
    createdAt: toIsoString(brief.created_at),
  };
}

export function serializeDeliveryLog(log: DeliveryLog) {
  return {
    id: log.id,
    briefId: log.brief_id,
    deliveryType: log.delivery_type,
    status: log.status,
    recipient: log.recipient,
    errorMessage: log.error_message || null,
    metadata: log.metadata || null,
    deliveredAt: toIsoString(log.delivered_at),
    createdAt: toIsoString(log.created_at),
  };
}

export function serializeWorkflowRun(run: WorkflowRun) {
  return {
    id: run.id,
    runType: run.run_type,
    trigger: run.trigger,
    date: run.date_key,
    status: run.status,
    dryRun: run.dry_run,
    briefId: run.brief_id ?? null,
    smsStatus: run.sms_status ?? null,
    voiceStatus: run.voice_status ?? null,
    integrationFailures: run.integration_failures || [],
    errorMessage: run.error_message || null,
    metadata: run.metadata || null,
    createdAt: toIsoString(run.created_at),
  };
}
