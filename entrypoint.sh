#!/bin/sh

# Start crond
crond -f -L /app/logs/cron.log -c /etc/crontabs &

# Start the main application process
exec "$@"

