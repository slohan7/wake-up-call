import { DatabaseService } from '../src/db/database';
import { runSmokeTest } from '../src/services/smoke-test';

describe('smoke-test mode', () => {
  let db: DatabaseService;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('uses live delivery behavior even when DRY_RUN_MODE is enabled for tests', async () => {
    const sendSMS = jest.fn(async () => ({
      success: true,
      messageId: 'smoke-sms-1',
      deliveryType: 'sms' as const,
      status: 'pending' as const,
    }));

    const result = await runSmokeTest(
      {
        targets: ['sms'],
        smsTo: '+15551234567',
        date: new Date('2026-04-01T12:00:00Z'),
      },
      {
        db,
        calendar: {} as any,
        gmail: {} as any,
        proton: {} as any,
        twilio: {
          sendSMS,
          makeVoiceCall: jest.fn(),
        } as any,
      }
    );

    expect(sendSMS).toHaveBeenCalledWith(
      '+15551234567',
      expect.stringContaining('Founder Daily Brief smoke test for 2026-04-01'),
      false
    );
    expect(db.countRecords('briefs')).toBe(0);
    expect(db.countRecords('workflow_runs')).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('passed');
    expect(result.results[0].summary).toContain('accepted by Twilio');
  });
});
