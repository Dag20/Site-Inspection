import pg from 'pg';
import { runMigrations } from '../src/db/migrate';

/** Builds a fresh sip_test database with all migrations, plus the non-superuser login the API uses. */
const ADMIN = process.env.TEST_DATABASE_URL_ADMIN ?? 'postgres://postgres:postgres@localhost:5432/postgres';

export const testUrls = () => {
  const admin = new URL(ADMIN);
  admin.pathname = '/sip_test';
  const app = new URL(admin);
  app.username = 'app_user';
  app.password = 'app_user';
  return { admin: admin.toString(), app: app.toString() };
};

export default async function setup() {
  const client = new pg.Client({ connectionString: ADMIN });
  try {
    await client.connect();
  } catch (err) {
    const where = new URL(ADMIN);
    throw new Error(
      `The API tests need PostgreSQL at ${where.hostname}:${where.port || 5432} and could not reach it (${(err as Error).message}).\n` +
        'In a codespace, the database starts with the codespace: rebuild it from the command palette with "Codespaces: Rebuild Container".\n' +
        'On your own computer, run: docker compose up -d',
    );
  }
  await client.query('DROP DATABASE IF EXISTS sip_test WITH (FORCE)');
  await client.query('CREATE DATABASE sip_test');
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user LOGIN PASSWORD 'app_user' IN ROLE app_rw; END IF;
  END $$`);
  await client.end();
  await runMigrations(testUrls().admin);
}
