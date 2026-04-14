import { Pool, PoolClient, PoolConfig } from 'pg';
import { config } from '../config/env';

let pool: Pool | null = null;

function resolvePoolConfig(): PoolConfig {
  if (config.database.connectionString) {
    return {
      connectionString: config.database.connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
    };
  }

  throw new Error('License database connection string is not configured. Set LICENSE_DATABASE_URL or DATABASE_URL.');
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(resolvePoolConfig());
  }
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
