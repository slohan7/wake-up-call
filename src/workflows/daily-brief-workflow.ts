import { DatabaseService } from '../db/database';
import { BriefGeneratorService } from '../services/brief-generator';
import { GoogleCalendarIntegration } from '../integrations/google-calendar';
import { GmailIntegration } from '../integrations/gmail';
import { ProtonBridgeIntegration } from '../integrations/proton-bridge';
import { TwilioIntegration } from '../integrations/twilio';
import { UnifiedInboxService } from '../services/inbox-service';
import { 
  BriefContext, 
  Meeting, 
  CalendarEvent,
  Brief,
  DeliveryLog,
  RunChannelStatus,
} from '../models/types';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { getLocalDate, getLocalDateKey } from '../utils/date';

export interface WorkflowOptions {
  date?: Date;
  dryRun?: boolean;
  skipDelivery?: boolean;
  forceRegenerate?: boolean;
  enableVoice?: boolean;
  forceVoice?: boolean;
  forceDelivery?: boolean;
  trigger?: string;
}

interface GatheredContext {
  context: BriefContext;
  integrationFailures: string[];
}

interface DeliveryExecution {
  deliveryLogs: DeliveryLog[];
  summary: {
    sms: RunChannelStatus;
    voice: RunChannelStatus;
  };
}

export class DailyBriefWorkflow {
  constructor(
    private db: DatabaseService,
    private briefGenerator: BriefGeneratorService,
    private googleCalendar: GoogleCalendarIntegration,
    private inbox: UnifiedInboxService,
    private twilio: TwilioIntegration
  ) {}

  async execute(options: WorkflowOptions = {}): Promise<{
    brief: Brief;
    deliveryResults: DeliveryLog[];
  }> {
    const {
      date = new Date(),
      dryRun = config.DRY_RUN_MODE,
      skipDelivery = false,
      forceRegenerate = false,
      enableVoice = config.ENABLE_VOICE_CALLS,
      forceVoice = false,
      forceDelivery = false,
      trigger = dryRun ? 'dry-run' : 'manual',
    } = options;

    const localDate = getLocalDate(date);
    const dateKey = getLocalDateKey(localDate);
    logger.info('Starting daily brief workflow', { 
      date: localDate.toISOString(),
      dateKey,
      dryRun,
      skipDelivery,
      forceRegenerate,
      forceDelivery,
      trigger,
    });

    let integrationFailures: string[] = [];

    try {
      const existingBrief = this.db.getBriefByDate(localDate);

      // Check if brief already exists for today
      if (existingBrief && !forceRegenerate && !dryRun) {
        logger.info('Brief already exists for today', { briefId: existingBrief.id });

        const deliveryExecution = skipDelivery
          ? this.createSkippedDeliveryExecution()
          : await this.deliverBrief(existingBrief, {
              dryRun,
              enableVoice: forceVoice || (enableVoice && existingBrief.is_high_priority),
              forceDelivery,
            });

        this.recordWorkflowRun({
          dateKey,
          trigger,
          dryRun,
          briefId: existingBrief.id ?? null,
          integrationFailures,
          errorMessage: null,
          deliverySummary: deliveryExecution.summary,
          metadata: {
            reusedExistingBrief: true,
            skipDelivery,
            forceRegenerate,
            forceDelivery,
          },
        });

        return {
          brief: existingBrief,
          deliveryResults: deliveryExecution.deliveryLogs.length > 0
            ? deliveryExecution.deliveryLogs
            : this.db.getDeliveryLogsForBrief(existingBrief.id!),
        };
      }

      // Gather context for brief generation
      const gathered = await this.gatherContext(localDate);
      integrationFailures = [...gathered.integrationFailures];
      
      // Generate the brief
      const generatedBrief = await this.briefGenerator.generateBrief(gathered.context);
      if (this.briefGenerator.getLastGenerationMetadata().usedFallback) {
        integrationFailures.push(config.LLM_PROVIDER);
      }
      
      // Store the brief
      const brief = dryRun
        ? {
            date: localDate,
            full_content: generatedBrief.fullBrief,
            sms_content: generatedBrief.smsBrief,
            voice_content: generatedBrief.voiceBrief,
            priority_score: generatedBrief.priorityScore,
            is_high_priority: generatedBrief.isHighPriority,
            created_at: new Date(),
          }
        : existingBrief && forceRegenerate
          ? this.db.updateBrief(existingBrief.id!, {
              date: localDate,
              full_content: generatedBrief.fullBrief,
              sms_content: generatedBrief.smsBrief,
              voice_content: generatedBrief.voiceBrief,
              priority_score: generatedBrief.priorityScore,
              is_high_priority: generatedBrief.isHighPriority,
            })
          : this.db.createBrief({
              date: localDate,
              full_content: generatedBrief.fullBrief,
              sms_content: generatedBrief.smsBrief,
              voice_content: generatedBrief.voiceBrief,
              priority_score: generatedBrief.priorityScore,
              is_high_priority: generatedBrief.isHighPriority,
            });
      
      logger.info(dryRun ? 'Brief generated in dry-run mode' : 'Brief generated and stored', {
        briefId: brief.id,
        priorityScore: brief.priority_score,
        isHighPriority: brief.is_high_priority,
      });
      
      // Deliver the brief
      const deliveryExecution = skipDelivery
        ? this.createSkippedDeliveryExecution()
        : await this.deliverBrief(brief, { 
            dryRun, 
            enableVoice: forceVoice || (enableVoice && brief.is_high_priority),
            forceDelivery,
          });

      this.recordWorkflowRun({
        dateKey,
        trigger,
        dryRun,
        briefId: brief.id ?? null,
        integrationFailures,
        errorMessage: null,
        deliverySummary: deliveryExecution.summary,
        metadata: {
          reusedExistingBrief: false,
          skipDelivery,
          forceRegenerate,
          forceDelivery,
          usedFallbackBriefGeneration: this.briefGenerator.getLastGenerationMetadata().usedFallback,
        },
      });
      
      return { brief, deliveryResults: deliveryExecution.deliveryLogs };
    } catch (error) {
      logger.error('Daily brief workflow failed', { error });
      this.recordWorkflowRun({
        dateKey,
        trigger,
        dryRun,
        briefId: null,
        integrationFailures,
        errorMessage: error instanceof Error ? error.message : String(error),
        deliverySummary: {
          sms: skipDelivery ? 'skipped' : 'failed',
          voice: skipDelivery ? 'skipped' : 'failed',
        },
        metadata: {
          skipDelivery,
          forceRegenerate,
          forceDelivery,
        },
      });
      throw error;
    }
  }

  private async gatherContext(date: Date): Promise<GatheredContext> {
    logger.info('Gathering context for brief generation');
    
    // Fetch data in parallel
    const [calendarEvents, emails, tasks, followUps] = await Promise.allSettled([
      this.googleCalendar.getTodayEvents(date),
      this.inbox.getImportantEmails(config.GMAIL_MAX_RESULTS),
      Promise.resolve(this.db.getPendingTasks()),
      Promise.resolve(this.db.getOverdueFollowUps()),
    ]);
    
    // Process calendar events
    const meetings: Meeting[] = [];
    const integrationFailures: string[] = [];
    if (calendarEvents.status === 'fulfilled') {
      for (const event of calendarEvents.value) {
        meetings.push(await this.processCalendarEvent(event));
      }
    } else {
      logger.error('Failed to fetch calendar events', { error: calendarEvents.reason });
      integrationFailures.push('google_calendar');
    }

    if (emails.status !== 'fulfilled') {
      logger.error('Failed to fetch inbox messages', { error: emails.reason });
      integrationFailures.push('email');
    }
    
    // Get previous brief for context
    const previousBrief = this.db.getLatestBrief();
    
    return {
      context: {
        date,
        timezone: config.TIMEZONE,
        meetings,
        tasks: tasks.status === 'fulfilled' ? tasks.value : [],
        followUps: followUps.status === 'fulfilled' ? followUps.value : [],
        emails: emails.status === 'fulfilled' ? emails.value : [],
        previousBrief,
      },
      integrationFailures,
    };
  }

  private async processCalendarEvent(event: CalendarEvent): Promise<Meeting> {
    // Check if meeting already exists
    let meeting = this.db.getMeetingByCalendarId(event.id);
    
    if (!meeting) {
      // Create new meeting
      meeting = this.db.upsertMeeting({
        calendar_id: event.id,
        title: event.summary,
        start_time: event.start,
        end_time: event.end,
        attendees: event.attendees?.map(a => a.email) || [],
        location: event.location || null,
        description: event.description || null,
        prep_notes: null,
        importance_score: this.calculateMeetingImportance(event),
      });
    } else {
      // Update existing meeting
      meeting = this.db.upsertMeeting({
        ...meeting,
        title: event.summary,
        start_time: event.start,
        end_time: event.end,
        attendees: event.attendees?.map(a => a.email) || [],
        location: event.location || null,
        description: event.description || null,
      });
    }
    
    // Process attendees
    for (const attendee of event.attendees || []) {
      if (attendee.email && !attendee.email.includes('resource.calendar.google.com')) {
        if (!this.db.getPersonByEmail(attendee.email)) {
          this.db.createPerson({
            email: attendee.email,
            name: attendee.displayName || attendee.email.split('@')[0],
            company: null,
            importance: 5,
            last_contact: null,
          });
        }
      }
    }
    
    return meeting;
  }

  private calculateMeetingImportance(event: CalendarEvent): number {
    let score = 5; // Base score
    
    // Important keywords in title
    const importantKeywords = ['urgent', 'critical', 'review', 'decision', '1:1', 'interview'];
    if (importantKeywords.some(kw => event.summary.toLowerCase().includes(kw))) {
      score += 2;
    }
    
    // Number of attendees
    const attendeeCount = event.attendees?.length || 0;
    if (attendeeCount > 5) score += 1; // Large meeting
    if (attendeeCount === 2) score += 1; // 1:1 meeting
    
    return Math.min(score, 10);
  }

  private async deliverBrief(
    brief: Brief, 
    options: { dryRun?: boolean; enableVoice?: boolean; forceDelivery?: boolean }
  ): Promise<DeliveryExecution> {
    const { dryRun = false, enableVoice = false, forceDelivery = false } = options;
    const deliveryLogs: DeliveryLog[] = [];
    const smsDecision = this.getChannelDecision({
      deliveryType: 'sms',
      enabled: config.ENABLE_SMS,
      date: brief.date,
      dryRun,
      forceDelivery,
    });
    const voiceDecision = this.getChannelDecision({
      deliveryType: 'voice',
      enabled: enableVoice,
      date: brief.date,
      dryRun,
      forceDelivery,
    });
    
    logger.info('Delivering brief', {
      briefId: brief.id,
      dryRun,
      enableVoice,
      forceDelivery,
      smsDecision,
      voiceDecision,
    });

    if (dryRun) {
      logger.info('Dry run enabled, suppressing all live delivery calls', {
        briefId: brief.id,
        smsDecision,
        voiceDecision,
      });
      return {
        deliveryLogs: [],
        summary: {
          sms: smsDecision.shouldSend ? 'dry_run' : smsDecision.status,
          voice: voiceDecision.shouldSend ? 'dry_run' : voiceDecision.status,
        },
      };
    }

    if (!smsDecision.shouldSend && !voiceDecision.shouldSend) {
      logger.info('All deliveries were suppressed or skipped; no provider call will be made', {
        briefId: brief.id,
        smsDecision,
        voiceDecision,
      });
      return {
        deliveryLogs: [],
        summary: {
          sms: smsDecision.status,
          voice: voiceDecision.status,
        },
      };
    }
    
    // Send via Twilio
    const twilioResults = await this.twilio.sendBrief(
      {
        sms: smsDecision.shouldSend ? brief.sms_content : '',
        voice: voiceDecision.shouldSend ? brief.voice_content : undefined,
      },
      {
        enableSMS: smsDecision.shouldSend,
        enableVoice: voiceDecision.shouldSend,
        dryRun,
      }
    );
    
    // Log SMS delivery
    if (twilioResults.sms) {
      const smsStatus = twilioResults.sms.status ?? (twilioResults.sms.success ? 'sent' : 'failed');
      const smsLog = this.db.createDeliveryLog({
        brief_id: brief.id!,
        delivery_type: 'sms',
        status: smsStatus,
        recipient: config.RECIPIENT_PHONE_NUMBER || 'unknown',
        error_message: twilioResults.sms.error || null,
        metadata: {
          messageId: twilioResults.sms.messageId,
          ...(twilioResults.sms.metadata || {}),
          suppressAutoRetry: twilioResults.sms.suppressAutoRetry || false,
        },
        delivered_at: smsStatus === 'sent' ? new Date() : null,
      });
      deliveryLogs.push(smsLog);
    }
    
    // Log voice delivery
    if (twilioResults.voice) {
      const voiceStatus = twilioResults.voice.status ?? (twilioResults.voice.success ? 'sent' : 'failed');
      const voiceLog = this.db.createDeliveryLog({
        brief_id: brief.id!,
        delivery_type: 'voice',
        status: voiceStatus,
        recipient: config.RECIPIENT_PHONE_NUMBER || 'unknown',
        error_message: twilioResults.voice.error || null,
        metadata: {
          callId: twilioResults.voice.messageId,
          ...(twilioResults.voice.metadata || {}),
          suppressAutoRetry: twilioResults.voice.suppressAutoRetry || false,
        },
        delivered_at: voiceStatus === 'sent' ? new Date() : null,
      });
      deliveryLogs.push(voiceLog);
    }
    
    return {
      deliveryLogs,
      summary: {
        sms: twilioResults.sms
          ? (twilioResults.sms.success ? 'sent' : 'failed')
          : smsDecision.status,
        voice: twilioResults.voice
          ? (twilioResults.voice.success ? 'sent' : 'failed')
          : voiceDecision.status,
      },
    };
  }

  private createSkippedDeliveryExecution(): DeliveryExecution {
    return {
      deliveryLogs: [],
      summary: {
        sms: 'skipped',
        voice: 'skipped',
      },
    };
  }

  private getChannelDecision(options: {
    deliveryType: DeliveryLog['delivery_type'];
    enabled: boolean;
    date: Date;
    dryRun: boolean;
    forceDelivery: boolean;
  }): {
    shouldSend: boolean;
    status: RunChannelStatus;
    reason: string;
  } {
    const { deliveryType, enabled, date, dryRun, forceDelivery } = options;

    if (!enabled) {
      logger.info('Delivery skipped because channel is disabled', { deliveryType });
      return {
        shouldSend: false,
        status: 'skipped',
        reason: 'disabled',
      };
    }

    if (dryRun || forceDelivery) {
      logger.info('Delivery will proceed without duplicate suppression', {
        deliveryType,
        reason: dryRun ? 'dry-run' : 'force-delivery',
      });
      return {
        shouldSend: true,
        status: dryRun ? 'dry_run' : 'sent',
        reason: dryRun ? 'dry-run' : 'forced',
      };
    }

    const latestDelivery = this.db.getLatestDeliveryForDate(date, deliveryType);
    if (!latestDelivery) {
      logger.info('Delivery allowed because there is no prior attempt for the day', {
        deliveryType,
        dateKey: getLocalDateKey(date),
      });
      return {
        shouldSend: true,
        status: 'sent',
        reason: 'no-prior-attempt',
      };
    }

    if (latestDelivery.status === 'sent') {
      logger.info('Delivery suppressed because the channel already succeeded for the day', {
        deliveryType,
        dateKey: getLocalDateKey(date),
      });
      return {
        shouldSend: false,
        status: 'suppressed',
        reason: 'already-sent',
      };
    }

    if (latestDelivery.status === 'pending') {
      logger.warn('Delivery suppressed because a previous attempt is still pending final provider status', {
        deliveryType,
        dateKey: getLocalDateKey(date),
        providerMessageId: latestDelivery.metadata?.messageId || latestDelivery.metadata?.callId || null,
      });
      return {
        shouldSend: false,
        status: 'suppressed',
        reason: 'pending-previous-attempt',
      };
    }

    if (latestDelivery.status === 'failed' && latestDelivery.metadata?.suppressAutoRetry) {
      logger.warn('Delivery suppressed because the previous failure may have succeeded remotely', {
        deliveryType,
        error: latestDelivery.error_message,
      });
      return {
        shouldSend: false,
        status: 'suppressed',
        reason: 'ambiguous-previous-failure',
      };
    }

    logger.info('Delivery retry is allowed after a non-ambiguous failure', {
      deliveryType,
      dateKey: getLocalDateKey(date),
      previousStatus: latestDelivery.status,
      previousError: latestDelivery.error_message,
    });
    return {
      shouldSend: true,
      status: 'sent',
      reason: 'retry-allowed',
    };
  }

  private recordWorkflowRun(options: {
    dateKey: string;
    trigger: string;
    dryRun: boolean;
    briefId: number | null;
    integrationFailures: string[];
    errorMessage: string | null;
    deliverySummary: {
      sms: RunChannelStatus;
      voice: RunChannelStatus;
    };
    metadata?: Record<string, unknown>;
  }): void {
    const {
      dateKey,
      trigger,
      dryRun,
      briefId,
      integrationFailures,
      errorMessage,
      deliverySummary,
      metadata,
    } = options;

    const status = errorMessage
      ? 'failed'
      : deliverySummary.sms === 'suppressed' || deliverySummary.voice === 'suppressed'
        ? 'suppressed'
        : 'success';

    this.db.createWorkflowRun({
      run_type: 'daily_brief',
      trigger,
      date_key: dateKey,
      status,
      dry_run: dryRun,
      brief_id: briefId,
      sms_status: deliverySummary.sms,
      voice_status: deliverySummary.voice,
      integration_failures: integrationFailures,
      error_message: errorMessage,
      metadata: metadata || null,
    });
  }

  close(): void {
    this.db.close();
  }
}

// Factory function
export function createDailyBriefWorkflow(): DailyBriefWorkflow {
  const db = new DatabaseService();
  const briefGenerator = new BriefGeneratorService();
  const googleCalendar = new GoogleCalendarIntegration();
  const gmail = new GmailIntegration();
  const proton = new ProtonBridgeIntegration();
  const inbox = new UnifiedInboxService([gmail, proton]);
  const twilio = new TwilioIntegration();
  
  return new DailyBriefWorkflow(
    db,
    briefGenerator,
    googleCalendar,
    inbox,
    twilio
  );
}
