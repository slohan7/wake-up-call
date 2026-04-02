import twilio from 'twilio';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { isRetriableError } from '../utils/retry';

export interface DeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  deliveryType: 'sms' | 'voice';
  status?: 'pending' | 'sent' | 'failed';
  metadata?: Record<string, unknown>;
  suppressAutoRetry?: boolean;
}

export class TwilioIntegration {
  private client: twilio.Twilio | null = null;
  private initialized = false;

  constructor() {
    if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN) {
      this.client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
      this.initialized = true;
    }
  }

  isConfigured(): boolean {
    return this.initialized && !!this.client;
  }

  async sendSMS(to: string, message: string, dryRun = false): Promise<DeliveryResult> {
    if (dryRun) {
      logger.info('DRY RUN: Would send SMS', { to, messageLength: message.length });
      return {
        success: true,
        messageId: `dry-run-sms-${Date.now()}`,
        deliveryType: 'sms',
      };
    }

    if (!this.isConfigured()) {
      logger.error('Twilio not configured for SMS');
      return {
        success: false,
        error: 'Twilio not configured',
        deliveryType: 'sms',
        suppressAutoRetry: false,
      };
    }

    const from = this.getFromNumber();
    if (!from) {
      return {
        success: false,
        error: 'TWILIO_PHONE_NUMBER is not configured',
        deliveryType: 'sms',
        suppressAutoRetry: false,
      };
    }

    try {
      const statusCallbackUrl = this.getSmsStatusCallbackUrl();
      const result = await this.client!.messages.create({
        body: message,
        from,
        to,
        statusCallback: statusCallbackUrl || undefined,
      });

      logger.info('SMS accepted by Twilio; final delivery is pending provider status', {
        messageId: result.sid,
        to,
        messageLength: message.length,
        providerStatus: result.status,
        statusCallbackConfigured: Boolean(statusCallbackUrl),
      });

      return {
        success: true,
        messageId: result.sid,
        deliveryType: 'sms',
        status: 'pending',
        metadata: {
          providerStatus: result.status || 'queued',
          statusCallbackConfigured: Boolean(statusCallbackUrl),
          statusCallbackUrl: statusCallbackUrl || null,
          finalDeliveryPending: true,
        },
        suppressAutoRetry: false,
      };
    } catch (error: any) {
      const suppressAutoRetry = this.shouldSuppressAutoRetry(error);
      logger.error('Failed to send SMS', {
        error: error.message,
        to,
        suppressAutoRetry,
      });
      return {
        success: false,
        error: error.message,
        deliveryType: 'sms',
        status: 'failed',
        suppressAutoRetry,
      };
    }
  }

  async makeVoiceCall(
    to: string,
    message: string,
    dryRun = false
  ): Promise<DeliveryResult> {
    if (dryRun) {
      logger.info('DRY RUN: Would make voice call', { to, messageLength: message.length });
      return {
        success: true,
        messageId: `dry-run-voice-${Date.now()}`,
        deliveryType: 'voice',
      };
    }

    if (!this.isConfigured()) {
      logger.error('Twilio not configured for voice calls');
      return {
        success: false,
        error: 'Twilio not configured',
        deliveryType: 'voice',
        suppressAutoRetry: false,
      };
    }

    const from = this.getFromNumber();
    if (!from) {
      return {
        success: false,
        error: 'TWILIO_PHONE_NUMBER is not configured',
        deliveryType: 'voice',
        suppressAutoRetry: false,
      };
    }

    try {
      const twiml = this.createVoiceTwiML(message);
      const result = await this.client!.calls.create({
        twiml,
        from,
        to,
      });

      logger.info('Voice call initiated successfully', {
        callId: result.sid,
        to,
        messageLength: message.length,
      });

      return {
        success: true,
        messageId: result.sid,
        deliveryType: 'voice',
        status: 'sent',
        suppressAutoRetry: false,
      };
    } catch (error: any) {
      const suppressAutoRetry = this.shouldSuppressAutoRetry(error);
      logger.error('Failed to initiate voice call', {
        error: error.message,
        to,
        suppressAutoRetry,
      });
      return {
        success: false,
        error: error.message,
        deliveryType: 'voice',
        status: 'failed',
        suppressAutoRetry,
      };
    }
  }

  async sendBrief(
    brief: {
      sms: string;
      voice?: string;
    },
    options: {
      enableSMS?: boolean;
      enableVoice?: boolean;
      recipient?: string;
      dryRun?: boolean;
    } = {}
  ): Promise<{
    sms?: DeliveryResult;
    voice?: DeliveryResult;
  }> {
    const {
      enableSMS = config.ENABLE_SMS,
      enableVoice = config.ENABLE_VOICE_CALLS,
      recipient = config.RECIPIENT_PHONE_NUMBER,
      dryRun = config.DRY_RUN_MODE,
    } = options;

    if (!recipient) {
      if (dryRun) {
        return {
          sms: enableSMS && brief.sms
            ? {
                success: true,
                messageId: `dry-run-sms-${Date.now()}`,
                deliveryType: 'sms',
              }
            : undefined,
          voice: enableVoice && brief.voice
            ? {
                success: true,
                messageId: `dry-run-voice-${Date.now()}`,
                deliveryType: 'voice',
              }
            : undefined,
        };
      }

      logger.error('No recipient phone number configured');
      return {
        sms: enableSMS
          ? {
              success: false,
              error: 'No recipient phone number configured',
              deliveryType: 'sms',
              suppressAutoRetry: false,
            }
          : undefined,
        voice: enableVoice
          ? {
              success: false,
              error: 'No recipient phone number configured',
              deliveryType: 'voice',
              suppressAutoRetry: false,
            }
          : undefined,
      };
    }

    const results: {
      sms?: DeliveryResult;
      voice?: DeliveryResult;
    } = {};

    if (enableSMS && brief.sms) {
      logger.info('Sending SMS brief', { recipient, dryRun });
      results.sms = await this.sendSMS(recipient, brief.sms, dryRun);
    }

    if (enableVoice && brief.voice) {
      logger.info('Making voice call for brief', { recipient, dryRun });

      if (results.sms?.success && !dryRun) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      results.voice = await this.makeVoiceCall(recipient, brief.voice, dryRun);
    }

    return results;
  }

  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      await this.client!.api.accounts(config.TWILIO_ACCOUNT_SID!).fetch();
      return true;
    } catch (error) {
      logger.error('Twilio connection test failed', { error });
      return false;
    }
  }

  async getMessageStatus(messageSid: string): Promise<string | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const message = await this.client!.messages(messageSid).fetch();
      return message.status;
    } catch (error) {
      logger.error('Failed to get message status', { messageSid, error });
      return null;
    }
  }

  async getCallStatus(callSid: string): Promise<string | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const call = await this.client!.calls(callSid).fetch();
      return call.status;
    } catch (error) {
      logger.error('Failed to get call status', { callSid, error });
      return null;
    }
  }

  private getFromNumber(): string | null {
    return config.TWILIO_PHONE_NUMBER || null;
  }

  private getSmsStatusCallbackUrl(): string | null {
    if (!config.APP_BASE_URL) {
      return null;
    }

    try {
      return new URL('/webhook/twilio/message-status', this.ensureTrailingSlash(config.APP_BASE_URL)).toString();
    } catch (error) {
      logger.warn('APP_BASE_URL is invalid; Twilio SMS callbacks will be disabled', {
        appBaseUrl: config.APP_BASE_URL,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private shouldSuppressAutoRetry(error: any): boolean {
    if (!error) {
      return false;
    }

    const status = typeof error.status === 'number' ? error.status : undefined;
    if (status && status >= 400 && status < 500) {
      return false;
    }

    if (status && status >= 500) {
      return true;
    }

    return isRetriableError(error as Error);
  }

  private createVoiceTwiML(message: string): string {
    const speed = config.VOICE_CALL_SPEED;
    const language = config.VOICE_CALL_LANGUAGE;
    const voice = config.VOICE_CALL_VOICE;
    const cleanMessage = this.cleanMessageForVoice(message);

    return `
      <Response>
        <Say voice="${voice}" language="${language}" rate="${speed * 100}%">
          ${this.escapeXml(cleanMessage)}
        </Say>
        <Pause length="1"/>
        <Say voice="${voice}" language="${language}">
          Thank you and have a great day.
        </Say>
      </Response>
    `.trim();
  }

  private cleanMessageForVoice(message: string): string {
    let cleaned = message
      .replace(/[#*_~`]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[-•]\s+/gm, '')
      .replace(/\n+/g, '. ')
      .replace(/\.{2,}/g, '.')
      .trim();

    cleaned = cleaned
      .replace(/([.!?])\s+/g, '$1 <break time="500ms"/> ')
      .replace(/,\s+/g, ', <break time="300ms"/> ');

    return cleaned;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export const twilioClient = new TwilioIntegration();
