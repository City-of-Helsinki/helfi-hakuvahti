## Installing and running Hakuvahti

- `npm i` to install dependencies
- Copy .env.dist as .env and configure:
  - MongoDB
  - ElasticProxy, 
  - Email sending
  - Subscription days, etc settings
- Create MongoDB collections: `npm run hav:init-mongodb`
- `npm start` (or `npm run dev` for development)
- Hakuvahti should now be running in port :3000 (by default)
- For production environment, add following commands to cron:
  - npm run hav:populate-email-queue 
  - npm run npm run hav:send-emails-from-queue

## REST Endpoints:

`/subscription (POST)`

Adds new Hakuvahti subscription:

```
{
    "elastic_query": "<full elastic query>",
    "search_description": "Some search with terms",
    "query": "<url at webpage>",
    "email": "test@hel.fi",
    "lang": "fi"
}
```

`/subscription/confirm/:id/:hash (GET)`

Confirms a subscription. To confirm a subscription, user must know both the id and hash (`hash` field in collection).

Subscriptions that are not confirmed, will not be checked during `npm run hav:populate-email-queue ` command.

`/subscription/delete/:id/:hash (DELETE)`

Deletes a subscription. To delete a subscription, user must know both the id and hash (`hash` field in collection).

### Command line actions

`npm run hav:init-mongodb`

Initialize MongoDB collections. Required before running populate or send commands.

`npm run hav:populate-email-queue`

Queries all Hakuvahti entries and checks for new results in ElasticSearch. This populates the email queue.

Removes expired subscriptions.

Adds following emails to the email queue:

- New results from ElasticQuery queries
- Notifications if subscription is going to expire

`npm run hav:send-emails-from-queue`

Sends emails in queue that were generated by `hav:populate-email-queue`
