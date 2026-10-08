import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ISSUE_STATUSES, ROLES, SEVERITIES } from '@sip/shared';

/**
 * Every tenant-owned table carries organization_id. Row-level security (drizzle/0001_security.sql)
 * blocks any row whose organization_id differs from the request's organization.
 * When you add a table here, add it to TENANT_TABLES in src/db/tenant-tables.ts as well;
 * a test fails if a table with organization_id is missing a policy.
 */

export const roleEnum = pgEnum('role', ROLES);
export const issueStatusEnum = pgEnum('issue_status', ISSUE_STATUSES);
export const severityEnum = pgEnum('severity', SEVERITIES);
export const inspectionResultEnum = pgEnum('inspection_result', ['pass', 'fail', 'pass_with_comments', 'not_applicable']);
export const inspectionStatusEnum = pgEnum('inspection_status', ['scheduled', 'in_progress', 'completed', 'cancelled']);
export const ncrStatusEnum = pgEnum('ncr_status', ['open', 'assigned', 'action_proposed', 'evidence_submitted', 'rejected', 'approved', 'closed']);
export const notificationStatusEnum = pgEnum('notification_status', ['queued', 'sent', 'delivered', 'failed']);
export const channelEnum = pgEnum('channel', ['whatsapp', 'email']);
export const attachmentKindEnum = pgEnum('attachment_kind', ['photo', 'file', 'signature']);
export const attachmentPhaseEnum = pgEnum('attachment_phase', ['before', 'after', 'general']);
export const entityTypeEnum = pgEnum('entity_type', ['project', 'issue', 'inspection', 'ncr', 'daily_report', 'location', 'contractor']);
export const fieldTypeEnum = pgEnum('field_type', [
  'text', 'number', 'date', 'dropdown', 'multi_select', 'checkbox', 'user', 'contractor', 'location', 'photo', 'file', 'long_text',
]);

const pk = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const org = () => uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });

export const organizations = pgTable('organizations', {
  id: pk(),
  name: text('name').notNull(),
  country: text('country').notNull().default('QA'),
  defaultLocale: text('default_locale').notNull().default('en'),
  createdAt: createdAt(),
});

/** People are global so one person can belong to several organizations. Membership is what is tenant-scoped. */
export const users = pgTable('users', {
  id: pk(),
  email: text('email').unique(),
  phone: text('phone'),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('en'),
  createdAt: createdAt(),
});

export const contractors = pgTable('contractors', {
  id: pk(),
  organizationId: org(),
  name: text('name').notNull(),
  trade: text('trade'),
  /** Number that receives WhatsApp notifications for this company, in E.164 form. */
  whatsappPhone: text('whatsapp_phone'),
  createdAt: createdAt(),
}, (t) => [index('contractors_org_idx').on(t.organizationId)]);

export const memberships = pgTable('memberships', {
  id: pk(),
  organizationId: org(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  /** Set for contractor and subcontractor users. It limits what they can see. */
  contractorId: uuid('contractor_id').references(() => contractors.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('memberships_org_user_uq').on(t.organizationId, t.userId)]);

export const projects = pgTable('projects', {
  id: pk(),
  organizationId: org(),
  name: text('name').notNull(),
  code: text('code'),
  clientName: text('client_name'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('projects_org_idx').on(t.organizationId)]);

/** Project-level role. When present it overrides the organization-level role for that project. */
export const projectMembers = pgTable('project_members', {
  organizationId: org(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] })]);

export const buildings = pgTable('buildings', {
  id: pk(),
  organizationId: org(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
});

/** Floor, room or zone. parent_id lets Level 3 contain Bathroom B-14. */
export const locations = pgTable('locations', {
  id: pk(),
  organizationId: org(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  buildingId: uuid('building_id').references(() => buildings.id),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('locations_project_idx').on(t.projectId)]);

export const issueCounters = pgTable('issue_counters', {
  organizationId: uuid('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  nextNumber: integer('next_number').notNull().default(1001),
});

export const issues = pgTable('issues', {
  id: pk(),
  organizationId: org(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  /** Human-facing number (#1042). Assigned by the server, so an issue created offline has none until it syncs. */
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  locationId: uuid('location_id').references(() => locations.id),
  locationText: text('location_text'),
  category: text('category').notNull(),
  severity: severityEnum('severity').notNull().default('medium'),
  priority: severityEnum('priority').notNull().default('medium'),
  status: issueStatusEnum('status').notNull().default('open'),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  inspectionId: uuid('inspection_id'),
  rejectionReason: text('rejection_reason'),
  dueDate: date('due_date'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  verifiedBy: uuid('verified_by').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('issues_org_number_uq').on(t.organizationId, t.number),
  index('issues_project_status_idx').on(t.projectId, t.status),
  index('issues_contractor_idx').on(t.contractorId),
]);

export const templates = pgTable('templates', {
  id: pk(),
  organizationId: org(),
  kind: text('kind').notNull().default('inspection'),
  name: text('name').notNull(),
  /** Checklist definition. Regulatory wording lives here, editable per company, never in code. */
  definition: jsonb('definition').notNull().default(sql`'{"items":[]}'::jsonb`),
  createdAt: createdAt(),
});

export const inspections = pgTable('inspections', {
  id: pk(),
  organizationId: org(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  templateId: uuid('template_id').references(() => templates.id),
  type: text('type').notNull(),
  locationId: uuid('location_id').references(() => locations.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  inspectorId: uuid('inspector_id').references(() => users.id),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  status: inspectionStatusEnum('status').notNull().default('scheduled'),
  result: inspectionResultEnum('result'),
  comments: text('comments'),
  signedBy: uuid('signed_by').references(() => users.id),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('inspections_project_idx').on(t.projectId)]);

export const inspectionItems = pgTable('inspection_items', {
  id: pk(),
  organizationId: org(),
  inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  label: text('label').notNull(),
  result: inspectionResultEnum('result'),
  comment: text('comment'),
  /** A failed item can raise an issue. */
  issueId: uuid('issue_id').references(() => issues.id),
});

export const ncrs = pgTable('ncrs', {
  id: pk(),
  organizationId: org(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  number: integer('number').notNull(),
  description: text('description').notNull(),
  requirement: text('requirement'),
  nonConformance: text('non_conformance'),
  rootCause: text('root_cause'),
  immediateAction: text('immediate_action'),
  correctiveAction: text('corrective_action'),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  status: ncrStatusEnum('status').notNull().default('open'),
  dueDate: date('due_date'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('ncrs_org_number_uq').on(t.organizationId, t.number)]);

export const comments = pgTable('comments', {
  id: pk(),
  organizationId: org(),
  entityType: entityTypeEnum('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  authorId: uuid('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, (t) => [index('comments_entity_idx').on(t.entityType, t.entityId)]);

/** Photos, documents and signatures. The file itself lives in object storage under storage_key. */
export const attachments = pgTable('attachments', {
  id: pk(),
  organizationId: org(),
  projectId: uuid('project_id').references(() => projects.id),
  entityType: entityTypeEnum('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  kind: attachmentKindEnum('kind').notNull().default('photo'),
  phase: attachmentPhaseEnum('phase').notNull().default('general'),
  storageKey: text('storage_key').notNull(),
  fileName: text('file_name'),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  caption: text('caption'),
  takenAt: timestamp('taken_at', { withTimezone: true }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index('attachments_entity_idx').on(t.entityType, t.entityId)]);

/**
 * Audit trail. Append-only: a database trigger rejects UPDATE, DELETE and TRUNCATE.
 * actor_id is null for system actions and for actions taken through a secure link.
 */
export const activities = pgTable('activities', {
  id: pk(),
  organizationId: org(),
  projectId: uuid('project_id'),
  entityType: entityTypeEnum('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  actorLabel: text('actor_label').notNull(),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  /** When the user did it on their device, which can be earlier than created_at if they were offline. */
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [index('activities_entity_idx').on(t.entityType, t.entityId, t.createdAt)]);

export const notifications = pgTable('notifications', {
  id: pk(),
  organizationId: org(),
  channel: channelEnum('channel').notNull().default('whatsapp'),
  template: text('template').notNull(),
  locale: text('locale').notNull().default('en'),
  recipientUserId: uuid('recipient_user_id').references(() => users.id),
  recipientAddress: text('recipient_address').notNull(),
  params: jsonb('params').notNull(),
  entityType: entityTypeEnum('entity_type'),
  entityId: uuid('entity_id'),
  status: notificationStatusEnum('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  /** Filled from the provider's delivery report so message spend can be reviewed each quarter. */
  billable: boolean('billable'),
  costAmount: numeric('cost_amount', { precision: 10, scale: 5 }),
  costCurrency: text('cost_currency'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('notifications_status_idx').on(t.status, t.createdAt)]);

/** A link sent in a notification. It opens one issue for one recipient without a login. Only the hash is stored. */
export const accessLinks = pgTable('access_links', {
  id: pk(),
  organizationId: org(),
  tokenHash: text('token_hash').notNull().unique(),
  entityType: entityTypeEnum('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  recipientUserId: uuid('recipient_user_id').references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const dailyReports = pgTable('daily_reports', {
  id: pk(),
  organizationId: org(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  reportDate: date('report_date').notNull(),
  weather: text('weather'),
  workers: integer('workers'),
  content: jsonb('content').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('daily_reports_project_date_uq').on(t.projectId, t.reportDate, t.createdBy)]);

export const customFields = pgTable('custom_fields', {
  id: pk(),
  organizationId: org(),
  entityType: entityTypeEnum('entity_type').notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  fieldType: fieldTypeEnum('field_type').notNull(),
  options: jsonb('options'),
  required: boolean('required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('custom_fields_org_entity_key_uq').on(t.organizationId, t.entityType, t.key)]);

export const customFieldValues = pgTable('custom_field_values', {
  organizationId: org(),
  fieldId: uuid('field_id').notNull().references(() => customFields.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull(),
  value: jsonb('value'),
}, (t) => [primaryKey({ columns: [t.fieldId, t.entityId] })]);

/** One row per change key received from a device. A retry returns the stored result instead of applying twice. */
export const appliedMutations = pgTable('applied_mutations', {
  organizationId: org(),
  key: uuid('key').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  result: jsonb('result').notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.key] })]);
