#!/usr/bin/env node

import { GoogleCalendarIntegration } from '../integrations/google-calendar';

async function calendarList() {
  const integration = new GoogleCalendarIntegration();

  if (!integration.isConfigured()) {
    console.error('Google Calendar is not configured.');
    process.exitCode = 1;
    return;
  }

  const calendars = await integration.listAccessibleCalendars();

  console.log('\n📅 ACCESSIBLE GOOGLE CALENDARS\n');

  if (calendars.length === 0) {
    console.log('No calendars were returned for the authenticated Google account.\n');
    return;
  }

  for (const calendar of calendars) {
    const label = calendar.summaryOverride || calendar.summary;
    const flags = [
      calendar.primary ? 'primary' : null,
      calendar.selected ? 'selected' : null,
      calendar.hidden ? 'hidden' : null,
      calendar.accessRole,
    ].filter(Boolean).join(', ');

    console.log(`- ${label}`);
    console.log(`  id: ${calendar.id}`);
    console.log(`  flags: ${flags}`);
  }

  console.log('');
  console.log('You can set GOOGLE_CALENDAR_IDS using either the exact id or the displayed calendar name.');
  console.log('Example: GOOGLE_CALENDAR_IDS=primary,school calendar');
  console.log('');
}

if (require.main === module) {
  calendarList().catch(error => {
    console.error('\n❌ Failed to list calendars:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { calendarList };
