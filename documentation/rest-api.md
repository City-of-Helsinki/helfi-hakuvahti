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
        "fi": { "subject": "<subject>", "body": "<plain text body>" },
        "sv": { "subject": "...", "body": "..." },
        "en": { "subject": "...", "body": "..." }
    },
    "subscription_ids": ["<optional: send only to these subscriptions>"]
}
```

- `X-Access-Token` is required. The API key says the request comes from one of our Drupal sites; the access token says which admin is behind it. It is verified against the identity provider's signing keys, and its `azp` claim has to name an allowed client (see the `OIDC_*` variables in [environment-variables.md](environment-variables.md)). Drupal renews the token before sending, so a token that has expired means the admin's session is no longer usable.
- The admin also has to be **allowed to broadcast for this particular site**. The token's `ad_groups` claim has to contain one of the values in the `broadcast.adGroups` list of the site's `conf/{site}.json` for the current `ENVIRONMENT`.
- All three languages are required; each subscriber receives their own language version wrapped in the site's email template.
- `subject` and `body` are plain text. Newlines in `body` become line breaks.
- All channels are composed from the same `subject` and `body`.
- `subscription_ids` (optional) enables test mode: the message is sent only to those subscriptions of the site, so admins can preview the message on their own subscriptions before the real broadcast.

Returns `202` with an empty body. Sending continues in the background because contact details are resolved from ATV in batches, which can take minutes for large sites. Messages are inserted into the shared notification queue and delivered by `hav:send-queue`. Large broadcast can delay regular notifications by a few cron cycles.

Returns `400` if `X-Access-Token` is missing, and `403` if the token cannot be verified.

Returns `403` with `Not authorized to broadcast for this site.` if the token is fine but the admin is in none of the site's `broadcast.adGroups`, or the token carries no `ad_groups` claim at all.

Returns `500` if the `OIDC_*` variables are not configured, the issuer's discovery document cannot be read, or the site has no `broadcast.adGroups` configured for the current environment, so broadcasting fails closed.

## Key figures

`GET` `/stats/:site_id`

Per-site subscription figures for product owners. One site per request — a hakuvahti *is* a `site_id`.

| Parameter | In | Default | Values |
|---|---|---|---|
| `site_id` | path | — | must match a filename under `conf/` |
| `interval` | query | `month` | `day`, `month` |
| `from` | query | 12 months / 30 days back | `YYYY-MM-DD` |
| `to` | query | today | `YYYY-MM-DD` |

Authorization is the shared API key, same as every other endpoint. Any key holder can read any site — the response is aggregate counts with no personal data in it. Per-admin scoping belongs in Drupal, which already knows who owns which site.

```json
{
    "site_id": "rekry",
    "generated_at": "2027-02-05T09:12:33.000Z",
    "collecting_since": "2026-09-15",
    "range": { "from": "2026-02-01", "to": "2027-02-28", "interval": "month" },
    "current": { "active": 5388, "unconfirmed": 41 },
    "periods": [
        {
            "period": "2026-10",
            "created": 455, "confirmed": 402,
            "cancelled": 38, "cancelled_unconfirmed": 0,
            "expired": 131, "expired_unconfirmed": 53,
            "confirmed_by_lang": { "fi": 373, "sv": 17, "en": 12 },
            "net_change": 233, "active_end": 5010, "incomplete": false
        }
    ]
}
```

### Reading the numbers

- `current` is counted live off `subscription`, so it is right even if the cron has not run today. Everything under `periods` comes from stored counters.
- **`confirmed` is the "new subscriptions" figure**, not `created`. `created` counts signups that began; `confirmed` counts the ones that became active, and only once per subscription even when the subscriber confirms both email and SMS. The conversion rate is `confirmed / created`.
- `cancelled` is *keskeytetty* — the user unsubscribed. `expired` is *vanhentunut* — the subscription reached the site's `maxAge` and the cron deleted it. The `_unconfirmed` variants are the same events for subscriptions that never became active, kept separate so churn is not inflated by people who never finished signing up.
- `net_change` is `confirmed − cancelled − expired`. Its running total should track the `active_end` series; a persistent divergence between them means an event is being missed. It is `null` — not `0` — when the period has no stored data at all, so "nothing was recorded" cannot be read as "no churn happened". A quiet period that *was* being monitored reports a real `0`, because the cron leaves a daily measurement behind even on a day when nothing else happens.
- `active_end` is the last measured active count in the period, `null` if the cron wrote no measurement for it. Gaps are reported as gaps rather than carried forward.
- `confirmed_by_lang` always sums to `confirmed` exactly, because a subscription has exactly one language. It is safe to read as a partition and to turn into percentages.
- `range` echoes the **effective** range. `from` snaps back to the start of its period and `to` out to the end of its, so a period is never half-reported; `to` is clamped to today; and a very long range is capped (366 days / 120 months).

### Two things that will otherwise be misread

- `collecting_since` — periods before it read zero because nothing was being recorded, not because nothing happened. Do not render pre-launch zeroes as real.
- `incomplete` — the period has not ended, so its counters are still growing. Without surfacing this, "this month" next to "last month" reads as a collapse that is only the calendar.

A configured site with no data yet is `200` with `collecting_since: null` and a zero-filled series, not `404`.

Returns `400` with `{ "error": "Invalid site_id provided." }` for a site with no configuration, and `{ "error": "Invalid date.", "field": "from" }` for a date the calendar does not have, such as `2026-02-31`.

The response is JSON only. A spreadsheet export is the consumer's to render — `confirmed_by_lang` and the monthly rollup are already in the shape a table needs.

## Health checks

`/healthz` — 200 if the server is up.

`/readiness` — 200 if the server is up and MongoDB is reachable.
