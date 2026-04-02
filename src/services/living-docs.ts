import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DatabaseService } from '../db/database';
import { GoogleCalendarIntegration } from '../integrations/google-calendar';
import type { CalendarEvent, EmailThread, FollowUp, Person, Task } from '../models/types';
import { UnifiedInboxService } from './inbox-service';
import { formatLocalDate, formatLocalTime, isOverdue } from '../utils/date';
import { logger } from '../utils/logger';

type FollowUpWithPerson = FollowUp & { person?: Person };

export interface LivingDocsOptions {
  date?: Date;
  outputDir?: string;
}

export interface LivingDocsDependencies {
  db: DatabaseService;
  inbox: UnifiedInboxService;
  calendar: GoogleCalendarIntegration;
}

export interface LivingDocsResult {
  outputDir: string;
  files: {
    people: string;
    tasks: string;
    followUps: string;
  };
  counts: {
    peopleRanked: number;
    tasksActive: number;
    taskSuggestions: number;
    followUpsActive: number;
    followUpSuggestions: number;
  };
  integrationStatus: {
    email: 'ok' | 'unavailable';
    calendar: 'ok' | 'unavailable';
  };
}

export class LivingDocsService {
  constructor(private dependencies: LivingDocsDependencies) {}

  async refresh(options: LivingDocsOptions = {}): Promise<LivingDocsResult> {
    const { db, inbox, calendar } = this.dependencies;
    const date = options.date ?? new Date();
    const outputDir = options.outputDir ?? join(process.cwd(), 'living-docs');

    mkdirSync(outputDir, { recursive: true });

    const [eventsResult, emailsResult] = await Promise.allSettled([
      calendar.getTodayEvents(date),
      inbox.getImportantEmails(10),
    ]);

    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];

    if (eventsResult.status === 'rejected') {
      logger.warn('Living docs refresh could not load calendar events', {
        error: String(eventsResult.reason),
      });
    }

    if (emailsResult.status === 'rejected') {
      logger.warn('Living docs refresh could not load inbox messages', {
        error: String(emailsResult.reason),
      });
    }

    this.syncPeopleFromSignals(events, emails);

    const people = db.getAllPeople();
    const tasks = db.getPendingTasks(false);
    const followUps = db.getPendingFollowUps();

    const rankedPeople = rankPeople(people, events, emails, followUps).slice(0, 15);
    const taskSuggestions = buildTaskSuggestions(events, emails, tasks).slice(0, 10);
    const followUpSuggestions = buildFollowUpSuggestions(emails, followUps).slice(0, 10);

    const dateLabel = formatLocalDate(date, 'EEEE, MMMM d, yyyy');
    const generatedAt = new Date().toISOString();

    const peoplePath = join(outputDir, 'people.md');
    const tasksPath = join(outputDir, 'tasks.md');
    const followUpsPath = join(outputDir, 'follow-ups.md');

    writeFileSync(
      peoplePath,
      renderPeopleDoc({
        dateLabel,
        generatedAt,
        people: rankedPeople,
        events,
        emails,
      }),
      'utf-8'
    );

    writeFileSync(
      tasksPath,
      renderTasksDoc({
        dateLabel,
        generatedAt,
        tasks,
        suggestions: taskSuggestions,
        events,
        emails,
      }),
      'utf-8'
    );

    writeFileSync(
      followUpsPath,
      renderFollowUpsDoc({
        dateLabel,
        generatedAt,
        followUps,
        suggestions: followUpSuggestions,
        emails,
      }),
      'utf-8'
    );

    return {
      outputDir,
      files: {
        people: peoplePath,
        tasks: tasksPath,
        followUps: followUpsPath,
      },
      counts: {
        peopleRanked: rankedPeople.length,
        tasksActive: tasks.length,
        taskSuggestions: taskSuggestions.length,
        followUpsActive: followUps.length,
        followUpSuggestions: followUpSuggestions.length,
      },
      integrationStatus: {
        email: emailsResult.status === 'fulfilled' ? 'ok' : 'unavailable',
        calendar: eventsResult.status === 'fulfilled' ? 'ok' : 'unavailable',
      },
    };
  }

  private syncPeopleFromSignals(events: CalendarEvent[], emails: EmailThread[]): void {
    const { db } = this.dependencies;
    const seenEmails = new Set<string>();

    for (const event of events) {
      for (const attendee of event.attendees || []) {
        const email = attendee.email?.trim().toLowerCase();
        if (!email || seenEmails.has(email) || isSkippableSystemEmail(email)) {
          continue;
        }

        seenEmails.add(email);
        if (!db.getPersonByEmail(email)) {
          db.createPerson({
            email,
            name: attendee.displayName || nameFromEmail(email),
            company: null,
            importance: 5,
            last_contact: null,
          });
        }
      }
    }

    for (const emailThread of emails) {
      const email = emailThread.from.trim().toLowerCase();
      if (!email || seenEmails.has(email) || isSkippableSystemEmail(email)) {
        continue;
      }

      seenEmails.add(email);
      if (!db.getPersonByEmail(email)) {
        db.createPerson({
          email,
          name: nameFromEmail(email),
          company: null,
          importance: 5,
          last_contact: null,
        });
      }
    }
  }
}

type RankedPerson = {
  person: Person;
  score: number;
  reasons: string[];
};

type SuggestedTask = {
  title: string;
  reason: string;
  source: 'calendar' | 'email';
};

type SuggestedFollowUp = {
  person: string;
  email: string;
  subject: string;
  reason: string;
  source: 'email';
};

function rankPeople(
  people: Person[],
  events: CalendarEvent[],
  emails: EmailThread[],
  followUps: FollowUpWithPerson[]
): RankedPerson[] {
  const byEmail = new Map<string, RankedPerson>();

  for (const person of people) {
    byEmail.set(person.email.toLowerCase(), {
      person,
      score: person.importance / 2,
      reasons: [`importance ${person.importance}/10`],
    });
  }

  for (const followUp of followUps) {
    const email = followUp.person?.email?.toLowerCase();
    if (!email) {
      continue;
    }

    const ranked = byEmail.get(email);
    if (!ranked) {
      continue;
    }

    ranked.score += isOverdue(followUp.due_date) ? 5 : 3;
    ranked.reasons.push(
      isOverdue(followUp.due_date)
        ? `overdue follow-up: ${followUp.subject}`
        : `pending follow-up: ${followUp.subject}`
    );
  }

  for (const event of events) {
    for (const attendee of event.attendees || []) {
      const email = attendee.email?.trim().toLowerCase();
      if (!email) {
        continue;
      }

      const ranked = byEmail.get(email);
      if (!ranked) {
        continue;
      }

      ranked.score += 4;
      ranked.reasons.push(`meeting today: ${event.summary} at ${formatLocalTime(event.start)}`);
    }
  }

  for (const emailThread of emails) {
    const email = emailThread.from.trim().toLowerCase();
    const ranked = byEmail.get(email);
    if (!ranked) {
      continue;
    }

    ranked.score += emailThread.isUnread ? 4 : 2;
    ranked.reasons.push(
      `${emailThread.isUnread ? 'unread' : 'important'} email: ${emailThread.subject}`
    );
  }

  return [...byEmail.values()]
    .map(entry => ({
      ...entry,
      reasons: dedupe(entry.reasons).slice(0, 4),
    }))
    .sort((left, right) => right.score - left.score);
}

function buildTaskSuggestions(
  events: CalendarEvent[],
  emails: EmailThread[],
  tasks: Task[]
): SuggestedTask[] {
  const existingTitles = new Set(tasks.map(task => normalizeKey(task.title)));
  const suggestions: SuggestedTask[] = [];

  for (const event of events) {
    const title = `Prep for ${event.summary}`;
    if (existingTitles.has(normalizeKey(title))) {
      continue;
    }

    suggestions.push({
      title,
      reason: `Calendar shows ${event.summary} at ${formatLocalTime(event.start)}.`,
      source: 'calendar',
    });
  }

  for (const email of emails) {
    const title = `Reply to ${nameFromEmail(email.from)} about ${email.subject}`;
    if (existingTitles.has(normalizeKey(title))) {
      continue;
    }

    suggestions.push({
      title,
      reason: `${email.isUnread ? 'Unread' : 'Important'} email from ${email.from}.`,
      source: 'email',
    });
  }

  return dedupeBy(suggestions, suggestion => normalizeKey(suggestion.title));
}

function buildFollowUpSuggestions(
  emails: EmailThread[],
  followUps: FollowUpWithPerson[]
): SuggestedFollowUp[] {
  const existing = new Set(
    followUps.map(followUp => normalizeKey(`${followUp.person?.email || ''}:${followUp.subject}`))
  );

  const suggestions: SuggestedFollowUp[] = [];

  for (const email of emails) {
    const subject = `Respond re: ${email.subject}`;
    const key = normalizeKey(`${email.from}:${subject}`);
    if (existing.has(key)) {
      continue;
    }

    suggestions.push({
      person: nameFromEmail(email.from),
      email: email.from,
      subject,
      reason: `${email.isUnread ? 'Unread' : 'Important'} email suggests a reply or follow-up may be needed.`,
      source: 'email',
    });
  }

  return dedupeBy(suggestions, suggestion => normalizeKey(`${suggestion.email}:${suggestion.subject}`));
}

function renderPeopleDoc(options: {
  dateLabel: string;
  generatedAt: string;
  people: RankedPerson[];
  events: CalendarEvent[];
  emails: EmailThread[];
}): string {
  const { dateLabel, generatedAt, people, events, emails } = options;

  return `# People

Generated: ${generatedAt}
Day: ${dateLabel}

This file is generated from your local people database, today's calendar, and important inbox threads.

## Today’s Signals

- Meetings today: ${events.length}
- Important emails considered: ${emails.length}

## Ranked People

${people.length > 0
  ? people.map((entry, index) => {
      const company = entry.person.company ? ` | ${entry.person.company}` : '';
      return `${index + 1}. ${entry.person.name} <${entry.person.email}>${company}
   Score: ${entry.score.toFixed(1)}
   Why now: ${entry.reasons.join('; ')}`;
    }).join('\n\n')
  : 'No people found yet. Calendar attendees and important email senders will start populating this list over time.'}
`;
}

function renderTasksDoc(options: {
  dateLabel: string;
  generatedAt: string;
  tasks: Task[];
  suggestions: SuggestedTask[];
  events: CalendarEvent[];
  emails: EmailThread[];
}): string {
  const { dateLabel, generatedAt, tasks, suggestions, events, emails } = options;

  return `# Tasks

Generated: ${generatedAt}
Day: ${dateLabel}

This file combines your active database tasks with suggested tasks inferred from today’s calendar and important inbox threads.

## Active Tasks In Database

${tasks.length > 0
  ? tasks.map((task, index) => `${index + 1}. [${task.priority.toUpperCase()}] ${task.title}
   Status: ${task.status}
   Due: ${task.due_date ? formatLocalDate(task.due_date) : 'none'}
   Category: ${task.category || 'none'}
   ${task.description ? `Context: ${task.description}` : 'Context: none'}`).join('\n\n')
  : 'No active tasks in the database.'}

## Suggested Tasks From Today’s Context

${suggestions.length > 0
  ? suggestions.map((suggestion, index) => `${index + 1}. ${suggestion.title}
   Source: ${suggestion.source}
   Reason: ${suggestion.reason}`).join('\n\n')
  : 'No additional task suggestions from today’s calendar or inbox signals.'}

## Signal Counts

- Meetings today: ${events.length}
- Important emails considered: ${emails.length}
`;
}

function renderFollowUpsDoc(options: {
  dateLabel: string;
  generatedAt: string;
  followUps: FollowUpWithPerson[];
  suggestions: SuggestedFollowUp[];
  emails: EmailThread[];
}): string {
  const { dateLabel, generatedAt, followUps, suggestions, emails } = options;

  return `# Follow-ups

Generated: ${generatedAt}
Day: ${dateLabel}

This file combines your active database follow-ups with suggested follow-ups derived from important inbox activity.

## Active Follow-ups In Database

${followUps.length > 0
  ? followUps.map((followUp, index) => `${index + 1}. ${followUp.person?.name || 'Unknown'} <${followUp.person?.email || 'unknown'}>
   Subject: ${followUp.subject}
   Due: ${formatLocalDate(followUp.due_date)}
   Priority: ${followUp.priority}/10
   Status: ${followUp.status}
   ${followUp.context ? `Context: ${followUp.context}` : 'Context: none'}
   ${isOverdue(followUp.due_date) ? 'Overdue: yes' : 'Overdue: no'}`).join('\n\n')
  : 'No active follow-ups in the database.'}

## Suggested Follow-ups To Capture

${suggestions.length > 0
  ? suggestions.map((suggestion, index) => `${index + 1}. ${suggestion.person} <${suggestion.email}>
   Subject: ${suggestion.subject}
   Source: ${suggestion.source}
   Reason: ${suggestion.reason}`).join('\n\n')
  : 'No new follow-up suggestions from the current inbox signals.'}

## Signal Counts

- Important emails considered: ${emails.length}
`;
}

function nameFromEmail(email: string): string {
  const localPart = email.split('@')[0] || email;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isSkippableSystemEmail(email: string): boolean {
  return email.includes('resource.calendar.google.com');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeBy<T>(values: T[], keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
}
