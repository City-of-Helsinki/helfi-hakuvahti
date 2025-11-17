# Hakuvahti

Hakuvahti is a Fastify / Node.js application which monitors Hel.fi website searches that use ElasticSearch with ElasticProxy and sends updates to the query results to subscribed emails.

Pre-requisities to use Hakuvahti are:
- Drupal website uses ElasticSearch and ElasticProxy for search.
- Field name in Drupal / ElasticSearch is for publication is `field_publication_starts`.
- Title uses default `title` field, together with default `url` field.
- Site has Asiointitietovarasto account for storing subscribed email securely.

## Architecture in a nutshell:

- Hakuvahti is an Fastify application and follows recommended project structure
  from `fastify-cli` tool. This means no manual routing, routes are autoloaded
  from `src/routes` and plugins are autoloaded from `src/plugins`. Helper libraries
  are under `src/lib` and type definitions with Typebox are under `src/types`.
- Hakuvahti uses [Typebox](https://github.com/sinclairzx81/typebox), which creates 
  Json schema objects that infer as TypeScript types. Naming is standardized as 
  `SomeThing` for Json schema which has corresponding `SomeThingType`.
- Hakuvahti uses MongoDB collection as a queue for outbound emails. This way
  performing API actions and collecting results from ElasticSearch does not 
  depend on possible ATV errors or network lag, or availability of 
  SMTP server.
- Adding, confirming, and deleting subscriptions happens through REST api, while: 
- ElasticProxy queries and sending emails happen through cron scripts.
- Subscriptions are also removed through cron script, based on expiration
  days in site configuration.
- Email templates are located under `src/templates/something/*.html`
  - Templates are suffixed with lang code, which is set per subscription.
  - Templates can be modified for different sites by copying them 
    to a different folder, i.e. `src/templates/something2` and updating
    the `mail.templatePath` in the site configuration.

## Development setup

- Copy `.env.dist` as `.env` and configure:
  - ElasticProxy (default to local rekry elasticsearch),
  - `ATC_API_KEY` (Hakuvahti will trigger an error if ATV cannot be reached)
- Configure site-specific settings in `conf/` directory (see Configuration section below)

Start the local environment with:

```bash
make fresh
```

Hakuvahti should be availabe at `https://hakuvahti.docker.so`.

Get a shell inside the container:

```bash
make shell
```

The local environment does not run cron scripts automatically. Run scripts manually when testing, see [`package.json`](./package.json) for available commands.

Shutdown the container with:

```bash
make down
```

## Configuration

### Queue Population Script

The `hav:populate-queue` script checks for new search results and queues notification emails and SMS messages. It supports site-specific processing and dry-run mode for testing.

**Usage:**

```bash
# Process all sites
npm run hav:populate-queue

# Process specific site only
npm run hav:populate-queue -- --site=rekry

# Preview what would happen without making changes (dry run)
npm run hav:populate-queue -- --dry-run

# Dry run for specific site
npm run hav:populate-queue -- --site=rekry --dry-run
```

**CLI Parameters:**
- `--site=<sitename>` - Process only the specified site (omit to process all sites)
- `--dry-run` - Preview mode that shows what would happen without making any database changes

**OpenShift Crontab Examples:**

```yaml
# Rekry site - check at 6 AM daily
- name: populate-rekry
  schedule: "0 6 * * *"
  command: ["npm", "run", "hav:populate-queue", "--", "--site=rekry"]

# General site - check hourly
- name: populate-general  
  schedule: "0 * * * *"
  command: ["npm", "run", "hav:populate-queue", "--", "--site=general"]

# Queue processor runs every minute (processes all sites)
- name: send-emails
  schedule: "* * * * *"
  command: ["npm", "run", "hav:send-emails-in-queue"]
```

**Note:** Each site can have its own schedule. The `--site` parameter allows you to control when each site's results are collected, which is useful when different sites want notifications at different times or to spread the load on ElasticSearch.

### Site Configuration Files

Create JSON configuration files in the `conf/` directory. Each file represents a site and should be named `{site-id}.json` (e.g., `rekry.json`).

Example configuration structure:

```json
{
  "name": "rekry",
  "dev": {
    "urls": {
      "base": "https://helfi-rekry.docker.so",
      "en": "https://helfi-rekry.docker.so/en",
      "fi": "https://helfi-rekry.docker.so/fi",
      "sv": "https://helfi-rekry.docker.so/sv"
    },
    "subscription": {
      "maxAge": 90,
      "unconfirmedMaxAge": 5,
      "expiryNotificationDays": 3
    },
    "mail": {
      "templatePath": "rekry"
    }
  },
  "prod": {
    "urls": {
      "base": "https://hel.fi",
      "en": "https://hel.fi/en",
      "fi": "https://hel.fi/fi",
      "sv": "https://hel.fi/sv"
    },
    "subscription": {
      "maxAge": 90,
      "unconfirmedMaxAge": 5,
      "expiryNotificationDays": 3
    },
    "mail": {
      "templatePath": "rekry"
    }
  }
}
```

### Environment Selection

The system automatically selects the correct environment configuration based on the `ENVIRONMENT` variable:
- Defaults to `local` if `ENVIRONMENT` is not set
- Use `ENVIRONMENT=production` for production deployment
- Sites usually have `local`, `dev`, `staging` and `production` environments

### Configuration Properties

- **`name`**: Human-readable site name
- **`urls`**: Localized URLs for the site
  - `base`: Main site URL
  - `en`, `fi`, `sv`: Language-specific URLs
- **`subscription`**: Subscription lifecycle settings
  - `maxAge`: Maximum subscription age in days
  - `unconfirmedMaxAge`: Days before unconfirmed subscriptions are removed
  - `expiryNotificationDays`: Days before expiry to send notification
- **`mail`**: Email template configuration
  - `templatePath`: Template directory under `src/templates/`

## Environment variables

### Core
`ENVIRONMENT` Either `production`, `staging` or `dev`. This is used by Sentry and/or other services that need environment info.

`FASTIFY_PORT` Port where Hakuvahti runs. Do not change this.

### Website
`BASE_URL` Website that uses Hakuvahti (for example https://www.hel.fi)

`BASE_URL_FI` `BASE_URL_SV` `BASE_URL_EN` Localized url for Drupal base url (for example https://www.hel.fi/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja)

`MAIL_TEMPLATE_PATH` Template path under `templates` folder (for example `rekry`)

### MongoDB
`MONGODB` Set MongoDB connection url

### Sentry
`SENTRY_DSN` Set Sentry URL for logging and errors

### ElasticProxy
`ELASTIC_PROXY_UR` Set url for ElasticProxy

### Asiointitietovarasto
`ATV_API_KEY` Set API key here

`ATV_API_URL` Set ATV url here

### Subscription settings
`SUBSCRIPTION_MAX_AGE` Subscription max age in days (for example `90` days (3 months))

`UNCONFIRMED_SUBSCRIPTION_MAX_AGE` Subscription max age when it doesn't get confirmed (for example `5` days)

`SUBSCRIPTION_EXPIRY_NOTIFICATION_DAYS` How many days before expiration should we send notification (for example `3` days)

### SMTP Settings
`MAIL_FROM` (For example `noreply@hel.fi`)

`MAIL_HOST` (For example `smtp.hel.fi`)

`MAIL_PORT` (For example `25`)

`MAIL_SECURE` (Boolean, `true` or `false`)

`MAIL_AUTH_USER` (Username to authenticate at SMTP server)

`MAIL_AUTH_PASS` (Password to authenticate at SMTP server)

### Elisa Dialogi SMS Service (Optional)

Hakuvahti supports sending SMS notifications via Elisa Dialogi API. SMS notifications are optional and work alongside email notifications.

`DIALOGI_API_URL` Set the Elisa Dialogi API base URL (for example `https://viestipalvelu-api.elisa.fi/api/v1/`)

`DIALOGI_API_KEY` Set the API key/bearer token for Dialogi authentication

`DIALOGI_SENDER` Set the SMS sender identifier (international number with +, shortcode, or alphanumeric max 11 characters)

**Note:** If these environment variables are not set, SMS functionality will be disabled and only email notifications will be sent. The system will log a warning on startup if Dialogi is not configured.

For SMS notifications to work:
1. Users must provide their phone number in E.164 international format (e.g., `+358501234567`) when subscribing
2. Run the SMS queue processor: `npm run hav:send-sms-in-queue` (should be run at least once per minute in production)

### Testing

`TEST_SMS_NUMBER` Set your phone number in E.164 format for testing SMS sending (e.g., `+358501234567`). Used by `npm run hav:test-sms-sending` to verify Dialogi API integration.

# REST Endpoints:

## Add Subscription

`POST` `/subscription`

Adds new Hakuvahti subscription:

```json
{
    "elastic_query": "<full elastic query as base64 encoded string>",
    "search_description": "<Some search with terms, used in email notifications>",
    "query": "<url back to webpage for search results>",
    "email": "<email to subscribe>",
    "lang": "fi"
}
```

## Confirm a subscription

`GET` `/subscription/confirm/:id/:hash`

Confirms a subscription. To confirm a subscription, user must know both the id and hash (`hash` field in collection).

Subscriptions that are not confirmed, will not be checked during `npm run hav:populate-queue` command.

## Delete a subscription

`DELETE` `/subscription/delete/:id/:hash`

Deletes a subscription. To delete a subscription, user must know both the id and hash (`hash` field in collection).

## Health checks

Hakuvahti includes OpenShift compatible endpoints for health check:

`/healthz` Returns 200 OK and confirms Hakuvahti server is running.

`/readiness` Returns 200 OK and confirms Hakuvahti server is running and MongoDB connection is working.

## Command line / cron actions

### Initialize MongoDB collections

`npm run hav:init-mongodb`

Initialize MongoDB collections. Required before running populate or send commands.

### Query for new results for subscriptions

`npm run hav:populate-queue`

Queries all Hakuvahti entries and checks for new results in ElasticSearch. This populates the email and SMS queues.

Removes expired subscriptions.

Adds following notifications to queues:

- **Email queue**: New results from ElasticQuery queries and expiry notifications
- **SMS queue**: New results notifications (only for subscriptions with SMS in ATV)

### Sends emails from queue

`npm run hav:send-emails-in-queue`

Sends emails in queue that were generated by `hav:populate-queue`

### Sends SMS from queue

`npm run hav:send-sms-in-queue`

Sends SMS messages in queue that were generated by `hav:populate-queue`. Only processes subscriptions that have SMS stored in ATV.

### Test SMS Sending

`npm run hav:test-sms-sending`

Test script to verify Elisa Dialogi SMS API integration. Sends test SMS messages in all supported languages (fi, sv, en) to a specified phone number.

**Prerequisites:**
- Set `TEST_SMS_NUMBER` in your `.env` file (e.g., `TEST_SMS_NUMBER=+358501234567`)
- Configure `DIALOGI_API_URL` and `DIALOGI_API_KEY`
- Build the project: `npm run build:ts`

**Example usage:**
```bash
# Add to .env file:
TEST_SMS_NUMBER=+358501234567

# Build and run test
npm run build:ts
npm run hav:test-sms-sending
```

The script will send three test SMS messages (one per language) with dummy search data to verify the integration is working correctly.

### Mock server

See [dialogi-server.md](./documentation/dialogi-server.md).