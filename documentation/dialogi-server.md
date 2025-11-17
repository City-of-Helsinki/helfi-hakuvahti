### Mock Dialogi Server (Local Development)

`npm run hav:run-dialogi-test-server`

Runs a mock Dialogi API server for local testing when you don't have access to the real Dialogi API (requires static IP).

**Usage:**
```bash
# Terminal 1: Start the mock server
npm run hav:run-dialogi-test-server

(or after starting hakuvahti with make up, you can start server with:
"docker compose exec nodejs npm run hav:run-dialogi-test-server")

# Terminal 2: Configure your .env to use the mock server
DIALOGI_API_URL=http://localhost:3001/sms
DIALOGI_API_KEY=any-value-works
DIALOGI_SENDER=TestSender

# Now test the full SMS pipeline locally
npm run hav:test-sms-sending
```

The mock server:
- Runs on `http://localhost:3001`
- Accepts POST requests to `/sms`
- Returns valid Dialogi-like responses
- Logs all "sent" SMS messages to console
- Allows testing the entire SMS pipeline without the real API

### Migration

To migrate existing subscriptions to have `site_id` field, run:

`npm run hav:migrate-site-id rekry`

`npm run hav:update-schema`
