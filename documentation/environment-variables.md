# Environment variables

## Core
`ENVIRONMENT` Selects the per-site config block. One of `local`, `dev`, `staging`, `production`. Required when starting the Fastify server (CLI scripts fall back to `dev`). Also used by Sentry.

`HAKUVAHTI_API_KEY` Required. Clients must send `Authorization: api-key <value>` on every non-health-check request, or the response is `403`.

`FASTIFY_PORT` Port where Hakuvahti runs. Do not change this in local dev.

## Broadcast
`BROADCAST_TOTP_SECRET` Base32 TOTP secret. Required for `POST /broadcast` requests.
The request must carry 6-digit code `totp_code`, or it is rejected. When unset or
unreadable, broadcasting is disabled.

Generate the secret once per environment outside of the application, e.g.
`head -c 20 /dev/urandom | base32`, store it in the environment variables and share it
to the admin's authenticator app with the default parameters: SHA-1, 6 digits, 30 second
period.

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
