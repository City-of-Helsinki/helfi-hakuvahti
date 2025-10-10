#!/bin/sh

cd "$HOME"

echo "Populating email queue"

# Forward all command-line arguments to the npm script
# Usage: ./populate.sh --site=rekry --dry-run
npm run hav:populate-email-queue -- "$@"

