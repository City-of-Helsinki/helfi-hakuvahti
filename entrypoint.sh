#!/bin/sh

# Start crond
# crond -f -L /app/logs/cron.log -c /etc/crontabs &
crond -f -l 8 -d 8 -L /dev/stdout -c /etc/crontabs &

# Start the main application process
exec "$@"

