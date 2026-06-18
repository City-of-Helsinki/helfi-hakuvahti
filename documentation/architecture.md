# Architecture

## Architecture in a nutshell:

- Hakuvahti is a Fastify application. Routes are autoloaded
  from `src/routes` and plugins are autoloaded from `src/plugins`.
  Helper libraries are under `src/lib` and type definitions are under
  `src/types`.
- Hakuvahti uses [Typebox](https://github.com/sinclairzx81/typebox), which creates
  Json schema objects that infer as TypeScript types. Naming is standardized as
  `SomeThing` for Json schema which has corresponding `SomeThingType`.
- Hakuvahti uses MongoDB collection as a queue for outbound notifications. This way
  performing API actions and collecting results from ElasticSearch does not
  depend on possible ATV errors or network lag, or availability of
  SMTP server.
- Adding, confirming, and deleting subscriptions happens through REST api.
- Saved ElasticSearch queries are re-checked from scheduled cron job.
- Subscriptions are expired through cron job, expiration is configured
  in site configuration.
- Email templates are located under `src/templates/something/*.html`
  - Templates are suffixed with lang code, which is set per subscription.
  - Templates can be modified for different sites by copying them
    to a different folder, i.e. `src/templates/something2` and updating
    the `mail.templatePath` in the site configuration.

