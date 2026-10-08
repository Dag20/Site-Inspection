import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { IssueStatus, Mutation, Severity } from '@sip/shared';

/**
 * The on-device database. Every screen reads and writes here first; the network is only used to sync.
 * That is what makes the app work the same with or without signal.
 */
export interface LocalIssue {
  id: string;
  /** Null until the server has assigned a number, which is when the issue first syncs. */
  number: number | null;
  projectId: string;
  title: string;
  category: string;
  status: IssueStatus;
  priority: Severity;
  locationText: string | null;
  contractorId: string | null;
  dueDate: string | null;
  updatedAt: string;
  /** True while a change to this issue is still waiting in the outbox. */
  pending: boolean;
}

export interface OutboxEntry {
  /** Auto-incremented. Changes are sent in this order. */
  seq?: number;
  mutation: Mutation;
  /** Set when the server refused the change. It stays here until the user has seen it. */
  error?: { code: string; message: string };
}

export interface LocalPhoto {
  id: string;
  issueId: string;
  phase: 'before' | 'after';
  blob: Blob;
  takenAt: string;
  uploaded: boolean;
}

interface Schema extends DBSchema {
  issues: { key: string; value: LocalIssue; indexes: { byProject: string } };
  outbox: { key: number; value: OutboxEntry };
  photos: { key: string; value: LocalPhoto; indexes: { byIssue: string } };
  meta: { key: string; value: unknown };
}

export type LocalDb = IDBPDatabase<Schema>;

export function openLocalDb(name = 'site-inspection'): Promise<LocalDb> {
  return openDB<Schema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('issues', { keyPath: 'id' }).createIndex('byProject', 'projectId');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('photos', { keyPath: 'id' }).createIndex('byIssue', 'issueId');
      db.createObjectStore('meta');
    },
  });
}
