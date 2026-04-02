import { DatabaseService } from '../db/database';
import {
  SAMPLE_SEED_FOLLOW_UPS,
  SAMPLE_SEED_MEETING_IDS,
  SAMPLE_SEED_PEOPLE,
  SAMPLE_SEED_TASK_TITLES,
} from '../db/sample-data';

export interface SampleDataStatus {
  hasSampleData: boolean;
  people: number;
  tasks: number;
  followUps: number;
  meetings: number;
}

export interface SampleDataPurgeResult {
  deleted: {
    people: number;
    tasks: number;
    followUps: number;
    meetings: number;
  };
  remaining: SampleDataStatus;
}

export function detectSampleData(db: DatabaseService): SampleDataStatus {
  const people = SAMPLE_SEED_PEOPLE.filter(seedPerson => {
    const person = db.getPersonByEmail(seedPerson.email);
    return (
      !!person &&
      person.name === seedPerson.name &&
      (person.company || null) === (seedPerson.company || null)
    );
  }).length;

  const tasks = SAMPLE_SEED_TASK_TITLES.filter(title => !!db.getTaskByTitle(title)).length;

  const followUps = SAMPLE_SEED_FOLLOW_UPS.filter(seedFollowUp => {
    const person = db.getPersonByEmail(seedFollowUp.personEmail);
    return !!person && !!db.getFollowUpByPersonAndSubject(person.id!, seedFollowUp.subject);
  }).length;

  const meetings = SAMPLE_SEED_MEETING_IDS.filter(meetingId => !!db.getMeetingByCalendarId(meetingId)).length;

  return {
    hasSampleData: people > 0 || tasks > 0 || followUps > 0 || meetings > 0,
    people,
    tasks,
    followUps,
    meetings,
  };
}

export function purgeSampleData(db: DatabaseService): SampleDataPurgeResult {
  const deleted = {
    people: 0,
    tasks: 0,
    followUps: 0,
    meetings: 0,
  };

  for (const meetingId of SAMPLE_SEED_MEETING_IDS) {
    if (db.getMeetingByCalendarId(meetingId)) {
      db.deleteMeetingByCalendarId(meetingId);
      deleted.meetings += 1;
    }
  }

  for (const title of SAMPLE_SEED_TASK_TITLES) {
    if (db.getTaskByTitle(title)) {
      db.deleteTaskByTitle(title);
      deleted.tasks += 1;
    }
  }

  for (const seedFollowUp of SAMPLE_SEED_FOLLOW_UPS) {
    const person = db.getPersonByEmail(seedFollowUp.personEmail);
    if (!person) {
      continue;
    }

    const existing = db.getFollowUpByPersonAndSubject(person.id!, seedFollowUp.subject);
    if (existing) {
      db.deleteFollowUpByPersonAndSubject(person.id!, seedFollowUp.subject);
      deleted.followUps += 1;
    }
  }

  for (const seedPerson of SAMPLE_SEED_PEOPLE) {
    const person = db.getPersonByEmail(seedPerson.email);
    if (!person) {
      continue;
    }

    const isExactSampleMatch =
      person.name === seedPerson.name &&
      (person.company || null) === (seedPerson.company || null);

    if (!isExactSampleMatch) {
      continue;
    }

    if (db.countFollowUpsForPerson(person.id!) === 0) {
      db.deletePersonByEmail(seedPerson.email);
      deleted.people += 1;
    }
  }

  return {
    deleted,
    remaining: detectSampleData(db),
  };
}
