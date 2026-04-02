#!/usr/bin/env node

import { createDailyBriefWorkflow } from '../workflows/daily-brief-workflow';
import { DatabaseService } from '../db/database';
import { config } from '../utils/config';
import { formatLocalDate, formatLocalTime } from '../utils/date';
import { getConfiguredLLMDisplayName, hasConfiguredLiveLLMKey } from '../services/llm-provider';
import { detectSampleData } from '../services/sample-data';

async function dryRun() {
  console.log('\n🔧 FOUNDER DAILY BRIEF - DRY RUN MODE\n');
  console.log('=' .repeat(50));
  console.log(`Date: ${formatLocalDate(new Date(), 'EEEE, MMMM d, yyyy')}`);
  console.log(`Time: ${formatLocalTime(new Date())}`);
  console.log(`Timezone: ${config.TIMEZONE}`);
  console.log('=' .repeat(50));

  const sampleDb = new DatabaseService();
  try {
    const sampleDataStatus = detectSampleData(sampleDb);
    if (sampleDataStatus.hasSampleData) {
      console.log('\n⚠️  SAMPLE DATA DETECTED');
      console.log(
        `Your local DB still contains sample seed records (${sampleDataStatus.people} people, ${sampleDataStatus.tasks} tasks, ${sampleDataStatus.followUps} follow-ups, ${sampleDataStatus.meetings} meetings).`
      );
      console.log('Those records can contaminate the brief until you purge them or replace them with real data.');
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
      console.log('\n📊 Generating brief...\n');
      
      const result = await workflow.execute({
        dryRun: true,
        forceVoice: true, // Always preview the voice output in dry-run mode
        trigger: 'dry-run',
      });

      brief = result.brief;
      deliveryResults = result.deliveryResults;
    } finally {
      workflow.close();
    }

    // Display full brief
    console.log('\n' + '='.repeat(50));
    console.log('FULL BRIEF');
    console.log('='.repeat(50));
    console.log(brief.full_content);

    // Display SMS brief
    console.log('\n' + '='.repeat(50));
    console.log(`SMS BRIEF (${brief.sms_content.length} chars)`);
    console.log('='.repeat(50));
    console.log(brief.sms_content);

    // Display voice brief
    console.log('\n' + '='.repeat(50));
    console.log(`VOICE BRIEF (~${brief.voice_content.split(' ').length / 2.5} seconds)`);
    console.log('='.repeat(50));
    console.log(brief.voice_content);

    // Display metadata
    console.log('\n' + '='.repeat(50));
    console.log('METADATA');
    console.log('='.repeat(50));
    console.log(`Priority Score: ${brief.priority_score}/10`);
    console.log(`High Priority Day: ${brief.is_high_priority ? 'YES' : 'NO'}`);
    console.log(`Brief ID: ${brief.id ?? 'dry-run (not stored)'}`);
    console.log(`Created: ${formatLocalTime(brief.created_at!)}`);

    // Display delivery simulation
    console.log('\n' + '='.repeat(50));
    console.log('DELIVERY SIMULATION');
    console.log('='.repeat(50));
    
    if (config.ENABLE_SMS) {
      console.log(`✅ SMS would be sent to: ${config.RECIPIENT_PHONE_NUMBER || 'NOT CONFIGURED'}`);
    } else {
      console.log('⏭️  SMS delivery is disabled');
    }

    if (brief.voice_content) {
      console.log(`✅ Voice call would be made to: ${config.RECIPIENT_PHONE_NUMBER || 'NOT CONFIGURED'}`);
    } else {
      console.log('⏭️  Voice call delivery is disabled');
    }

    // Check configuration
    console.log('\n' + '='.repeat(50));
    console.log('CONFIGURATION STATUS');
    console.log('='.repeat(50));
    
    const checks = [
      { name: 'Database', status: true },
      { name: 'Google Calendar', status: !!config.GOOGLE_REFRESH_TOKEN },
      { name: 'Gmail', status: !!config.GOOGLE_REFRESH_TOKEN },
      { name: 'Twilio SMS', status: !!config.TWILIO_ACCOUNT_SID },
      { name: 'Twilio Voice', status: !!config.TWILIO_ACCOUNT_SID },
      {
        name: hasConfiguredLiveLLMKey()
          ? `${getConfiguredLLMDisplayName()}`
          : 'Mock brief generation',
        status: true,
      },
    ];

    checks.forEach(check => {
      console.log(`${check.status ? '✅' : '❌'} ${check.name}`);
    });

    // Delivery results
    if (deliveryResults.length > 0) {
      console.log('\n' + '='.repeat(50));
      console.log('DELIVERY LOGS');
      console.log('='.repeat(50));
      
      deliveryResults.forEach(log => {
        const icon = log.status === 'sent' ? '✅' : '❌';
        console.log(`${icon} ${log.delivery_type.toUpperCase()}: ${log.status}`);
        if (log.error_message) {
          console.log(`   Error: ${log.error_message}`);
        }
      });
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ DRY RUN COMPLETED SUCCESSFULLY');
    console.log('='.repeat(50));
    console.log('\nTo send the brief for real, run: npm run generate-brief');
    console.log('To enable automatic daily delivery, configure the n8n workflow.\n');

  } catch (error) {
    console.error('\n❌ DRY RUN FAILED');
    console.error(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  dryRun().catch(console.error);
}

export { dryRun };
