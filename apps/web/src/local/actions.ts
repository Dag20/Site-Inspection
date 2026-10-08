import { checkTransition, type CreateIssueInput, type IssueAction, type Role } from '@sip/shared';
import type { LocalDb, LocalIssue, LocalPhoto } from './db';

const now = () => new Date().toISOString();

/**
 * Creates an issue on the device. The issue and its outbox entry are written in one IndexedDB
 * transaction, so there is never an issue that will not sync or a queued change with no issue.
 */
export async function createIssue(db: LocalDb, input: Omit<CreateIssueInput, 'id' | 'severity' | 'priority'> & Partial<Pick<CreateIssueInput, 'priority'>>, photo?: Blob): Promise<LocalIssue> {
  const id = crypto.randomUUID();
  const priority = input.priority ?? 'medium';
  const issue: LocalIssue = {
    id,
    number: null,
    projectId: input.projectId,
    title: input.title,
    category: input.category,
    status: input.contractorId ? 'assigned' : 'open',
    priority,
    locationText: input.locationText ?? null,
    contractorId: input.contractorId ?? null,
    dueDate: input.dueDate ?? null,
    updatedAt: now(),
    pending: true,
  };
  const tx = db.transaction(['issues', 'outbox', 'photos'], 'readwrite');
  await tx.objectStore('issues').put(issue);
  await tx.objectStore('outbox').add({
    mutation: { key: crypto.randomUUID(), type: 'issue.create', clientTime: now(), payload: { ...input, id, severity: priority, priority } },
  });
  if (photo) {
    const p: LocalPhoto = { id: crypto.randomUUID(), issueId: id, phase: 'before', blob: photo, takenAt: now(), uploaded: false };
    await tx.objectStore('photos').put(p);
  }
  await tx.done;
  return issue;
}

/**
 * Changes an issue's status on the device, using the same rules the server enforces.
 * The server still has the final say when the change syncs.
 */
export async function transitionIssue(
  db: LocalDb,
  role: Role,
  issueId: string,
  action: IssueAction,
  extra: { contractorId?: string; reason?: string; comment?: string } = {},
): Promise<LocalIssue> {
  const tx = db.transaction(['issues', 'outbox'], 'readwrite');
  const issue = await tx.objectStore('issues').get(issueId);
  if (!issue) throw new Error('Issue not found on this device.');
  const check = checkTransition(role, issue.status, action);
  if (!check.ok) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error(check.message);
  }
  const next: LocalIssue = { ...issue, status: check.to, contractorId: extra.contractorId ?? issue.contractorId, updatedAt: now(), pending: true };
  await tx.objectStore('issues').put(next);
  await tx.objectStore('outbox').add({
    mutation: { key: crypto.randomUUID(), type: 'issue.transition', clientTime: now(), payload: { issueId, action, attachmentIds: [], ...extra } },
  });
  await tx.done;
  return next;
}
