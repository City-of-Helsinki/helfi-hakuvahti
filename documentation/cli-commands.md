# CLI commands

## Queue Population

The `hav:populate-queue` script checks for new search results, queues notification emails and SMS, syncs ATV `delete_after` values that disagree with the current site config, and removes expired subscriptions. Supports site filtering and dry-run mode.

**Usage:**

```bash
# Process all sites
npm run hav:populate-queue

# Process specific site only
npm run hav:populate-queue -- --site=rekry

# Dry run (no writes)
npm run hav:populate-queue -- --dry-run

# Dry run, one site
npm run hav:populate-queue -- --site=rekry --dry-run
```

**CLI Parameters:**
- `--site=<sitename>` — process only the specified site (omit to process all)
- `--dry-run` — read-only preview; no writes to MongoDB or ATV

**OpenShift Crontab Examples:**

```yaml
# Rekry site - check at 6 AM daily
- name: populate-rekry
  schedule: "0 6 * * *"
  command: ["npm", "run", "hav:populate-queue", "--", "--site=rekry"]

# Queue processor runs every minute (processes both email and SMS queue items)
- name: send-queue
  schedule: "* * * * *"
  command: ["npm", "run", "hav:send-queue"]
```

**Note:** Different sites can run on different schedules — useful for staggered ElasticSearch load or per-site delivery timing.


## Initialize MongoDB collections

`npm run hav:init-mongodb`

Creates the `queue` and `subscription` collections with their JSON-schema validators, and drops the legacy `smsqueue` collection if present. Run once before the first `populate` / `send` command.

## Send notifications from queue

`npm run hav:send-queue`

Processes both `type: "email"` and `type: "sms"` items from the `queue` collection, sending via SMTP / Dialogi. Run at least once per minute in production.

## Update subscription length (maintenance)

`npm run hav:update-subscription-length -- --site=<id> [--batch-size=<n>] [--dry-run]`

Recalculates `delete_after` for every subscription on a site using the current `subscription.maxAge` and updates the corresponding ATV documents. Run after changing `maxAge` so existing ATV records match.

- `--site=<id>` (required) — site to migrate.
- `--batch-size=<n>` — ATV update batch size; defaults to 100.
- `--dry-run` — preview without writing to ATV.

## Test SMS sending

`npm run hav:test-sms-sending`

Sends one test SMS per supported language (fi, sv, en) to `TEST_SMS_NUMBER` to verify the Dialogi integration.

Requires `TEST_SMS_NUMBER`, `DIALOGI_API_URL`, and `DIALOGI_API_KEY` in `.env`, and a prior `npm run build:ts`.

## Test email templates for one site

`npm run hav:test-email-templates -- --site=<id>`

Queues nine dummy emails for the given site — confirmation, expiry, and new-hits, each rendered in fi, en, and sv. Requires at least one existing subscription in the database; its `atv_id` is used as the recipient. Run `hav:send-queue` afterwards and inspect the output in Mailpit.

## Test email templates for all sites

`npm run hav:test-all-templates -- --email=<address>`

Renders every email and SMS template across all sites and sends them directly via SMTP to the given address (SMS is wrapped as email for Mailpit). Bypasses the queue. View at https://mailpit.docker.so/ in local dev.

## Mock Dialogi server

`npm run hav:run-dialogi-test-server`

Mock Dialogi API for local development — no real SMS sent. See [dialogi-server.md](./dialogi-server.md) for the `DIALOGI_API_URL` value to put in `.env`.
