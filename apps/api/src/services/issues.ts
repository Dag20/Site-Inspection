import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { can, checkTransition, isContractorRole, type CommentInput, type CreateIssueInput, type TransitionInput } from '@sip/shared';
import { roleForProject, type AuthContext } from '../auth';
import type { Tx } from '../db/client';
import { activities, attachments, comments, contractors, issues, locations, projects, users } from '../db/schema';
import { AppError } from '../errors';
import { notifyContractor, notifyInspectors } from '../notifications/queue';
import { recordActivity } from './activity';

type Issue = typeof issues.$inferSelect;

async function nextIssueNumber(tx: Tx, organizationId: string): Promise<number> {
  const res = await tx.execute<{ number: number }>(sql`
    insert into issue_counters (organization_id, next_number) values (${organizationId}, 1002)
    on conflict (organization_id) do update set next_number = issue_counters.next_number + 1
    returning next_number - 1 as number`);
  return res.rows[0]!.number;
}

async function templateParams(tx: Tx, issue: Issue) {
  const [project] = await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, issue.projectId));
  const [loc] = issue.locationId ? await tx.select({ name: locations.name }).from(locations).where(eq(locations.id, issue.locationId)) : [];
  const [con] = issue.contractorId ? await tx.select({ name: contractors.name }).from(contractors).where(eq(contractors.id, issue.contractorId)) : [];
  return {
    project: project?.name ?? '-',
    number: String(issue.number),
    title: issue.title,
    location: [loc?.name, issue.locationText].filter(Boolean).join(' / ') || '-',
    priority: issue.priority,
    due: issue.dueDate ?? '-',
    contractor: con?.name ?? '-',
  };
}

/** Loads an issue the caller is allowed to see. Contractor users get "not found" for other companies' issues. */
async function loadIssue(tx: Tx, auth: AuthContext, id: string, lock = false): Promise<Issue> {
  const q = tx.select().from(issues).where(eq(issues.id, id));
  const [issue] = lock ? await q.for('update') : await q;
  if (!issue) throw new AppError('not_found', 'Issue not found.');
  if (isContractorRole(auth.role) && issue.contractorId !== auth.contractorId) throw new AppError('not_found', 'Issue not found.');
  return issue;
}

export async function createIssue(tx: Tx, auth: AuthContext, input: CreateIssueInput, occurredAt = new Date()) {
  const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId));
  if (!project) throw new AppError('not_found', 'Project not found.');
  const role = await roleForProject(tx, auth, input.projectId);
  if (!can(role, 'issue.create')) throw new AppError('forbidden', 'Your role cannot create issues.');
  if (input.contractorId && !can(role, 'issue.assign')) throw new AppError('forbidden', 'Your role cannot assign issues.');

  const number = await nextIssueNumber(tx, auth.organizationId);
  const [issue] = await tx
    .insert(issues)
    .values({
      id: input.id,
      organizationId: auth.organizationId,
      projectId: input.projectId,
      number,
      title: input.title,
      description: input.description ?? null,
      locationId: input.locationId ?? null,
      locationText: input.locationText ?? null,
      category: input.category,
      severity: input.severity,
      priority: input.priority,
      contractorId: input.contractorId ?? null,
      status: input.contractorId ? 'assigned' : 'open',
      dueDate: input.dueDate ?? null,
      createdBy: auth.userId,
    })
    .returning();
  if (!issue) throw new Error('insert returned no row');

  await recordActivity(tx, auth, { projectId: issue.projectId, entityType: 'issue', entityId: issue.id, action: 'issue.created', after: { title: issue.title, status: 'open' }, occurredAt });
  if (issue.contractorId) {
    await recordActivity(tx, auth, { projectId: issue.projectId, entityType: 'issue', entityId: issue.id, action: 'issue.assigned', before: { status: 'open' }, after: { status: 'assigned', contractorId: issue.contractorId }, occurredAt });
    await notifyContractor(tx, auth.organizationId, 'issue_assigned', issue, await templateParams(tx, issue));
  }
  return issue;
}

export async function transitionIssue(tx: Tx, auth: AuthContext, input: TransitionInput, occurredAt = new Date()) {
  const current = await loadIssue(tx, auth, input.issueId, true);
  const role = await roleForProject(tx, auth, current.projectId);
  const check = checkTransition(role, current.status, input.action);
  if (!check.ok) throw new AppError(check.code, check.message);

  const patch: Partial<typeof issues.$inferInsert> = { status: check.to, updatedAt: new Date() };
  if (input.action === 'assign') patch.contractorId = input.contractorId!;
  if (input.action === 'reject') patch.rejectionReason = input.reason!;
  if (input.action === 'submit_evidence') patch.rejectionReason = null;
  if (input.action === 'approve') patch.verifiedBy = auth.userId;
  if (input.action === 'close') patch.closedAt = new Date();

  const [issue] = await tx.update(issues).set(patch).where(eq(issues.id, current.id)).returning();
  if (!issue) throw new Error('update returned no row');

  if (input.action === 'submit_evidence' && input.attachmentIds.length) {
    await tx.update(attachments).set({ phase: 'after' }).where(and(eq(attachments.entityType, 'issue'), eq(attachments.entityId, issue.id), inArray(attachments.id, input.attachmentIds)));
  }
  if (input.comment) {
    await tx.insert(comments).values({ organizationId: auth.organizationId, entityType: 'issue', entityId: issue.id, authorId: auth.userId, body: input.comment });
  }

  await recordActivity(tx, auth, {
    projectId: issue.projectId,
    entityType: 'issue',
    entityId: issue.id,
    action: `issue.${input.action}`,
    before: { status: current.status, contractorId: current.contractorId },
    after: { status: issue.status, contractorId: issue.contractorId, reason: input.reason ?? undefined },
    occurredAt,
  });

  const params = await templateParams(tx, issue);
  if (input.action === 'assign') await notifyContractor(tx, auth.organizationId, 'issue_assigned', issue, params);
  if (input.action === 'submit_evidence') await notifyInspectors(tx, auth.organizationId, 'evidence_submitted', issue, params);
  if (input.action === 'reject') await notifyContractor(tx, auth.organizationId, 'evidence_rejected', issue, { ...params, reason: input.reason! });
  if (input.action === 'approve') await notifyContractor(tx, auth.organizationId, 'evidence_approved', issue, { ...params, approver: auth.name });
  return issue;
}

export async function addComment(tx: Tx, auth: AuthContext, input: CommentInput, occurredAt = new Date()) {
  const issue = await loadIssue(tx, auth, input.issueId);
  const role = await roleForProject(tx, auth, issue.projectId);
  if (!can(role, 'comment.create')) throw new AppError('forbidden', 'Your role cannot comment.');
  const [comment] = await tx.insert(comments).values({ id: input.id, organizationId: auth.organizationId, entityType: 'issue', entityId: issue.id, authorId: auth.userId, body: input.body }).returning();
  await recordActivity(tx, auth, { projectId: issue.projectId, entityType: 'issue', entityId: issue.id, action: 'issue.commented', after: { commentId: input.id }, occurredAt });
  return comment;
}

export async function listIssues(tx: Tx, auth: AuthContext, q: { projectId?: string; status?: Issue['status']; limit: number; offset: number }) {
  const where = and(
    q.projectId ? eq(issues.projectId, q.projectId) : undefined,
    q.status ? eq(issues.status, q.status) : undefined,
    // Contractor users only ever see their own company's issues. A contractor user with no company sees nothing.
    isContractorRole(auth.role) ? (auth.contractorId ? eq(issues.contractorId, auth.contractorId) : sql`false`) : undefined,
  );
  return tx.select().from(issues).where(where).orderBy(desc(issues.number)).limit(q.limit).offset(q.offset);
}

export async function getIssue(tx: Tx, auth: AuthContext, id: string) {
  const issue = await loadIssue(tx, auth, id);
  // One at a time: a transaction uses a single connection, which runs one query at a time.
  const activity = await tx.select().from(activities).where(and(eq(activities.entityType, 'issue'), eq(activities.entityId, id))).orderBy(asc(activities.createdAt));
  const issueComments = await tx
    .select({ id: comments.id, body: comments.body, createdAt: comments.createdAt, author: users.name })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(and(eq(comments.entityType, 'issue'), eq(comments.entityId, id)))
    .orderBy(asc(comments.createdAt));
  const files = await tx.select().from(attachments).where(and(eq(attachments.entityType, 'issue'), eq(attachments.entityId, id))).orderBy(asc(attachments.createdAt));
  return { ...issue, activity, comments: issueComments, attachments: files };
}
