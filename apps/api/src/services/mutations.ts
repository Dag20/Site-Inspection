import { and, eq } from 'drizzle-orm';
import type { Mutation, MutationResult } from '@sip/shared';
import type { AuthContext } from '../auth';
import { withTenant, type Db } from '../db/client';
import { appliedMutations } from '../db/schema';
import { AppError } from '../errors';
import { addComment, createIssue, transitionIssue } from './issues';

/**
 * Applies one change from a device, exactly once.
 * Each change runs in its own transaction: the change, its audit line, its notifications and the record
 * of its key commit together or not at all. A repeated key returns the stored result.
 * A change the rules no longer allow is returned as "rejected" with a message for the user.
 */
export async function applyMutation(db: Db, auth: AuthContext, m: Mutation): Promise<MutationResult> {
  try {
    return await withTenant(db, auth.organizationId, async (tx) => {
      const [seen] = await tx.select().from(appliedMutations).where(and(eq(appliedMutations.organizationId, auth.organizationId), eq(appliedMutations.key, m.key)));
      if (seen) return { key: m.key, status: 'duplicate', data: seen.result } as const;

      const occurredAt = new Date(m.clientTime);
      let data: unknown;
      if (m.type === 'issue.create') data = await createIssue(tx, auth, m.payload, occurredAt);
      else if (m.type === 'issue.transition') data = await transitionIssue(tx, auth, m.payload, occurredAt);
      else data = await addComment(tx, auth, m.payload, occurredAt);

      const result = JSON.parse(JSON.stringify(data));
      await tx.insert(appliedMutations).values({ organizationId: auth.organizationId, key: m.key, userId: auth.userId, type: m.type, result });
      return { key: m.key, status: 'applied', data: result } as const;
    });
  } catch (err) {
    if (err instanceof AppError) return { key: m.key, status: 'rejected', code: err.code, message: err.message };
    // The same record id sent twice under different keys (a device that lost its outbox, for example).
    const pgCode = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (pgCode === '23505') return { key: m.key, status: 'rejected', code: 'invalid_state', message: 'This record already exists.' };
    throw err;
  }
}
