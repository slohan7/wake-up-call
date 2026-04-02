import { BriefGeneratorService } from '../src/services/brief-generator';
import type { BriefContext } from '../src/models/types';

describe('BriefGeneratorService', () => {
  it('tells the llm to stay grounded in the provided evidence', async () => {
    const generateJSON = jest.fn().mockResolvedValue({
      fullBrief: 'Full brief',
      smsBrief: 'SMS brief',
      voiceBrief: 'Voice brief',
      topPriorities: ['Send investor update'],
    });

    const service = new BriefGeneratorService({
      generateJSON,
    } as any);

    const now = new Date('2026-04-01T12:00:00Z');
    const context: BriefContext = {
      date: now,
      timezone: 'America/Detroit',
      meetings: [],
      tasks: [
        {
          id: 1,
          title: 'Send investor update',
          description: null,
          due_date: new Date('2026-03-31T12:00:00Z'),
          priority: 'urgent',
          status: 'pending',
          category: 'Fundraising',
          created_at: now,
          updated_at: now,
        },
      ],
      followUps: [],
      emails: [
        {
          id: 'email-1',
          subject: 'Please review Q4 draft',
          from: 'investor@example.com',
          to: ['founder@example.com'],
          snippet: 'Would love your thoughts before the call.',
          date: new Date('2026-04-01T11:00:00Z'),
          isImportant: true,
          isUnread: true,
          labels: ['IMPORTANT', 'UNREAD'],
          body: 'Would love your thoughts before the call.',
        },
      ],
      previousBrief: null,
    };

    await service.generateBrief(context);

    const prompt = generateJSON.mock.calls[0][0];
    expect(prompt).toContain('System-scored priorities:');
    expect(prompt).toContain('Every claim must be grounded in the provided context.');
    expect(prompt).toContain('Do not invent meetings, people, deadlines, security issues, or tasks.');
    expect(prompt).toContain('If an email or note is ambiguous, describe it neutrally instead of escalating it.');
    expect(prompt).toContain('1. Send investor update');
  });

  it('falls back to a generated brief and preserves high-priority scoring when the LLM fails', async () => {
    const service = new BriefGeneratorService();
    (service as any).llmProvider = {
      generateJSON: jest.fn().mockRejectedValue(new Error('LLM unavailable')),
    };

    const now = new Date('2026-04-01T12:00:00Z');
    const context: BriefContext = {
      date: now,
      timezone: 'America/Detroit',
      meetings: [
        {
          id: 1,
          calendar_id: 'meeting-1',
          title: 'Board meeting',
          start_time: new Date('2026-04-01T13:00:00Z'),
          end_time: new Date('2026-04-01T14:00:00Z'),
          attendees: ['ceo@example.com', 'board@example.com'],
          location: 'Zoom',
          description: 'Review company metrics',
          prep_notes: null,
          importance_score: 9,
        },
      ],
      tasks: [
        {
          id: 1,
          title: 'Send investor update',
          description: null,
          due_date: new Date('2026-03-31T12:00:00Z'),
          priority: 'urgent',
          status: 'pending',
          category: 'Fundraising',
          created_at: now,
          updated_at: now,
        },
      ],
      followUps: [
        {
          id: 1,
          person_id: 1,
          subject: 'Finalize term sheet edits',
          context: null,
          due_date: new Date('2026-03-31T10:00:00Z'),
          status: 'pending',
          priority: 10,
          created_at: now,
          updated_at: now,
          person: {
            id: 1,
            email: 'investor@example.com',
            name: 'Key Investor',
            company: 'Fund',
            importance: 10,
            last_contact: null,
            created_at: now,
            updated_at: now,
          },
        },
      ],
      emails: [
        {
          id: 'email-1',
          subject: 'Urgent follow-up',
          from: 'investor@example.com',
          to: ['founder@example.com'],
          snippet: 'Need your answer before the call.',
          date: new Date('2026-04-01T11:00:00Z'),
          isImportant: true,
          isUnread: true,
          labels: ['IMPORTANT', 'UNREAD'],
          body: 'Please send the update before noon.',
        },
      ],
      previousBrief: null,
    };

    const brief = await service.generateBrief(context);

    expect(brief.fullBrief).toContain('Daily Brief');
    expect(brief.smsBrief.length).toBeGreaterThan(0);
    expect(brief.voiceBrief.length).toBeGreaterThan(0);
    expect(brief.priorityScore).toBeGreaterThanOrEqual(8);
    expect(brief.isHighPriority).toBe(true);
    expect(brief.topPriorities).toContain('Send investor update');
  });
});
