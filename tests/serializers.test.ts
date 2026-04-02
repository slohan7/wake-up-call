import { serializeBrief } from '../src/api/serializers';

describe('API serializers', () => {
  it('serializes brief dates as local YYYY-MM-DD strings instead of ISO timestamps', () => {
    const serialized = serializeBrief({
      id: 1,
      date: new Date('2026-04-01T12:00:00Z'),
      full_content: 'Full brief',
      sms_content: 'SMS brief',
      voice_content: 'Voice brief',
      priority_score: 7,
      is_high_priority: false,
      created_at: new Date('2026-04-01T12:30:00Z'),
    });

    expect(serialized.date).toBe('2026-04-01');
    expect(serialized.createdAt).toBe('2026-04-01T12:30:00.000Z');
  });
});
