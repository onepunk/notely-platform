import { Pool } from 'pg';
import { config } from '../config/env';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!config.database.connectionString) {
      throw new Error('Database connection string not configured');
    }
    pool = new Pool({
      connectionString: config.database.connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
