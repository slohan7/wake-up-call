# Founder Daily Brief

Founder Daily Brief is a Node.js + TypeScript service that builds a daily founder brief from:

- Google Calendar events
- Gmail messages
- Proton Mail Bridge inbox messages
- local SQLite tasks and follow-ups

It can:

- generate a full brief, SMS summary, and voice script
- store one brief per Detroit-local day in SQLite
- send SMS via Twilio
- optionally place a voice call on high-priority days
- run from CLI, API, or an n8n schedule
- run a zero-side-effect dry run
- run a separate live smoke test for real credentials

## What was verified locally

The repo was validated locally with:

- `npm install`
- `npm run build`
- `npm test -- --runInBand`
- `npm run lint`
- `npm run db:migrate`
- `npm run db:seed`
- `npm run db:seed` again on the same DB
- `npm run dry-run`
- `npm run generate-brief -- --skip-delivery --date 2026-04-01`
- `npm run status`
- `npm run smoke-test -- --full` with credentials intentionally blanked to verify fail-closed output
- `npm start`
- `GET /health`
- `GET /api/brief/latest`
- `GET /api/status/latest`

Live Google, Gmail, Proton Mail Bridge, Anthropic/OpenAI, and Twilio calls were not validated in this sandbox because no working outbound credentialed network path was available here.

## Public date contract

The app uses Detroit-local day keys everywhere public:

- `brief.date` in API responses is `YYYY-MM-DD`
- `run.date` in status responses is `YYYY-MM-DD`
- database brief uniqueness is enforced on that same local date key

Only timestamp fields such as `createdAt` remain ISO timestamps.

## Setup

1. Install dependencies:

```bash
nvm use
npm install
```

This repo is currently pinned to Node 20 because `better-sqlite3` in the current dependency set is not reliable on Node 24 in this environment.

2. Create a local env file:

```bash
cp .env.example .env
```

3. Set the required env vars for the integrations you actually want to use:

- Google Calendar and Gmail:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REFRESH_TOKEN`
  - `GOOGLE_REDIRECT_URI`
- Proton Mail Bridge on the same Mac:
  - `PROTON_IMAP_USERNAME`
  - `PROTON_IMAP_PASSWORD`
  - `PROTON_IMAP_HOST`
  - `PROTON_IMAP_PORT`
  - `PROTON_IMAP_MAILBOX`
- Anthropic or OpenAI:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
- Twilio:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`
  - `RECIPIENT_PHONE_NUMBER`
  - `APP_BASE_URL`

4. Initialize the database:

```bash
npm run db:migrate
npm run db:seed
```

Repeated `npm run db:seed` runs do not create duplicate sample records.

Important:

- `npm run db:seed` inserts fake sample people, tasks, follow-ups, and meetings
- those records are useful for plumbing validation only
- if you already seeded the DB, they will be treated as real context until you remove them

To check and remove known sample records:

```bash
npm run db:purge-sample-data -- --dry-run
npm run db:purge-sample-data
```

## Import real operating data

For real usage, do not rely on `db:seed`. Import your own people, tasks, and follow-ups from CSV instead.

Templates are included:

```bash
mkdir -p imports
cp templates/import-data/people.csv ./imports/people.csv
cp templates/import-data/tasks.csv ./imports/tasks.csv
cp templates/import-data/follow-ups.csv ./imports/follow-ups.csv
```

Supported CSV files:

- `people.csv`
  - headers: `email,name,company,importance,last_contact`
- `tasks.csv`
  - headers: `title,description,due_date,priority,status,category`
- `follow-ups.csv`
  - headers: `person_email,person_name,person_company,person_importance,person_last_contact,subject,context,due_date,status,priority`

Date fields accept `YYYY-MM-DD` or ISO timestamps.

Import examples:

```bash
npm run import-data -- --tasks ./imports/tasks.csv
npm run import-data -- --people ./imports/people.csv --follow-ups ./imports/follow-ups.csv
npm run import-data -- --people ./imports/people.csv --tasks ./imports/tasks.csv --follow-ups ./imports/follow-ups.csv --dry-run
```

Import behavior:

- people are matched by `email`
- tasks are matched by `title`
- follow-ups are matched by `person_email + subject`
- repeated imports update changed rows instead of duplicating them
- follow-up imports can create or update the linked person record automatically

## Local development

Useful commands:

- `npm run dev`
- `npm run build`
- `npm start`
- `npm test -- --runInBand`
- `npm run lint`
- `npm run db:migrate`
- `npm run db:seed`
- `npm run import-data -- --tasks ./imports/tasks.csv`
- `npm run refresh-docs`
- `npm run calendar:list`
- `npm run dry-run`
- `npm run generate-brief`
- `npm run smoke-test`
- `npm run status`

For a reliable local scheduler path on macOS, use the compiled CLI through `scripts/run-daily-brief.sh` instead of scheduling `npm` directly.

## Living docs

You can generate living Markdown docs that adapt to today’s inbox and calendar context without overwriting your database tasks or follow-ups.

Run:

```bash
npm run refresh-docs
```

Useful options:

- `--date YYYY-MM-DD`
- `--output-dir PATH`

What it writes by default:

- `living-docs/people.md`
- `living-docs/tasks.md`
- `living-docs/follow-ups.md`

What’s inside:

- `people.md`
  - ranked people based on importance, overdue follow-ups, meetings today, and important email activity
- `tasks.md`
  - your active database tasks plus suggested tasks inferred from today’s meetings and inbox activity
- `follow-ups.md`
  - your active database follow-ups plus suggested follow-ups inferred from inbox activity

Behavior notes:

- these files are local working documents and are git-ignored
- calendar attendees and important email senders from Gmail or Proton can be added to the people table automatically if they do not already exist
- the docs are meant to help you decide what to update in your real system, not to silently rewrite your task and follow-up records

## Dry run

Run:

```bash
npm run dry-run
```

Dry run:

- does not store a brief
- does not write delivery logs
- does not call Twilio
- still generates and prints the full, SMS, and voice outputs
- still records a workflow run for visibility

## Manual generation

Generate and store a brief without delivery:

```bash
npm run generate-brief -- --skip-delivery --date 2026-04-01
```

Useful options:

- `--dry-run`
- `--skip-delivery`
- `--force`
- `--force-delivery`
- `--with-voice`
- `--date YYYY-MM-DD`

Notes:

- `--force` regenerates the brief for that local day instead of failing on the unique date key
- `--force-delivery` bypasses duplicate delivery suppression for that run
- `--with-voice` forces voice delivery on a manual run; unattended runs still only call on high-priority days when `ENABLE_VOICE_CALLS=true`

Wrapper command:

```bash
./scripts/run-daily-brief.sh --skip-delivery --date 2026-04-01
```

The wrapper:

- refreshes `living-docs/` before generating the brief
- uses the compiled CLI in `dist/cli/generate-brief.js`
- avoids `npm` and `tsx` in the scheduled path
- creates a simple lock so overlapping runs do not stack
- writes clean scheduler logs when used from `launchd`
- keeps going even if one inbox or Calendar is temporarily unavailable during the living-docs refresh

Optional wrapper controls:

- `--skip-refresh-docs`
- `FOUNDER_BRIEF_SKIP_REFRESH_DOCS=1`

## Preview the text

If you want to see exactly what the SMS would look like right now without calling Twilio, run:

```bash
nvm use
npm run dry-run
```

That prints:

- the full brief
- the SMS brief text
- the voice brief text
- the simulated delivery targets

If you want to generate and store a real brief for today without sending it, run:

```bash
npm run generate-brief -- --skip-delivery --date 2026-04-02
```

Use `npm run dry-run` when you want to preview the exact text. Use `generate-brief -- --skip-delivery` when you want a stored brief without delivery.

## Google calendar diagnosis

If another calendar is visible in the Google Calendar UI but missing from the brief, the usual cause is that the app only had a raw calendar id mismatch, not an access problem.

This repo now supports `GOOGLE_CALENDAR_IDS` entries as either:

- exact Google calendar ids
- or visible calendar names such as `school calendar`

To see exactly what the authenticated Google account can access, run:

```bash
npm run calendar:list
```

Then set:

```env
GOOGLE_CALENDAR_IDS=primary,school calendar
```

or use the exact ids printed by `npm run calendar:list`.

## Smoke test

Smoke test mode is separate from dry-run mode.

- it uses live integrations
- it ignores `DRY_RUN_MODE`
- it does not create a stored brief
- it records smoke-test run results in `workflow_runs`
- SMS and voice smoke sends are suppressed after a same-day success unless `--force-send` is used
- voice is opt-in and never included in a full run unless explicitly requested

Examples:

```bash
npm run smoke-test
npm run smoke-test -- --calendar
npm run smoke-test -- --gmail
npm run smoke-test -- --proton
npm run smoke-test -- --llm
npm run smoke-test -- --anthropic
npm run smoke-test -- --sms --sms-to +15551234567
npm run smoke-test -- --voice --voice-to +15551234567
npm run smoke-test -- --full --with-voice --force-send
```

Recipient selection:

- normal daily delivery uses `RECIPIENT_PHONE_NUMBER`
- smoke tests prefer `SMOKE_TEST_SMS_TO` and `SMOKE_TEST_VOICE_TO`
- CLI flags `--sms-to` and `--voice-to` override both

For a real live credentialed smoke test, fill in `.env` and run the command for the specific integration you want to validate first before using `--full`.

SMS smoke tests confirm Twilio accepted the request. Final handset delivery still depends on carrier status and, if configured, the Twilio callback updating the app.

## Proton Mail Bridge

If you want the brief to read a Proton inbox, use Proton Mail Bridge on the same Mac that runs this app.

Basic setup:

1. Install and sign in to Proton Mail Bridge.
2. In Bridge, open the mailbox account settings and copy the local IMAP credentials.
3. Add those values to `.env`:
   - `PROTON_IMAP_HOST`
   - `PROTON_IMAP_PORT`
   - `PROTON_IMAP_SECURE`
   - `PROTON_IMAP_USERNAME`
   - `PROTON_IMAP_PASSWORD`
   - `PROTON_IMAP_MAILBOX`
4. Run:

```bash
npm run smoke-test -- --proton
```

Notes:

- Proton support here is local-only and depends on Bridge actively running on your Mac
- the daily brief merges Gmail and Proton messages into one inbox context before ranking priorities
- Proton message selection is simpler than Gmail query support; it currently prefers unread or flagged recent mail in the configured mailbox

## Status inspection

CLI:

```bash
npm run status
```

API:

- `GET /api/status/latest`

This shows:

- latest brief generation status
- latest brief date
- whether SMS is pending, sent, skipped, suppressed, or failed
- whether voice was sent, skipped, suppressed, or failed
- any recorded integration failures
- recent smoke-test runs in the CLI output

## API

After `npm run build && npm start`, the server exposes:

- `GET /health`
- `POST /webhook/daily-brief`
- `POST /webhook/twilio/message-status`
- `POST /api/generate-brief`
- `GET /api/brief/latest`
- `GET /api/brief/YYYY-MM-DD`
- `GET /api/status/latest`

If `WEBHOOK_SECRET` is set, `POST /webhook/daily-brief` requires the `X-Webhook-Secret` header.

Example `GET /api/brief/latest` shape:

```json
{
  "brief": {
    "id": 1,
    "date": "2026-04-01",
    "fullContent": "...",
    "smsContent": "...",
    "voiceContent": "...",
    "priorityScore": 10,
    "isHighPriority": true,
    "createdAt": "2026-04-02T00:17:08.000Z"
  },
  "deliveryLogs": []
}
```

## n8n

The repo includes `n8n/daily-brief-workflow.json`.

Responsibility split:

- n8n:
  - schedule the run at `7:30 AM`
  - trigger the app webhook
- Node app:
  - gather Google/Gmail/local context
  - generate the brief
  - store it
  - apply duplicate-suppression rules
  - send SMS / voice when enabled
  - record workflow and smoke-test status

Import and configure in n8n:

1. Import `n8n/daily-brief-workflow.json`.
2. Keep the workflow timezone set to `America/Detroit`.
3. Set `FOUNDER_DAILY_BRIEF_BASE_URL`.
   Example: `http://127.0.0.1:3000`
4. If the app uses a webhook secret, set `WEBHOOK_SECRET` in n8n too.
5. Do not add automatic HTTP-request retries in n8n. The Node app owns delivery suppression and safety decisions.

Twilio delivery callbacks:

- set `APP_BASE_URL` to the public base URL of the Node app, not the n8n URL
- Twilio must be able to reach `POST /webhook/twilio/message-status`
- for local-only testing on your Mac, use a tunnel such as `ngrok` or `cloudflared` if you want final SMS status callbacks to arrive

DST safety:

- keep the app `TIMEZONE=America/Detroit`
- keep the n8n workflow timezone as `America/Detroit`
- keep the cron expression at `30 7 * * *` in that workflow timezone

## macOS launchd

If you want to run this from your Mac instead of n8n, the repo includes:

- wrapper script: `scripts/run-daily-brief.sh`
- LaunchAgent template: `launchd/com.stevenlohan.founder-daily-brief.daily.plist`

Recommended setup:

1. Build once:

```bash
npm run build
```

2. Test the scheduled entrypoint directly:

```bash
./scripts/run-daily-brief.sh --skip-delivery --date 2026-04-01
```

3. Copy the LaunchAgent into place:

```bash
mkdir -p ~/Library/LaunchAgents
cp launchd/com.stevenlohan.founder-daily-brief.daily.plist ~/Library/LaunchAgents/
```

4. Load it with modern `launchctl` commands:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.stevenlohan.founder-daily-brief.daily.plist 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.stevenlohan.founder-daily-brief.daily.plist
```

5. Kick off one manual test run now:

```bash
launchctl kickstart -k "gui/$(id -u)/com.stevenlohan.founder-daily-brief.daily"
```

6. Inspect logs:

```bash
tail -n 100 logs/launchd.stdout.log
tail -n 100 logs/launchd.stderr.log
```

What this LaunchAgent does:

- runs every day at `7:30 AM`
- refreshes the living docs before it generates the brief
- uses absolute paths
- runs from `/Users/stevenlohan/founder-daily-brief`
- writes stdout and stderr to `logs/`
- lets the wrapper resolve the current Node binary, including `nvm` setups

Before trusting the 7:30 AM run:

- keep the Mac awake, plugged in, and logged in for the first testing week
- confirm `.env` is complete
- confirm `npm run build` has been run after any code changes
- use `launchctl kickstart` before relying on the timed trigger
- if your username or repo path changes, update the plist paths before loading it

## Delivery safeguards

The current safeguards are:

- one stored brief per Detroit-local day
- duplicate SMS suppression for the same day unless forced
- duplicate voice suppression for the same day unless forced
- voice calls only on high-priority days unless manually forced
- dry-run never touches live delivery providers
- smoke tests are recorded separately from daily runs
- SMS delivery logs start as `pending` when Twilio accepts the API request and are updated to `sent` or `failed` when Twilio posts final status
- a same-day SMS retry is suppressed while the prior delivery is still `pending`
- Twilio sends do not auto-retry inside the app
- if a Twilio failure looks ambiguous enough that the provider may have accepted the request, later unattended retries are suppressed instead of risking duplicate user-facing sends

## Environment variables

See `.env.example` for the full list. The most important ones are:

- `TIMEZONE`
- `DATABASE_PATH`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_CALENDAR_IDS`
- `GMAIL_QUERY`
- `GMAIL_MAX_RESULTS`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `LLM_MODEL`
- `LLM_PROVIDER`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `RECIPIENT_PHONE_NUMBER`
- `APP_BASE_URL`
- `SMOKE_TEST_SMS_TO`
- `SMOKE_TEST_VOICE_TO`
- `ENABLE_SMS`
- `ENABLE_VOICE_CALLS`
- `DRY_RUN_MODE`
- `HIGH_PRIORITY_THRESHOLD`
- `WEBHOOK_SECRET`

Notes:

- normal runs fall back to the mock LLM provider when the configured live provider key is missing
- the LLM smoke test requires a real provider key for whichever `LLM_PROVIDER` you selected
- Google Calendar and inbox integrations degrade to empty data during normal runs if not configured
- set `GOOGLE_CALENDAR_ID` for a single calendar, or `GOOGLE_CALENDAR_IDS` as a comma-separated list such as `primary,slohan@umich.edu` to merge multiple Google calendars into one brief
- `GOOGLE_CALENDAR_IDS` can now use either raw ids or visible calendar names such as `primary,school calendar`
- Proton Mail Bridge requires the Bridge app and local IMAP credentials; the app does not connect directly to Proton’s hosted IMAP
- Twilio delivery fails closed if credentials or recipient are missing
- without `APP_BASE_URL`, Twilio SMS requests can still be accepted, but final delivered or undelivered callbacks cannot update the local status log
- placeholder values in `.env.example` are ignored by config parsing

## Public compliance page

For Twilio A2P registration, the repo includes a public-safe template at:

- `docs/privacy-and-terms.html`

Recommended publishing path:

1. Replace the placeholder support email in that file.
2. Do not add phone numbers, API keys, tokens, or internal operational details.
3. Publish the `docs/` folder with GitHub Pages.
4. Use the published URL for both the Privacy Policy URL and Terms & Conditions URL fields in Twilio if you are using the combined page approach.

Local safety notes:

- `.env` and other local env files are ignored by git
- local imported CSV data under `imports/` is ignored by git
- local SQLite files under `data/` are ignored by git

## Known limitations

- no live end-to-end Google, Proton Mail Bridge, Anthropic/OpenAI, or Twilio validation was possible in this sandbox
- no built-in Google OAuth callback route is exposed by the server
- no auth layer exists beyond the optional webhook secret
- Gmail body parsing is intentionally simple and may miss complex multipart formatting
- Proton Mail Bridge parsing is intentionally simple and may miss complex MIME formatting
- n8n import correctness was checked at the JSON/config level here, not by importing into a running n8n instance
