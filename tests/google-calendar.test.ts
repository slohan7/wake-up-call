import { GoogleCalendarIntegration } from '../src/integrations/google-calendar';
import { config } from '../src/utils/config';

describe('GoogleCalendarIntegration', () => {
  const originalCalendarId = config.GOOGLE_CALENDAR_ID;
  const originalCalendarIds = config.GOOGLE_CALENDAR_IDS;

  afterEach(() => {
    config.GOOGLE_CALENDAR_ID = originalCalendarId;
    config.GOOGLE_CALENDAR_IDS = originalCalendarIds;
  });

  it('merges events from multiple configured calendars and keeps them sorted', async () => {
    config.GOOGLE_CALENDAR_ID = 'primary';
    config.GOOGLE_CALENDAR_IDS = 'primary, school calendar';

    const integration = new GoogleCalendarIntegration() as any;
    integration.initialized = true;
    integration.calendar = {
      calendarList: {
        list: jest.fn(async () => ({
          data: {
            items: [
              {
                id: 'primary',
                summary: 'Steven Lohan',
                primary: true,
                selected: true,
                accessRole: 'owner',
              },
              {
                id: 'slohan@umich.edu',
                summary: 'school calendar',
                selected: true,
                accessRole: 'reader',
              },
            ],
          },
        })),
      },
      events: {
        list: jest.fn(async ({ calendarId }: { calendarId: string }) => {
          if (calendarId === 'primary') {
            return {
              data: {
                items: [
                  {
                    id: 'primary-1',
                    summary: 'Founder sync',
                    start: { dateTime: '2026-04-02T13:00:00.000Z' },
                    end: { dateTime: '2026-04-02T13:30:00.000Z' },
                  },
                ],
              },
            };
          }

          if (calendarId === 'slohan@umich.edu') {
            return {
              data: {
                items: [
                  {
                    id: 'umich-1',
                    summary: 'EECS 492',
                    start: { dateTime: '2026-04-02T12:00:00.000Z' },
                    end: { dateTime: '2026-04-02T13:00:00.000Z' },
                  },
                  {
                    id: 'umich-dup',
                    summary: 'Founder sync',
                    start: { dateTime: '2026-04-02T13:00:00.000Z' },
                    end: { dateTime: '2026-04-02T13:30:00.000Z' },
                  },
                ],
              },
            };
          }

          throw new Error(`Unexpected calendar id: ${calendarId}`);
        }),
      },
    };

    const events = await integration.getTodayEvents(new Date('2026-04-02T12:00:00.000Z'));

    expect(events.map((event: any) => event.summary)).toEqual(['EECS 492', 'Founder sync']);
    expect(integration.calendar.events.list).toHaveBeenCalledTimes(2);
  });

  it('lists accessible calendars from the calendar list api', async () => {
    const integration = new GoogleCalendarIntegration() as any;
    integration.initialized = true;
    integration.calendar = {
      calendarList: {
        list: jest.fn(async () => ({
          data: {
            items: [
              {
                id: 'primary',
                summary: 'Steven Lohan',
                primary: true,
                selected: true,
                accessRole: 'owner',
              },
              {
                id: 'slohan@umich.edu',
                summary: 'school calendar',
                selected: true,
                accessRole: 'reader',
              },
            ],
          },
        })),
      },
    };

    const calendars = await integration.listAccessibleCalendars();

    expect(calendars).toEqual([
      expect.objectContaining({
        id: 'primary',
        summary: 'Steven Lohan',
        primary: true,
      }),
      expect.objectContaining({
        id: 'slohan@umich.edu',
        summary: 'school calendar',
        selected: true,
      }),
    ]);
  });
});
