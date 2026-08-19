# Statistics: how it works and how to test it

Where every figure in `/stats` comes from, which action produces it, and the behaviours that are intentional but read as bugs.

For the response contract see [rest-api.md](./rest-api.md); for the commands referenced here see [cli-commands.md](./cli-commands.md).

## Why there is a second collection

A subscription row is deleted when the user unsubscribes and when the cron expires it. Nothing is left behind, so `subscription` can answer "how many exist now" but never "how many were cancelled last month".

That is what the `statistics` collection is for. Counters are written at the moment something happens, by whatever code causes it. There is no aggregation job, nothing runs on a schedule to roll figures up, and no past day is ever recomputed — a day's document simply stops being written to when the day ends.

One document per site per day, keyed `site_id:day`, for example `rekry:2026-08-17`. Days are **Europe/Helsinki**, not UTC, so month boundaries match the ones a product owner reads.

## The subscription lifecycle and its counters

```
                POST /subscription
                created +1
                        │
                        ▼
            ┌───────────────────────┐   first confirmation    ┌──────────────────┐
            │      UNCONFIRMED      │ ─────────────────────►  │      ACTIVE      │ ⟲ second confirmation
            │       status 0        │      confirmed +1       │     status 1     │   NO COUNTER
            └───────────┬───────────┘                         └────────┬─────────┘
                        │                                              │
   DELETE …/delete      │                         DELETE …/delete      │
   cancelled_unconfirmed +1                       cancelled +1         │
                        │                                              │
   cron, past unconfirmedMaxAge                   cron, past maxAge    │
   expired_unconfirmed +1                         expired +1           │
                        │                                              │
                        ▼                                              ▼
            ┌───────────────────────────────────────────────────────────────────┐
            │                 row deleted from `subscription`                    │
            │      after this, cancelled and expired are indistinguishable       │
            └───────────────────────────────────────────────────────────────────┘
```

Every transition that changes the number of subscriptions writes exactly one counter. The self-loop writes none: confirming a second channel activates nothing new.

| Counter | Written when | Code | How to trigger it |
|---|---|---|---|
| `created` | A signup begins, confirmed or not | [addSubscription.ts](../src/routes/addSubscription.ts) | `POST /subscription` |
| `confirmed` | A subscription first becomes active. **Once per subscription**, not per channel | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) | Confirm email or SMS |
| `cancelled` | User unsubscribes a live subscription — *keskeytetty* | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) | `DELETE` after confirming |
| `cancelled_unconfirmed` | User unsubscribes before ever confirming | [subscriptionActions.ts](../src/lib/subscriptionActions.ts) | `DELETE` before confirming |
| `expired` | Active subscription passes the site's `maxAge` and the cron deletes it — *vanhentunut* | [subscriptionExpiry.ts](../src/lib/subscriptionExpiry.ts) | Backdate `created`, run the cron |
| `expired_unconfirmed` | Never-confirmed subscription passes `unconfirmedMaxAge` | [subscriptionExpiry.ts](../src/lib/subscriptionExpiry.ts) | Backdate `created`, run the cron |
| `snapshot` | Measured live counts, once per site per cron run. A measurement, not a sum of events | [subscriptionProcessor.ts](../src/lib/subscriptionProcessor.ts) | Run the cron |

Every counter is also recorded per language, and the languages always add up to the total exactly, because a subscription has exactly one language:

```
lang.fi.X + lang.sv.X + lang.en.X === events.X      for every counter X
```

A total that does not add up means an event was recorded without a valid language, which also raises a Sentry alert.

## What writes, what reads

```
  CAUSED BY A REQUEST
  ┌──────────────────────┐
  │ POST /subscription   │──┐
  ├──────────────────────┤  │
  │ POST …/confirm       │──┤        ┌─────────────────────┐  one    ┌──────────────────────┐
  ├──────────────────────┤  ├──────► │     Statistics      │ upsert  │      statistics      │
  │ DELETE …/delete      │──┤        │ record()            │ ──────► │  _id = site_id:day   │
  └──────────────────────┘  │        │ recordSnapshot()    │         │ counters + snapshot  │
                            │        │ never throws        │         └──────────┬───────────┘
  CAUSED BY THE CRON        │        └─────────────────────┘                    │
  ┌──────────────────────┐  │                                          counters │
  │ hav:populate-queue   │──┘                                                   ▼
  │ expiry + snapshot    │                    ┌──────────────────────┐  ┌──────────────────────┐
  └──────────────────────┘                    │     subscription     │─►│  GET /stats/:site_id │
                                              │  current state only  │  │      JSON only       │
                                              └──────────────────────┘  └──────────────────────┘
                                                        live counts
```

A figure exists only if the code that produces it ran. The endpoint reads stored counters for past periods, and counts `subscription` live for `current`.

### A stored day

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

Documents are sparse: a counter that did not happen is absent rather than zero, and a language with no activity has no subtree at all. The endpoint zero-fills every gap, so an absent key and a `0` are the same thing to a consumer.

## Exercising each counter by hand

The commands below assume the local environment; substitute the base URL and API key for another.

```bash
BASE=https://hakuvahti.docker.so
KEY=123
```

### created, confirmed, cancelled

`POST /subscription` validates the query against the site's Elasticsearch proxy before storing anything, so it needs that proxy reachable — either the sibling project's environment (see [testing.md](./testing.md)) or an environment where the proxies are hosted. On a bare local stack the request fails with `Invalid elastic_query`.

```bash
curl -sk -X POST $BASE/subscription \
  -H 'Content-Type: application/json' -H "Authorization: api-key $KEY" \
  -d '{"elastic_query":"eyJxdWVyeSI6eyJtYXRjaF9hbGwiOnt9fX0=","query":"/fi/avoimet-tyopaikat?q=test",
       "email":"qa@example.com","sms":"+358501234567","site_id":"rekry","lang":"fi"}'
```

The response carries `insertedId` but no `hash` — that ships in the confirmation email. Read it from Mailpit, or from the database:

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

### Once per subscription, not once per channel

The most important assertion in the feature. SMS codes are derived from `sms_secret` on a 30-minute window:

```bash
docker compose exec -T app node --input-type=module \
 -e "import {generateSmsCode} from './src/lib/smsCode.ts'; console.log(generateSmsCode('<sms_secret>'))"

curl -sk -X POST "$BASE/subscription/sms/confirm/$ID" -H "Authorization: api-key $KEY" \
  -H 'Content-Type: application/json' -d '{"code":"<code>"}'
```

Confirm email **and** SMS on one subscription, then check that `events.confirmed` is `1`.

### expired and the snapshot

Expiry needs a subscription older than the site's `maxAge`, and the API has no way to age one, so backdate `created` directly. Local `rekry` uses 90 days, and 5 days for unconfirmed subscriptions — see [configuration.md](./configuration.md).

```bash
docker compose exec -T mongodb mongosh hakuvahti --quiet --eval \
 'db.subscription.updateMany({site_id:"rekry"},{$set:{created:new Date(Date.now()-120*864e5)}})'

npm run hav:populate-queue -- --site=rekry
```

That run expires the backdated rows and writes the day's snapshot. `--dry-run` writes nothing at all, statistics included.

### A multi-month series

To look at a realistic chart without waiting months, give surviving subscriptions a spread of `first_created` values and reconstruct the history:

Write the day documents directly — they are counters keyed `${site_id}:${day}`,
so a series is a handful of upserts and needs no application code:

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

Keep each `lang` subtree summing to its `events` counter, or the partition
invariant the report relies on will not hold (see above).

## Behaviours that are intentional

| What you see | Why |
|---|---|
| Confirming both email and SMS increments `confirmed` only once | It counts subscriptions, not channels |
| `net_change` is `null` rather than `0` | The period has no stored data at all. A period with data but no events reports `0` |
| `current.active` does not match the last `active_end` | `current` is counted at request time; `active_end` is the last measurement the cron stored. They agree only just after a cron run |
| A counter lands on the following day | Days are Europe/Helsinki, so writes after 21:00–22:00 UTC belong to the next day's document |
| `POST /subscription` returns no `hash` | It ships in the confirmation email |
| `cancelled_unconfirmed` stays at 0 | The unsubscribe link ships in notification emails, which only active subscriptions receive |

## When statistics fail

A statistics failure must never break the operation that triggered it.

| If this fails | The user sees | The cost |
|---|---|---|
| A counter write | Nothing, the operation succeeds | One counter lost, reported to Sentry |
| The expiry language grouping | Nothing, expired subscriptions are still deleted | That day's expiry counters lost |
| The daily snapshot | Nothing, notifications are still queued | One point missing from the active-count series |
| The confirmation or unsubscribe itself | An error | Not swallowed — the operation genuinely failed |

## Environment notes

- **Restart the app container after changing code.** `node --watch` does not observe host file edits through the bind mount on macOS, so `docker compose restart app` is needed or the previous code is still serving.
- **Counters exist only from the moment the instrumentation is deployed.** Nothing reconstructs churn for earlier periods, because a deleted subscription leaves no trace.
