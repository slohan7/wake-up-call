#!/usr/bin/env node

import { DatabaseService } from '../db/database';
import { detectSampleData } from '../services/sample-data';
import { createDailyBriefWorkflow } from '../workflows/daily-brief-workflow';
import { config } from '../utils/config';
import { formatLocalDate, parseInputDate } from '../utils/date';

async function generateBrief() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const options = {
    dryRun: args.includes('--dry-run'),
    skipDelivery: args.includes('--skip-delivery'),
    forceRegenerate: args.includes('--force'),
    forceDelivery: args.includes('--force-delivery'),
    enableVoice: config.ENABLE_VOICE_CALLS,
    forceVoice: args.includes('--with-voice'),
    date: new Date(),
    trigger: 'cli',
  };

  // Check for date argument
  const dateIndex = args.indexOf('--date');
  if (dateIndex !== -1 && args[dateIndex + 1]) {
    const parsedDate = parseInputDate(args[dateIndex + 1]);
    if (!parsedDate) {
      console.error('Invalid date format. Use YYYY-MM-DD');
      process.exit(1);
    }
    options.date = parsedDate;
  }

  // Check for help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Founder Daily Brief Generator

Usage: npm run generate-brief [options]

Options:
  --dry-run         Simulate delivery without actually sending
  --skip-delivery   Generate brief but don't send it
  --force           Regenerate even if brief exists for today
  --force-delivery  Bypass duplicate delivery suppression for this run
  --with-voice      Include voice call delivery
  --date YYYY-MM-DD Generate brief for specific date
  --help, -h        Show this help message

Examples:
  npm run generate-brief                    # Generate and send today's brief
  npm run generate-brief --dry-run          # Test without sending
  npm run generate-brief --skip-delivery    # Generate only, don't send
  npm run generate-brief --date 2024-03-15  # Generate for specific date
`);
    process.exit(0);
  }

  console.log('\n📬 FOUNDER DAILY BRIEF GENERATOR\n');
  console.log('Date:', formatLocalDate(options.date, 'EEEE, MMMM d, yyyy'));
  console.log('Mode:', options.dryRun ? 'DRY RUN' : 'LIVE');
  console.log('Delivery:', options.skipDelivery ? 'DISABLED' : 'ENABLED');
  console.log('Force Delivery:', options.forceDelivery ? 'YES' : 'NO');
  console.log('Voice:', options.forceVoice || options.enableVoice ? 'ENABLED' : 'DISABLED');
  console.log('');

  const sampleDb = new DatabaseService();
  try {
    const sampleDataStatus = detectSampleData(sampleDb);
    if (sampleDataStatus.hasSampleData) {
      console.log('⚠️  SAMPLE DATA DETECTED');
      console.log(
        `Your local DB still contains sample seed records (${sampleDataStatus.people} people, ${sampleDataStatus.tasks} tasks, ${sampleDataStatus.followUps} follow-ups, ${sampleDataStatus.meetings} meetings).`
      );
      console.log('Those records can show up as fake priorities until you purge them or replace them with real data.');
      console.log('Run: npm run db:purge-sample-data\n');
    }
  } finally {
    sampleDb.close();
  }

  try {
    const workflow = createDailyBriefWorkflow();
    let brief;
    let deliveryResults;

    try {
      const result = await workflow.execute(options);
      brief = result.brief;
      deliveryResults = result.deliveryResults;
    } finally {
      workflow.close();
    }

    console.log('✅ Brief generated successfully!');
    console.log(`   Priority Score: ${brief.priority_score}/10`);
    console.log(`   High Priority: ${brief.is_high_priority ? 'YES' : 'NO'}`);

    if (deliveryResults.length > 0) {
      console.log('\n📨 Delivery Results:');
      deliveryResults.forEach(log => {
        const icon = log.status === 'sent' ? '✅' : '❌';
        console.log(`   ${icon} ${log.delivery_type.toUpperCase()}: ${log.status}`);
        if (log.error_message) {
          console.log(`      Error: ${log.error_message}`);
        }
      });
    } else if (!options.skipDelivery) {
      console.log('\n⚠️  No delivery methods configured or enabled');
    }

    console.log('\n✨ Done!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Failed to generate brief:');
    console.error(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  generateBrief().catch(console.error);
}

export { generateBrief };
