import { beforeEach, describe, expect, it } from 'vitest';
import type { Mutation, MutationResult } from '@sip/shared';
import { createIssue, transitionIssue } from './actions';
import { openLocalDb, type LocalDb } from './db';
import { countWaiting, listRefused, syncOnce, syncState, type Transport } from './sync';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CONTRACTOR = '22222222-2222-4222-8222-222222222222';
let db: LocalDb;
let n = 0;
beforeEach(async () => {
  db = await openLocalDb(`test-${++n}`);
});

const noSignal: Transport = async () => {
  throw new TypeError('Failed to fetch');
};
/** A stand-in server: numbers issues from 1001 and applies each key once. */
function fakeServer(refuse: (m: Mutation) => string | null = () => null) {
  const seen = new Map<string, MutationResult>();
  const received: Mutation[] = [];
  let next = 1001;
  const send: Transport = async (mutations) =>
    mutations.map((m) => {
      received.push(m);
      const before = seen.get(m.key);
      if (before) return { ...before, status: 'duplicate' } as MutationResult;
      const why = refuse(m);
      if (why) return { key: m.key, status: 'rejected', code: 'invalid_state', message: why };
      const data = m.type === 'issue.create' ? { id: m.payload.id, number: next++, status: m.payload.contractorId ? 'assigned' : 'open' } : m.type === 'issue.transition' ? { id: m.payload.issueId, status: 'assigned', contractorId: m.payload.contractorId } : {};
      const result: MutationResult = { key: m.key, status: 'applied', data };
      seen.set(m.key, result);
      return result;
    });
  return { send, received };
}

describe('working with no signal', () => {
  it('saves an issue and its photo on the device and queues the change', async () => {
    const issue = await createIssue(db, { projectId: PROJECT, title: 'Leak', category: 'Plumbing' }, new Blob(['x']));
    expect(issue.number).toBeNull();
    expect(issue.pending).toBe(true);
    expect(await db.get('issues', issue.id)).toBeTruthy();
    expect(await db.getAllFromIndex('photos', 'byIssue', issue.id)).toHaveLength(1);
    expect(await countWaiting(db)).toBe(1);
  });

  it('keeps every change, in order, when the server cannot be reached', async () => {
    const a = await createIssue(db, { projectId: PROJECT, title: 'A', category: 'Civil' });
    await transitionIssue(db, 'site_engineer', a.id, 'assign', { contractorId: CONTRACTOR });
    await createIssue(db, { projectId: PROJECT, title: 'B', category: 'Civil' });
    expect(await syncOnce(db, noSignal)).toEqual({ sent: 0, refused: 0, reachedServer: false });
    expect(await countWaiting(db)).toBe(3);

    const server = fakeServer();
    expect(await syncOnce(db, server.send)).toEqual({ sent: 3, refused: 0, reachedServer: true });
    expect(server.received.map((m) => m.type)).toEqual(['issue.create', 'issue.transition', 'issue.create']);
    expect(await countWaiting(db)).toBe(0);
    const stored = await db.get('issues', a.id);
    expect(stored).toMatchObject({ number: 1001, status: 'assigned', pending: false });
  });

  it('applies the same local rules as the server', async () => {
    const a = await createIssue(db, { projectId: PROJECT, title: 'A', category: 'Civil' });
    await expect(transitionIssue(db, 'site_engineer', a.id, 'close')).rejects.toThrow(/cannot be changed/);
    await expect(transitionIssue(db, 'contractor', a.id, 'assign')).rejects.toThrow(/cannot assign/);
    expect(await countWaiting(db)).toBe(1); // only the create
  });

  it('keeps a change the server refused, with the reason, and still sends the rest', async () => {
    const a = await createIssue(db, { projectId: PROJECT, title: 'A', category: 'Civil' });
    await transitionIssue(db, 'site_engineer', a.id, 'assign', { contractorId: CONTRACTOR });
    const b = await createIssue(db, { projectId: PROJECT, title: 'B', category: 'Civil' });
    const server = fakeServer((m) => (m.type === 'issue.transition' ? 'This issue was already closed.' : null));
    expect(await syncOnce(db, server.send)).toEqual({ sent: 2, refused: 1, reachedServer: true });
    const refusedList = await listRefused(db);
    expect(refusedList).toHaveLength(1);
    expect(refusedList[0]!.error!.message).toBe('This issue was already closed.');
    expect((await db.get('issues', b.id))!.number).toBe(1002);
    // A refused change is not resent on the next attempt.
    expect(await syncOnce(db, server.send)).toEqual({ sent: 0, refused: 0, reachedServer: true });
  });
});

describe('sync indicator', () => {
  it('shows offline, syncing or synced', () => {
    expect(syncState({ online: false, waiting: 2, busy: false })).toBe('offline');
    expect(syncState({ online: true, waiting: 2, busy: false })).toBe('syncing');
    expect(syncState({ online: true, waiting: 0, busy: true })).toBe('syncing');
    expect(syncState({ online: true, waiting: 0, busy: false })).toBe('synced');
  });
});
