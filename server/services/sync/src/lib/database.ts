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

  throw new Error('Sync database connection string is not configured. Set SYNC_DATABASE_URL or DATABASE_URL.');
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(resolvePoolConfig());

    // Handle pool errors to prevent process crash on connection termination
    pool.on('error', (err) => {
      console.error('[sync-db] Unexpected pool error:', err.message);
      // Don't crash - pool will automatically reconnect on next query
    });
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
