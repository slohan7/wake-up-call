import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseService } from '../src/db/database';
import { LivingDocsService } from '../src/services/living-docs';
import type { CalendarEvent, EmailThread } from '../src/models/types';

describe('LivingDocsService', () => {
  let db: DatabaseService;
  let outputDir: string;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
    outputDir = mkdtempSync(join(tmpdir(), 'founder-brief-living-docs-'));
  });

  afterEach(() => {
    db.close();
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('generates living docs that reflect database state plus inbox and calendar signals', async () => {
    const createdPerson = db.createPerson({
      email: 'alex.chen@example.com',
      name: 'Alex Chen',
      company: 'Roots',
      importance: 8,
      last_contact: null,
    });

    db.createTask({
      title: 'Ship weekly investor update',
      description: 'Summarize progress and runway changes.',
      due_date: new Date('2026-04-02T16:00:00Z'),
      priority: 'high',
      status: 'pending',
      category: 'Fundraising',
    });

    db.createFollowUp({
      person_id: createdPerson.id!,
      subject: 'Close the product feedback loop',
      context: 'Need Alex to confirm priorities before Friday.',
      due_date: new Date('2026-04-01T15:00:00Z'),
      status: 'pending',
      priority: 9,
    });

    const events: CalendarEvent[] = [
      {
        id: 'event-1',
        summary: 'Investor call',
        start: new Date('2026-04-02T14:00:00Z'),
        end: new Date('2026-04-02T14:30:00Z'),
        attendees: [
          {
            email: 'alex.chen@example.com',
            displayName: 'Alex Chen',
          },
        ],
      },
    ];

    const emails: EmailThread[] = [
      {
        id: 'email-1',
        subject: 'Term sheet update',
        from: 'sarah.jones@example.com',
        to: ['steven@example.com'],
        snippet: 'Can you get back to me before lunch?',
        date: new Date('2026-04-02T13:15:00Z'),
        isImportant: true,
        isUnread: true,
        labels: ['IMPORTANT', 'UNREAD'],
        body: 'Can you get back to me before lunch?',
      },
    ];

    const service = new LivingDocsService({
      db,
      inbox: {
        getImportantEmails: jest.fn().mockResolvedValue(emails),
      } as any,
      calendar: {
        getTodayEvents: jest.fn().mockResolvedValue(events),
      } as any,
    });

    const result = await service.refresh({
      date: new Date('2026-04-02T12:00:00Z'),
      outputDir,
    });

    expect(result.integrationStatus).toEqual({
      email: 'ok',
      calendar: 'ok',
    });

    expect(db.getPersonByEmail('sarah.jones@example.com')?.name).toBe('Sarah Jones');

    const peopleDoc = readFileSync(result.files.people, 'utf-8');
    const tasksDoc = readFileSync(result.files.tasks, 'utf-8');
    const followUpsDoc = readFileSync(result.files.followUps, 'utf-8');

    expect(peopleDoc).toContain('Alex Chen <alex.chen@example.com>');
    expect(peopleDoc).toContain('meeting today: Investor call');
    expect(peopleDoc).toContain('Sarah Jones <sarah.jones@example.com>');

    expect(tasksDoc).toContain('[HIGH] Ship weekly investor update');
    expect(tasksDoc).toContain('Prep for Investor call');
    expect(tasksDoc).toContain('Reply to Sarah Jones about Term sheet update');

    expect(followUpsDoc).toContain('Close the product feedback loop');
    expect(followUpsDoc).toContain('Respond re: Term sheet update');
    expect(followUpsDoc).toContain('Sarah Jones <sarah.jones@example.com>');
  });
});
