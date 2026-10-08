import type { LocalDb, LocalIssue } from './db';
import { countWaiting, listRefused, syncOnce, syncState, type SyncState, type Transport } from './sync';

export interface Snapshot {
  state: SyncState;
  waiting: number;
  refused: { seq: number; message: string }[];
  issues: LocalIssue[];
}

/**
 * Keeps the outbox moving and tells the screen what to show.
 * It tries to sync when the app opens, when signal returns, after every local change, and every 20 seconds.
 */
export class SyncEngine {
  private listeners = new Set<() => void>();
  private busy = false;
  private again = false;
  private snap: Snapshot = { state: 'synced', waiting: 0, refused: [], issues: [] };

  constructor(private db: LocalDb, private send: Transport, private pull?: () => Promise<void>) {}

  start() {
    window.addEventListener('online', () => void this.kick());
    window.addEventListener('offline', () => void this.refresh());
    setInterval(() => void this.kick(), 20_000);
    void this.kick();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  /** Call after any local change. */
  async kick() {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    await this.refresh();
    try {
      if (navigator.onLine) {
        const r = await syncOnce(this.db, this.send);
        if (r.reachedServer && this.pull) await this.pull().catch(() => undefined);
      }
    } finally {
      this.busy = false;
      await this.refresh();
      if (this.again) {
        this.again = false;
        void this.kick();
      }
    }
  }

  async dismissRefused(seq: number) {
    await this.db.delete('outbox', seq);
    await this.refresh();
  }

  private async refresh() {
    const [waiting, refused, issues] = await Promise.all([countWaiting(this.db), listRefused(this.db), this.db.getAll('issues')]);
    issues.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.snap = {
      state: syncState({ online: navigator.onLine, waiting, busy: this.busy }),
      waiting,
      refused: refused.map((e) => ({ seq: e.seq!, message: e.error!.message })),
      issues,
    };
    this.listeners.forEach((fn) => fn());
  }
}
