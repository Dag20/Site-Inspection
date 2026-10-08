import type { AuthContext } from '../auth';
import { withTenant, createDb, type Db } from './client';
import { contractors, locations, memberships, organizations, projectMembers, projects, templates, users } from './schema';
import { createIssue, transitionIssue } from '../services/issues';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Fixed ids so the development sign-in tokens printed below stay the same on every machine. */
export const DEMO = {
  org: u(1),
  project: u(10),
  users: { khalid: u(101), ahmed: u(102), fatima: u(103), ravi: u(104), omar: u(105) },
  contractors: { abcMep: u(201), dohaElectrical: u(202), gulfFitout: u(203), qatarCivil: u(204) },
  locations: { basement: u(301), ground: u(302), l1: u(303), l2: u(304), l3: u(305), l4: u(306), roof: u(307) },
};

/** Example data for one Qatar project. Phone numbers are placeholders and are not real. */
export async function seedDemo(db: Db) {
  const org = DEMO.org;
  await withTenant(db, org, async (tx) => {
    await tx.insert(organizations).values({ id: org, name: 'Example Contracting W.L.L.', country: 'QA' });
    await tx.insert(users).values([
      { id: DEMO.users.khalid, name: 'Khalid', email: 'khalid@example.com' },
      { id: DEMO.users.ahmed, name: 'Ahmed', email: 'ahmed@example.com' },
      { id: DEMO.users.fatima, name: 'Fatima', email: 'fatima@example.com', phone: '+97400000003' },
      { id: DEMO.users.ravi, name: 'Ravi (ABC MEP)', email: 'ravi@example.com' },
      { id: DEMO.users.omar, name: 'Omar (Doha Electrical)', email: 'omar@example.com' },
    ]);
    await tx.insert(contractors).values([
      { id: DEMO.contractors.abcMep, organizationId: org, name: 'ABC MEP', trade: 'MEP', whatsappPhone: '+97400000011' },
      { id: DEMO.contractors.dohaElectrical, organizationId: org, name: 'Doha Electrical', trade: 'Electrical', whatsappPhone: '+97400000012' },
      { id: DEMO.contractors.gulfFitout, organizationId: org, name: 'Gulf Fitout', trade: 'Fit-out', whatsappPhone: '+97400000013' },
      { id: DEMO.contractors.qatarCivil, organizationId: org, name: 'Qatar Civil Works', trade: 'Civil', whatsappPhone: '+97400000014' },
    ]);
    await tx.insert(memberships).values([
      { organizationId: org, userId: DEMO.users.khalid, role: 'project_manager' },
      { organizationId: org, userId: DEMO.users.ahmed, role: 'site_engineer' },
      { organizationId: org, userId: DEMO.users.fatima, role: 'inspector' },
      { organizationId: org, userId: DEMO.users.ravi, role: 'contractor', contractorId: DEMO.contractors.abcMep },
      { organizationId: org, userId: DEMO.users.omar, role: 'contractor', contractorId: DEMO.contractors.dohaElectrical },
    ]);
    await tx.insert(projects).values({ id: DEMO.project, organizationId: org, name: 'Lusail Commercial Tower', code: 'LCT' });
    await tx.insert(projectMembers).values({ organizationId: org, projectId: DEMO.project, userId: DEMO.users.fatima, role: 'inspector' });
    const names = ['Basement', 'Ground Floor', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Roof'];
    await tx.insert(locations).values(Object.values(DEMO.locations).map((id, i) => ({ id, organizationId: org, projectId: DEMO.project, name: names[i]!, sortOrder: i })));
    await tx.insert(templates).values({
      organizationId: org,
      name: 'MEP first-fix inspection (example)',
      definition: { items: ['Pipework supported at specified spacing', 'Pressure test recorded', 'Penetrations sealed', 'Valves accessible and tagged'] },
    });

    const as = (userId: string, name: string, role: AuthContext['role'], contractorId: string | null = null): AuthContext => ({ userId, organizationId: org, role, contractorId, name });
    const ahmed = as(DEMO.users.ahmed, 'Ahmed', 'site_engineer');
    const fatima = as(DEMO.users.fatima, 'Fatima', 'inspector');
    const ravi = as(DEMO.users.ravi, 'Ravi (ABC MEP)', 'contractor', DEMO.contractors.abcMep);
    const due = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

    await createIssue(tx, ahmed, { id: u(1001), projectId: DEMO.project, locationId: DEMO.locations.l3, locationText: 'Bathroom B-14', title: 'Water leaking at pipe joint', category: 'Plumbing', severity: 'high', priority: 'high', contractorId: DEMO.contractors.abcMep, dueDate: due(3) });
    await createIssue(tx, fatima, { id: u(1002), projectId: DEMO.project, locationId: DEMO.locations.l2, locationText: 'Riser R-03', title: 'Fire-stopping missing at riser penetration', category: 'Fire Protection', severity: 'critical', priority: 'critical', contractorId: DEMO.contractors.abcMep, dueDate: due(1) });
    await transitionIssue(tx, ravi, { issueId: u(1002), action: 'submit_evidence', comment: 'Fire sealant applied to both sides of the slab.', attachmentIds: [] });
    await createIssue(tx, ahmed, { id: u(1003), projectId: DEMO.project, locationId: DEMO.locations.basement, locationText: 'Plant Room', title: 'Cable tray supports spaced wider than drawing', category: 'Electrical', severity: 'medium', priority: 'medium', contractorId: DEMO.contractors.dohaElectrical, dueDate: due(-1) });
    await createIssue(tx, fatima, { id: u(1004), projectId: DEMO.project, locationId: DEMO.locations.l4, locationText: 'Column C-12', title: 'Honeycombing on column face', category: 'Civil', severity: 'high', priority: 'high', dueDate: due(4) });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error('DATABASE_URL_ADMIN is not set');
  const { db, pool } = createDb(url);
  await seedDemo(db);
  await pool.end();
  console.log('Demo data loaded. Development sign-in headers:');
  for (const [name, id] of Object.entries(DEMO.users)) console.log(`  ${name.padEnd(7)} Authorization: Dev ${DEMO.org}:${id}`);
}
