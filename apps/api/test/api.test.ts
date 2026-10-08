import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { DevAuthProvider } from '../src/auth';
import { createDb, withTenant } from '../src/db/client';
import { contractors, memberships, organizations, projects, users } from '../src/db/schema';
import { DEMO, seedDemo } from '../src/db/seed';
import { TENANT_TABLES } from '../src/db/tenant-tables';
import { ConsoleChannel } from '../src/notifications/channels';
import { dispatchQueued } from '../src/notifications/queue';
import { testUrls } from './global-setup';

const urls = testUrls();
const admin = createDb(urls.admin);
const appDb = createDb(urls.app); // non-superuser: row-level security applies
const channel = new ConsoleChannel();
const app = createApp({ db: appDb.db, auth: new DevAuthProvider(appDb.db), channel });

const OTHER = { org: randomUUID(), user: randomUUID(), project: randomUUID(), contractor: randomUUID() };
const as = (org: string, user: string) => ({ authorization: `Dev ${org}:${user}` });
const ahmed = as(DEMO.org, DEMO.users.ahmed);
const fatima = as(DEMO.org, DEMO.users.fatima);
const ravi = as(DEMO.org, DEMO.users.ravi);
const omar = as(DEMO.org, DEMO.users.omar);
const flush = async () => {
  await app.notificationsSettled();
  await dispatchQueued(appDb.db, DEMO.org, channel);
};

beforeAll(async () => {
  await seedDemo(admin.db);
  await withTenant(admin.db, OTHER.org, async (tx) => {
    await tx.insert(organizations).values({ id: OTHER.org, name: 'Another Company' });
    await tx.insert(users).values({ id: OTHER.user, name: 'Outsider' });
    await tx.insert(memberships).values({ organizationId: OTHER.org, userId: OTHER.user, role: 'owner' });
    await tx.insert(projects).values({ id: OTHER.project, organizationId: OTHER.org, name: 'Other Project' });
    await tx.insert(contractors).values({ id: OTHER.contractor, organizationId: OTHER.org, name: 'Other Contractor' });
  });
  await flush();
});
afterAll(async () => {
  await app.close();
  await admin.pool.end();
  await appDb.pool.end();
});

describe('tenant isolation', () => {
  it('every table with organization_id has a tenant policy', async () => {
    const cols = await admin.db.execute<{ table_name: string }>(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'organization_id'`);
    const policies = await admin.db.execute<{ tablename: string }>(sql`select tablename from pg_policies where policyname = 'tenant_isolation'`);
    const protectedTables = new Set(policies.rows.map((r) => r.tablename));
    for (const { table_name } of cols.rows) expect(protectedTables, table_name).toContain(table_name);
    expect([...TENANT_TABLES].sort()).toEqual(cols.rows.map((r) => r.table_name).sort());
  });

  it('returns no rows when no organization is set', async () => {
    const res = await appDb.db.execute(sql`select id from issues`);
    expect(res.rows).toHaveLength(0);
  });

  it('one organization cannot read or write another organization\'s data', async () => {
    const outsider = as(OTHER.org, OTHER.user);
    const list = await app.inject({ method: 'GET', url: '/v1/issues', headers: outsider });
    expect(list.json()).toEqual([]);
    const one = await app.inject({ method: 'GET', url: `/v1/issues/${'00000000-0000-4000-8000-000000001001'}`, headers: outsider });
    expect(one.statusCode).toBe(404);
    // Creating an issue against another organization's project fails: the project is invisible.
    const create = await app.inject({ method: 'POST', url: '/v1/issues', headers: outsider, payload: { projectId: DEMO.project, title: 'x', category: 'Civil' } });
    expect(create.statusCode).toBe(404);
    // Even a hand-written insert with a foreign organization_id is refused by the database.
    await expect(
      withTenant(appDb.db, OTHER.org, (tx) => tx.insert(projects).values({ organizationId: DEMO.org, name: 'smuggled' })),
    ).rejects.toThrow();
  });

  it('rejects a request with no sign-in', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/issues' })).statusCode).toBe(401);
  });
});

describe('the loop: capture, assign, fix, prove, verify, close', () => {
  let id: string;

  it('site engineer creates and assigns; contractor is notified with a working link', async () => {
    channel.sent.length = 0;
    const res = await app.inject({ method: 'POST', url: '/v1/issues', headers: ahmed, payload: { projectId: DEMO.project, locationId: DEMO.locations.l3, locationText: 'Corridor C-01', title: 'Exposed cable', category: 'Electrical', priority: 'high' } });
    expect(res.statusCode).toBe(201);
    id = res.json().id;
    expect(res.json().status).toBe('open');
    expect(res.json().number).toBeGreaterThan(1000);

    const assign = await app.inject({ method: 'POST', url: `/v1/issues/${id}/transition`, headers: ahmed, payload: { action: 'assign', contractorId: DEMO.contractors.abcMep } });
    expect(assign.json().status).toBe('assigned');
    await flush();
    const msg = channel.sent.find((m) => m.template === 'issue_assigned');
    expect(msg?.to).toBe('+97400000011');
    expect(msg?.params.location).toBe('Level 3 / Corridor C-01');

    const viaLink = await app.inject({ method: 'GET', url: `/l/${msg!.linkToken}` });
    expect(viaLink.statusCode).toBe(200);
    expect(viaLink.json().issue.id).toBe(id);
    expect((await app.inject({ method: 'GET', url: `/l/${DEMO.org}.${'x'.repeat(43)}` })).statusCode).toBe(404);
  });

  it('a contractor from another company cannot see or act on it', async () => {
    expect((await app.inject({ method: 'GET', url: `/v1/issues/${id}`, headers: omar })).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/v1/issues', headers: omar });
    expect(list.json().every((i: { contractorId: string }) => i.contractorId === DEMO.contractors.dohaElectrical)).toBe(true);
    const act = await app.inject({ method: 'POST', url: `/v1/issues/${id}/transition`, headers: omar, payload: { action: 'submit_evidence' } });
    expect(act.statusCode).toBe(404);
  });

  it('contractor cannot approve their own work', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/issues/${id}/transition`, headers: ravi, payload: { action: 'approve' } });
    expect(res.statusCode).toBe(403);
  });

  it('contractor submits, inspector rejects with a reason, contractor resubmits, inspector approves, engineer closes', async () => {
    channel.sent.length = 0;
    const step = async (headers: { authorization: string }, payload: Record<string, unknown>) => (await app.inject({ method: 'POST', url: `/v1/issues/${id}/transition`, headers, payload })).json();
    expect((await step(ravi, { action: 'submit_evidence', comment: 'Cable enclosed in trunking.' })).status).toBe('submitted');
    expect((await app.inject({ method: 'POST', url: `/v1/issues/${id}/transition`, headers: fatima, payload: { action: 'reject' } })).statusCode).toBe(422);
    expect((await step(fatima, { action: 'reject', reason: 'Photo unclear' })).status).toBe('rejected');
    expect((await step(ravi, { action: 'submit_evidence' })).status).toBe('submitted');
    expect((await step(fatima, { action: 'approve' })).status).toBe('verified');
    expect((await step(ahmed, { action: 'close' })).status).toBe('closed');
    await flush();
    expect(channel.sent.map((m) => m.template)).toEqual(['evidence_submitted', 'evidence_rejected', 'evidence_submitted', 'evidence_approved']);

    const detail = (await app.inject({ method: 'GET', url: `/v1/issues/${id}`, headers: ahmed })).json();
    expect(detail.activity.map((a: { action: string }) => a.action)).toEqual([
      'issue.created', 'issue.assign', 'issue.submit_evidence', 'issue.reject', 'issue.submit_evidence', 'issue.approve', 'issue.close',
    ]);
    expect(detail.activity[3].after.reason).toBe('Photo unclear');
    expect(detail.comments).toHaveLength(1);
  });
});

describe('offline sync', () => {
  it('applies each change once, even when the device retries', async () => {
    const issueId = randomUUID();
    const body = { mutations: [
      { key: randomUUID(), type: 'issue.create', clientTime: '2026-10-07T08:00:00.000Z', payload: { id: issueId, projectId: DEMO.project, title: 'Created offline', category: 'Civil' } },
      { key: randomUUID(), type: 'comment.create', clientTime: '2026-10-07T08:01:00.000Z', payload: { id: randomUUID(), issueId, body: 'Noted on site' } },
    ] };
    const first = (await app.inject({ method: 'POST', url: '/v1/sync', headers: ahmed, payload: body })).json();
    expect(first.results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied']);
    const again = (await app.inject({ method: 'POST', url: '/v1/sync', headers: ahmed, payload: body })).json();
    expect(again.results.map((r: { status: string }) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect(again.results[0].data.number).toBe(first.results[0].data.number);

    const detail = (await app.inject({ method: 'GET', url: `/v1/issues/${issueId}`, headers: ahmed })).json();
    expect(detail.comments).toHaveLength(1);
    // The same record arriving under a new key (a device that lost its outbox) is refused, not duplicated.
    const lost = (await app.inject({ method: 'POST', url: '/v1/sync', headers: ahmed, payload: { mutations: [{ ...body.mutations[0], key: randomUUID() }] } })).json();
    expect(lost.results[0].status).toBe('rejected');
    // The audit trail keeps the time it happened on the device, not only the time it reached the server.
    expect(detail.activity[0].occurredAt).toContain('2026-10-07');
  });

  it('returns a stale offline action to the user instead of applying it', async () => {
    // Issue 1002 is waiting for review. Fatima rejects it online; an approval she queued earlier offline arrives later.
    const issueId = '00000000-0000-4000-8000-000000001002';
    await app.inject({ method: 'POST', url: `/v1/issues/${issueId}/transition`, headers: fatima, payload: { action: 'reject', reason: 'Work incomplete' } });
    const res = (await app.inject({ method: 'POST', url: '/v1/sync', headers: fatima, payload: { mutations: [
      { key: randomUUID(), type: 'issue.transition', clientTime: new Date().toISOString(), payload: { issueId, action: 'approve' } },
    ] } })).json();
    expect(res.results[0].status).toBe('rejected');
    expect(res.results[0].code).toBe('invalid_state');
    const detail = (await app.inject({ method: 'GET', url: `/v1/issues/${issueId}`, headers: fatima })).json();
    expect(detail.status).toBe('rejected');
  });
});

describe('notifications', () => {
  it('two senders running at once never send the same message twice', async () => {
    channel.sent.length = 0;
    const res = await app.inject({ method: 'POST', url: '/v1/issues', headers: ahmed, payload: { projectId: DEMO.project, title: 'Race check', category: 'Civil', contractorId: DEMO.contractors.gulfFitout } });
    expect(res.statusCode).toBe(201);
    await Promise.all([flush(), dispatchQueued(appDb.db, DEMO.org, channel), dispatchQueued(appDb.db, DEMO.org, channel)]);
    expect(channel.sent.filter((m) => m.params.title === 'Race check')).toHaveLength(1);
  });
});

describe('audit trail', () => {
  it('cannot be edited or deleted, by the app or by the database owner', async () => {
    await expect(withTenant(appDb.db, DEMO.org, (tx) => tx.execute(sql`update activities set action = 'tampered'`))).rejects.toThrow();
    await expect(withTenant(appDb.db, DEMO.org, (tx) => tx.execute(sql`delete from activities`))).rejects.toThrow();
    const appendOnly = { cause: expect.objectContaining({ message: 'activities is append-only' }) };
    await expect(admin.db.execute(sql`update activities set action = 'tampered'`)).rejects.toMatchObject(appendOnly);
    await expect(admin.db.execute(sql`delete from activities`)).rejects.toMatchObject(appendOnly);
    await expect(admin.db.execute(sql`truncate activities`)).rejects.toMatchObject(appendOnly);
  });
});
