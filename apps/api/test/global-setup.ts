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
  await client.connect();
  await client.query('DROP DATABASE IF EXISTS sip_test WITH (FORCE)');
  await client.query('CREATE DATABASE sip_test');
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user LOGIN PASSWORD 'app_user' IN ROLE app_rw; END IF;
  END $$`);
  await client.end();
  await runMigrations(testUrls().admin);
}
