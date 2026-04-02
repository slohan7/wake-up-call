export const SAMPLE_SEED_PEOPLE = [
  {
    email: 'john.doe@company.com',
    name: 'John Doe',
    company: 'Acme Corp',
  },
  {
    email: 'jane.smith@partner.com',
    name: 'Jane Smith',
    company: 'Partner Co',
  },
  {
    email: 'bob.wilson@client.com',
    name: 'Bob Wilson',
    company: 'Client Inc',
  },
  {
    email: 'sarah.jones@investor.com',
    name: 'Sarah Jones',
    company: 'VC Fund',
  },
] as const;

export const SAMPLE_SEED_TASK_TITLES = [
  'Review Q4 financial reports',
  'Prepare product roadmap presentation',
  'Schedule team 1:1s',
  'Review marketing campaign metrics',
] as const;

export const SAMPLE_SEED_FOLLOW_UPS = [
  {
    personEmail: 'sarah.jones@investor.com',
    subject: 'Term sheet discussion',
  },
  {
    personEmail: 'jane.smith@partner.com',
    subject: 'Partnership proposal',
  },
  {
    personEmail: 'bob.wilson@client.com',
    subject: 'Contract renewal',
  },
] as const;

export const SAMPLE_SEED_MEETING_IDS = [
  'sample-meeting-1',
  'sample-meeting-2',
  'sample-meeting-3',
] as const;
