import type { EmailThread } from '../models/types';
import { logger } from '../utils/logger';

export interface InboxProvider {
  getSourceName(): string;
  isConfigured(): boolean;
  getImportantEmails(maxResults?: number): Promise<EmailThread[]>;
  testConnection(): Promise<boolean>;
}

export class UnifiedInboxService {
  constructor(private readonly providers: InboxProvider[]) {}

  isConfigured(): boolean {
    return this.providers.some(provider => provider.isConfigured());
  }

  getConfiguredSources(): string[] {
    return this.providers
      .filter(provider => provider.isConfigured())
      .map(provider => provider.getSourceName());
  }

  async getImportantEmails(maxResults: number): Promise<EmailThread[]> {
    const configuredProviders = this.providers.filter(provider => provider.isConfigured());

    if (configuredProviders.length === 0) {
      logger.info('No inbox providers configured, returning empty emails');
      return [];
    }

    const results = await Promise.allSettled(
      configuredProviders.map(provider => provider.getImportantEmails(maxResults))
    );

    const merged: EmailThread[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        merged.push(...result.value);
        return;
      }

      logger.warn('Inbox provider fetch failed', {
        provider: configuredProviders[index].getSourceName(),
        error: String(result.reason),
      });
    });

    return dedupeAndSortEmails(merged).slice(0, maxResults);
  }
}

function dedupeAndSortEmails(emails: EmailThread[]): EmailThread[] {
  const seen = new Set<string>();
  const deduped: EmailThread[] = [];

  for (const email of emails.sort((left, right) => right.date.getTime() - left.date.getTime())) {
    const key = [
      email.from.trim().toLowerCase(),
      email.subject.trim().toLowerCase(),
      email.date.toISOString().slice(0, 16),
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(email);
  }

  return deduped;
}
