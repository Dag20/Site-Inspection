import type { Mutation, MutationResult } from '@sip/shared';
import type { LocalDb, LocalIssue, OutboxEntry } from './db';

/** Sends a batch of changes. Must throw when the server cannot be reached. */
export type Transport = (mutations: Mutation[]) => Promise<MutationResult[]>;

export type SyncState = 'offline' | 'syncing' | 'synced';

/** The three states shown to the user. Anything still waiting to send counts as syncing. */
export function syncState(s: { online: boolean; waiting: number; busy: boolean }): SyncState {
  if (!s.online) return 'offline';
  return s.busy || s.waiting > 0 ? 'syncing' : 'synced';
}

const BATCH = 25;

function issueIdOf(m: Mutation): string {
  return m.type === 'issue.create' ? m.payload.id : m.payload.issueId;
}

async function waitingEntries(db: LocalDb): Promise<OutboxEntry[]> {
  return (await db.getAll('outbox')).filter((e) => !e.error);
}

export const countWaiting = async (db: LocalDb) => (await waitingEntries(db)).length;
export const listRefused = async (db: LocalDb) => (await db.getAll('outbox')).filter((e) => e.error);

/**
 * Sends everything waiting in the outbox, oldest first.
 * - Network failure: stop and keep everything; the next attempt resends the same keys, which the server applies once.
 * - Applied or duplicate: remove from the outbox and store the server's copy of the issue.
 * - Refused by the server's rules: keep the entry with the reason so the user can be told, and carry on.
 */
export async function syncOnce(db: LocalDb, send: Transport): Promise<{ sent: number; refused: number; reachedServer: boolean }> {
  let sent = 0;
  let refused = 0;
  for (;;) {
    const batch = (await waitingEntries(db)).slice(0, BATCH);
    if (!batch.length) break;
    let results: MutationResult[];
    try {
      results = await send(batch.map((e) => e.mutation));
    } catch {
      return { sent, refused, reachedServer: false };
    }
    const before = sent + refused;
    const tx = db.transaction(['issues', 'outbox'], 'readwrite');
    for (const entry of batch) {
      const result = results.find((r) => r.key === entry.mutation.key);
      if (!result) continue; // not acknowledged: stays in the outbox for the next attempt
      if (result.status === 'rejected') {
        refused++;
        await tx.objectStore('outbox').put({ ...entry, error: { code: result.code, message: result.message } });
        continue;
      }
      sent++;
      await tx.objectStore('outbox').delete(entry.seq!);
      if (entry.mutation.type !== 'comment.create') {
        const server = result.data as Partial<LocalIssue> & { id: string };
        const local = await tx.objectStore('issues').get(server.id);
        if (local) await tx.objectStore('issues').put({ ...local, number: server.number ?? local.number, status: server.status ?? local.status, contractorId: server.contractorId ?? local.contractorId });
      }
    }
    // An issue stays marked pending while any change to it is still waiting.
    const stillWaiting = new Set((await tx.objectStore('outbox').getAll()).filter((e) => !e.error).map((e) => issueIdOf(e.mutation)));
    for (const issue of await tx.objectStore('issues').getAll()) {
      const pending = stillWaiting.has(issue.id);
      if (issue.pending !== pending) await tx.objectStore('issues').put({ ...issue, pending });
    }
    await tx.done;
    if (sent + refused === before) break; // the server acknowledged nothing; try again later rather than loop
  }
  return { sent, refused, reachedServer: true };
}
