import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import type { EmailThread } from '../models/types';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

const PROTON_LOOKBACK_DAYS = 14;

type ProtonMessage = {
  uid?: number;
  envelope?: {
    subject?: string | null;
    from?: Array<{ address?: string | null; name?: string | null }>;
    to?: Array<{ address?: string | null; name?: string | null }>;
  } | null;
  flags?: Set<string>;
  internalDate?: Date;
  source?: Buffer;
};

export class ProtonBridgeIntegration {
  constructor(
    private readonly clientFactory: (options: ImapFlowOptions) => ImapFlow = options =>
      new ImapFlow(options)
  ) {}

  getSourceName(): 'proton' {
    return 'proton';
  }

  isConfigured(): boolean {
    return Boolean(config.PROTON_IMAP_USERNAME && config.PROTON_IMAP_PASSWORD);
  }

  async getImportantEmails(maxResults: number = config.PROTON_MAX_RESULTS): Promise<EmailThread[]> {
    if (!this.isConfigured()) {
      logger.info('Proton Mail Bridge not configured, returning empty emails');
      return [];
    }

    return withRetry(async () => {
      const client = this.createClient();

      try {
        await client.connect();
        const lock = await client.getMailboxLock(config.PROTON_IMAP_MAILBOX);

        try {
          const recentIds = await this.searchRecentImportantMessageIds(client, maxResults);
          if (recentIds.length === 0) {
            return [];
          }

          const messages: EmailThread[] = [];
          for await (const message of client.fetch(
            recentIds,
            {
              uid: true,
              envelope: true,
              flags: true,
              internalDate: true,
              source: true,
            },
            { uid: true }
          )) {
            const mapped = this.mapMessageToEmailThread(message as ProtonMessage);
            if (mapped) {
              messages.push(mapped);
            }
          }

          return messages
            .sort((left, right) => right.date.getTime() - left.date.getTime())
            .slice(0, maxResults);
        } finally {
          lock.release();
        }
      } catch (error) {
        logger.error('Failed to fetch Proton Mail Bridge messages', { error });
        throw error;
      } finally {
        await this.disconnectClient(client);
      }
    });
  }

  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const client = this.createClient({ verifyOnly: true });

    try {
      await client.connect();
      return true;
    } catch (error) {
      logger.error('Proton Mail Bridge connection test failed', { error });
      return false;
    } finally {
      await this.disconnectClient(client);
    }
  }

  private createClient(overrides: Partial<ImapFlowOptions> = {}): ImapFlow {
    return this.clientFactory({
      host: config.PROTON_IMAP_HOST,
      port: config.PROTON_IMAP_PORT,
      secure: config.PROTON_IMAP_SECURE,
      auth: {
        user: config.PROTON_IMAP_USERNAME!,
        pass: config.PROTON_IMAP_PASSWORD!,
      },
      logger: false,
      ...overrides,
    });
  }

  private async searchRecentImportantMessageIds(
    client: ImapFlow,
    maxResults: number
  ): Promise<number[]> {
    const since = new Date(Date.now() - PROTON_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const prioritized = normalizeSearchResult(await client.search({
      since,
      or: [
        { seen: false },
        { flagged: true },
      ],
    }));

    const fallback = prioritized.length > 0
      ? prioritized
      : normalizeSearchResult(await client.search({ since }));

    return fallback.slice(-maxResults);
  }

  private mapMessageToEmailThread(message: ProtonMessage): EmailThread | null {
    const from = this.firstAddress(message.envelope?.from);
    if (!from) {
      return null;
    }

    const sourceText = message.source?.toString('utf-8') || '';
    const body = extractBodyPreview(sourceText);
    const flags = [...(message.flags || new Set<string>())];
    const isUnread = !flags.includes('\\Seen');
    const isImportant = isUnread || flags.includes('\\Flagged');

    return {
      id: `proton:${message.uid || `${from}:${message.envelope?.subject || 'message'}`}`,
      subject: message.envelope?.subject?.trim() || '(no subject)',
      from,
      to: this.addressList(message.envelope?.to),
      snippet: body.slice(0, 240),
      date: message.internalDate || new Date(),
      isImportant,
      isUnread,
      labels: flags.map(flag => flag.replace(/^\\/, '')),
      body,
    };
  }

  private firstAddress(
    addresses?: Array<{ address?: string | null; name?: string | null }> | null
  ): string {
    return addresses?.find(address => address.address)?.address?.trim().toLowerCase() || '';
  }

  private addressList(
    addresses?: Array<{ address?: string | null; name?: string | null }> | null
  ): string[] {
    return (addresses || [])
      .map(address => address.address?.trim().toLowerCase())
      .filter((address): address is string => Boolean(address));
  }

  private async disconnectClient(client: ImapFlow): Promise<void> {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

function extractBodyPreview(rawMessage: string): string {
  if (!rawMessage) {
    return '';
  }

  const multipartText = rawMessage.match(
    /Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/i
  );

  const fallbackText = rawMessage.split(/\r?\n\r?\n/, 2)[1] || '';
  const candidate = multipartText?.[1] || fallbackText;

  return candidate
    .replace(/=\r?\n/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const protonBridge = new ProtonBridgeIntegration();

function normalizeSearchResult(result: number[] | false): number[] {
  return Array.isArray(result) ? result : [];
}
