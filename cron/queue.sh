#!/bin/sh

cd /app

echo "Sending emails in queue"

npm run hav:send-emails-in-queue
