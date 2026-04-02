import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { AccessibleCalendar, CalendarEvent } from '../models/types';
import { config, getConfiguredCalendarIds } from '../utils/config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { getStartOfLocalDay, getEndOfLocalDay } from '../utils/date';

export class GoogleCalendarIntegration {
  private oauth2Client: OAuth2Client;
  private calendar: any;
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
      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      this.initialized = true;
    }
  }

  isConfigured(): boolean {
    return this.initialized && !!config.GOOGLE_REFRESH_TOKEN;
  }

  async getAuthUrl(): Promise<string> {
    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
  }

  async handleAuthCallback(code: string): Promise<{ refresh_token: string }> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    
    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. Try revoking access and re-authenticating.');
    }

    return { refresh_token: tokens.refresh_token };
  }

  async getTodayEvents(date: Date = new Date()): Promise<CalendarEvent[]> {
    if (!this.isConfigured()) {
      logger.warn('Google Calendar not configured, returning empty events');
      return [];
    }

    return withRetry(async () => {
      try {
        const timeMin = getStartOfLocalDay(date).toISOString();
        const timeMax = getEndOfLocalDay(date).toISOString();
        return this.getEventsAcrossCalendars({
          timeMin,
          timeMax,
          maxResults: 50,
        });
      } catch (error) {
        logger.error('Failed to fetch calendar events', { error });
        throw error;
      }
    });
  }

  async getUpcomingEvents(days: number = 7): Promise<CalendarEvent[]> {
    if (!this.isConfigured()) {
      logger.warn('Google Calendar not configured, returning empty events');
      return [];
    }

    return withRetry(async () => {
      try {
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        return this.getEventsAcrossCalendars({
          timeMin,
          timeMax,
          maxResults: 100,
        });
      } catch (error) {
        logger.error('Failed to fetch upcoming events', { error });
        throw error;
      }
    });
  }

  private async getEventsAcrossCalendars(options: {
    timeMin: string;
    timeMax: string;
    maxResults: number;
  }): Promise<CalendarEvent[]> {
    const calendarIds = await this.resolveConfiguredCalendarIds();
    const results = await Promise.allSettled(
      calendarIds.map(calendarId => this.getEventsForCalendar(calendarId, options))
    );

    const successful = results
      .filter(
        (result): result is PromiseFulfilledResult<CalendarEvent[]> => result.status === 'fulfilled'
      )
      .map(result => result.value);

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.warn('Failed to fetch events for configured calendar', {
          calendarId: calendarIds[index],
          error: String(result.reason),
        });
      }
    });

    if (successful.length === 0) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (firstFailure) {
        throw firstFailure.reason;
      }
      return [];
    }

    return this.mergeCalendarEvents(successful.flat());
  }

  private async getEventsForCalendar(
    calendarId: string,
    options: {
      timeMin: string;
      timeMax: string;
      maxResults: number;
    }
  ): Promise<CalendarEvent[]> {
    const response = await this.calendar.events.list({
      calendarId,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: options.maxResults,
    });

    const events = response.data.items || [];

    return events
      .filter((event: any) => event.start && !event.status?.includes('cancelled'))
      .map((event: any) => this.mapGoogleEventToCalendarEvent(event));
  }

  private mergeCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
    const deduped = new Map<string, CalendarEvent>();

    for (const event of events) {
      // Same event can appear in multiple selected calendars; collapse exact time/title duplicates.
      const key = [
        event.summary.trim().toLowerCase(),
        event.start.getTime(),
        event.end.getTime(),
        event.location?.trim().toLowerCase() || '',
      ].join('|');

      if (!deduped.has(key)) {
        deduped.set(key, event);
      }
    }

    return [...deduped.values()].sort((left, right) => left.start.getTime() - right.start.getTime());
  }

  async listAccessibleCalendars(): Promise<AccessibleCalendar[]> {
    if (!this.isConfigured()) {
      return [];
    }

    return withRetry(async () => {
      const entries: AccessibleCalendar[] = [];
      let pageToken: string | undefined;

      do {
        const response = await this.calendar.calendarList.list({
          minAccessRole: 'reader',
          maxResults: 250,
          pageToken,
        });

        for (const item of response.data.items || []) {
          if (!item.id || item.deleted) {
            continue;
          }

          entries.push({
            id: item.id,
            summary: item.summary || item.id,
            summaryOverride: item.summaryOverride || null,
            primary: item.primary === true,
            selected: item.selected === true,
            hidden: item.hidden === true,
            accessRole: item.accessRole || 'reader',
          });
        }

        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);

      return entries.sort((left, right) => {
        if (left.primary !== right.primary) {
          return left.primary ? -1 : 1;
        }

        return (left.summaryOverride || left.summary).localeCompare(
          right.summaryOverride || right.summary
        );
      });
    });
  }

  private async resolveConfiguredCalendarIds(): Promise<string[]> {
    const configuredTokens = getConfiguredCalendarIds(config);
    const accessibleCalendars = await this.listAccessibleCalendars();

    if (accessibleCalendars.length === 0) {
      return configuredTokens;
    }

    const resolvedIds: string[] = [];
    const unresolvedTokens: string[] = [];

    for (const token of configuredTokens) {
      const matches = findMatchingCalendars(accessibleCalendars, token);

      if (matches.length === 0) {
        unresolvedTokens.push(token);
        if (!resolvedIds.includes(token)) {
          resolvedIds.push(token);
        }
        continue;
      }

      for (const match of matches) {
        if (!resolvedIds.includes(match.id)) {
          resolvedIds.push(match.id);
        }
      }
    }

    if (unresolvedTokens.length > 0) {
      logger.warn('Some configured calendar identifiers did not match accessible calendar ids or names', {
        unresolvedTokens,
        accessibleCalendars: accessibleCalendars.map(calendar => ({
          id: calendar.id,
          summary: calendar.summary,
          summaryOverride: calendar.summaryOverride,
          primary: calendar.primary,
          selected: calendar.selected,
        })),
      });
    }

    return resolvedIds;
  }

  private mapGoogleEventToCalendarEvent(googleEvent: any): CalendarEvent {
    const start = googleEvent.start.dateTime || googleEvent.start.date;
    const end = googleEvent.end.dateTime || googleEvent.end.date;

    const attendees = (googleEvent.attendees || []).map((attendee: any) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
    }));

    return {
      id: googleEvent.id,
      summary: googleEvent.summary || 'No title',
      start: new Date(start),
      end: new Date(end),
      attendees,
      location: googleEvent.location,
      description: googleEvent.description,
      hangoutLink: googleEvent.hangoutLink,
    };
  }

  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      const calendarIds = await this.resolveConfiguredCalendarIds();
      const results = await Promise.allSettled(
        calendarIds.map(calendarId => this.calendar.calendars.get({ calendarId }))
      );

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.warn('Configured calendar connection test failed', {
            calendarId: calendarIds[index],
            error: String(result.reason),
          });
        }
      });

      return results.some(result => result.status === 'fulfilled');
    } catch (error) {
      logger.error('Google Calendar connection test failed', { error });
      return false;
    }
  }
}

export const googleCalendar = new GoogleCalendarIntegration();

function findMatchingCalendars(
  calendars: AccessibleCalendar[],
  rawToken: string
): AccessibleCalendar[] {
  const token = normalizeCalendarToken(rawToken);

  if (!token) {
    return [];
  }

  if (token === 'primary') {
    const primaryCalendars = calendars.filter(calendar => calendar.primary);
    if (primaryCalendars.length > 0) {
      return primaryCalendars;
    }
  }

  const exactIdMatches = calendars.filter(calendar => normalizeCalendarToken(calendar.id) === token);
  if (exactIdMatches.length > 0) {
    return exactIdMatches;
  }

  const summaryMatches = calendars.filter(calendar =>
    [calendar.summary, calendar.summaryOverride]
      .filter(Boolean)
      .some(value => normalizeCalendarToken(value!) === token)
  );

  return summaryMatches;
}

function normalizeCalendarToken(value: string): string {
  return value.trim().toLowerCase();
}
