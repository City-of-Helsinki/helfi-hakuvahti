#!/bin/sh
set -e

# crond -f -L /app/logs/cron.log

cd /app
exec npm run start

