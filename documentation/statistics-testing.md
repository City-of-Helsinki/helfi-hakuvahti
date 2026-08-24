# Statistics

Where the `/stats/:site_id` figures come from and how to produce each counter by hand.
Response fields: [rest-api.md](./rest-api.md). Commands: [cli-commands.md](./cli-commands.md).

## Storage

Collection `statistics`, one document per site per day, `_id` = `<site_id>:<day>`.

- `day` is `YYYY-MM-DD` in **Europe/Helsinki**, produced by `Statistics.day()` in [statistics.ts](../src/lib/statistics.ts).
  A counter written after 21:00–22:00 UTC lands on the next day's document.
- Counters are incremented by the code performing the action. No job aggregates them, and no stored day is recomputed.
- Documents are sparse: an absent counter is zero, and a language with no activity has no subtree. `GET /stats/:site_id` zero-fills both.
- `subscription` holds current state only. The endpoint reads `statistics` for past periods and counts `subscription` live for `current`.
- Periods before `collecting_since` return zeros; nothing backfills them.

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

## Counters

Subscription status values: `0` INACTIVE (unconfirmed), `1` ACTIVE, `2` DISABLED.

| Counter | Written when | Written by | Trigger |
|---|---|---|---|
| `created` | A subscription row is inserted, confirmed or not | [addSubscription.ts](../src/routes/addSubscription.ts) | `POST /subscription` |
| `confirmed` | Status changes `0` → `1`. Once per subscription, not per channel | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) | Confirm email or SMS |
| `cancelled` | A status `1` row is deleted through the API | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) | `DELETE` after confirming |
| `cancelled_unconfirmed` | A status `0` row is deleted through the API | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) | `DELETE` before confirming |
| `expired` | The cron deletes a status `1` row whose `created` is older than the site's `maxAge` | [subscriptionExpiry.ts](../src/lib/subscriptionExpiry.ts) | Backdate `created`, run the cron |
| `expired_unconfirmed` | The cron deletes a status `0` row older than `unconfirmedMaxAge` | [subscriptionExpiry.ts](../src/lib/subscriptionExpiry.ts) | Backdate `created`, run the cron |
| `snapshot` | The cron measures live `active` and `unconfirmed`, once per site per run | [hav-populate-queue.ts](../src/bin/hav-populate-queue.ts) | Run the cron |

Deleting or confirming a status `2` row writes no counter.

Every counter is also recorded per language, in the same `Statistics.record()` update as the total:

```
lang.fi.X + lang.sv.X + lang.en.X === events.X      for every counter X
```

An unknown event or language name writes neither path and reports to Sentry. Expiry deletes rows whose
`lang` is not `fi`, `sv` or `en` without counting them, and logs the number to Sentry.

## Manual runs

```bash
BASE=https://hakuvahti.docker.so
KEY=123
```

`POST /subscription` needs two external services reachable: the site's Elasticsearch proxy (see
[testing.md](./testing.md)) and ATV. Without the proxy the request is `400 Invalid elastic_query: …`;
without ATV it is `500 Could not find hashed email. Subscription not added.`

### created, confirmed, cancelled

```bash
curl -sk -X POST $BASE/subscription \
  -H 'Content-Type: application/json' -H "Authorization: api-key $KEY" \
  -d '{"elastic_query":"eyJxdWVyeSI6eyJtYXRjaF9hbGwiOnt9fX0=","query":"/fi/avoimet-tyopaikat?q=test",
       "email":"qa@example.com","sms":"+358501234567","site_id":"rekry","lang":"fi"}'
```

`hash` and `sms_secret` are not in the response — read them from the confirmation email in Mailpit, or
from the database:

```bash
docker compose exec -T mongodb mongosh hakuvahti --quiet --eval \
 'const s=db.subscription.find().sort({_id:-1}).limit(1)[0]; print(s._id+" "+s.hash+" "+s.sms_secret)'
```

```bash
ID=<id>; HASH=<hash>

curl -sk -X POST   "$BASE/subscription/confirm/$ID/$HASH" -H "Authorization: api-key $KEY"
curl -sk -X DELETE "$BASE/subscription/delete/$ID/$HASH"  -H "Authorization: api-key $KEY"

curl -sk "$BASE/stats/rekry?interval=day" -H "Authorization: api-key $KEY"
```

The unsubscribe link is rendered only in new-hits and expiry emails, both of which go to confirmed
subscriptions, so `cancelled_unconfirmed` is reachable only by calling the endpoint directly.

### confirmed counts once per subscription

SMS codes are derived from `sms_secret` over a 30-minute window:

```bash
docker compose exec -T app node --input-type=module \
 -e "import {generateSmsCode} from './src/lib/smsCode.ts'; console.log(generateSmsCode('<sms_secret>'))"

curl -sk -X POST "$BASE/subscription/sms/confirm/$ID" -H "Authorization: api-key $KEY" \
  -H 'Content-Type: application/json' -d '{"code":"<code>"}'
```

Confirm email **and** SMS on one subscription: `events.confirmed` is `1`.

### expired, expired_unconfirmed, snapshot

Expiry compares `created` against the site's current `maxAge`. No endpoint ages a row, so backdate it in
the database. Local `rekry` uses 90 days, and 5 days for unconfirmed — see [configuration.md](./configuration.md).

```bash
docker compose exec -T mongodb mongosh hakuvahti --quiet --eval \
 'db.subscription.updateMany({site_id:"rekry"},{$set:{created:new Date(Date.now()-120*864e5)}})'

npm run hav:populate-queue -- --site=rekry
```

The run deletes the backdated rows and writes the day's snapshot. `--site` filters the notification pass
only: expiry and measurement always cover every configured site. `--dry-run` writes nothing, statistics
included.

### A multi-month series

Day documents are plain counters keyed `<site_id>:<day>`; a series is a set of upserts. `$set` replaces
that day's counters:

```bash
docker compose exec -T mongodb mongosh hakuvahti --quiet --eval \
 'const day=n=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
  for (let i=0;i<120;i+=1) {
    const d=day(i);
    db.statistics.updateOne({_id:`rekry:${d}`},
      {$setOnInsert:{site_id:"rekry",day:d,created:new Date()},
       $set:{events:{created:12,confirmed:10,cancelled:1,expired:4},
             lang:{fi:{created:11,confirmed:9,cancelled:1,expired:4},
                   sv:{created:1,confirmed:1}},
             snapshot:{at:new Date(),active:4800-i*3,unconfirmed:30}}},
      {upsert:true});
  }'
```

Keep each `lang` subtree summing to its `events` counter to preserve the invariant above.

## Failure behaviour

| Failing part | Result |
|---|---|
| A counter write | Operation succeeds, one counter lost, reported to Sentry |
| The expiry language grouping | Subscriptions are still deleted, that day's expiry counters lost |
| The daily snapshot | Notifications are still queued, one point missing from the `active_end` series |

## Automated coverage

`npm test` runs [statistics.test.ts](../test/lib/statistics.test.ts) (day boundary, counter writes,
`countLive()`, `measure()`), [statsReport.test.ts](../test/lib/statsReport.test.ts) (range resolution,
period aggregation) and [stats.test.ts](../test/routes/stats.test.ts) (endpoint validation and payload).
