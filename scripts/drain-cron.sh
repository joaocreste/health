#!/bin/sh
# Wrapper for the launchd/cron schedule: drain the AI-insight rebuild queue hourly.
cd "/Users/joaocreste/Claude Agent/Health WebbApp" || exit 1
/opt/homebrew/bin/node scripts/drain-insight-jobs.mjs --apply --limit 3
