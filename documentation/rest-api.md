# REST Endpoints

All non-health-check endpoints require the `Authorization: api-key <HAKUVAHTI_API_KEY>` header.

## Add Subscription

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

## Confirm a subscription (email)

`POST` `/subscription/confirm/:id/:hash`

Requires the subscription's id and `hash`.

## Confirm a subscription (SMS)

`POST` `/subscription/sms/confirm/:id`

```json
{ "code": "<6-digit code sent by SMS>" }
```

Returns `400` if the code is invalid or expired. Caller MUST rate-limit.

## Renew a subscription (email)

`POST` `/subscription/renew/:id/:hash`

Resets `created` and the ATV `delete_after`, extending the lifetime.

## Renew a subscription (SMS)

`POST` `/subscription/sms/renew/:id`

Same as the email renew but id-only (no hash). Caller MUST rate-limit.

## Get subscription status

`GET` `/subscription/status/:id/:hash`

Returns:

```json
{ "subscriptionStatus": "active" | "inactive" | "disabled" }
```

`404` if no subscription matches the id + hash.

## Delete a subscription (email)

`DELETE` `/subscription/delete/:id/:hash`

Requires the subscription's id and `hash`.

## Delete a subscription (SMS)

`DELETE` `/subscription/sms/delete/:id`

Id-only (no hash). Caller MUST rate-limit.

## Broadcast a message

`POST` `/broadcast`

Broadcasts a one-off message to all subscribers of a single site. Every subscriber gets the message on each channel they have confirmed: emails go to email-confirmed subscribers, SMS to sms-confirmed subscribers on sites with `enableSms`. Recipients are deduplicated per channel (one email per address, one SMS per phone number). The most recently renewed one decides the language.

Requires the `X-Access-Token` header in addition to the API key:

```
X-Access-Token: <OpenID Connect access token of the admin sending the broadcast>
```

```json
{
    "site_id": "<id of a site configuration in conf/, e.g. rekry>",
    "messages": {
        "fi": { "subject": "<subject>", "body": "<plain text body>", "sms": "<optional SMS text>" },
        "sv": { "subject": "...", "body": "...", "sms": "..." },
        "en": { "subject": "...", "body": "...", "sms": "..." }
    },
    "subscription_ids": ["<optional: send only to these subscriptions>"]
}
```

- `X-Access-Token` is required. The API key says the request comes from one of our Drupal sites; the access token says which admin is behind it. It is verified against the identity provider's signing keys, and its `azp` claim has to name an allowed client (see the `OIDC_*` variables in [environment-variables.md](environment-variables.md)). Drupal renews the token before sending, so a token that has expired means the admin's session is no longer usable.
- All three languages are required; each subscriber receives their own language version wrapped in the site's email template.
- `subject` and `body` are plain text. Newlines in `body` become line breaks.
- `sms` SMS texts are sent verbatim and are ignored on sites without `enableSms`.
- `subscription_ids` (optional) enables test mode: the message is sent only to those subscriptions of the site, so admins can preview the message on their own subscriptions before the real broadcast.

Returns `202` with `{ "id": "<broadcast id>" }`. Sending continues in the background because contact details are resolved from ATV in batches, which can take minutes for large sites. Messages are inserted into the shared notification queue and delivered by `hav:send-queue`. Large broadcast can delay regular notifications by a few cron cycles.

Returns `409` if a broadcast for the same site is already processing (started within the last 30 minutes). Test sends neither set nor respect this guard.

Returns `400` if `X-Access-Token` is missing, and `403` if the token cannot be verified: a bad signature, an expired token, another issuer, or an `azp` that is not in `OIDC_ALLOWED_CLIENTS`. The admin has to log in again in that case.

Returns `500` if the `OIDC_*` variables are not configured or the issuer's discovery document cannot be read, so broadcasting fails closed.

## Broadcast status

`GET` `/broadcast/:id`

```json
{
    "id": "...",
    "site_id": "rekry",
    "status": "processing" | "completed" | "failed",
    "test": false,
    "created": "<ISO date>",
    "stats": {
        "subscriptionsChecked": 0,
        "emailsQueued": 0,
        "smsQueued": 0,
        "missingContacts": 0
    }
}
```

`stats` is `null` until the broadcast finishes. `missingContacts` counts subscriptions whose ATV document had no contact details.

## Health checks

`/healthz` — 200 if the server is up.

`/readiness` — 200 if the server is up and MongoDB is reachable.
