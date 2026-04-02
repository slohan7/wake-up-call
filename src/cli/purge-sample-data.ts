#!/usr/bin/env node

import { DatabaseService } from '../db/database';
import { detectSampleData, purgeSampleData } from '../services/sample-data';

async function purgeSampleDataCli() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Founder Daily Brief Sample Data Cleanup

Usage:
  npm run db:purge-sample-data [options]

Options:
  --dry-run         Show what would be removed without writing
  --help, -h        Show this help message
`);
    process.exit(0);
  }

  const db = new DatabaseService();

  try {
    const before = detectSampleData(db);

    console.log('\n🧹 SAMPLE DATA CHECK\n');
    console.log(`People: ${before.people}`);
    console.log(`Tasks: ${before.tasks}`);
    console.log(`Follow-ups: ${before.followUps}`);
    console.log(`Meetings: ${before.meetings}`);
    console.log('');

    if (!before.hasSampleData) {
      console.log('No known sample seed data found.\n');
      process.exit(0);
    }

    if (dryRun) {
      console.log('Dry run only. No records were deleted.\n');
      process.exit(0);
    }

    const result = purgeSampleData(db);

    console.log('Deleted:');
    console.log(`- People: ${result.deleted.people}`);
    console.log(`- Tasks: ${result.deleted.tasks}`);
    console.log(`- Follow-ups: ${result.deleted.followUps}`);
    console.log(`- Meetings: ${result.deleted.meetings}`);
    console.log('');
    console.log('Remaining known sample records:');
    console.log(`- People: ${result.remaining.people}`);
    console.log(`- Tasks: ${result.remaining.tasks}`);
    console.log(`- Follow-ups: ${result.remaining.followUps}`);
    console.log(`- Meetings: ${result.remaining.meetings}`);
    console.log('');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  purgeSampleDataCli().catch(error => {
    console.error('\n❌ Failed to purge sample data:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { purgeSampleDataCli };
