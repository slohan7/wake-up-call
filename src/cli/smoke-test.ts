#!/usr/bin/env node

import { serializeWorkflowRun } from '../api/serializers';
import { DatabaseService } from '../db/database';
import { GmailIntegration } from '../integrations/gmail';
import { GoogleCalendarIntegration } from '../integrations/google-calendar';
import { ProtonBridgeIntegration } from '../integrations/proton-bridge';
import { TwilioIntegration } from '../integrations/twilio';
import type { SmokeTarget } from '../services/smoke-test';
import { runSmokeTest } from '../services/smoke-test';
import { getLocalDateKey, parseInputDate } from '../utils/date';

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function resolveTargets(args: string[]): SmokeTarget[] {
  const explicitTargets: SmokeTarget[] = [];

  if (args.includes('--calendar')) explicitTargets.push('calendar');
  if (args.includes('--gmail')) explicitTargets.push('gmail');
  if (args.includes('--proton')) explicitTargets.push('proton');
  if (args.includes('--llm') || args.includes('--anthropic') || args.includes('--openai')) explicitTargets.push('llm');
  if (args.includes('--sms')) explicitTargets.push('sms');
  if (args.includes('--voice')) explicitTargets.push('voice');

  const includeVoice = args.includes('--with-voice');

  if (explicitTargets.length > 0) {
    if (includeVoice && !explicitTargets.includes('voice')) {
      explicitTargets.push('voice');
    }
    return explicitTargets;
  }

  const fullTargets: SmokeTarget[] = ['calendar', 'gmail', 'llm', 'sms'];
  if (includeVoice) {
    fullTargets.push('voice');
  }

  return fullTargets;
}

async function smokeTest() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Founder Daily Brief Smoke Test

Usage: npm run smoke-test [options]

Options:
  --full              Run calendar, gmail, llm, and sms smoke tests
  --calendar          Run only the Google Calendar smoke test
  --gmail             Run only the Gmail smoke test
  --proton            Run only the Proton Mail Bridge smoke test
  --llm               Run only the configured LLM smoke test
  --anthropic         Alias for --llm
  --openai            Alias for --llm
  --sms               Run only the SMS smoke test
  --voice             Run only the voice smoke test
  --with-voice        Add the voice smoke test to a full run
  --force-send        Bypass same-day smoke-test send suppression
  --sms-to NUMBER     Override the SMS smoke-test recipient
  --voice-to NUMBER   Override the voice smoke-test recipient
  --date YYYY-MM-DD   Use a specific local date key for the smoke test
  --help, -h          Show this help message

Examples:
  npm run smoke-test
  npm run smoke-test -- --calendar
  npm run smoke-test -- --sms --sms-to +15551234567
  npm run smoke-test -- --full --with-voice --force-send
`);
    return;
  }

  const parsedDateValue = getArgValue(args, '--date');
  const parsedDate = parsedDateValue ? parseInputDate(parsedDateValue) : new Date();
  if (!parsedDate) {
    console.error('Invalid date format. Use YYYY-MM-DD');
    process.exitCode = 1;
    return;
  }

  const targets = resolveTargets(args);
  const dateKey = getLocalDateKey(parsedDate);
  const forceSend = args.includes('--force-send');
  const smsTo = getArgValue(args, '--sms-to');
  const voiceTo = getArgValue(args, '--voice-to');

  console.log('\n🧪 FOUNDER DAILY BRIEF SMOKE TEST\n');
  console.log('Mode: LIVE SMOKE TEST');
  console.log('Date:', dateKey);
  console.log('Targets:', targets.join(', '));
  console.log('Force Send:', forceSend ? 'YES' : 'NO');
  console.log('Dry Run Override: smoke tests ignore DRY_RUN_MODE');
  console.log('');

  const db = new DatabaseService();
  const calendar = new GoogleCalendarIntegration();
  const gmail = new GmailIntegration();
  const proton = new ProtonBridgeIntegration();
  const twilio = new TwilioIntegration();

  try {
    const result = await runSmokeTest(
      {
        targets,
        date: parsedDate,
        forceSend,
        smsTo,
        voiceTo,
      },
      {
        db,
        calendar,
        gmail,
        proton,
        twilio,
      }
    );

    for (const smokeResult of result.results) {
      const label = smokeResult.status.toUpperCase().padEnd(10, ' ');
      console.log(`${label} ${smokeResult.target.padEnd(8, ' ')} ${smokeResult.summary}`);
    }

    if (result.generatedBrief) {
      console.log('\nGenerated brief preview:');
      console.log(`  Date: ${result.generatedBrief.date}`);
      console.log(`  Priority: ${result.generatedBrief.priorityScore}/10`);
      console.log(`  High Priority: ${result.generatedBrief.isHighPriority ? 'YES' : 'NO'}`);
      console.log(`  SMS Preview: ${result.generatedBrief.smsContent}`);
    }

    const latestRuns = targets
      .flatMap(target => {
        const run = db.getLatestSmokeRunForDate(parsedDate, target);
        return run ? [serializeWorkflowRun(run)] : [];
      })
      .sort((a, b) => a.trigger.localeCompare(b.trigger));

    if (latestRuns.length > 0) {
      console.log('\nRecorded smoke-test runs:');
      for (const run of latestRuns) {
        console.log(`  - ${run.trigger}: ${run.status} (${run.date})`);
      }
    }

    const hasFailures = result.results.some(item => item.status === 'failed');
    console.log('');
    process.exitCode = hasFailures ? 1 : 0;
  } catch (error) {
    console.error('Smoke test failed unexpectedly:', error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  smokeTest().catch(console.error);
}

export { smokeTest };
