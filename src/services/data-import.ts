import { readFileSync } from 'fs';
import { DatabaseService } from '../db/database';
import type { FollowUp, Person, Task } from '../models/types';
import { parseInputDate } from '../utils/date';

type ImportCounts = {
  created: number;
  updated: number;
  skipped: number;
};

export type ImportSummary = {
  people: ImportCounts;
  tasks: ImportCounts;
  followUps: ImportCounts;
};

export type ImportOptions = {
  db: DatabaseService;
  peoplePath?: string;
  tasksPath?: string;
  followUpsPath?: string;
  dryRun?: boolean;
};

type ParsedCsvRow = Record<string, string>;

type PersonInput = Omit<Person, 'id' | 'created_at' | 'updated_at'>;
type TaskInput = Omit<Task, 'id' | 'created_at' | 'updated_at'>;
type FollowUpInput = Omit<FollowUp, 'id' | 'created_at' | 'updated_at'>;

const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const FOLLOW_UP_STATUSES = new Set(['pending', 'sent', 'completed', 'skipped']);

export function importOperatingData(options: ImportOptions): ImportSummary {
  const { db, peoplePath, tasksPath, followUpsPath, dryRun = false } = options;

  const summary: ImportSummary = {
    people: emptyCounts(),
    tasks: emptyCounts(),
    followUps: emptyCounts(),
  };

  if (peoplePath) {
    const peopleRows = readCsvFile(peoplePath, ['email', 'name']);
    for (const row of peopleRows) {
      upsertPerson(db, normalizePersonRow(row), summary.people, dryRun);
    }
  }

  if (tasksPath) {
    const taskRows = readCsvFile(tasksPath, ['title', 'priority', 'status']);
    for (const row of taskRows) {
      upsertTask(db, normalizeTaskRow(row), summary.tasks, dryRun);
    }
  }

  if (followUpsPath) {
    const followUpRows = readCsvFile(followUpsPath, ['person_email', 'subject', 'due_date', 'status', 'priority']);
    for (const row of followUpRows) {
      upsertFollowUp(db, normalizeFollowUpRow(row), summary, dryRun);
    }
  }

  return summary;
}

function emptyCounts(): ImportCounts {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
  };
}

function incrementAction(counts: ImportCounts, action: keyof ImportCounts): void {
  counts[action] += 1;
}

function upsertPerson(
  db: DatabaseService,
  person: PersonInput,
  counts: ImportCounts,
  dryRun: boolean
): PersonInput | Person {
  const existing = db.getPersonByEmail(person.email);

  if (!existing) {
    incrementAction(counts, 'created');
    return dryRun ? person : db.createPerson(person);
  }

  if (personEquals(existing, person)) {
    incrementAction(counts, 'skipped');
    return existing;
  }

  incrementAction(counts, 'updated');
  return dryRun ? person : db.updatePerson(existing.id!, person);
}

function upsertTask(
  db: DatabaseService,
  task: TaskInput,
  counts: ImportCounts,
  dryRun: boolean
): TaskInput | Task {
  const existing = db.getTaskByTitle(task.title);

  if (!existing) {
    incrementAction(counts, 'created');
    return dryRun ? task : db.createTask(task);
  }

  if (taskEquals(existing, task)) {
    incrementAction(counts, 'skipped');
    return existing;
  }

  incrementAction(counts, 'updated');
  return dryRun ? task : db.updateTask(existing.id!, task);
}

function upsertFollowUp(
  db: DatabaseService,
  input: {
    person: PersonInput;
    followUp: FollowUpInput;
  },
  summary: ImportSummary,
  dryRun: boolean
): void {
  const existingPerson = db.getPersonByEmail(input.person.email);
  const personResult = upsertPerson(db, input.person, summary.people, dryRun);
  const personId = 'id' in personResult && typeof personResult.id === 'number'
    ? personResult.id
    : existingPerson?.id;

  if (dryRun && !personId) {
    incrementAction(summary.followUps, 'created');
    return;
  }

  if (!personId) {
    throw new Error(`Unable to resolve person id for follow-up subject "${input.followUp.subject}"`);
  }

  const followUp: FollowUpInput = {
    ...input.followUp,
    person_id: personId,
  };

  const existing = db.getFollowUpByPersonAndSubject(personId, followUp.subject);

  if (!existing) {
    incrementAction(summary.followUps, 'created');
    if (!dryRun) {
      db.createFollowUp(followUp);
    }
    return;
  }

  if (followUpEquals(existing, followUp)) {
    incrementAction(summary.followUps, 'skipped');
    return;
  }

  incrementAction(summary.followUps, 'updated');
  if (!dryRun) {
    db.updateFollowUp(existing.id!, followUp);
  }
}

function normalizePersonRow(row: ParsedCsvRow): PersonInput {
  return {
    email: requiredValue(row.email, 'email'),
    name: requiredValue(row.name, 'name'),
    company: optionalValue(row.company),
    importance: parseInteger(optionalValue(row.importance) || '5', 'importance', 1, 10),
    last_contact: parseOptionalDate(optionalValue(row.last_contact), 'last_contact'),
  };
}

function normalizeTaskRow(row: ParsedCsvRow): TaskInput {
  const priority = requiredValue(row.priority, 'priority').toLowerCase();
  if (!TASK_PRIORITIES.has(priority)) {
    throw new Error(`Invalid task priority "${row.priority}"`);
  }

  const status = requiredValue(row.status, 'status').toLowerCase();
  if (!TASK_STATUSES.has(status)) {
    throw new Error(`Invalid task status "${row.status}"`);
  }

  return {
    title: requiredValue(row.title, 'title'),
    description: optionalValue(row.description),
    due_date: parseOptionalDate(optionalValue(row.due_date), 'due_date'),
    priority: statusValue(priority, TASK_PRIORITIES) as Task['priority'],
    status: statusValue(status, TASK_STATUSES) as Task['status'],
    category: optionalValue(row.category),
  };
}

function normalizeFollowUpRow(row: ParsedCsvRow): { person: PersonInput; followUp: FollowUpInput } {
  const status = requiredValue(row.status, 'status').toLowerCase();
  if (!FOLLOW_UP_STATUSES.has(status)) {
    throw new Error(`Invalid follow-up status "${row.status}"`);
  }

  return {
    person: {
      email: requiredValue(row.person_email, 'person_email'),
      name: requiredValue(row.person_name, 'person_name'),
      company: optionalValue(row.person_company),
      importance: parseInteger(optionalValue(row.person_importance) || '5', 'person_importance', 1, 10),
      last_contact: parseOptionalDate(optionalValue(row.person_last_contact), 'person_last_contact'),
    },
    followUp: {
      person_id: 0,
      subject: requiredValue(row.subject, 'subject'),
      context: optionalValue(row.context),
      due_date: parseRequiredDate(requiredValue(row.due_date, 'due_date'), 'due_date'),
      status: statusValue(status, FOLLOW_UP_STATUSES) as FollowUp['status'],
      priority: parseInteger(requiredValue(row.priority, 'priority'), 'priority', 1, 10),
    },
  };
}

function readCsvFile(path: string, requiredHeaders: string[]): ParsedCsvRow[] {
  const content = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
  const rows = parseCsv(content);
  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map(header => header.trim());

  for (const requiredHeader of requiredHeaders) {
    if (!headers.includes(requiredHeader)) {
      throw new Error(`Missing required CSV header "${requiredHeader}" in ${path}`);
    }
  }

  return dataRows
    .filter(row => row.some(value => value.trim() !== ''))
    .map(row => {
      const parsed: ParsedCsvRow = {};
      headers.forEach((header, index) => {
        parsed[header] = (row[index] || '').trim();
      });
      return parsed;
    });
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (inQuotes) {
      if (character === '"' && next === '"') {
        value += '"';
        index += 1;
        continue;
      }

      if (character === '"') {
        inQuotes = false;
        continue;
      }

      value += character;
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ',') {
      row.push(value);
      value = '';
      continue;
    }

    if (character === '\r') {
      continue;
    }

    if (character === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += character;
  }

  if (value !== '' || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function requiredValue(value: string | undefined, fieldName: string): string {
  const trimmed = optionalValue(value);
  if (!trimmed) {
    throw new Error(`Missing required value for "${fieldName}"`);
  }

  return trimmed;
}

function optionalValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseInteger(value: string, fieldName: string, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid integer for "${fieldName}": ${value}`);
  }

  return parsed;
}

function parseOptionalDate(value: string | null, fieldName: string): Date | null {
  if (!value) {
    return null;
  }

  return parseRequiredDate(value, fieldName);
}

function parseRequiredDate(value: string, fieldName: string): Date {
  const parsed = parseInputDate(value);
  if (!parsed) {
    throw new Error(`Invalid date for "${fieldName}": ${value}`);
  }

  return parsed;
}

function statusValue(value: string, validValues: Set<string>): string {
  if (!validValues.has(value)) {
    throw new Error(`Invalid enum value "${value}"`);
  }

  return value;
}

function personEquals(existing: Person, next: PersonInput): boolean {
  return (
    existing.email === next.email &&
    existing.name === next.name &&
    (existing.company || null) === (next.company || null) &&
    existing.importance === next.importance &&
    sameDate(existing.last_contact, next.last_contact)
  );
}

function taskEquals(existing: Task, next: TaskInput): boolean {
  return (
    existing.title === next.title &&
    (existing.description || null) === (next.description || null) &&
    sameDate(existing.due_date, next.due_date) &&
    existing.priority === next.priority &&
    existing.status === next.status &&
    (existing.category || null) === (next.category || null)
  );
}

function followUpEquals(existing: FollowUp, next: FollowUpInput): boolean {
  return (
    existing.person_id === next.person_id &&
    existing.subject === next.subject &&
    (existing.context || null) === (next.context || null) &&
    sameDate(existing.due_date, next.due_date) &&
    existing.status === next.status &&
    existing.priority === next.priority
  );
}

function sameDate(left: Date | null | undefined, right: Date | null | undefined): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.toISOString() === right.toISOString();
}
