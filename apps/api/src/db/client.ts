import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** A transaction that already has the tenant set. Services accept this, never the bare pool. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/**
 * Runs `fn` in a transaction scoped to one organization.
 * set_config(..., true) lasts only for this transaction, so a pooled connection cannot leak a tenant.
 */
export function withTenant<T>(db: Db, organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
    return fn(tx);
  });
}
