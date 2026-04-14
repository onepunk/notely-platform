import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

function getConnectionString(): string {
  const connectionString = process.env.SYNC_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('SYNC_DATABASE_URL or DATABASE_URL must be set to run migrations');
  }
  return connectionString;
}

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.sync_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function migrationApplied(client: Client, filename: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM public.sync_migrations WHERE filename = $1', [filename]);
  return (result.rowCount ?? 0) > 0;
}

async function recordMigration(client: Client, filename: string) {
  await client.query('INSERT INTO public.sync_migrations (filename) VALUES ($1)', [filename]);
}

async function runMigration(client: Client, filePath: string, filename: string) {
  const sql = fs.readFileSync(filePath, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`Applying migration: ${filename}`);
  await client.query(sql);
  await recordMigration(client, filename);
}

async function run() {
  const connectionString = getConnectionString();
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await ensureMigrationsTable(client);

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      // eslint-disable-next-line no-console
      console.warn(`Migrations directory not found at ${MIGRATIONS_DIR}`);
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const alreadyApplied = await migrationApplied(client, file);
      if (alreadyApplied) {
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      try {
        await client.query('BEGIN');
        await runMigration(client, filePath, file);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    // eslint-disable-next-line no-console
    console.log('Sync migrations complete.');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', error);
  process.exit(1);
});
