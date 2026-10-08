import { describe, expect, it } from 'vitest';
import { can, checkTransition, isContractorRole, mutation, transitionInput } from './index';

describe('permissions', () => {
  it('contractors can work on issues but not see everything or review', () => {
    expect(can('contractor', 'issue.work')).toBe(true);
    expect(can('contractor', 'issue.view_all')).toBe(false);
    expect(can('contractor', 'issue.review')).toBe(false);
    expect(isContractorRole('subcontractor')).toBe(true);
  });
  it('clients and viewers are read-only', () => {
    for (const role of ['client', 'viewer'] as const) {
      expect(can(role, 'issue.view_all')).toBe(true);
      expect(can(role, 'issue.create')).toBe(false);
      expect(can(role, 'comment.create')).toBe(false);
    }
  });
});

describe('issue workflow', () => {
  it('walks the full loop', () => {
    expect(checkTransition('site_engineer', 'open', 'assign')).toEqual({ ok: true, to: 'assigned' });
    expect(checkTransition('contractor', 'assigned', 'submit_evidence')).toEqual({ ok: true, to: 'submitted' });
    expect(checkTransition('inspector', 'submitted', 'reject')).toEqual({ ok: true, to: 'rejected' });
    expect(checkTransition('contractor', 'rejected', 'submit_evidence')).toEqual({ ok: true, to: 'submitted' });
    expect(checkTransition('inspector', 'submitted', 'approve')).toEqual({ ok: true, to: 'verified' });
    expect(checkTransition('site_engineer', 'verified', 'close')).toEqual({ ok: true, to: 'closed' });
  });
  it('refuses a stale action with a reason', () => {
    const r = checkTransition('inspector', 'rejected', 'approve');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_state');
  });
  it('refuses an action the role may not take', () => {
    const r = checkTransition('contractor', 'submitted', 'approve');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });
  it('cannot close before verification', () => {
    expect(checkTransition('project_manager', 'submitted', 'close').ok).toBe(false);
  });
});

describe('input validation', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  it('requires a reason to reject and a contractor to assign', () => {
    expect(transitionInput.safeParse({ issueId: uuid, action: 'reject' }).success).toBe(false);
    expect(transitionInput.safeParse({ issueId: uuid, action: 'reject', reason: 'Photo unclear' }).success).toBe(true);
    expect(transitionInput.safeParse({ issueId: uuid, action: 'assign' }).success).toBe(false);
  });
  it('parses a mutation envelope', () => {
    const r = mutation.safeParse({ key: uuid, type: 'comment.create', clientTime: new Date().toISOString(), payload: { id: uuid, issueId: uuid, body: 'Done' } });
    expect(r.success).toBe(true);
  });
});
