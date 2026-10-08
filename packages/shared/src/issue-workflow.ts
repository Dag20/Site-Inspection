import { can, type Permission, type Role } from './roles';

/** Capture -> Assign -> Fix -> Prove -> Verify -> Close */
export const ISSUE_STATUSES = ['open', 'assigned', 'in_progress', 'submitted', 'rejected', 'verified', 'closed'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_ACTIONS = ['assign', 'start', 'submit_evidence', 'approve', 'reject', 'close'] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

interface Rule {
  from: readonly IssueStatus[];
  to: IssueStatus;
  permission: Permission;
}

export const ISSUE_RULES: Record<IssueAction, Rule> = {
  assign: { from: ['open', 'assigned'], to: 'assigned', permission: 'issue.assign' },
  start: { from: ['assigned', 'rejected'], to: 'in_progress', permission: 'issue.work' },
  submit_evidence: { from: ['assigned', 'in_progress', 'rejected'], to: 'submitted', permission: 'issue.work' },
  approve: { from: ['submitted'], to: 'verified', permission: 'issue.review' },
  reject: { from: ['submitted'], to: 'rejected', permission: 'issue.review' },
  close: { from: ['verified'], to: 'closed', permission: 'issue.close' },
};

export type TransitionCheck =
  | { ok: true; to: IssueStatus }
  | { ok: false; code: 'forbidden' | 'invalid_state'; message: string };

/**
 * The one place that decides whether a status change is allowed.
 * The server calls it for every change, including changes that were made offline and synced later,
 * so a stale offline action (approving an issue someone already rejected) is refused with a reason.
 */
export function checkTransition(role: Role, current: IssueStatus, action: IssueAction): TransitionCheck {
  const rule = ISSUE_RULES[action];
  if (!can(role, rule.permission)) {
    return { ok: false, code: 'forbidden', message: `Your role cannot ${action.replace('_', ' ')} an issue.` };
  }
  if (!rule.from.includes(current)) {
    return { ok: false, code: 'invalid_state', message: `This issue is now "${current}", so it cannot be changed with "${action.replace('_', ' ')}".` };
  }
  return { ok: true, to: rule.to };
}
