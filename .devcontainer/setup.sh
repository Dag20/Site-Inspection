#!/usr/bin/env bash
# Runs once when the codespace is created: installs packages, builds the database and loads the example project.
set -euo pipefail
sudo corepack enable
corepack prepare --activate
[ -f .env ] || cp .env.example .env
pnpm install
until node -e "require('net').connect(5432,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"; do sleep 1; done
pnpm db:migrate
pnpm db:seed || echo "Example data was already loaded."
# Sign the web app in as Ahmed, the example site engineer. Change the user id to try another role (ids are printed above).
[ -f apps/web/.env.local ] || echo "VITE_DEV_AUTH=00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000102" > apps/web/.env.local
echo
echo "Ready. Run:  pnpm test   (checks)   or   pnpm dev   (starts the API and web app)"
