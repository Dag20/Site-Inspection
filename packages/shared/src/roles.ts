/**
 * Roles and permissions. This table is the single place a permission rule is changed.
 * The API enforces it on every request; the web app only uses it to hide controls.
 */
export const ROLES = [
  'owner',
  'admin',
  'project_manager',
  'site_engineer',
  'inspector',
  'contractor',
  'subcontractor',
  'client',
  'viewer',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'org.manage',
  'project.create',
  'project.view',
  'issue.view_all', // without this, a user sees only issues assigned to their contractor company
  'issue.create',
  'issue.assign',
  'issue.work', // start work, submit evidence
  'issue.review', // approve or reject evidence
  'issue.close',
  'comment.create',
  'inspection.create',
  'report.generate',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF_BASE: Permission[] = ['project.view', 'issue.view_all', 'issue.create', 'comment.create'];

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  project_manager: [...STAFF_BASE, 'project.create', 'issue.assign', 'issue.review', 'issue.close', 'inspection.create', 'report.generate'],
  site_engineer: [...STAFF_BASE, 'issue.assign', 'issue.close', 'inspection.create', 'report.generate'],
  inspector: [...STAFF_BASE, 'issue.assign', 'issue.review', 'inspection.create', 'report.generate'],
  contractor: ['project.view', 'issue.work', 'comment.create'],
  subcontractor: ['project.view', 'issue.work', 'comment.create'],
  client: ['project.view', 'issue.view_all'],
  viewer: ['project.view', 'issue.view_all'],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** Contractor-side roles are limited to records assigned to their own company. */
export function isContractorRole(role: Role): boolean {
  return role === 'contractor' || role === 'subcontractor';
}
