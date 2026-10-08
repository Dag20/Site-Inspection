/** Tables protected by the tenant row-level security policy. Keep in step with schema.ts. */
export const TENANT_TABLES = [
  'contractors', 'memberships', 'projects', 'project_members', 'buildings', 'locations', 'issue_counters',
  'issues', 'templates', 'inspections', 'inspection_items', 'ncrs', 'comments', 'attachments', 'activities',
  'notifications', 'access_links', 'daily_reports', 'custom_fields', 'custom_field_values', 'applied_mutations',
] as const;
