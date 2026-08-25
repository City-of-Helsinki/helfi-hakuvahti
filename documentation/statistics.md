# Statistics

`GET /stats/:site_id` reports per-site subscription figures from the `statistics` collection.
Response fields: [rest-api.md](./rest-api.md). Producing the figures by hand:
[testing.md](./testing.md#testing-statistics).

## Storage

One document per site per day, `_id` = `<site_id>:<day>`.

- `day` is `YYYY-MM-DD` in **Europe/Helsinki**, produced by `Statistics.day()` in [statistics.ts](../src/lib/statistics.ts).
  A counter written after 21:00–22:00 UTC lands on the next day's document.
- Counters are incremented by the code performing the action. No job aggregates them, and no stored day is recomputed.
- Documents are sparse: an absent counter is zero, and a language with no activity has no subtree. The endpoint zero-fills both.
- `subscription` holds current state only. The endpoint reads `statistics` for past periods and counts `subscription` live for `current`.
- Periods before `collecting_since` return zeros; nothing backfills them.
- A failed counter write never fails the operation that triggered it: the counter is lost and reported to Sentry.

```js
{
  _id: 'rekry:2026-08-17',
  site_id: 'rekry',
  day: '2026-08-17',
  created: ISODate('2026-08-17T04:00:09Z'),   // when the document was first written
  events: { created: 15, confirmed: 13, cancelled: 1, expired: 4 },
  lang: {
    fi: { created: 14, confirmed: 12, cancelled: 1, expired: 4 },
    sv: { created: 1,  confirmed: 1 }
  },
  snapshot: { at: ISODate('2026-08-17T04:00:09Z'), active: 4981, unconfirmed: 37 }
}
```

## Triggers

Subscription status values: `0` INACTIVE (unconfirmed), `1` ACTIVE, `2` DISABLED.

| Counter | Written when | Written by |
|---|---|---|
| `created` | `POST /subscription` inserts a row, confirmed or not | [addSubscription.ts](../src/routes/addSubscription.ts) |
| `confirmed` | An email or SMS confirmation moves a row from status `0` to `1`. Once per subscription, not per channel | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) |
| `cancelled` | `DELETE /subscription/delete/:id/:hash` or `/subscription/sms/delete/:id` on a status `1` row | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) |
| `cancelled_unconfirmed` | The same two endpoints on a status `0` row | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) |
| `expired` | `hav:populate-queue` deletes a status `1` row whose `created` is older than the site's `maxAge` | [subscriptionExpiry.ts](../src/lib/subscriptionExpiry.ts) |
| `expired_unconfirmed` | `hav:populate-queue` deletes a status `0` row older than `unconfirmedMaxAge` | [subscriptionExpiry.ts](../src/lib/subscriptionExpiry.ts) |
| `snapshot` | `hav:populate-queue` measures live `active` and `unconfirmed`, once per site per run | [hav-populate-queue.ts](../src/bin/hav-populate-queue.ts) |

Deleting or confirming a status `2` row writes no counter. `--dry-run` writes no statistics, and `--site`
filters the notification pass only: expiry and measurement always cover every configured site.

## Languages

Every counter is also recorded per language, in the same `Statistics.record()` update as the total:

```
lang.fi.X + lang.sv.X + lang.en.X === events.X      for every counter X
```

An unknown event or language name writes neither path and reports to Sentry. Expiry deletes rows whose
`lang` is not `fi`, `sv` or `en` without counting them, and logs the number to Sentry.
