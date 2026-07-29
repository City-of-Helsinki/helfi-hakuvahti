# Architecture

- Routes autoload from `src/routes`, plugins from `src/plugins`. Libraries in `src/lib`, Typebox types in `src/types`.
- Uses [Typebox](https://github.com/sinclairzx81/typebox) for JSON-schema-derived TypeScript types. Convention: `SomeThing` is the schema, `SomeThingType` the inferred TS type.
- A single MongoDB `queue` collection holds outbound email and SMS notifications, so API and ElasticSearch work is not blocked by ATV errors, network lag, or SMTP/Dialogi outages.
- Adding, confirming, renewing, and deleting subscriptions happen through the REST API.
- ElasticSearch queries, notification delivery, and expired-subscription cleanup run as cron scripts. Cleanup uses each site's `maxAge` / `unconfirmedMaxAge`.
- Email templates live under `src/templates/<templatePath>/*.html`, SMS templates under `src/templates/<templatePath>/sms/*.txt`. There is one template file per message type; per-language strings come from the site config's `translations` map, with the subscription's `lang` exposed as a template variable. To customize a site's templates, copy the folder and update `mail.templatePath` in its config.
