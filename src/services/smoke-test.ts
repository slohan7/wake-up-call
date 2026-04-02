import { serializeBrief } from '../api/serializers';
import { DatabaseService } from '../db/database';
import { GmailIntegration } from '../integrations/gmail';
import { GoogleCalendarIntegration } from '../integrations/google-calendar';
import { ProtonBridgeIntegration } from '../integrations/proton-bridge';
import { TwilioIntegration } from '../integrations/twilio';
import type { BriefContext, GeneratedBrief } from '../models/types';
import { BriefGeneratorService } from './brief-generator';
import { UnifiedInboxService } from './inbox-service';
import {
  createLLMProvider,
  getConfiguredLLMDisplayName,
  hasConfiguredLiveLLMKey,
} from './llm-provider';
import { config } from '../utils/config';
import { getLocalDateKey } from '../utils/date';

export type SmokeTarget = 'calendar' | 'gmail' | 'proton' | 'llm' | 'sms' | 'voice';

export interface SmokeTestResult {
  target: SmokeTarget;
  status: 'passed' | 'failed' | 'suppressed' | 'skipped';
  summary: string;
  details?: Record<string, unknown>;
}

export interface SmokeTestOptions {
  targets: SmokeTarget[];
  date?: Date;
  forceSend?: boolean;
  smsTo?: string;
  voiceTo?: string;
}

export interface SmokeTestDependencies {
  db: DatabaseService;
  calendar: GoogleCalendarIntegration;
  gmail: GmailIntegration;
  proton: ProtonBridgeIntegration;
  twilio: TwilioIntegration;
  briefGeneratorFactory?: () => BriefGeneratorService;
}

function defaultDependencies(): SmokeTestDependencies {
  return {
    db: new DatabaseService(),
    calendar: new GoogleCalendarIntegration(),
    gmail: new GmailIntegration(),
    proton: new ProtonBridgeIntegration(),
    twilio: new TwilioIntegration(),
    briefGeneratorFactory: () => new BriefGeneratorService(),
  };
}

export async function runSmokeTest(
  options: SmokeTestOptions,
  dependencies: SmokeTestDependencies = defaultDependencies()
): Promise<{
  results: SmokeTestResult[];
  generatedBrief?: ReturnType<typeof serializeBrief>;
}> {
  const {
    db,
    calendar,
    gmail,
    proton,
    twilio,
    briefGeneratorFactory = () => new BriefGeneratorService(),
  } = dependencies;
  const date = options.date ?? new Date();
  const dateKey = getLocalDateKey(date);
  const results: SmokeTestResult[] = [];
  let generatedBrief: GeneratedBrief | null = null;

  const calendarResult = options.targets.includes('calendar') || options.targets.includes('llm')
    ? await runCalendarCheck(calendar, db, date, dateKey)
    : null;
  if (calendarResult && options.targets.includes('calendar')) {
    results.push(calendarResult.result);
  }

  const gmailResult = options.targets.includes('gmail') || options.targets.includes('llm')
    ? await runGmailCheck(gmail, db, dateKey)
    : null;
  if (gmailResult && options.targets.includes('gmail')) {
    results.push(gmailResult.result);
  }

  const protonResult = options.targets.includes('proton')
    ? await runProtonCheck(proton, db, dateKey)
    : null;
  if (protonResult) {
    results.push(protonResult.result);
  }

  if (options.targets.includes('llm')) {
    const inbox = new UnifiedInboxService([gmail, proton]);
    const inboxEmails = await inbox.getImportantEmails(10);
    const llmCheck = await runLLMCheck({
      db,
      briefGeneratorFactory,
      date,
      dateKey,
      meetings: (calendarResult?.events || []).map(event => ({
        calendar_id: event.id,
        title: event.summary,
        start_time: event.start,
        end_time: event.end,
        attendees: (event.attendees || []).map(attendee => attendee.email),
        location: event.location || null,
        description: event.description || null,
        prep_notes: null,
        importance_score: 5,
      })),
      emails: inboxEmails,
    });
    results.push(llmCheck.result);
    generatedBrief = llmCheck.generatedBrief;
  }

  if (options.targets.includes('sms')) {
    const smsResult = await runDeliverySmoke({
      db,
      twilio,
      date,
      dateKey,
      trigger: 'sms',
      recipient: options.smsTo || config.SMOKE_TEST_SMS_TO || config.RECIPIENT_PHONE_NUMBER,
      message: generatedBrief?.smsBrief || `Founder Daily Brief smoke test for ${dateKey}. SMS delivery path is working.`,
      forceSend: options.forceSend === true,
    });
    results.push(smsResult);
  }

  if (options.targets.includes('voice')) {
    const voiceResult = await runDeliverySmoke({
      db,
      twilio,
      date,
      dateKey,
      trigger: 'voice',
      recipient: options.voiceTo || config.SMOKE_TEST_VOICE_TO || config.RECIPIENT_PHONE_NUMBER,
      message: generatedBrief?.voiceBrief || `Founder Daily Brief voice smoke test for ${dateKey}. This confirms the voice delivery path is working.`,
      forceSend: options.forceSend === true,
    });
    results.push(voiceResult);
  }

  return {
    results,
    generatedBrief: generatedBrief
      ? serializeBrief({
          id: undefined,
          date,
          full_content: generatedBrief.fullBrief,
          sms_content: generatedBrief.smsBrief,
          voice_content: generatedBrief.voiceBrief,
          priority_score: generatedBrief.priorityScore,
          is_high_priority: generatedBrief.isHighPriority,
          created_at: new Date(),
        })
      : undefined,
  };
}

async function runCalendarCheck(
  calendar: GoogleCalendarIntegration,
  db: DatabaseService,
  date: Date,
  dateKey: string
): Promise<{ result: SmokeTestResult; events: Awaited<ReturnType<GoogleCalendarIntegration['getTodayEvents']>> }> {
  try {
    if (!calendar.isConfigured()) {
      return {
        events: [],
        result: recordSmokeResult(db, {
          trigger: 'calendar',
          dateKey,
          status: 'failed',
          summary: 'Google Calendar is not configured.',
        }),
      };
    }

    const connected = await calendar.testConnection();
    if (!connected) {
      return {
        events: [],
        result: recordSmokeResult(db, {
          trigger: 'calendar',
          dateKey,
          status: 'failed',
          summary: 'Google Calendar connection test failed.',
        }),
      };
    }

    const events = await calendar.getTodayEvents(date);
    return {
      events,
      result: recordSmokeResult(db, {
        trigger: 'calendar',
        dateKey,
        status: 'passed',
        summary: `Read ${events.length} calendar events for ${dateKey}.`,
        details: {
          sampleTitles: events.slice(0, 3).map(event => event.summary),
        },
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      events: [],
      result: recordSmokeResult(db, {
        trigger: 'calendar',
        dateKey,
        status: 'failed',
        summary: `Google Calendar smoke test failed: ${message}`,
      }),
    };
  }
}

async function runGmailCheck(
  gmail: GmailIntegration,
  db: DatabaseService,
  dateKey: string
): Promise<{ result: SmokeTestResult; emails: Awaited<ReturnType<GmailIntegration['getImportantEmails']>> }> {
  try {
    if (!gmail.isConfigured()) {
      return {
        emails: [],
        result: recordSmokeResult(db, {
          trigger: 'gmail',
          dateKey,
          status: 'failed',
          summary: 'Gmail is not configured.',
        }),
      };
    }

    const connected = await gmail.testConnection();
    if (!connected) {
      return {
        emails: [],
        result: recordSmokeResult(db, {
          trigger: 'gmail',
          dateKey,
          status: 'failed',
          summary: 'Gmail connection test failed.',
        }),
      };
    }

    const emails = await gmail.getImportantEmails(5);
    return {
      emails,
      result: recordSmokeResult(db, {
        trigger: 'gmail',
        dateKey,
        status: 'passed',
        summary: `Read ${emails.length} Gmail messages using the configured query.`,
        details: {
          sampleSubjects: emails.slice(0, 3).map(email => email.subject),
        },
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      emails: [],
      result: recordSmokeResult(db, {
        trigger: 'gmail',
        dateKey,
        status: 'failed',
        summary: `Gmail smoke test failed: ${message}`,
      }),
    };
  }
}

async function runProtonCheck(
  proton: ProtonBridgeIntegration,
  db: DatabaseService,
  dateKey: string
): Promise<{ result: SmokeTestResult; emails: Awaited<ReturnType<ProtonBridgeIntegration['getImportantEmails']>> }> {
  try {
    if (!proton.isConfigured()) {
      return {
        emails: [],
        result: recordSmokeResult(db, {
          trigger: 'proton',
          dateKey,
          status: 'failed',
          summary: 'Proton Mail Bridge is not configured.',
        }),
      };
    }

    const connected = await proton.testConnection();
    if (!connected) {
      return {
        emails: [],
        result: recordSmokeResult(db, {
          trigger: 'proton',
          dateKey,
          status: 'failed',
          summary: 'Proton Mail Bridge connection test failed.',
        }),
      };
    }

    const emails = await proton.getImportantEmails(5);
    return {
      emails,
      result: recordSmokeResult(db, {
        trigger: 'proton',
        dateKey,
        status: 'passed',
        summary: `Read ${emails.length} Proton Mail Bridge messages from ${config.PROTON_IMAP_MAILBOX}.`,
        details: {
          sampleSubjects: emails.slice(0, 3).map(email => email.subject),
        },
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      emails: [],
      result: recordSmokeResult(db, {
        trigger: 'proton',
        dateKey,
        status: 'failed',
        summary: `Proton Mail Bridge smoke test failed: ${message}`,
      }),
    };
  }
}

async function runLLMCheck(options: {
  db: DatabaseService;
  briefGeneratorFactory: () => BriefGeneratorService;
  date: Date;
  dateKey: string;
  meetings: BriefContext['meetings'];
  emails: BriefContext['emails'];
}): Promise<{ result: SmokeTestResult; generatedBrief: GeneratedBrief | null }> {
  const { db, briefGeneratorFactory, date, dateKey, meetings, emails } = options;
  const llmDisplayName = getConfiguredLLMDisplayName();

  try {
    if (config.LLM_PROVIDER === 'mock') {
      return {
        generatedBrief: null,
        result: recordSmokeResult(db, {
          trigger: 'llm',
          dateKey,
          status: 'failed',
          summary: 'LLM_PROVIDER is set to mock. Configure a live LLM provider for smoke testing.',
        }),
      };
    }

    if (!hasConfiguredLiveLLMKey()) {
      return {
        generatedBrief: null,
        result: recordSmokeResult(db, {
          trigger: 'llm',
          dateKey,
          status: 'failed',
          summary: `${llmDisplayName} API key is not configured.`,
        }),
      };
    }

    const briefGenerator = briefGeneratorFactory();
    briefGenerator.setLLMProvider(createLLMProvider());

    const context: BriefContext = {
      date,
      timezone: config.TIMEZONE,
      meetings,
      tasks: db.getPendingTasks(),
      followUps: db.getOverdueFollowUps(),
      emails,
      previousBrief: db.getLatestBrief(),
    };

    const generatedBrief = await briefGenerator.generateBrief(context);
    if (briefGenerator.getLastGenerationMetadata().usedFallback) {
      return {
        generatedBrief,
        result: recordSmokeResult(db, {
          trigger: 'llm',
          dateKey,
          status: 'failed',
          summary: `${llmDisplayName} brief generation fell back to the local fallback template.`,
        }),
      };
    }

    return {
      generatedBrief,
      result: recordSmokeResult(db, {
        trigger: 'llm',
        dateKey,
        status: 'passed',
        summary: `Generated a live brief with ${llmDisplayName} using model ${config.LLM_MODEL}.`,
        details: {
          provider: config.LLM_PROVIDER,
          model: config.LLM_MODEL,
          smsLength: generatedBrief.smsBrief.length,
          voiceWordCount: generatedBrief.voiceBrief.split(/\s+/).length,
          topPriorities: generatedBrief.topPriorities,
        },
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      generatedBrief: null,
      result: recordSmokeResult(db, {
        trigger: 'llm',
        dateKey,
        status: 'failed',
        summary: `${llmDisplayName} smoke test failed: ${message}`,
      }),
    };
  }
}

async function runDeliverySmoke(options: {
  db: DatabaseService;
  twilio: TwilioIntegration;
  date: Date;
  dateKey: string;
  trigger: 'sms' | 'voice';
  recipient?: string;
  message: string;
  forceSend: boolean;
}): Promise<SmokeTestResult> {
  const { db, twilio, date, dateKey, trigger, recipient, message, forceSend } = options;

  try {
    if (!recipient) {
      return recordSmokeResult(db, {
        trigger,
        dateKey,
        status: 'failed',
        summary: `No recipient configured for ${trigger.toUpperCase()} smoke testing.`,
      });
    }

    const latestRun = db.getLatestSmokeRunForDate(date, trigger);
    if (!forceSend && latestRun && shouldSuppressSmokeRun(latestRun)) {
      return recordSmokeResult(db, {
        trigger,
        dateKey,
        status: 'suppressed',
        summary: `${trigger.toUpperCase()} smoke test suppressed because it already ran today.`,
        details: {
          priorRunId: latestRun.id,
          priorStatus: latestRun.status,
        },
      });
    }

    const result = trigger === 'sms'
      ? await twilio.sendSMS(recipient, message, false)
      : await twilio.makeVoiceCall(recipient, message, false);

    return recordSmokeResult(db, {
      trigger,
      dateKey,
      status: result.success ? 'passed' : 'failed',
      summary: result.success
        ? result.status === 'pending'
          ? `${trigger.toUpperCase()} smoke test was accepted by Twilio for ${recipient}; final delivery is still pending provider status.`
          : `${trigger.toUpperCase()} smoke test completed successfully for ${recipient}.`
        : `${trigger.toUpperCase()} smoke test failed: ${result.error}`,
      details: {
        recipient,
        messageId: result.messageId,
        deliveryStatus: result.status || null,
        suppressAutoRetry: result.suppressAutoRetry || false,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return recordSmokeResult(db, {
      trigger,
      dateKey,
      status: 'failed',
      summary: `${trigger.toUpperCase()} smoke test failed: ${message}`,
    });
  }
}

function shouldSuppressSmokeRun(run: ReturnType<DatabaseService['getLatestSmokeRunForDate']>): boolean {
  if (!run) {
    return false;
  }

  if (run.status === 'success' || run.status === 'suppressed') {
    return true;
  }

  return run.metadata?.suppressAutoRetry === true;
}

function recordSmokeResult(
  db: DatabaseService,
  options: {
    trigger: string;
    dateKey: string;
    status: SmokeTestResult['status'];
    summary: string;
    details?: Record<string, unknown>;
  }
): SmokeTestResult {
  const { trigger, dateKey, status, summary, details } = options;
  const mappedStatus = status === 'passed' ? 'success' : status === 'failed' ? 'failed' : 'suppressed';
  const metadata = {
    summary,
    ...(details || {}),
  };

  db.createWorkflowRun({
    run_type: 'smoke_test',
    trigger,
    date_key: dateKey,
    status: mappedStatus,
    dry_run: false,
    brief_id: null,
    sms_status: trigger === 'sms' ? mapSmokeChannelStatus(status) : 'skipped',
    voice_status: trigger === 'voice' ? mapSmokeChannelStatus(status) : 'skipped',
    integration_failures: status === 'failed' ? [trigger] : [],
    error_message: status === 'failed' ? summary : null,
    metadata,
  });

  return {
    target: trigger as SmokeTarget,
    status,
    summary,
    details,
  };
}

function mapSmokeChannelStatus(status: SmokeTestResult['status']) {
  switch (status) {
    case 'passed':
      return 'sent' as const;
    case 'failed':
      return 'failed' as const;
    case 'suppressed':
      return 'suppressed' as const;
    case 'skipped':
    default:
      return 'skipped' as const;
  }
}
