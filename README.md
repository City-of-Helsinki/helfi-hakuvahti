# Hakuvahti

Hakuvahti is a Fastify / Node.js application that monitors Hel.fi searches (ElasticSearch via ElasticProxy) and notifies subscribers of new results by email and optional SMS.

Prerequisites:
- Drupal site uses ElasticSearch + ElasticProxy.
- The site config's `matchField` names the ElasticSearch field that holds each result's publication timestamp (e.g. `field_publication_starts`).
- Results expose `title` and `url` fields.
- Site has an Asiointitietovarasto (ATV) account for storing subscriber contact info.
- For SMS: site has access to the Elisa Dialogi SMS service.

## Architecture

- Follows the `fastify-cli` layout: routes autoload from `src/routes`, plugins from `src/plugins`. Libraries in `src/lib`, Typebox types in `src/types`.
- Uses [Typebox](https://github.com/sinclairzx81/typebox) for JSON-schema-derived TypeScript types. Convention: `SomeThing` is the schema, `SomeThingType` the inferred TS type.
- A single MongoDB `queue` collection holds outbound email and SMS notifications, so API and ElasticSearch work is not blocked by ATV errors, network lag, or SMTP/Dialogi outages.
- Adding, confirming, renewing, and deleting subscriptions happen through the REST API.
- ElasticProxy queries, notification delivery, and expired-subscription cleanup run as cron scripts. Cleanup uses each site's `maxAge` / `unconfirmedMaxAge`.
- Email templates live under `src/templates/<templatePath>/*.html`, SMS templates under `src/templates/<templatePath>/sms/*.txt`. There is one template file per message type; per-language strings come from the site config's `translations` map, with the subscription's `lang` exposed as a template variable. To customize a site's templates, copy the folder and update `mail.templatePath` in its config.

## Development setup

- Copy `.env.dist` to `.env` and set:
  - `ATV_API_KEY` / `ATV_API_URL` — Hakuvahti errors out if ATV is unreachable.
  - `HAKUVAHTI_API_KEY` — required; protects every non-health-check route.
  - `DIALOGI_API_URL` / `DIALOGI_API_KEY` / `DIALOGI_SENDER` — only if testing SMS.
- Add per-site config under `conf/` (see Configuration below).

Start the local environment with:

```bash
make fresh
```

Hakuvahti should be available at `https://hakuvahti.docker.so`.

Get a shell inside the container:

```bash
make shell
```

The local environment does not run cron scripts automatically — run them manually. See [`package.json`](./package.json) for the list.

Shutdown the container with:

```bash
make down
```

## Configuration

### Queue Population Script

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

# General site - check hourly
- name: populate-general
  schedule: "0 * * * *"
  command: ["npm", "run", "hav:populate-queue", "--", "--site=etusivu"]

# Queue processor runs every minute (processes both email and SMS queue items)
- name: send-queue
  schedule: "* * * * *"
  command: ["npm", "run", "hav:send-queue"]
```

**Note:** Different sites can run on different schedules — useful for staggered ElasticSearch load or per-site delivery timing.

### Site Configuration Files

Each site is defined by a `{site-id}.json` file in `conf/` (e.g. `rekry.json`). A config has top-level fields (`name`, `translations`, `matchField`, `fieldFormats`) plus one block per environment (`local` / `dev` / `staging` / `production`) containing `urls`, `subscription`, `mail`, and `elasticProxyUrl`.

Example:

```json
{
  "name": "rekry",
  "matchField": "field_publication_starts",
  "fieldFormats": {
    "url": "url"
  },
  "translations": {
    "email_subject_confirmation": {
      "fi": "Vahvista työpaikkojen hakuvahdin tilaus",
      "en": "Confirm your saved search for jobs",
      "sv": "Bekräfta beställningen av sökvakten för arbetsplatser"
    }
    // ...remaining translation keys, see conf/rekry.json for the full set
  },
  "local": {
    "urls": {
      "base": "https://helfi-rekry.docker.so",
      "en": "https://helfi-rekry.docker.so/en",
      "fi": "https://helfi-rekry.docker.so/fi",
      "sv": "https://helfi-rekry.docker.so/sv"
    },
    "subscription": {
      "maxAge": 90,
      "unconfirmedMaxAge": 5,
      "expiryNotificationDays": 3,
      "enableSms": true,
      "smsCodeExpireConfirmMinutes": 60,
      "smsCodeExpireActionMinutes": 720
    },
    "mail": {
      "templatePath": "rekry",
      "maxHitsInEmail": 10
    },
    "elasticProxyUrl": "http://helfi-rekry-elastic-proxy:8080/job_listings"
  },
  "dev": { "...": "same shape as local" },
  "staging": { "...": "same shape as local" },
  "production": { "...": "same shape as local" }
}
```

See [`conf/rekry.json`](./conf/rekry.json) for a full example with all translation keys.

### Environment Selection

The `ENVIRONMENT` variable selects which block in each site config is used. Valid values: `local`, `dev`, `staging`, `production`. Required when starting the Fastify server; CLI scripts fall back to `dev` if unset.

### Configuration Properties

Top-level (shared across all environments):

- **`name`**: Human-readable site name.
- **`matchField`**: ElasticSearch `_source` field holding each result's publication timestamp (e.g. `field_publication_starts`). Hits whose value here is newer than the subscription's `last_checked` are queued.
- **`fieldFormats`**: Optional map from ES field name → formatter. Built-ins: `url` (prepends the site's `base` URL), `date` (Unix seconds → `dd.mm.yyyy`, `Europe/Helsinki`).
- **`translations`**: Per-language strings injected into email and SMS templates. Required keys vary per site — see `conf/rekry.json` for the full set.

Per-environment (`local` / `dev` / `staging` / `production`):

- **`urls`**: Localized URLs.
  - `base`: Main site URL.
  - `en`, `fi`, `sv`: Per-language URLs used in notification links.
- **`elasticProxyUrl`**: Full URL to this site's ElasticProxy index endpoint.
- **`subscription`**:
  - `maxAge`: Max subscription age in days.
  - `unconfirmedMaxAge`: Days before unconfirmed subscriptions are removed.
  - `expiryNotificationDays`: Days before expiry to send the expiry notification.
  - `enableSms`: Master SMS switch. When `false`, all SMS output for the site (confirmation, new-hits, renewal) is suppressed.
  - `smsCodeExpireConfirmMinutes`: Validity period of an SMS confirmation code.
  - `smsCodeExpireActionMinutes`: Validity period of an SMS action token (unsubscribe / renew links sent over SMS).
- **`mail`**:
  - `templatePath`: Template directory under `src/templates/`.
  - `maxHitsInEmail`: Cap on hits rendered in a single email; defaults to 10. Additional hits remain reachable via the search link.

## Environment variables

### Core
`ENVIRONMENT` Selects the per-site config block. One of `local`, `dev`, `staging`, `production`. Required when starting the Fastify server (CLI scripts fall back to `dev`). Also used by Sentry.

`HAKUVAHTI_API_KEY` Required. Clients must send `Authorization: api-key <value>` on every non-health-check request, or the response is `403`.

`FASTIFY_PORT` Port where Hakuvahti runs. Do not change this in local dev.

### MongoDB
`MONGODB` MongoDB connection URL.

### Sentry
`SENTRY_DSN` Sentry DSN for logging and errors.

`SENTRY_RELEASE` Optional. Release identifier reported to Sentry.

### Asiointitietovarasto
`ATV_API_KEY` API key for ATV.

`ATV_API_URL` ATV base URL.

### SMTP Settings
`MAIL_FROM` From address (e.g. `noreply@hel.fi`).

`MAIL_HOST` SMTP host (e.g. `smtp.hel.fi`).

`MAIL_PORT` SMTP port (e.g. `25`).

`MAIL_SECURE` Set to the literal string `true` to enable TLS; any other value disables it.

`MAIL_AUTH_USER` SMTP username.

`MAIL_AUTH_PASS` SMTP password.

### Elisa Dialogi SMS Service (Optional)

`DIALOGI_API_URL` Elisa Dialogi API base URL (e.g. `https://viestipalvelu-api.elisa.fi/api/v1`).

`DIALOGI_API_KEY` API key / bearer token for Dialogi.

`DIALOGI_SENDER` SMS sender identifier (international number with `+`, shortcode, or alphanumeric up to 11 characters).

When unset, SMS is disabled and a startup warning is logged. Email continues to work.

For SMS to work end-to-end:
1. All three Dialogi env vars above are set.
2. The current environment's `subscription.enableSms` is `true` in `conf/<site>.json`.
3. The subscriber's phone number is in E.164 format (e.g. `+358501234567`).
4. `npm run hav:send-queue` runs at least once a minute in production.

### Testing

`TEST_SMS_NUMBER` Phone number (E.164, e.g. `+358501234567`) used by `npm run hav:test-sms-sending`.

> Note: legacy environment variables `BASE_URL`, `BASE_URL_FI`, `BASE_URL_SV`,
> `BASE_URL_EN`, `MAIL_TEMPLATE_PATH`, `ELASTIC_PROXY_URL`, `SUBSCRIPTION_MAX_AGE`,
> `UNCONFIRMED_SUBSCRIPTION_MAX_AGE`, and `SUBSCRIPTION_EXPIRY_NOTIFICATION_DAYS`
> are no longer used as primary configuration — these values now come from the
> per-site JSON config in `conf/`. They may still appear in older deployment
> manifests but can be removed.

## REST Endpoints

All non-health-check endpoints require the `Authorization: api-key <HAKUVAHTI_API_KEY>` header.

### Add Subscription

`POST` `/subscription`

Adds a new subscription. At least one of `email` or `sms` is required.

```json
{
    "elastic_query": "<full elastic query as base64-encoded string>",
    "search_description": "<Some search with terms, used in notifications>",
    "query": "<url back to webpage for search results>",
    "email": "<email to subscribe (optional if sms provided)>",
    "sms": "<phone number in E.164 format, e.g. +358501234567 (optional if email provided)>",
    "site_id": "<id of a site configuration in conf/, e.g. rekry>",
    "lang": "fi",
    "user_data_in_atv": 1
}
```

- `site_id` is required and must match a filename under `conf/`.
- `user_data_in_atv` (optional, truthy number): when set, `query`, `search_description`, and `elastic_query` are stored in ATV instead of MongoDB.
- A phone number can be submitted on any site, but SMS delivery is gated by `enableSms`. When `enableSms` is `false` the confirmation SMS is suppressed and `hav:populate-queue` queues no SMS for the site; subscriptions created during that period never become `sms_confirmed`, so flipping `enableSms` on later does not deliver to them — only already SMS-confirmed subscriptions resume.

### Confirm a subscription (email)

`POST` `/subscription/confirm/:id/:hash`

Requires the subscription's id and `hash`.

### Confirm a subscription (SMS)

`POST` `/subscription/sms/confirm/:id`

```json
{ "code": "<6-digit code sent by SMS>" }
```

Returns `400` if the code is invalid or expired. Caller MUST rate-limit.

### Renew a subscription (email)

`POST` `/subscription/renew/:id/:hash`

Resets `created` and the ATV `delete_after`, extending the lifetime.

### Renew a subscription (SMS)

`POST` `/subscription/sms/renew/:id`

Same as the email renew but id-only (no hash). Caller MUST rate-limit.

### Get subscription status

`GET` `/subscription/status/:id/:hash`

Returns:

```json
{ "subscriptionStatus": "active" | "inactive" | "disabled" }
```

`404` if no subscription matches the id + hash.

### Delete a subscription (email)

`DELETE` `/subscription/delete/:id/:hash`

Requires the subscription's id and `hash`.

### Delete a subscription (SMS)

`DELETE` `/subscription/sms/delete/:id`

Id-only (no hash). Caller MUST rate-limit.

### Health checks

OpenShift-compatible. No `Authorization` header required.

`/healthz` — 200 if the server is up.

`/readiness` — 200 if the server is up and MongoDB is reachable.

## CLI commands

### Initialize MongoDB collections

`npm run hav:init-mongodb`

Creates the `queue` and `subscription` collections with their JSON-schema validators, and drops the legacy `smsqueue` collection if present. Run once before the first `populate` / `send` command.

### Populate the notification queue

`npm run hav:populate-queue`

Queries every confirmed subscription against ElasticSearch and populates the notification queue. Also:

- Removes expired subscriptions using each site's `maxAge` / `unconfirmedMaxAge`.
- Syncs ATV `delete_after` whenever it disagrees with `created + maxAge` (handles `maxAge` config changes and legacy subscriptions without `delete_after`).

Queues:
- **Email** — new results, expiry notifications.
- **SMS** — new results, renewal notifications. Only for `sms_confirmed` subscriptions on sites with `enableSms: true`.

Supports `--site=<id>` and `--dry-run` (see Queue Population Script above).

### Send notifications from queue

`npm run hav:send-queue`

Processes both `type: "email"` and `type: "sms"` items from the `queue` collection, sending via SMTP / Dialogi. Run at least once per minute in production.

### Update subscription length (maintenance)

`npm run hav:update-subscription-length -- --site=<id> [--batch-size=<n>] [--dry-run]`

Recalculates `delete_after` for every subscription on a site using the current `subscription.maxAge` and updates the corresponding ATV documents. Run after changing `maxAge` so existing ATV records match.

- `--site=<id>` (required) — site to migrate.
- `--batch-size=<n>` — ATV update batch size; defaults to 100.
- `--dry-run` — preview without writing to ATV.

### Test SMS sending

`npm run hav:test-sms-sending`

Sends one test SMS per supported language (fi, sv, en) to `TEST_SMS_NUMBER` to verify the Dialogi integration.

Requires `TEST_SMS_NUMBER`, `DIALOGI_API_URL`, and `DIALOGI_API_KEY` in `.env`, and a prior `npm run build:ts`.

### Test email templates for one site

`npm run hav:test-email-templates -- --site=<id>`

Queues nine dummy emails for the given site — confirmation, expiry, and new-hits, each rendered in fi, en, and sv. Requires at least one existing subscription in the database; its `atv_id` is used as the recipient. Run `hav:send-queue` afterwards and inspect the output in Mailpit.

### Test email templates for all sites

`npm run hav:test-all-templates -- --email=<address>`

Renders every email and SMS template across all sites and sends them directly via SMTP to the given address (SMS is wrapped as email for Mailpit). Bypasses the queue. View at https://mailpit.docker.so/ in local dev.

### Mock Dialogi server

`npm run hav:run-dialogi-test-server`

Mock Dialogi API for local development — no real SMS sent. See [dialogi-server.md](./documentation/dialogi-server.md) for the `DIALOGI_API_URL` value to put in `.env`.
