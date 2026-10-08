import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function runMigrations(adminUrl: string) {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error('DATABASE_URL_ADMIN is not set');
  await runMigrations(url);
  console.log('Migrations applied.');
}
