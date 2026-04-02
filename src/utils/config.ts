import dotenv from 'dotenv';
import { z } from 'zod';
import { join } from 'path';

dotenv.config({ path: join(process.cwd(), '.env') });

const ConfigSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  TIMEZONE: z.string().default('America/Detroit'),
  
  // Database
  DATABASE_PATH: z.string().default('./data/founder_brief.db'),
  
  // Google APIs
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().default('primary'),
  GOOGLE_CALENDAR_IDS: z.string().optional(),
  
  // Gmail
  GMAIL_QUERY: z.string().default('is:important OR is:starred'),
  GMAIL_MAX_RESULTS: z.string().transform(Number).default('20'),

  // Proton Mail Bridge / IMAP
  PROTON_IMAP_HOST: z.string().default('127.0.0.1'),
  PROTON_IMAP_PORT: z.string().transform(Number).default('1143'),
  PROTON_IMAP_SECURE: z.string().transform(v => v === 'true').default('false'),
  PROTON_IMAP_USERNAME: z.string().optional(),
  PROTON_IMAP_PASSWORD: z.string().optional(),
  PROTON_IMAP_MAILBOX: z.string().default('INBOX'),
  PROTON_MAX_RESULTS: z.string().transform(Number).default('20'),
  
  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  RECIPIENT_PHONE_NUMBER: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  SMOKE_TEST_SMS_TO: z.string().optional(),
  SMOKE_TEST_VOICE_TO: z.string().optional(),
  
  // LLM
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-sonnet-4'),
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'mock']).default('anthropic'),
  
  // Feature Flags
  ENABLE_VOICE_CALLS: z.string().transform(v => v === 'true').default('false'),
  ENABLE_SMS: z.string().transform(v => v === 'true').default('true'),
  DRY_RUN_MODE: z.string().transform(v => v === 'true').default('false'),
  HIGH_PRIORITY_THRESHOLD: z.string().transform(Number).default('8'),
  
  // Voice Call
  VOICE_CALL_SPEED: z.string().transform(Number).default('1.0'),
  VOICE_CALL_LANGUAGE: z.string().default('en-US'),
  VOICE_CALL_VOICE: z.string().default('Polly.Matthew'),
  
  // Brief Configuration
  MAX_BRIEF_LENGTH: z.string().transform(Number).default('700'),
  MAX_SMS_LENGTH: z.string().transform(Number).default('800'),
  MAX_VOICE_SECONDS: z.string().transform(Number).default('60'),
  
  // Scheduling
  CRON_SCHEDULE: z.string().default('30 7 * * *'),
  SCHEDULE_ENABLED: z.string().transform(v => v === 'true').default('false'),
  
  // Webhook
  WEBHOOK_URL: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function normalizeOptional(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const placeholderValues = new Set([
    'your-client-id',
    'your-client-secret',
    'your-refresh-token',
    'your-anthropic-api-key',
    'your-account-sid',
    'your-auth-token',
    'your-proton-bridge-username',
    'your-proton-bridge-password',
    'your-api-key',
    'your-webhook-secret',
    'your-public-app-base-url',
    '+1234567890',
    '+0987654321',
  ]);

  if (placeholderValues.has(trimmed) || trimmed.startsWith('your-')) {
    return undefined;
  }

  return trimmed;
}

let config: Config;

try {
  const parsed = ConfigSchema.parse(process.env);
  config = {
    ...parsed,
    GOOGLE_CLIENT_ID: normalizeOptional(parsed.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: normalizeOptional(parsed.GOOGLE_CLIENT_SECRET),
    GOOGLE_REFRESH_TOKEN: normalizeOptional(parsed.GOOGLE_REFRESH_TOKEN),
    GOOGLE_CALENDAR_ID: normalizeOptional(parsed.GOOGLE_CALENDAR_ID) || 'primary',
    GOOGLE_CALENDAR_IDS: normalizeOptional(parsed.GOOGLE_CALENDAR_IDS),
    PROTON_IMAP_USERNAME: normalizeOptional(parsed.PROTON_IMAP_USERNAME),
    PROTON_IMAP_PASSWORD: normalizeOptional(parsed.PROTON_IMAP_PASSWORD),
    PROTON_IMAP_MAILBOX: normalizeOptional(parsed.PROTON_IMAP_MAILBOX) || 'INBOX',
    TWILIO_ACCOUNT_SID: normalizeOptional(parsed.TWILIO_ACCOUNT_SID),
    TWILIO_AUTH_TOKEN: normalizeOptional(parsed.TWILIO_AUTH_TOKEN),
    TWILIO_PHONE_NUMBER: normalizeOptional(parsed.TWILIO_PHONE_NUMBER),
    RECIPIENT_PHONE_NUMBER: normalizeOptional(parsed.RECIPIENT_PHONE_NUMBER),
    APP_BASE_URL: normalizeOptional(parsed.APP_BASE_URL),
    SMOKE_TEST_SMS_TO: normalizeOptional(parsed.SMOKE_TEST_SMS_TO),
    SMOKE_TEST_VOICE_TO: normalizeOptional(parsed.SMOKE_TEST_VOICE_TO),
    ANTHROPIC_API_KEY: normalizeOptional(parsed.ANTHROPIC_API_KEY),
    OPENAI_API_KEY: normalizeOptional(parsed.OPENAI_API_KEY),
    WEBHOOK_URL: normalizeOptional(parsed.WEBHOOK_URL),
    WEBHOOK_SECRET: normalizeOptional(parsed.WEBHOOK_SECRET),
  };
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Configuration validation failed:');
    error.errors.forEach(err => {
      console.error(`  ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export function getConfiguredCalendarIds(
  source: Pick<Config, 'GOOGLE_CALENDAR_ID' | 'GOOGLE_CALENDAR_IDS'> = config
): string[] {
  const rawValues = [source.GOOGLE_CALENDAR_ID, source.GOOGLE_CALENDAR_IDS]
    .filter(Boolean)
    .join(',');

  const values = rawValues
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    return ['primary'];
  }

  return [...new Set(values)];
}

export { config };
