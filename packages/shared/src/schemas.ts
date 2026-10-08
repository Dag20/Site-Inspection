import { z } from 'zod';
import { ISSUE_ACTIONS, ISSUE_STATUSES } from './issue-workflow';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

const id = z.uuid();

/** Ids are generated on the device so an issue created offline can have photos and comments attached before it syncs. */
export const createIssueInput = z.object({
  id,
  projectId: id,
  locationId: id.nullish(),
  locationText: z.string().trim().max(200).nullish(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullish(),
  category: z.string().trim().min(1).max(80),
  severity: z.enum(SEVERITIES).default('medium'),
  priority: z.enum(SEVERITIES).default('medium'),
  contractorId: id.nullish(),
  dueDate: z.iso.date().nullish(),
});
export type CreateIssueInput = z.infer<typeof createIssueInput>;

export const transitionInput = z
  .object({
    issueId: id,
    action: z.enum(ISSUE_ACTIONS),
    contractorId: id.nullish(),
    reason: z.string().trim().max(1000).nullish(),
    comment: z.string().trim().max(4000).nullish(),
    attachmentIds: z.array(id).max(20).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'assign' && !v.contractorId) ctx.addIssue({ code: 'custom', path: ['contractorId'], message: 'Choose a contractor.' });
    if (v.action === 'reject' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give a reason for the rejection.' });
  });
export type TransitionInput = z.infer<typeof transitionInput>;

export const commentInput = z.object({ id, issueId: id, body: z.string().trim().min(1).max(4000) });
export type CommentInput = z.infer<typeof commentInput>;

/**
 * One offline-capable change. `key` is unique per change and makes a retry safe:
 * the server applies each key once and returns the stored result for a repeat.
 */
export const mutation = z.discriminatedUnion('type', [
  z.object({ key: id, type: z.literal('issue.create'), clientTime: z.iso.datetime(), payload: createIssueInput }),
  z.object({ key: id, type: z.literal('issue.transition'), clientTime: z.iso.datetime(), payload: transitionInput }),
  z.object({ key: id, type: z.literal('comment.create'), clientTime: z.iso.datetime(), payload: commentInput }),
]);
export type Mutation = z.infer<typeof mutation>;

export const syncRequest = z.object({ mutations: z.array(mutation).min(1).max(50) });

export type MutationResult =
  | { key: string; status: 'applied' | 'duplicate'; data: unknown }
  | { key: string; status: 'rejected'; code: string; message: string };

export const listIssuesQuery = z.object({
  projectId: id.optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
