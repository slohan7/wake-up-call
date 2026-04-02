import { DatabaseService } from '../src/db/database';
import { DailyBriefWorkflow } from '../src/workflows/daily-brief-workflow';
import type { GeneratedBrief } from '../src/models/types';

function makeGeneratedBrief(overrides: Partial<GeneratedBrief> = {}): GeneratedBrief {
  return {
    fullBrief: 'Full brief',
    smsBrief: 'SMS brief',
    voiceBrief: 'Voice brief',
    priorityScore: 6,
    isHighPriority: false,
    topPriorities: ['Priority 1'],
    ...overrides,
  };
}

describe('DailyBriefWorkflow', () => {
  let db: DatabaseService;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  function createWorkflow(options: {
    generatedBriefs?: GeneratedBrief[];
    twilioSendBrief?: jest.Mock;
    usedFallback?: boolean;
  } = {}) {
    const generatedBriefs = options.generatedBriefs ?? [makeGeneratedBrief()];
    const generateBrief = jest.fn(async () => generatedBriefs.shift() ?? makeGeneratedBrief());
    const getLastGenerationMetadata = jest.fn(() => ({
      usedFallback: options.usedFallback ?? false,
    }));
    const sendBrief = options.twilioSendBrief ?? jest.fn(async (_brief, deliveryOptions) => ({
      sms: deliveryOptions.enableSMS
        ? { success: true, messageId: `sms-${Date.now()}`, deliveryType: 'sms' as const }
        : undefined,
      voice: deliveryOptions.enableVoice
        ? { success: true, messageId: `voice-${Date.now()}`, deliveryType: 'voice' as const }
        : undefined,
    }));

    const workflow = new DailyBriefWorkflow(
      db,
      { generateBrief, getLastGenerationMetadata } as any,
      { getTodayEvents: jest.fn(async () => []) } as any,
      { getImportantEmails: jest.fn(async () => []) } as any,
      { sendBrief } as any
    );

    return { workflow, generateBrief, getLastGenerationMetadata, sendBrief };
  }

  it('does not persist a brief or delivery logs during dry run', async () => {
    const date = new Date('2026-04-01T12:00:00Z');
    const { workflow, sendBrief } = createWorkflow({
      generatedBriefs: [makeGeneratedBrief({ isHighPriority: true, priorityScore: 9 })],
    });

    const result = await workflow.execute({
      date,
      dryRun: true,
      enableVoice: true,
    });

    expect(sendBrief).not.toHaveBeenCalled();
    expect(result.deliveryResults).toHaveLength(0);
    expect(result.brief.id).toBeUndefined();
    expect(db.getLatestBrief()).toBeNull();
    expect(db.hasDeliveryForToday(date, 'sms')).toBe(false);
    expect(db.hasDeliveryForToday(date, 'voice')).toBe(false);
  });

  it('regenerates from fresh context during dry run even if a brief already exists for the day', async () => {
    const date = new Date('2026-04-01T12:00:00Z');
    const { workflow, generateBrief } = createWorkflow({
      generatedBriefs: [
        makeGeneratedBrief({ fullBrief: 'Stored brief', smsBrief: 'Stored SMS' }),
        makeGeneratedBrief({ fullBrief: 'Fresh dry-run brief', smsBrief: 'Fresh dry-run SMS' }),
      ],
    });

    const stored = await workflow.execute({
      date,
      skipDelivery: true,
    });

    const dryRun = await workflow.execute({
      date,
      dryRun: true,
      forceVoice: true,
    });

    expect(stored.brief.full_content).toBe('Stored brief');
    expect(dryRun.brief.full_content).toBe('Fresh dry-run brief');
    expect(dryRun.brief.id).toBeUndefined();
    expect(generateBrief).toHaveBeenCalledTimes(2);
  });

  it('suppresses duplicate sms delivery but still allows a later voice-only send', async () => {
    const date = new Date('2026-04-01T12:00:00Z');
    const { workflow, sendBrief } = createWorkflow();

    await workflow.execute({
      date,
      dryRun: false,
      enableVoice: false,
    });

    await workflow.execute({
      date,
      dryRun: false,
      forceVoice: true,
    });

    const thirdRun = await workflow.execute({
      date,
      dryRun: false,
      forceVoice: true,
    });

    expect(sendBrief).toHaveBeenCalledTimes(2);

    expect(sendBrief.mock.calls[0][1]).toMatchObject({
      enableSMS: true,
      enableVoice: false,
      dryRun: false,
    });

    expect(sendBrief.mock.calls[1][1]).toMatchObject({
      enableSMS: false,
      enableVoice: true,
      dryRun: false,
    });

    const deliveryLogs = db.getDeliveryLogsForBrief(thirdRun.brief.id!);
    expect(deliveryLogs).toHaveLength(2);
    expect(deliveryLogs.filter(log => log.delivery_type === 'sms')).toHaveLength(1);
    expect(deliveryLogs.filter(log => log.delivery_type === 'voice')).toHaveLength(1);
  });

  it('updates the existing brief when force regenerate is used', async () => {
    const date = new Date('2026-04-01T12:00:00Z');
    const { workflow } = createWorkflow({
      generatedBriefs: [
        makeGeneratedBrief({ fullBrief: 'Original brief', smsBrief: 'Original SMS' }),
        makeGeneratedBrief({ fullBrief: 'Updated brief', smsBrief: 'Updated SMS', priorityScore: 8 }),
      ],
    });

    const first = await workflow.execute({
      date,
      skipDelivery: true,
    });

    const second = await workflow.execute({
      date,
      skipDelivery: true,
      forceRegenerate: true,
    });

    expect(second.brief.id).toBe(first.brief.id);
    expect(second.brief.full_content).toBe('Updated brief');
    expect(second.brief.sms_content).toBe('Updated SMS');
  });

  it('suppresses automatic retry when the previous provider failure may have succeeded remotely', async () => {
    const date = new Date('2026-04-01T12:00:00Z');
    const sendBrief = jest
      .fn()
      .mockResolvedValueOnce({
        sms: {
          success: false,
          error: 'Twilio 503 timeout after request submission',
          deliveryType: 'sms' as const,
          suppressAutoRetry: true,
        },
      })
      .mockResolvedValueOnce({
        sms: {
          success: true,
          messageId: 'sms-second-attempt',
          deliveryType: 'sms' as const,
        },
      });

    const { workflow } = createWorkflow({ twilioSendBrief: sendBrief });

    await workflow.execute({
      date,
      dryRun: false,
      enableVoice: false,
    });

    const secondRun = await workflow.execute({
      date,
      dryRun: false,
      enableVoice: false,
    });

    expect(sendBrief).toHaveBeenCalledTimes(1);
    expect(secondRun.deliveryResults).toHaveLength(1);
    expect(secondRun.deliveryResults[0].status).toBe('failed');

    const latestRun = db.getLatestWorkflowRun();
    expect(latestRun?.sms_status).toBe('suppressed');
  });

  it('records the latest workflow run for status inspection', async () => {
    const date = new Date('2026-04-01T12:00:00Z');
    const { workflow } = createWorkflow();

    await workflow.execute({
      date,
      skipDelivery: true,
      trigger: 'cli',
    });

    const latestRun = db.getLatestWorkflowRun();
    expect(latestRun).not.toBeNull();
    expect(latestRun?.date_key).toBe('2026-04-01');
    expect(latestRun?.trigger).toBe('cli');
    expect(latestRun?.sms_status).toBe('skipped');
    expect(latestRun?.voice_status).toBe('skipped');
    expect(latestRun?.integration_failures).toEqual([]);
  });

  it('records Twilio-accepted sms as pending and suppresses later same-day retries', async () => {
    const date = new Date('2026-04-01T12:00:00Z');
    const sendBrief = jest.fn().mockResolvedValue({
      sms: {
        success: true,
        messageId: 'SM-pending-1',
        deliveryType: 'sms' as const,
        status: 'pending' as const,
        metadata: {
          providerStatus: 'queued',
          statusCallbackConfigured: true,
        },
      },
    });

    const { workflow } = createWorkflow({ twilioSendBrief: sendBrief });

    await workflow.execute({
      date,
      dryRun: false,
      enableVoice: false,
    });

    const secondRun = await workflow.execute({
      date,
      dryRun: false,
      enableVoice: false,
    });

    expect(sendBrief).toHaveBeenCalledTimes(1);

    const deliveryLogs = db.getDeliveryLogsForBrief(secondRun.brief.id!);
    expect(deliveryLogs).toHaveLength(1);
    expect(deliveryLogs[0].status).toBe('pending');
    expect(deliveryLogs[0].metadata?.messageId).toBe('SM-pending-1');
    expect(deliveryLogs[0].metadata?.providerStatus).toBe('queued');

    const latestRun = db.getLatestWorkflowRun();
    expect(latestRun?.sms_status).toBe('suppressed');
  });
});
