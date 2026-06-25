import * as Sentry from '@sentry/node';

// Sentry must be initialized before any other module is imported, so this file
// is preloaded via `node --import ./src/instrument.ts` (see package.json scripts).
// An empty/undefined SENTRY_DSN makes init a no-op, so this is safe in every env.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.ENVIRONMENT,
  release: process.env.SENTRY_RELEASE ?? '',
  beforeSend: (event) => {
    // Redact customer email from the request payload before sending to Sentry.
    if (typeof event?.request?.data !== 'string') {
      return event;
    }

    const data = JSON.parse(event.request.data);

    if (!data.email) {
      return event;
    }

    delete data.email;
    event.request.data = JSON.stringify(data);

    return event;
  },
});
