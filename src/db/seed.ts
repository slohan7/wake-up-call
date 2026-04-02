#!/usr/bin/env node

import { addDays, subDays } from 'date-fns';
import { DatabaseService } from './database';
import {
  SAMPLE_SEED_FOLLOW_UPS,
  SAMPLE_SEED_MEETING_IDS,
  SAMPLE_SEED_PEOPLE,
  SAMPLE_SEED_TASK_TITLES,
} from './sample-data';

function getSeedPeople() {
  return [
    {
      ...SAMPLE_SEED_PEOPLE[0],
      importance: 8,
      last_contact: subDays(new Date(), 14),
    },
    {
      ...SAMPLE_SEED_PEOPLE[1],
      importance: 9,
      last_contact: subDays(new Date(), 7),
    },
    {
      ...SAMPLE_SEED_PEOPLE[2],
      importance: 7,
      last_contact: subDays(new Date(), 21),
    },
    {
      ...SAMPLE_SEED_PEOPLE[3],
      importance: 10,
      last_contact: subDays(new Date(), 3),
    },
  ];
}

function getSeedTasks() {
  return [
    {
      title: SAMPLE_SEED_TASK_TITLES[0],
      description: 'Analyze revenue trends and prepare summary for board',
      due_date: new Date(),
      priority: 'urgent' as const,
      status: 'pending' as const,
      category: 'Finance',
    },
    {
      title: SAMPLE_SEED_TASK_TITLES[1],
      description: 'Update slides for next week\'s all-hands',
      due_date: addDays(new Date(), 2),
      priority: 'high' as const,
      status: 'in_progress' as const,
      category: 'Product',
    },
    {
      title: SAMPLE_SEED_TASK_TITLES[2],
      description: 'Book recurring meetings with direct reports',
      due_date: addDays(new Date(), 3),
      priority: 'medium' as const,
      status: 'pending' as const,
      category: 'Management',
    },
    {
      title: SAMPLE_SEED_TASK_TITLES[3],
      description: 'Assess Q3 campaign performance',
      due_date: subDays(new Date(), 2),
      priority: 'high' as const,
      status: 'pending' as const,
      category: 'Marketing',
    },
  ];
}

function getSeedMeetings() {
  const now = new Date();
  return [
    {
      calendar_id: SAMPLE_SEED_MEETING_IDS[0],
      title: 'Team Standup',
      start_time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0),
      end_time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30),
      attendees: ['team@company.com'],
      location: 'Zoom',
      description: 'Daily team sync',
      prep_notes: 'Review sprint board, discuss blockers',
      importance_score: 6,
    },
    {
      calendar_id: SAMPLE_SEED_MEETING_IDS[1],
      title: 'Investor Update Call',
      start_time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0),
      end_time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0),
      attendees: ['sarah.jones@investor.com', 'john.doe@company.com'],
      location: 'Conference Room A',
      description: 'Monthly investor update',
      prep_notes: 'Prepare metrics dashboard, discuss runway',
      importance_score: 9,
    },
    {
      calendar_id: SAMPLE_SEED_MEETING_IDS[2],
      title: 'Product Review',
      start_time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0),
      end_time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0),
      attendees: ['product@company.com', 'engineering@company.com'],
      location: null,
      description: 'Review new feature designs',
      prep_notes: null,
      importance_score: 7,
    },
  ];
}

export function seedDatabase(db: DatabaseService) {
  const createdCounts = {
    people: 0,
    tasks: 0,
    followUps: 0,
    meetings: 0,
  };

  const skippedCounts = {
    people: 0,
    tasks: 0,
    followUps: 0,
    meetings: 0,
  };

  const people = getSeedPeople().map(person => {
    const existing = db.getPersonByEmail(person.email);
    if (existing) {
      skippedCounts.people += 1;
      return existing;
    }

    createdCounts.people += 1;
    return db.createPerson(person);
  });

  for (const task of getSeedTasks()) {
    const existing = db.getTaskByTitle(task.title);
    if (existing) {
      skippedCounts.tasks += 1;
      continue;
    }

    db.createTask(task);
    createdCounts.tasks += 1;
  }

  const followUps = [
    {
      person_id: people[3].id!,
      subject: SAMPLE_SEED_FOLLOW_UPS[0].subject,
      context: 'Follow up on Series A funding terms',
      due_date: subDays(new Date(), 1),
      status: 'pending' as const,
      priority: 10,
    },
    {
      person_id: people[1].id!,
      subject: SAMPLE_SEED_FOLLOW_UPS[1].subject,
      context: 'Send updated partnership terms',
      due_date: new Date(),
      status: 'pending' as const,
      priority: 8,
    },
    {
      person_id: people[2].id!,
      subject: SAMPLE_SEED_FOLLOW_UPS[2].subject,
      context: 'Discuss renewal terms for next year',
      due_date: addDays(new Date(), 3),
      status: 'pending' as const,
      priority: 6,
    },
  ];

  for (const followUp of followUps) {
    const existing = db.getFollowUpByPersonAndSubject(followUp.person_id, followUp.subject);
    if (existing) {
      skippedCounts.followUps += 1;
      continue;
    }

    db.createFollowUp(followUp);
    createdCounts.followUps += 1;
  }

  for (const meeting of getSeedMeetings()) {
    const existing = db.getMeetingByCalendarId(meeting.calendar_id);
    db.upsertMeeting(meeting);
    if (existing) {
      skippedCounts.meetings += 1;
    } else {
      createdCounts.meetings += 1;
    }
  }

  return {
    createdCounts,
    skippedCounts,
    totals: {
      people: getSeedPeople().length,
      tasks: getSeedTasks().length,
      followUps: followUps.length,
      meetings: getSeedMeetings().length,
    },
  };
}

async function seed() {
  console.log('🌱 Seeding database with sample data...\n');
  
  try {
    const db = new DatabaseService();

    const result = seedDatabase(db);
    db.close();
    
    console.log('\n✅ Database seed completed successfully!');
    console.log('\nCreated:');
    console.log(`  - ${result.createdCounts.people} people`);
    console.log(`  - ${result.createdCounts.tasks} tasks`);
    console.log(`  - ${result.createdCounts.followUps} follow-ups`);
    console.log(`  - ${result.createdCounts.meetings} meetings`);
    console.log('\nSkipped because they already existed:');
    console.log(`  - ${result.skippedCounts.people} people`);
    console.log(`  - ${result.skippedCounts.tasks} tasks`);
    console.log(`  - ${result.skippedCounts.followUps} follow-ups`);
    console.log(`  - ${result.skippedCounts.meetings} meetings`);
    console.log('\n✨ You can now run: npm run dry-run\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  seed().catch(console.error);
}

export { seed };
