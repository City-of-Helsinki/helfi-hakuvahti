## Running Hakuvahti

- `npm i`
- Copy .env.dist as .env and configure MongoDB + ElasticProxy settings.
- `npm start` or `npm run dev`

## Endpoints:

`/subscription (POST)`

Adds news Hakuvahti subscription:

```
{
    "elastic_query": "test", // Query for elatic proxy
    "query": "test",         // Queryparam URL at the website for linkback
    "email": "test asd",     // Subscriber email. This will be hashed automatically
    "lang": "fi"             // Locale for email templates.
}
```

`/subscription/:id (DELETE)`

Deletes a subscription

### Running cron:

npm run cron

### TODO:

- Finish token auth in src/plugins/token.ts
- Finish ATV integration in src/plugins/atv.ts
- Send emails in cron
