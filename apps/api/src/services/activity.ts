import type { AuthContext } from '../auth';
import type { Tx } from '../db/client';
import { activities } from '../db/schema';

type EntityType = (typeof activities.$inferInsert)['entityType'];

/** Adds one line to the audit trail. There is deliberately no update or delete counterpart. */
export async function recordActivity(
  tx: Tx,
  auth: AuthContext,
  entry: { projectId?: string | null; entityType: EntityType; entityId: string; action: string; before?: unknown; after?: unknown; occurredAt?: Date },
) {
  await tx.insert(activities).values({
    organizationId: auth.organizationId,
    projectId: entry.projectId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorId: auth.userId,
    actorLabel: auth.name,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    occurredAt: entry.occurredAt ?? new Date(),
  });
}
