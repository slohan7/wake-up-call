import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { EmailThread } from '../models/types';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

export class GmailIntegration {
  private oauth2Client: OAuth2Client;
  private gmail: any;
  private initialized: boolean = false;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI
    );

    if (config.GOOGLE_REFRESH_TOKEN) {
      this.oauth2Client.setCredentials({
        refresh_token: config.GOOGLE_REFRESH_TOKEN,
      });
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      this.initialized = true;
    }
  }

  isConfigured(): boolean {
    return this.initialized && !!config.GOOGLE_REFRESH_TOKEN;
  }

  getSourceName(): 'gmail' {
    return 'gmail';
  }

  async getImportantEmails(maxResults: number = config.GMAIL_MAX_RESULTS): Promise<EmailThread[]> {
    if (!this.isConfigured()) {
      logger.warn('Gmail not configured, returning empty emails');
      return [];
    }

    return withRetry(async () => {
      try {
        // Get message IDs matching the query
        const response = await this.gmail.users.messages.list({
          userId: 'me',
          q: config.GMAIL_QUERY,
          maxResults,
        });

        const messages = response.data.messages || [];
        
        // Fetch details for each message
        const emailPromises = messages.map((msg: any) => 
          this.getEmailDetails(msg.id)
        );

        const emails = await Promise.all(emailPromises);
        return emails.filter(e => e !== null) as EmailThread[];
      } catch (error) {
        logger.error('Failed to fetch Gmail messages', { error });
        throw error;
      }
    });
  }

  private async getEmailDetails(messageId: string): Promise<EmailThread | null> {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = response.data;
      const headers = message.payload?.headers || [];
      
      const getHeader = (name: string): string => {
        const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
        return header?.value || '';
      };

      const from = getHeader('From');
      const to = getHeader('To').split(',').map((e: string) => e.trim());
      const subject = getHeader('Subject');
      const date = new Date(getHeader('Date'));
      
      // Get labels
      const labels = message.labelIds || [];
      const isImportant = labels.includes('IMPORTANT');
      const isUnread = labels.includes('UNREAD');
      
      // Get snippet
      const snippet = message.snippet || '';
      
      // Get body (simplified - you might want to handle multipart messages better)
      const body = this.extractBody(message.payload);

      return {
        id: messageId,
        subject,
        from: this.extractEmail(from),
        to,
        snippet,
        date,
        isImportant,
        isUnread,
        labels,
        body,
      };
    } catch (error) {
      logger.error('Failed to get email details', { messageId, error });
      return null;
    }
  }

  private extractEmail(fromHeader: string): string {
    const match = fromHeader.match(/<(.+?)>/);
    return match ? match[1] : fromHeader;
  }

  private extractBody(payload: any): string {
    if (!payload) return '';

    // For simple messages
    if (payload.body?.data) {
      return this.decodeBase64Url(payload.body.data);
    }

    // For multipart messages
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.decodeBase64Url(part.body.data);
        }
      }
      
      // If no text/plain, try text/html
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          const html = this.decodeBase64Url(part.body.data);
          // Simple HTML stripping (you might want to use a proper HTML parser)
          return html.replace(/<[^>]*>/g, '').trim();
        }
      }
    }

    return '';
  }

  private decodeBase64Url(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf-8');
  }

  async searchEmails(query: string, maxResults: number = 10): Promise<EmailThread[]> {
    if (!this.isConfigured()) {
      logger.warn('Gmail not configured, returning empty emails');
      return [];
    }

    return withRetry(async () => {
      try {
        const response = await this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults,
        });

        const messages = response.data.messages || [];
        
        const emailPromises = messages.map((msg: any) => 
          this.getEmailDetails(msg.id)
        );

        const emails = await Promise.all(emailPromises);
        return emails.filter(e => e !== null) as EmailThread[];
      } catch (error) {
        logger.error('Failed to search Gmail messages', { query, error });
        throw error;
      }
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    if (!this.isConfigured()) {
      logger.warn('Gmail not configured, cannot mark as read');
      return;
    }

    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
    } catch (error) {
      logger.error('Failed to mark email as read', { messageId, error });
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      await this.gmail.users.getProfile({ userId: 'me' });
      return true;
    } catch (error) {
      logger.error('Gmail connection test failed', { error });
      return false;
    }
  }
}

export const gmail = new GmailIntegration();
