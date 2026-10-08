/**
 * WhatsApp template names and the order of their body variables.
 * These must match the templates approved in Meta Business Suite (see the WhatsApp setup pack).
 * Every template has one URL button whose variable is the secure-link token.
 */
export const TEMPLATES = {
  issue_assigned: ['project', 'number', 'title', 'location', 'priority', 'due'],
  issue_due_soon: ['project', 'number', 'title', 'location', 'due'],
  issue_overdue: ['project', 'number', 'title', 'location', 'due', 'contractor'],
  evidence_submitted: ['project', 'number', 'title', 'location', 'contractor'],
  evidence_rejected: ['project', 'number', 'title', 'location', 'reason'],
  evidence_approved: ['project', 'number', 'title', 'location', 'approver'],
} as const;

export type TemplateName = keyof typeof TEMPLATES;
export type TemplateParams = Record<string, string>;

export function bodyParameters(template: TemplateName, params: TemplateParams): string[] {
  return TEMPLATES[template].map((key) => params[key] ?? '-');
}
