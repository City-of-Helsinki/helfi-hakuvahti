#!/bin/sh

cd /app

echo "Populating email queue"

npm run hav:populate-email-queue

