const shared = require('@notely/shared');

const db = shared.database;
const { ValidationError, NotFoundError } = shared.errors;
const baseLogger = shared.logger.child({ service: 'admin-database', scope: 'database-service' });

const DEFAULT_DATABASE_NAME =
  process.env.ADMIN_DATABASE_DEFAULT_DB ||
  process.env.POSTGRES_DB ||
  'notely_v3';

const LEGACY_ALIAS = (process.env.ADMIN_DATABASE_LEGACY_ALIAS || 'notely')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const ALLOWED_SCHEMAS = (process.env.ADMIN_DATABASE_ALLOWED_SCHEMAS ||
  'auth,users,calendar,meetings,transcripts,notes,summaries,admin,actions,portal')
  .split(',')
  .map((schema) => schema.trim())
  .filter(Boolean);

const MAX_PAGE_SIZE = parseInt(process.env.ADMIN_DATABASE_MAX_PAGE_SIZE || '1000', 10);
const DEFAULT_PAGE_SIZE = parseInt(process.env.ADMIN_DATABASE_DEFAULT_PAGE_SIZE || '100', 10);

const SENSITIVE_COLUMNS = Object.freeze(
  JSON.parse(
    process.env.ADMIN_DATABASE_SENSITIVE_COLUMNS ||
    JSON.stringify({
      'transcripts.transcriptions': ['transcription_text'],
      'summaries.summaries': ['summary_text', 'summary_text_encrypted'],
      'client_sync.transcription_content': ['text', 'original_text'],
      'client_sync.summary_content': ['summary_text'],
      'client_sync.note_content': ['notes'],
      'notes.notes': ['content']
    })
  )
);

const REDACTION_PLACEHOLDER = '[REDACTED - User Content]';

function getSensitiveColumnsForTable(schema, table) {
  return SENSITIVE_COLUMNS[`${schema}.${table}`] || [];
}

function redactSensitiveFields(rows, schema, table) {
  const sensitiveColumns = getSensitiveColumnsForTable(schema, table);
  if (sensitiveColumns.length === 0) {
    return { rows, redactedColumns: [] };
  }

  const redactedRows = rows.map((row) => {
    const redacted = { ...row };
    for (const col of sensitiveColumns) {
      if (col in redacted && redacted[col] != null) {
        redacted[col] = REDACTION_PLACEHOLDER;
      }
    }
    return redacted;
  });

  return { rows: redactedRows, redactedColumns: sensitiveColumns };
}

function assertIdentifier(value, label) {
  if (!value || typeof value !== 'string') {
    throw new ValidationError(`${label} is required`);
  }

  const trimmed = value.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new ValidationError(`${label} contains invalid characters`);
  }

  return trimmed;
}

function quoteIdentifier(value) {
  const valid = assertIdentifier(value, 'Identifier');
  return `"${valid.replace(/"/g, '""')}"`;
}

function normalizeDatabaseName(name) {
  if (!name || name === DEFAULT_DATABASE_NAME) {
    return DEFAULT_DATABASE_NAME;
  }

  if (LEGACY_ALIAS.includes(name)) {
    return DEFAULT_DATABASE_NAME;
  }

  throw new ValidationError(`Database "${name}" is not supported by admin-database service`);
}

function parseQualifiedTable(tableName) {
  if (!tableName) {
    throw new ValidationError('Table name is required');
  }

  const parts = tableName.split('.');
  if (parts.length !== 2) {
    throw new ValidationError(
      'Table name must include schema and table (e.g., "global_auth.users")'
    );
  }

  const [schema, table] = parts;
  const normalizedSchema = assertIdentifier(schema, 'Schema');
  const normalizedTable = assertIdentifier(table, 'Table');

  if (!ALLOWED_SCHEMAS.includes(normalizedSchema)) {
    throw new ValidationError(`Schema "${normalizedSchema}" is not permitted`);
  }

  return {
    schema: normalizedSchema,
    table: normalizedTable
  };
}

function applyPagination(queryPage, queryLimit) {
  const page = Number.isFinite(Number(queryPage)) ? Math.max(0, parseInt(queryPage, 10)) : 0;
  const limitCandidate = Number.isFinite(Number(queryLimit))
    ? parseInt(queryLimit, 10)
    : DEFAULT_PAGE_SIZE;

  const limit = Math.min(Math.max(1, limitCandidate), MAX_PAGE_SIZE);
  const offset = page * limit;

  return { page, limit, offset };
}

async function listTables({ database }) {
  const targetDatabase = normalizeDatabaseName(database);

  baseLogger.debug('Listing tables', { database: targetDatabase });

  const { rows } = await db.query(
    `
      SELECT
        schemaname AS schema,
        relname AS table_name,
        n_live_tup AS estimated_count
      FROM pg_stat_user_tables
      WHERE schemaname = ANY($1)
      ORDER BY schemaname, relname
    `,
    [ALLOWED_SCHEMAS]
  );

  return rows.map((row) => ({
    name: `${row.schema}.${row.table_name}`,
    schema: row.schema,
    table: row.table_name,
    count: Number(row.estimated_count) || 0
  }));
}

async function getTableColumns(schema, table) {
  const { rows } = await db.query(
    `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position
    `,
    [schema, table]
  );

  return rows;
}

async function getTablePrimaryKeyColumns(schema, table) {
  const { rows } = await db.query(
    `
      SELECT
        kcu.column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position
    `,
    [schema, table]
  );

  return rows.map((row) => row.column_name);
}

async function getTableRecords({ tableName, page, limit, database }) {
  const targetDatabase = normalizeDatabaseName(database);
  const { schema, table } = parseQualifiedTable(tableName);
  const { limit: pageSize, offset } = applyPagination(page, limit);
  const columns = await getTableColumns(schema, table);

  if (columns.length === 0) {
    throw new NotFoundError(`Table "${schema}.${table}" was not found`);
  }

  const primaryKeyColumns = await getTablePrimaryKeyColumns(schema, table);
  const orderColumns = primaryKeyColumns.length > 0
    ? primaryKeyColumns
    : [columns[0].column_name];

  const selectColumns = columns.map((column) => quoteIdentifier(column.column_name)).join(', ');
  const orderClause = orderColumns
    .map((column) => `${quoteIdentifier(column)} ASC`)
    .join(', ');

  const sql = `
    SELECT ${selectColumns}
    FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
    ORDER BY ${orderClause}
    LIMIT $1 OFFSET $2
  `;

  const [rowsResult, countResult] = await Promise.all([
    db.query(sql, [pageSize, offset]),
    db.query(
      `
        SELECT COUNT(*)::bigint AS total
        FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
      `
    )
  ]);

  // Redact sensitive columns before returning to the admin UI
  const { rows: redactedRows, redactedColumns } = redactSensitiveFields(rowsResult.rows, schema, table);

  baseLogger.debug('Fetched table records', {
    database: targetDatabase,
    schema,
    table,
    pageSize,
    offset,
    rowCount: rowsResult.rowCount,
    redactedColumns: redactedColumns.length > 0 ? redactedColumns : undefined
  });

  return {
    records: redactedRows,
    columns: columns.map((column) => column.column_name),
    totalCount: Number(countResult.rows[0].total) || 0,
    primaryKey: primaryKeyColumns,
    redactedColumns
  };
}

async function deleteRecord({ tableName, recordId, database, actor }) {
  const targetDatabase = normalizeDatabaseName(database);
  const { schema, table } = parseQualifiedTable(tableName);

  if (!recordId) {
    throw new ValidationError('Record ID is required');
  }

  const primaryKeyColumns = await getTablePrimaryKeyColumns(schema, table);
  if (primaryKeyColumns.length !== 1) {
    throw new ValidationError('Delete operation requires a single-column primary key');
  }

  const primaryKey = primaryKeyColumns[0];
  const deleteSql = `
    DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
    WHERE ${quoteIdentifier(primaryKey)}::text = $1
    RETURNING *
  `;

  const result = await db.query(deleteSql, [String(recordId)]);

  baseLogger.info('Deleted record', {
    database: targetDatabase,
    schema,
    table,
    primaryKey,
    recordId,
    deletedCount: result.rowCount,
    actor: actor?.email || null
  });

  if (result.rowCount === 0) {
    throw new NotFoundError(`Record with ID ${recordId} not found`);
  }

  return {
    deletedCount: result.rowCount
  };
}

async function deleteAllRecords({ tableName, database, actor }) {
  const targetDatabase = normalizeDatabaseName(database);
  const { schema, table } = parseQualifiedTable(tableName);

  const deleteSql = `
    DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
  `;

  const result = await db.query(deleteSql);

  baseLogger.warn('Cleared table records', {
    database: targetDatabase,
    schema,
    table,
    deletedCount: result.rowCount,
    actor: actor?.email || null
  });

  return {
    deletedCount: result.rowCount
  };
}

async function updateRecord({ tableName, recordId, values, database, actor }) {
  const targetDatabase = normalizeDatabaseName(database);
  const { schema, table } = parseQualifiedTable(tableName);

  if (!recordId) {
    throw new ValidationError('Record ID is required');
  }

  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ValidationError('Update payload must be an object with column values');
  }

  const columns = await getTableColumns(schema, table);
  const columnNames = columns.map((column) => column.column_name);
  const primaryKeyColumns = await getTablePrimaryKeyColumns(schema, table);

  if (primaryKeyColumns.length !== 1) {
    throw new ValidationError('Update operation requires a single-column primary key');
  }

  const primaryKey = primaryKeyColumns[0];

  if (primaryKey in values) {
    throw new ValidationError('Primary key columns cannot be updated');
  }

  // Filter out sensitive columns from the update payload
  const sensitiveColumns = getSensitiveColumnsForTable(schema, table);
  const blockedColumns = Object.keys(values).filter((col) => sensitiveColumns.includes(col));
  if (blockedColumns.length > 0) {
    baseLogger.warn('Blocked update to sensitive columns', {
      schema,
      table,
      blockedColumns,
      actor: actor?.email || null
    });
    throw new ValidationError(
      `Cannot update sensitive columns: ${blockedColumns.join(', ')}. User content columns are read-only in the admin interface.`
    );
  }

  const updateColumns = Object.entries(values).filter(([column]) =>
    columnNames.includes(column)
  );

  if (updateColumns.length === 0) {
    throw new ValidationError('No valid columns provided for update');
  }

  const assignments = updateColumns.map(
    ([column], index) => `${quoteIdentifier(column)} = $${index + 2}`
  );

  const sql = `
    UPDATE ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
    SET ${assignments.join(', ')}
    WHERE ${quoteIdentifier(primaryKey)}::text = $1
    RETURNING *
  `;

  const parameters = [String(recordId), ...updateColumns.map(([, value]) => value)];
  const result = await db.query(sql, parameters);

  if (result.rowCount === 0) {
    throw new NotFoundError(`Record with ID ${recordId} not found`);
  }

  // Redact sensitive columns in the returned row
  const { rows: [redactedRecord] } = redactSensitiveFields(result.rows, schema, table);

  baseLogger.info('Updated record', {
    database: targetDatabase,
    schema,
    table,
    primaryKey,
    recordId,
    updatedColumns: updateColumns.map(([column]) => column),
    actor: actor?.email || null
  });

  return {
    record: redactedRecord
  };
}

module.exports = {
  listTables,
  getTableRecords,
  deleteRecord,
  deleteAllRecords,
  updateRecord,
  constants: {
    DEFAULT_DATABASE_NAME,
    ALLOWED_SCHEMAS,
    MAX_PAGE_SIZE,
    DEFAULT_PAGE_SIZE
  }
};
