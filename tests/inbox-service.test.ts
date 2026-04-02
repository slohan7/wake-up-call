import type { EmailThread } from '../src/models/types';
import { UnifiedInboxService } from '../src/services/inbox-service';

function makeEmail(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: 'email-1',
    subject: 'Status update',
    from: 'alex@example.com',
    to: ['steven@example.com'],
    snippet: 'Latest update',
    date: new Date('2026-04-02T14:00:00Z'),
    isImportant: true,
    isUnread: true,
    labels: ['UNREAD'],
    body: 'Latest update',
    ...overrides,
  };
}

describe('UnifiedInboxService', () => {
  it('merges, sorts, deduplicates, and tolerates a failing inbox provider', async () => {
    const service = new UnifiedInboxService([
      {
        getSourceName: () => 'gmail',
        isConfigured: () => true,
        testConnection: jest.fn(),
        getImportantEmails: jest.fn().mockResolvedValue([
          makeEmail({
            id: 'gmail-1',
            subject: 'Board deck',
            from: 'investor@example.com',
            date: new Date('2026-04-02T16:00:00Z'),
          }),
          makeEmail({
            id: 'gmail-2',
            subject: 'Status update',
            from: 'alex@example.com',
            date: new Date('2026-04-02T14:00:00Z'),
          }),
        ]),
      },
      {
        getSourceName: () => 'proton',
        isConfigured: () => true,
        testConnection: jest.fn(),
        getImportantEmails: jest.fn().mockResolvedValue([
          makeEmail({
            id: 'proton-1',
            subject: 'Status update',
            from: 'alex@example.com',
            date: new Date('2026-04-02T14:00:30Z'),
          }),
          makeEmail({
            id: 'proton-2',
            subject: 'Hiring update',
            from: 'candidate@example.com',
            date: new Date('2026-04-02T15:00:00Z'),
          }),
        ]),
      },
      {
        getSourceName: () => 'broken-provider',
        isConfigured: () => true,
        testConnection: jest.fn(),
        getImportantEmails: jest.fn().mockRejectedValue(new Error('bridge offline')),
      },
    ]);

    const emails = await service.getImportantEmails(10);

    expect(emails.map(email => email.subject)).toEqual([
      'Board deck',
      'Hiring update',
      'Status update',
    ]);
    expect(emails).toHaveLength(3);
  });
});
