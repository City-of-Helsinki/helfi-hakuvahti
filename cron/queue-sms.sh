#!/bin/sh

cd /app

echo "Sending SMS in queue"

npm run hav:send-sms-in-queue
