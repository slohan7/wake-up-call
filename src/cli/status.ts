#!/usr/bin/env node

import { serializeBrief, serializeDeliveryLog, serializeWorkflowRun } from '../api/serializers';
import { DatabaseService } from '../db/database';

async function showStatus() {
  const db = new DatabaseService();

  try {
    const latestRun = db.getLatestWorkflowRun();
    if (!latestRun) {
      console.log('No daily brief runs recorded yet.');
      return;
    }

    const run = serializeWorkflowRun(latestRun);
    const brief = latestRun.brief_id ? db.getBrief(latestRun.brief_id) : null;
    const serializedBrief = brief ? serializeBrief(brief) : null;
    const deliveryLogs = brief?.id
      ? db.getDeliveryLogsForBrief(brief.id).map(serializeDeliveryLog)
      : [];
    const smsStatus = deliveryLogs.find(log => log.deliveryType === 'sms')?.status || run.smsStatus || 'n/a';
    const voiceStatus = deliveryLogs.find(log => log.deliveryType === 'voice')?.status || run.voiceStatus || 'n/a';
    const recentSmokeRuns = db.getLatestWorkflowRuns('smoke_test', 5).map(serializeWorkflowRun);

    console.log('\n📊 FOUNDER DAILY BRIEF STATUS\n');
    console.log('Latest daily run:');
    console.log(`  Run ID: ${run.id}`);
    console.log(`  Date: ${run.date}`);
    console.log(`  Trigger: ${run.trigger}`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Dry Run: ${run.dryRun ? 'YES' : 'NO'}`);
    console.log(`  SMS: ${smsStatus}`);
    console.log(`  Voice: ${voiceStatus}`);
    console.log(`  Integration Failures: ${run.integrationFailures.length > 0 ? run.integrationFailures.join(', ') : 'none'}`);

    if (serializedBrief) {
      console.log('\nStored brief:');
      console.log(`  Brief ID: ${serializedBrief.id}`);
      console.log(`  Brief Date: ${serializedBrief.date}`);
      console.log(`  Priority: ${serializedBrief.priorityScore}/10`);
      console.log(`  High Priority: ${serializedBrief.isHighPriority ? 'YES' : 'NO'}`);
    }

    if (deliveryLogs.length > 0) {
      console.log('\nDelivery logs:');
      for (const log of deliveryLogs) {
        console.log(`  - ${log.deliveryType}: ${log.status}${log.errorMessage ? ` (${log.errorMessage})` : ''}`);
      }
    }

    if (recentSmokeRuns.length > 0) {
      console.log('\nRecent smoke tests:');
      for (const smokeRun of recentSmokeRuns) {
        const summary = typeof smokeRun.metadata?.summary === 'string'
          ? ` - ${smokeRun.metadata.summary}`
          : '';
        console.log(`  - ${smokeRun.date} ${smokeRun.trigger}: ${smokeRun.status}${summary}`);
      }
    }

    console.log('');
  } catch (error) {
    console.error('Failed to read status:', error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  showStatus().catch(console.error);
}

export { showStatus };
