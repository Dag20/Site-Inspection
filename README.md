# Site Inspection Platform

Construction site issues, inspections and evidence for contractors in Qatar and the GCC.
The product loop is **Capture → Assign → Fix → Prove → Verify → Close**.

This repository is the Phase 0 foundation. It is not the MVP. It proves the four things that are
expensive to retrofit, with tests: tenant isolation, an append-only audit trail, offline-first data,
and the WhatsApp notification path.

## What is here

| Path | What it is |
| --- | --- |
| `packages/shared` | Roles and permissions, the issue workflow rules, and request schemas. Used by both the API and the web app, so the phone and the server apply the same rules. |
| `apps/api` | REST API (Fastify) on PostgreSQL (Drizzle). Schema for every entity in the product brief, issue endpoints, the `/v1/sync` endpoint for offline changes, notification queue and WhatsApp Cloud API adapter. |
| `apps/web` | Installable web app (React, Vite, service worker). On-device database and outbox, sync engine, sync indicator, English and right-to-left Arabic switching. One small screen that exercises all of it. |
| `docs/decisions.md` | The architecture choices and why. |

## Run it in your browser (GitHub Codespaces)

No installs needed. On the repository page choose **Code → Codespaces → Create codespace on main**.
Setup takes a few minutes the first time: it installs packages, creates the database and loads the example project.
Then, in the terminal at the bottom:

```sh
pnpm test     # the automated checks
pnpm dev      # starts the API and the web app; open the "Web app" port when it appears
```

The web app signs in as Ahmed, the example site engineer. To try another role, change the user id in
`apps/web/.env.local` to one printed by the seed step, then restart `pnpm dev`.
The repository uses pnpm, not npm: `npm install` will fail on the workspace links.

## Run it on your own computer

Needs Node 22, pnpm and Docker.

```sh
cp .env.example .env
docker compose up -d          # PostgreSQL
pnpm install
pnpm db:migrate
pnpm db:seed                  # example project: Lusail Commercial Tower. Prints sign-in headers.
echo "VITE_DEV_AUTH=<organizationId>:<userId>" > apps/web/.env.local   # a pair printed by the seed
pnpm dev                      # API on http://localhost:3000, web app on http://localhost:5173
```

Offline behaviour needs the service worker, which only runs in a production build:
`pnpm --filter @sip/web build && pnpm --filter @sip/web preview`.

## Check it

```sh
pnpm typecheck
pnpm test        # API tests need PostgreSQL on localhost:5432 (docker compose up -d)
```

What the tests prove:

- **Tenant isolation.** Every table with `organization_id` has a row-level security policy. One organization cannot read or write another's rows, even with a hand-written insert.
- **Contractor scope.** A contractor user sees and acts only on issues assigned to their company.
- **The loop.** Create, assign, submit evidence, reject with a reason, resubmit, approve, close, with the right WhatsApp template queued at each step and a working secure link.
- **Offline sync.** A change is applied once even if the device retries. A stale offline action is returned to the user with a reason instead of being applied. Unsent changes survive a failed connection, in order.
- **Audit trail.** Activity rows cannot be updated, deleted or truncated, by the application or by the database owner.

## Not built yet

These are deliberate gaps, listed so nobody assumes they exist.

- **Real sign-in.** Only a development header exists (`apps/api/src/auth`). The server refuses to start with it in production. Email and password plus Google and Microsoft sign-in is the first MVP task.
- **Photo upload.** Photos taken on the device are stored locally (`photos` store) and the `attachments` table exists, but nothing uploads them to object storage yet.
- **Acting from a secure link.** `/l/:token` opens an issue read-only. Submitting evidence from the link is Phase 2.
- **Notification retries and delivery reports.** Messages are sent right after the request that caused them. A background worker for retries, and the webhook that records delivery and cost, are not written.
- **WhatsApp templates.** The adapter sends template names from `apps/api/src/notifications/templates.ts`. They must be approved in Meta Business Suite first. With no WhatsApp settings, messages are logged to the console.
- **Inspections, NCRs, daily reports, custom fields, documents.** Tables only. No endpoints or screens.
- **Arabic.** `apps/web/src/i18n/ar.json` is a partial draft that proves right-to-left layout. It needs a native speaker who knows site terminology.
- **iPhone.** The airplane-mode test passes in Chromium. It has not been run on a real iPhone, which is the test that decides web app versus native wrapper.

## Rules for adding to it

- A new tenant table gets `organization_id`, an entry in `apps/api/src/db/tenant-tables.ts`, and a policy in a migration. A test fails otherwise.
- Database access in the API goes through `withTenant`. Services take the transaction, never the pool.
- A screen never calls the API to save. It writes to the on-device database through `apps/web/src/local/actions.ts` and lets the sync engine send it.
- A change to who may do what is made in `packages/shared`, once.
- Screen text goes in `apps/web/src/i18n`. Layout uses logical CSS properties (`inline`, `block`, `start`, `end`).
