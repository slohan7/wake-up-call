import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseService } from '../src/db/database';
import { importOperatingData } from '../src/services/data-import';

describe('importOperatingData', () => {
  let db: DatabaseService;
  let tempDir: string;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
    tempDir = mkdtempSync(join(tmpdir(), 'founder-brief-import-'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates and updates people, tasks, and follow-ups without duplicating rows', () => {
    const peoplePath = join(tempDir, 'people.csv');
    const tasksPath = join(tempDir, 'tasks.csv');
    const followUpsPath = join(tempDir, 'follow-ups.csv');

    writeFileSync(
      peoplePath,
      [
        'email,name,company,importance,last_contact',
        'founder@example.com,Founder One,Roots,9,2026-03-30',
      ].join('\n')
    );

    writeFileSync(
      tasksPath,
      [
        'title,description,due_date,priority,status,category',
        'Review fundraising memo,Initial draft review,2026-04-03,high,pending,Fundraising',
      ].join('\n')
    );

    writeFileSync(
      followUpsPath,
      [
        'person_email,person_name,person_company,person_importance,person_last_contact,subject,context,due_date,status,priority',
        'investor@example.com,Key Investor,Fund,10,2026-03-25,Term sheet follow-up,Need response on edits,2026-04-02,pending,9',
      ].join('\n')
    );

    const first = importOperatingData({
      db,
      peoplePath,
      tasksPath,
      followUpsPath,
    });

    expect(first.people).toEqual({ created: 2, updated: 0, skipped: 0 });
    expect(first.tasks).toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(first.followUps).toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(db.countRecords('people')).toBe(2);
    expect(db.countRecords('tasks')).toBe(1);
    expect(db.countRecords('follow_ups')).toBe(1);

    writeFileSync(
      peoplePath,
      [
        'email,name,company,importance,last_contact',
        'founder@example.com,Founder One,Roots Labs,10,2026-04-01',
      ].join('\n')
    );

    writeFileSync(
      tasksPath,
      [
        'title,description,due_date,priority,status,category',
        'Review fundraising memo,Final partner-ready draft,2026-04-04,urgent,in_progress,Fundraising',
      ].join('\n')
    );

    writeFileSync(
      followUpsPath,
      [
        'person_email,person_name,person_company,person_importance,person_last_contact,subject,context,due_date,status,priority',
        'investor@example.com,Key Investor,Fund II,10,2026-04-01,Term sheet follow-up,Need response on revised economics,2026-04-03,pending,10',
      ].join('\n')
    );

    const second = importOperatingData({
      db,
      peoplePath,
      tasksPath,
      followUpsPath,
    });

    expect(second.people).toEqual({ created: 0, updated: 2, skipped: 0 });
    expect(second.tasks).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(second.followUps).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(db.countRecords('people')).toBe(2);
    expect(db.countRecords('tasks')).toBe(1);
    expect(db.countRecords('follow_ups')).toBe(1);

    const founder = db.getPersonByEmail('founder@example.com');
    expect(founder?.company).toBe('Roots Labs');
    expect(founder?.importance).toBe(10);

    const investor = db.getPersonByEmail('investor@example.com');
    expect(investor?.company).toBe('Fund II');

    const task = db.getTaskByTitle('Review fundraising memo');
    expect(task?.priority).toBe('urgent');
    expect(task?.status).toBe('in_progress');
    expect(task?.description).toBe('Final partner-ready draft');

    const followUp = db.getFollowUpByPersonAndSubject(investor!.id!, 'Term sheet follow-up');
    expect(followUp?.priority).toBe(10);
    expect(followUp?.context).toBe('Need response on revised economics');
  });
});
