import { and, eq, gt, isNull } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { commentInput, createIssueInput, listIssuesQuery, syncRequest, transitionInput, type Mutation, type MutationResult } from '@sip/shared';
import type { AuthContext, AuthProvider } from './auth';
import { withTenant, type Db } from './db/client';
import { accessLinks, contractors, issues, projects } from './db/schema';
import { AppError } from './errors';
import type { Channel } from './notifications/channels';
import { dispatchQueued, hashToken } from './notifications/queue';
import { getIssue, listIssues } from './services/issues';
import { applyMutation } from './services/mutations';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
  interface FastifyInstance {
    /** Resolves when messages started by earlier requests have been handed to the channel. Used by tests and shutdown. */
    notificationsSettled(): Promise<void>;
  }
}

export interface AppDeps {
  db: Db;
  auth: AuthProvider;
  channel: Channel;
  logger?: boolean;
}

const idParam = z.object({ id: z.uuid() });

export function createApp({ db, auth, channel, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  const sending = new Set<Promise<unknown>>();
  app.decorate('notificationsSettled', async () => {
    await Promise.all([...sending]);
  });
  app.addHook('onClose', async () => {
    await Promise.all([...sending]);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof z.ZodError) {
      return reply.status(422).send({ error: { code: 'validation', message: 'Some fields need attention.', fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong on our side. Your change was not saved.' } });
  });

  app.get('/health', async () => ({ ok: true }));

  /** Opens one record from a notification link without a login. Read-only in this scaffold. */
  app.get('/l/:token', async (req) => {
    const { token } = z.object({ token: z.string().regex(/^[0-9a-f-]{36}\.[\w-]{20,}$/i) }).parse(req.params);
    const [organizationId, secret] = token.split('.') as [string, string];
    return withTenant(db, organizationId, async (tx) => {
      const [link] = await tx
        .select()
        .from(accessLinks)
        .where(and(eq(accessLinks.tokenHash, hashToken(secret)), isNull(accessLinks.revokedAt), gt(accessLinks.expiresAt, new Date())));
      if (!link || link.entityType !== 'issue') throw new AppError('not_found', 'This link has expired or is not valid. Ask for a new one.');
      const [issue] = await tx
        .select({ id: issues.id, number: issues.number, title: issues.title, status: issues.status, priority: issues.priority, dueDate: issues.dueDate, locationText: issues.locationText, contractorId: issues.contractorId, rejectionReason: issues.rejectionReason })
        .from(issues)
        .where(eq(issues.id, link.entityId));
      // A link made for one company stops working if the issue is reassigned to another.
      if (!issue || (link.contractorId && issue.contractorId !== link.contractorId)) throw new AppError('not_found', 'This link has expired or is not valid. Ask for a new one.');
      return { issue };
    });
  });

  app.register(async (v1) => {
    v1.addHook('preHandler', async (req) => {
      const ctx = await auth.authenticate(req);
      if (!ctx) throw new AppError('unauthenticated', 'Sign in to continue.');
      req.auth = ctx;
    });

    /** Runs changes one by one, in the order the device made them, then sends any queued messages. */
    async function run(req: { auth: AuthContext }, mutations: Mutation[]): Promise<MutationResult[]> {
      const results: MutationResult[] = [];
      for (const m of mutations) results.push(await applyMutation(db, req.auth, m));
      const job = dispatchQueued(db, req.auth.organizationId, channel).catch((err) => app.log.error(err));
      sending.add(job);
      void job.finally(() => sending.delete(job));
      return results;
    }
    async function runOne(req: { auth: AuthContext; headers: Record<string, unknown> }, m: Omit<Mutation, 'key' | 'clientTime'>) {
      const header = z.uuid().safeParse(req.headers['idempotency-key']);
      const [result] = await run(req, [{ ...m, key: header.success ? header.data : randomUUID(), clientTime: new Date().toISOString() } as Mutation]);
      if (result!.status === 'rejected') throw new AppError(result!.code as AppError['code'], result!.message);
      return result!.data;
    }

    v1.get('/me', async (req) => req.auth);

    v1.get('/projects', async (req) => withTenant(db, req.auth.organizationId, (tx) => tx.select().from(projects)));

    v1.get('/contractors', async (req) =>
      withTenant(db, req.auth.organizationId, (tx) => tx.select({ id: contractors.id, name: contractors.name, trade: contractors.trade }).from(contractors)),
    );

    v1.get('/issues', async (req) => {
      const q = listIssuesQuery.parse(req.query);
      return withTenant(db, req.auth.organizationId, (tx) => listIssues(tx, req.auth, q));
    });

    v1.get('/issues/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      return withTenant(db, req.auth.organizationId, (tx) => getIssue(tx, req.auth, id));
    });

    v1.post('/issues', async (req, reply) => {
      const payload = createIssueInput.parse({ id: randomUUID(), ...(req.body as object) });
      return reply.status(201).send(await runOne(req, { type: 'issue.create', payload }));
    });

    v1.post('/issues/:id/transition', async (req) => {
      const { id } = idParam.parse(req.params);
      const payload = transitionInput.parse({ ...(req.body as object), issueId: id });
      return runOne(req, { type: 'issue.transition', payload });
    });

    v1.post('/issues/:id/comments', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const payload = commentInput.parse({ id: randomUUID(), ...(req.body as object), issueId: id });
      return reply.status(201).send(await runOne(req, { type: 'comment.create', payload }));
    });

    /** The offline outbox posts here. Results come back in the same order, one per change. */
    v1.post('/sync', async (req) => {
      const { mutations } = syncRequest.parse(req.body);
      return { results: await run(req, mutations) };
    });
  }, { prefix: '/v1' });

  return app;
}
