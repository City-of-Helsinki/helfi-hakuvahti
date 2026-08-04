# Environment variables

## Core
`ENVIRONMENT` Selects the per-site config block. One of `local`, `dev`, `staging`, `production`. Required when starting the Fastify server (CLI scripts fall back to `dev`). Also used by Sentry.

`HAKUVAHTI_API_KEY` Required. Clients must send `Authorization: api-key <value>` on every non-health-check request, or the response is `403`.

`FASTIFY_PORT` Port where Hakuvahti runs. Do not change this in local dev.

## Broadcast
Broadcasting is authorized with the OpenID Connect access token of the admin sending the
message.

`OIDC_ISSUER` The issuer the access token must come from, i.e. the Keycloak realm URL
(e.g. `https://tunnistus.test.hel.ninja/auth/realms/helsinki-tunnistus`). Tokens issued by
anything else are rejected. The keys the token signature is verified against are found via
the issuer's `.well-known/openid-configuration` document.

`OIDC_ALLOWED_CLIENTS` Comma separated list of the OpenID Connect client ids allowed to
broadcast.

## MongoDB
`MONGODB` MongoDB connection URL.

## Sentry
`SENTRY_DSN` Sentry DSN for logging and errors.

`SENTRY_RELEASE` Optional. Release identifier reported to Sentry.

## Asiointitietovarasto
`ATV_API_KEY` API key for ATV.

`ATV_API_URL` ATV base URL.

## SMTP Settings
`MAIL_FROM` From address (e.g. `noreply@hel.fi`).

`MAIL_HOST` SMTP host (e.g. `smtp.hel.fi`).

`MAIL_PORT` SMTP port (e.g. `25`).

`MAIL_SECURE` Set to the literal string `true` to enable TLS; any other value disables it.

`MAIL_AUTH_USER` SMTP username.

`MAIL_AUTH_PASS` SMTP password.

## Elisa Dialogi SMS Service (Optional)

`DIALOGI_API_URL` Elisa Dialogi API base URL (e.g. `https://viestipalvelu-api.elisa.fi/api/v1`).

`DIALOGI_API_KEY` API key / bearer token for Dialogi.

`DIALOGI_SENDER` SMS sender identifier (international number with `+`, shortcode, or alphanumeric up to 11 characters).

When unset, SMS is disabled and a startup warning is logged. Email continues to work.

For SMS to work end-to-end:
1. All three Dialogi env vars above are set.
2. The current environment's `subscription.enableSms` is `true` in `conf/<site>.json`.
3. The subscriber's phone number is in E.164 format (e.g. `+358501234567`).
4. `npm run hav:send-queue` runs at least once a minute in production.

## Testing

`TEST_SMS_NUMBER` Phone number (E.164, e.g. `+358501234567`) used by `npm run hav:test-sms-sending`.
