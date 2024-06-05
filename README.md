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
- Adding, confirming and deleting subscriptions happens through REST api, while: 
- ElasticProxy queries and sending emails happen through cron scripts.
- Subscriptions are also removed through cron script, based on expiration
  days in `.env` configuration.
- Email templates are located under `src/templates/something/*.html`
  - Templates are suffixed with lang code, which is set per subscription.
  - Templates can be modified for different sites by copying them 
    to a different folder, ieg. `src/templates/something2` and changing
    `MAIL_TEMPLATE_PATH` envvar.

## Installing and running Hakuvahti

- `npm i` to install dependencies
- Copy `.env.dist` as `.env` and configure:
  - MongoDB,
  - ElasticProxy, 
  - SMTP settings for email sending,
  - [ATV integration](https://github.com/City-of-Helsinki/atv)
  - Subscription days, etc settings
- Create MongoDB collections: `npm run hav:init-mongodb`
- `npm start` (or `npm run dev` for development)
- Hakuvahti should now be running in port `:3000` (by default)
- For production environment, add following commands to cron:
  - `npm run hav:populate-email-queue` (this should be run once per hour or at least daily)
  - `npm run hav:send-emails-from-queue` (this should be ran at least once per minute)

## Local docker environment:

- Run `docker-compose build && docker-compose up` 
- Note that local docker environment with corresponding Drupal site expects that Hakuvahti is checked out to the default folder `helfi-hakuvahti`. Otherwise you might run into `network <network name> declared as external, but could not be found`.
- Hakuvahti server should work at `http://localhost:3000`
- Subscription email is printed out to logs for easier testing. To receive results from new hits, you can use Mailhog locally.

## Environment variables

### Core
`ENVIRONMENT` Either `production`, `staging` or `dev`. This is used by Sentry and/or other services that need environment info.

`FASTIFY_PORT` Port where Hakuvahti runs (for example `3000`). If you change the envvar, remember to update Dockerfile and compose.yaml.

### Website
`BASE_URL` Website that uses Hakuvahti (for example https://www.hel.fi)

`BASE_URL_FI` `BASE_URL_SV` `BASE_URL_EN` Localized url for Drupal base url (for example https://www.hel.fi/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja)

`MAIL_TEMPLATE_PATH` Template path under `templates` folder (for example `rekry`)

`MAIL_CONFIRMATION_LINK` (Website url for confirming subscription. /subscription/id/hash will be appended)

`REMOVE_CONFIRMATION_LINK` (Website url for confirming subscription. /subscription/delete/id/hash will be appended)

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

# REST Endpoints:

## Add Subscription

`POST` `/subscription`

Adds new Hakuvahti subscription:

```
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

Subscriptions that are not confirmed, will not be checked during `npm run hav:populate-email-queue ` command.

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

`npm run hav:populate-email-queue`

Queries all Hakuvahti entries and checks for new results in ElasticSearch. This populates the email queue.

Removes expired subscriptions.

Adds following emails to the email queue:

- New results from ElasticQuery queries
- Notifications if subscription is going to expire

### Sends emails from queue

`npm run hav:send-emails-from-queue`

Sends emails in queue that were generated by `hav:populate-email-queue`
