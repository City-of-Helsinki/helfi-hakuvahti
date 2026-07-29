# Configuration

## Site Configuration Files

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

See [`conf/rekry.json`](../conf/rekry.json) for a full example with all translation keys.

## Environment Selection

The `ENVIRONMENT` variable selects which block in each site config is used. Valid values: `local`, `dev`, `staging`, `production`. Required when starting the Fastify server; CLI scripts fall back to `dev` if unset.

## Configuration Properties

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
