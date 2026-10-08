import type { Mutation, MutationResult } from '@sip/shared';
import type { LocalDb, LocalIssue } from './local/db';
import type { Transport } from './local/sync';

/**
 * Development sign-in only: set VITE_DEV_AUTH to "<organizationId>:<userId>" (printed by `pnpm db:seed`).
 * Real sign-in replaces this header in the first MVP sprint.
 */
const headers = (): Record<string, string> => ({ 'content-type': 'application/json', authorization: `Dev ${import.meta.env.VITE_DEV_AUTH ?? ''}` });

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: headers() });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export const sendMutations: Transport = async (mutations: Mutation[]) => {
  const res = await fetch('/v1/sync', { method: 'POST', headers: headers(), body: JSON.stringify({ mutations }) });
  // Treat any failure as "could not reach the server": nothing is removed from the outbox.
  if (!res.ok) throw new Error(`sync returned ${res.status}`);
  return ((await res.json()) as { results: MutationResult[] }).results;
};

/** Brings down the server's issues. Issues with changes still waiting on this device are left alone. */
export async function pullIssues(db: LocalDb) {
  const [me, projects, remote] = await Promise.all([
    get<{ role: string }>('/v1/me'),
    get<{ id: string; name: string }[]>('/v1/projects'),
    get<(Omit<LocalIssue, 'pending' | 'updatedAt'> & { updatedAt: string })[]>('/v1/issues?limit=200'),
  ]);
  const tx = db.transaction(['issues', 'meta'], 'readwrite');
  await tx.objectStore('meta').put(me.role, 'role');
  await tx.objectStore('meta').put(projects, 'projects');
  // Drop issues this user can no longer see (reassigned to another contractor, or another user's leftovers).
  // Ones with changes still waiting stay until those changes have been sent.
  const visible = new Set(remote.map((r) => r.id));
  for (const local of await tx.objectStore('issues').getAll()) {
    if (!local.pending && !visible.has(local.id)) await tx.objectStore('issues').delete(local.id);
  }
  for (const r of remote) {
    const local = await tx.objectStore('issues').get(r.id);
    if (local?.pending) continue;
    await tx.objectStore('issues').put({
      id: r.id, number: r.number, projectId: r.projectId, title: r.title, category: r.category, status: r.status, priority: r.priority,
      locationText: r.locationText, contractorId: r.contractorId, dueDate: r.dueDate, updatedAt: r.updatedAt, pending: false,
    });
  }
  await tx.done;
}

/**
 * The on-device data belongs to one person. If a different person is now signed in on this browser,
 * clear it before anything syncs, so one person's unsent changes are never sent under another's name
 * and nobody sees issues cached for someone else.
 * With no signal the check waits for the next start; the data stays as it was.
 */
export async function clearIfUserChanged(db: LocalDb): Promise<boolean> {
  let me: { userId: string; organizationId: string };
  try {
    me = await get<{ userId: string; organizationId: string }>('/v1/me');
  } catch {
    return false;
  }
  const who = `${me.organizationId}:${me.userId}`;
  const before = await db.get('meta', 'user');
  if (before === who) return false;
  const tx = db.transaction(['issues', 'outbox', 'photos', 'meta'], 'readwrite');
  if (before !== undefined) {
    await Promise.all([tx.objectStore('issues').clear(), tx.objectStore('outbox').clear(), tx.objectStore('photos').clear(), tx.objectStore('meta').clear()]);
  }
  await tx.objectStore('meta').put(who, 'user');
  await tx.done;
  return before !== undefined;
}
