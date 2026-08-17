# Hakuvahti

Hakuvahti is a Fastify / Node.js application that monitors Hel.fi searches (ElasticSearch) and notifies subscribers of new results by email and optional SMS.

Prerequisites:
- ElasticSearch
- The site config's `matchField` names the ElasticSearch field that holds each result's publication timestamp (e.g. `field_publication_starts`).
- Results expose `title` and `url` fields.
- Site has an Asiointitietovarasto (ATV) account for storing subscriber contact info.
- For SMS: site has access to the Elisa Dialogi SMS service.

## Development setup

- Copy `.env.dist` to `.env` and set:
  - `ATV_API_KEY` / `ATV_API_URL` — Hakuvahti errors out if ATV is unreachable.
  - `DIALOGI_API_URL` / `DIALOGI_API_KEY` / `DIALOGI_SENDER` — if testing SMS.

Start the local environment with:

```bash
make fresh
```

Hakuvahti should be available at `https://hakuvahti.docker.so`.

Get a shell inside the container:

```bash
make shell
```

The local environment does not run cron scripts automatically. See [`package.json`](../package.json) for the list for available commands.

Shutdown the container with:

```bash
make down
```

# Documentation

- [Architecture](./documentation/architecture.md): code layout, queue-based delivery, templates
- [Configuration](./documentation/configuration.md): per-site config files in `conf/` and their properties
- [Environment variables](./documentation/environment-variables.md): supported environment variables.
- [REST API](./documentation/rest-api.md): subscription CRUD, broadcast messages, health checks
- [CLI commands](./documentation/cli-commands.md): cron scripts, maintenance, and template testing tools
- [Statistics](./documentation/statistics-testing.md): where the `/stats` figures come from, and how to exercise each counter
- [Mock Dialogi server](./documentation/dialogi-server.md): local SMS testing without the real Dialogi API
- [Testing with Rekry](./documentation/testing.md): Testing walkthrough against a local Rekry site
