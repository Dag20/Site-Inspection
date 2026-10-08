# Architecture decisions (Phase 0)

The full reasoning is in the "Phase 0 — Architecture Decisions" document. This is the short form that travels with the code.

| Area | Choice |
| --- | --- |
| Language | TypeScript for web and API, one repository (pnpm workspaces) |
| Web | React and Vite, installable web app with a service worker |
| Web or native | Web app first. Native wrapper only if offline photo capture fails on real iPhones |
| API | REST and JSON on Fastify, validated with Zod |
| Database | PostgreSQL, schema and migrations in Drizzle |
| Multi-tenancy | One database. `organization_id` on every table, enforced by the API and by row-level security |
| Files | S3-compatible object storage, direct upload with signed links |
| Offline | Local-first. Every write goes to an on-device outbox, then syncs with a unique key per change |
| Conflicts | Comments, photos and activity only add. Field edits: latest wins. Status changes are checked by the server's workflow rules |
| Audit trail | Append-only table. A trigger rejects update, delete and truncate |
| Notifications | Rows in the database, sent by a channel adapter. WhatsApp first |
| Languages | Text in translation files. Right-to-left safe layout from day one |
| Hosting | Containers and managed PostgreSQL, cloud-neutral. Region chosen with pilot customers |

## How a change gets from a phone with no signal to the server

1. The app writes the record and an outbox entry to the on-device database in one transaction.
2. The sync indicator shows Offline, Syncing or Synced from the outbox and the connection.
3. With a connection, the outbox is posted to `POST /v1/sync` in order.
4. The server applies each change in its own transaction, with its audit line and notifications, and records the change's key.
5. A repeated key returns the stored result. A change the rules no longer allow comes back as `rejected` with a message.
6. The app removes acknowledged entries and keeps refused ones to show the user.

## Database roles

- The owner role runs migrations.
- `app_rw` is a group role created by the migrations with table access. It cannot update or delete `activities`.
- The API logs in as a non-superuser member of `app_rw`, so row-level security applies to it.
  In development that login is `app_user`, created by `docker/init.sql`.
