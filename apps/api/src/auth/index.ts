import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Role } from '@sip/shared';
import { withTenant, type Db, type Tx } from '../db/client';
import { memberships, projectMembers, users } from '../db/schema';

/** Who is making the request. The organization always comes from here, never from the request body or URL. */
export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
  contractorId: string | null;
  name: string;
}

export interface AuthProvider {
  authenticate(req: FastifyRequest): Promise<AuthContext | null>;
}

/**
 * Development sign-in: `Authorization: Dev <organizationId>:<userId>`.
 * It exists so the API can be exercised before the real sign-in (email and password, Google, Microsoft)
 * is added in the first MVP sprint. createApp refuses to start with it when NODE_ENV is production.
 */
export class DevAuthProvider implements AuthProvider {
  constructor(private db: Db) {}

  async authenticate(req: FastifyRequest): Promise<AuthContext | null> {
    const match = /^Dev ([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(req.headers.authorization ?? '');
    if (!match) return null;
    const [, organizationId, userId] = match as unknown as [string, string, string];
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ role: memberships.role, contractorId: memberships.contractorId, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.userId, userId));
      return row ? { userId, organizationId, role: row.role, contractorId: row.contractorId, name: row.name } : null;
    });
  }
}

/** A project-level role, when one is set, replaces the organization-level role for that project. */
export async function roleForProject(tx: Tx, auth: AuthContext, projectId: string): Promise<Role> {
  const [row] = await tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, auth.userId)));
  return row?.role ?? auth.role;
}
