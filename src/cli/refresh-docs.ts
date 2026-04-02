#!/usr/bin/env node

import { join } from 'path';
import { DatabaseService } from '../db/database';
import { GmailIntegration } from '../integrations/gmail';
import { GoogleCalendarIntegration } from '../integrations/google-calendar';
import { ProtonBridgeIntegration } from '../integrations/proton-bridge';
import { UnifiedInboxService } from '../services/inbox-service';
import { LivingDocsService } from '../services/living-docs';
import { detectSampleData } from '../services/sample-data';
import { parseInputDate } from '../utils/date';

async function refreshDocs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Founder Daily Brief Living Docs

Usage:
  npm run refresh-docs [options]

Options:
  --date YYYY-MM-DD       Generate docs for a specific local day
  --output-dir PATH       Write files to a custom directory
  --help, -h              Show this help message

Examples:
  npm run refresh-docs
  npm run refresh-docs -- --date 2026-04-02
  npm run refresh-docs -- --output-dir ./living-docs
`);
    process.exit(0);
  }

  const dateIndex = args.indexOf('--date');
  const outputDirIndex = args.indexOf('--output-dir');

  const dateArg = dateIndex !== -1 ? args[dateIndex + 1] : undefined;
  const outputDir = outputDirIndex !== -1 ? args[outputDirIndex + 1] : undefined;
  const parsedDate = dateArg ? parseInputDate(dateArg) : new Date();

  if (!parsedDate) {
    throw new Error('Invalid date format. Use YYYY-MM-DD.');
  }

  const db = new DatabaseService();
  const gmail = new GmailIntegration();
  const proton = new ProtonBridgeIntegration();
  const inbox = new UnifiedInboxService([gmail, proton]);
  const calendar = new GoogleCalendarIntegration();
  const service = new LivingDocsService({ db, inbox, calendar });

  try {
    const sampleDataStatus = detectSampleData(db);
    if (sampleDataStatus.hasSampleData) {
      console.log('\n⚠️  SAMPLE DATA DETECTED');
      console.log(
        `Your local DB still contains sample seed records (${sampleDataStatus.people} people, ${sampleDataStatus.tasks} tasks, ${sampleDataStatus.followUps} follow-ups, ${sampleDataStatus.meetings} meetings).`
      );
      console.log('Those records can appear in people/tasks/follow-up docs until you purge them.');
      console.log('Run: npm run db:purge-sample-data\n');
    }

    const result = await service.refresh({
      date: parsedDate,
      outputDir: outputDir ? join(process.cwd(), outputDir) : undefined,
    });

    console.log('\n📝 FOUNDER DAILY BRIEF LIVING DOCS\n');
    console.log(`Output directory: ${result.outputDir}`);
    console.log(`Email: ${result.integrationStatus.email}`);
    console.log(`Calendar: ${result.integrationStatus.calendar}`);
    console.log('');
    console.log(`People doc: ${result.files.people}`);
    console.log(`Tasks doc: ${result.files.tasks}`);
    console.log(`Follow-ups doc: ${result.files.followUps}`);
    console.log('');
    console.log(`Ranked people: ${result.counts.peopleRanked}`);
    console.log(`Active tasks: ${result.counts.tasksActive}`);
    console.log(`Suggested tasks: ${result.counts.taskSuggestions}`);
    console.log(`Active follow-ups: ${result.counts.followUpsActive}`);
    console.log(`Suggested follow-ups: ${result.counts.followUpSuggestions}`);
    console.log('');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  refreshDocs().catch(error => {
    console.error('\n❌ Failed to refresh living docs:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { refreshDocs };
