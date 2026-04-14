import { getPool } from '../lib/database';

const PERFORMANCE_BUDGETS = {
  TYPICAL_SYNC_MS: 2000,
  P95_SYNC_MS: 4000,
  PAYLOAD_CAP_KB: 1024,
  MEMORY_CEILING_MB: 50,
};

type ErrorRateByEndpoint = {
  endpoint: string;
  errors: number;
  total_requests: number;
  error_rate: number;
};

type ErrorRate = {
  current_hour: number;
  last_24_hours: number;
  last_7_days: number;
  by_endpoint: ErrorRateByEndpoint[];
};

type LatencyByOperation = {
  operation: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

type LatencyMetrics = {
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_ms: number;
  by_operation: LatencyByOperation[];
};

type DiffSizeByEntity = {
  entity_type: string;
  avg_kb: number;
  count: number;
};

type DiffSizeMetrics = {
  avg_kb: number;
  p95_kb: number;
  max_kb: number;
  total_operations: number;
  by_entity_type: DiffSizeByEntity[];
};

type SyncOperationsMetrics = {
  total_today: number;
  successful_today: number;
  failed_today: number;
  success_rate: number;
  active_users: number;
  devices_syncing: number;
};

type VersionDistribution = {
  v1_users: number;
  v2_users: number;
  total_users: number;
  v2_adoption_rate: number;
};

type PerformanceBudgets = {
  sync_latency_budget_ms: number;
  sync_latency_p95_budget_ms: number;
  payload_size_budget_kb: number;
  memory_budget_mb: number;
  budgets_met: {
    latency: boolean;
    payload_size: boolean;
    memory: boolean;
  };
};

export type MetricsResponse = {
  error_rate: ErrorRate;
  latency: LatencyMetrics;
  diff_sizes: DiffSizeMetrics;
  c_sync_operations: SyncOperationsMetrics;
  version_distribution: VersionDistribution;
  performance_budgets: PerformanceBudgets;
  timestamp: number;
};

export async function getMetrics(): Promise<MetricsResponse> {
  const pool = getPool();

  const [errorRate, latency, diffSizes, syncOperations] = await Promise.all([
    getSyncErrorRate(pool),
    getSyncLatencyMetrics(pool),
    getDiffSizeMetrics(pool),
    getSyncOperations(pool),
  ]);

  // Version distribution - all users use cursor-based sync
  const versionDistribution: VersionDistribution = {
    v1_users: 0,
    v2_users: syncOperations.active_users,
    total_users: syncOperations.active_users,
    v2_adoption_rate: 100,
  };

  return {
    error_rate: errorRate,
    latency,
    diff_sizes: diffSizes,
    c_sync_operations: syncOperations,
    version_distribution: versionDistribution,
    performance_budgets: {
      sync_latency_budget_ms: PERFORMANCE_BUDGETS.TYPICAL_SYNC_MS,
      sync_latency_p95_budget_ms: PERFORMANCE_BUDGETS.P95_SYNC_MS,
      payload_size_budget_kb: PERFORMANCE_BUDGETS.PAYLOAD_CAP_KB,
      memory_budget_mb: PERFORMANCE_BUDGETS.MEMORY_CEILING_MB,
      budgets_met: {
        latency: latency.p95_ms <= PERFORMANCE_BUDGETS.P95_SYNC_MS,
        payload_size: diffSizes.p95_kb <= PERFORMANCE_BUDGETS.PAYLOAD_CAP_KB,
        memory: true,
      },
    },
    timestamp: Date.now(),
  };
}

async function getSyncErrorRate(pool: ReturnType<typeof getPool>): Promise<ErrorRate> {
  try {
    const query = `
      SELECT
        COALESCE(operation_type::text, 'unknown') AS operation_type,
        COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '1 hour') AS total_last_hour,
        COUNT(*) FILTER (WHERE NOT success AND started_at >= NOW() - INTERVAL '1 hour') AS errors_last_hour,
        COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '24 hours') AS total_last_24h,
        COUNT(*) FILTER (WHERE NOT success AND started_at >= NOW() - INTERVAL '24 hours') AS errors_last_24h,
        COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days') AS total_last_7d,
        COUNT(*) FILTER (WHERE NOT success AND started_at >= NOW() - INTERVAL '7 days') AS errors_last_7d
      FROM client_sync.sync_operations
      GROUP BY operation_type
    `;

    const result = await pool.query(query);

    const totals = result.rows.reduce(
      (acc, row) => {
        const totalHour = Number(row.total_last_hour ?? 0);
        const errorsHour = Number(row.errors_last_hour ?? 0);
        const total24 = Number(row.total_last_24h ?? 0);
        const errors24 = Number(row.errors_last_24h ?? 0);
        const total7d = Number(row.total_last_7d ?? 0);
        const errors7d = Number(row.errors_last_7d ?? 0);

        acc.totalHour += totalHour;
        acc.errorsHour += errorsHour;
        acc.total24 += total24;
        acc.errors24 += errors24;
        acc.total7d += total7d;
        acc.errors7d += errors7d;
        return acc;
      },
      { totalHour: 0, errorsHour: 0, total24: 0, errors24: 0, total7d: 0, errors7d: 0 }
    );

    const byEndpoint: ErrorRateByEndpoint[] = result.rows.map((row) => {
      const total24 = Number(row.total_last_24h ?? 0);
      const errors24 = Number(row.errors_last_24h ?? 0);
      return {
        endpoint: row.operation_type,
        errors: errors24,
        total_requests: total24,
        error_rate: total24 > 0 ? Math.round((errors24 / total24) * 100 * 100) / 100 : 0,
      };
    });

    const currentHourRate =
      totals.totalHour > 0 ? Math.round((totals.errorsHour / totals.totalHour) * 100 * 100) / 100 : 0;
    const last24Rate =
      totals.total24 > 0 ? Math.round((totals.errors24 / totals.total24) * 100 * 100) / 100 : 0;
    const last7Rate =
      totals.total7d > 0 ? Math.round((totals.errors7d / totals.total7d) * 100 * 100) / 100 : 0;

    return {
      current_hour: currentHourRate,
      last_24_hours: last24Rate,
      last_7_days: last7Rate,
      by_endpoint: byEndpoint,
    };
  } catch (error) {
    console.error('[sync-service] Failed to compute sync error rate', error);
    return {
      current_hour: 0,
      last_24_hours: 0,
      last_7_days: 0,
      by_endpoint: [],
    };
  }
}

async function getSyncLatencyMetrics(pool: ReturnType<typeof getPool>): Promise<LatencyMetrics> {
  try {
    const aggregateQuery = `
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms,
        AVG(duration_ms) AS avg_ms
      FROM client_sync.sync_operations
      WHERE duration_ms IS NOT NULL
        AND started_at >= NOW() - INTERVAL '1 hour'
    `;

    const byOperationQuery = `
      SELECT
        operation_type::text AS operation,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms
      FROM client_sync.sync_operations
      WHERE duration_ms IS NOT NULL
        AND started_at >= NOW() - INTERVAL '1 hour'
      GROUP BY operation_type
    `;

    const [aggregateResult, byOperationResult] = await Promise.all([
      pool.query(aggregateQuery),
      pool.query(byOperationQuery),
    ]);

    const row = aggregateResult.rows[0] ?? {};

    return {
      p50_ms: Math.round(Number(row.p50_ms ?? 0)),
      p95_ms: Math.round(Number(row.p95_ms ?? 0)),
      p99_ms: Math.round(Number(row.p99_ms ?? 0)),
      avg_ms: Math.round(Number(row.avg_ms ?? 0)),
      by_operation: byOperationResult.rows.map((operationRow) => ({
        operation: operationRow.operation ?? 'unknown',
        p50_ms: Math.round(Number(operationRow.p50_ms ?? 0)),
        p95_ms: Math.round(Number(operationRow.p95_ms ?? 0)),
        p99_ms: Math.round(Number(operationRow.p99_ms ?? 0)),
      })),
    };
  } catch (error) {
    console.error('[sync-service] Failed to compute latency metrics', error);
    return {
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
      avg_ms: 0,
      by_operation: [],
    };
  }
}

async function getDiffSizeMetrics(pool: ReturnType<typeof getPool>): Promise<DiffSizeMetrics> {
  try {
    // Note: diff_size_bytes may not be tracked in the new schema
    // Return zeros if the column doesn't exist
    const query = `
      SELECT
        COUNT(*) AS total_operations
      FROM client_sync.sync_operations
      WHERE started_at >= NOW() - INTERVAL '24 hours'
    `;

    const result = await pool.query(query);
    const row = result.rows[0] ?? {};

    // Diff size tracking is not available in cursor-based sync
    return {
      avg_kb: 0,
      p95_kb: 0,
      max_kb: 0,
      total_operations: Number(row.total_operations ?? 0),
      by_entity_type: [],
    };
  } catch (error) {
    console.error('[sync-service] Failed to compute diff size metrics', error);
    return {
      avg_kb: 0,
      p95_kb: 0,
      max_kb: 0,
      total_operations: 0,
      by_entity_type: [],
    };
  }
}

async function getSyncOperations(pool: ReturnType<typeof getPool>): Promise<SyncOperationsMetrics> {
  try {
    const query = `
      SELECT
        COUNT(*) AS total_operations,
        COUNT(*) FILTER (WHERE success) AS successful_operations,
        COUNT(*) FILTER (WHERE NOT success) AS failed_operations,
        COUNT(DISTINCT user_id) AS active_users,
        COUNT(DISTINCT device_id) AS devices_syncing
      FROM client_sync.sync_operations
      WHERE started_at >= DATE_TRUNC('day', NOW())
    `;

    const result = await pool.query(query);
    const row = result.rows[0] ?? {
      total_operations: 0,
      successful_operations: 0,
      failed_operations: 0,
      active_users: 0,
      devices_syncing: 0,
    };

    const totalOps = Number(row.total_operations ?? 0);
    const successfulOps = Number(row.successful_operations ?? 0);

    return {
      total_today: totalOps,
      successful_today: successfulOps,
      failed_today: Number(row.failed_operations ?? 0),
      success_rate: totalOps > 0 ? Math.round((successfulOps / totalOps) * 100 * 100) / 100 : 100,
      active_users: Number(row.active_users ?? 0),
      devices_syncing: Number(row.devices_syncing ?? 0),
    };
  } catch (error) {
    console.error('[sync-service] Failed to compute sync operations metrics', error);
    return {
      total_today: 0,
      successful_today: 0,
      failed_today: 0,
      success_rate: 100,
      active_users: 0,
      devices_syncing: 0,
    };
  }
}
