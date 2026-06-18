# REST Endpoints:

## Add Subscription

`POST` `/subscription`

Adds new Hakuvahti subscription:

```json
{
    "elastic_query": "<full elastic query as base64 encoded string>",
    "search_description": "<Some search with terms, used in email notifications>",
    "query": "<url back to webpage for search results>",
    "email": "<email to subscribe>",
    "lang": "fi"
}
```

## Confirm a subscription

`GET` `/subscription/confirm/:id/:hash`

Confirms a subscription. To confirm a subscription, user must know both the id and hash (`hash` field in collection).

Subscriptions that are not confirmed, will not be checked during `npm run hav:populate-queue` command.

## Delete a subscription

`DELETE` `/subscription/delete/:id/:hash`

Deletes a subscription. To delete a subscription, user must know both the id and hash (`hash` field in collection).

## Health checks

Hakuvahti includes OpenShift compatible endpoints for health check:

`/healthz` Returns 200 OK and confirms Hakuvahti server is running.

`/readiness` Returns 200 OK and confirms Hakuvahti server is running and MongoDB connection is working.

