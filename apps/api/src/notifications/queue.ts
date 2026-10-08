import { and, eq, isNotNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { withTenant, type Db, type Tx } from '../db/client';
import { accessLinks, contractors, memberships, notifications, projectMembers, users } from '../db/schema';
import type { Channel } from './channels';
import type { TemplateName, TemplateParams } from './templates';

const LINK_DAYS = 14;
const MAX_ATTEMPTS = 5;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

interface IssueRef { id: string; contractorId: string | null; projectId: string }

/** Queues a message to the contractor company the issue is assigned to. No number on file means no message. */
export async function notifyContractor(tx: Tx, organizationId: string, template: TemplateName, issue: IssueRef, params: TemplateParams) {
  if (!issue.contractorId) return;
  const [c] = await tx.select({ phone: contractors.whatsappPhone }).from(contractors).where(eq(contractors.id, issue.contractorId));
  if (!c?.phone) return;
  await tx.insert(notifications).values({ organizationId, template, recipientAddress: c.phone, params: { ...params, _contractorId: issue.contractorId }, entityType: 'issue', entityId: issue.id });
}

/** Queues a message to each inspector: those on the project, or all inspectors in the organization if none are set. */
export async function notifyInspectors(tx: Tx, organizationId: string, template: TemplateName, issue: IssueRef, params: TemplateParams) {
  let people = await tx
    .select({ id: users.id, phone: users.phone })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, issue.projectId), eq(projectMembers.role, 'inspector'), isNotNull(users.phone)));
  if (!people.length) {
    people = await tx
      .select({ id: users.id, phone: users.phone })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.role, 'inspector'), isNotNull(users.phone)));
  }
  for (const p of people) {
    await tx.insert(notifications).values({ organizationId, template, recipientUserId: p.id, recipientAddress: p.phone!, params, entityType: 'issue', entityId: issue.id });
  }
}

/**
 * Sends this organization's queued messages. Called after a request commits.
 * The secure link is created here, at send time, so only its hash is ever stored.
 * Not built yet: a background worker that retries failed messages across all organizations.
 * It needs its own database role, because the API's role cannot read across tenants.
 */
export async function dispatchQueued(db: Db, organizationId: string, channel: Channel): Promise<number> {
  const queued = await withTenant(db, organizationId, (tx) =>
    tx.select().from(notifications).where(and(eq(notifications.status, 'queued'), eq(notifications.channel, channel.name))).limit(50),
  );
  let sent = 0;
  for (const n of queued) {
    const token = randomBytes(32).toString('base64url');
    const { _contractorId, ...params } = n.params as TemplateParams & { _contractorId?: string };
    try {
      await withTenant(db, organizationId, (tx) =>
        tx.insert(accessLinks).values({
          organizationId,
          tokenHash: hashToken(token),
          entityType: n.entityType ?? 'issue',
          entityId: n.entityId!,
          contractorId: _contractorId ?? null,
          recipientUserId: n.recipientUserId,
          expiresAt: new Date(Date.now() + LINK_DAYS * 864e5),
        }),
      );
      const result = await channel.send({ to: n.recipientAddress, template: n.template as TemplateName, locale: n.locale, params, linkToken: `${organizationId}.${token}` });
      await withTenant(db, organizationId, (tx) =>
        tx.update(notifications).set({ status: 'sent', sentAt: new Date(), attempts: n.attempts + 1, providerMessageId: result.providerMessageId ?? null, error: null }).where(eq(notifications.id, n.id)),
      );
      sent++;
    } catch (err) {
      const attempts = n.attempts + 1;
      await withTenant(db, organizationId, (tx) =>
        tx.update(notifications).set({ attempts, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', error: String((err as Error).message ?? err) }).where(eq(notifications.id, n.id)),
      );
    }
  }
  return sent;
}
