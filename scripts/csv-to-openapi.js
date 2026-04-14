#!/usr/bin/env node
/**
 * CSV to OpenAPI 3.0 Converter
 *
 * Converts API_ENDPOINTS.csv to OpenAPI 3.0.3 JSON format for use with
 * security tools like OWASP ZAP and Cloudflare API Shield.
 *
 * Usage: node scripts/csv-to-openapi.js
 *
 * Input:  docs/API_ENDPOINTS.csv
 * Output: docs/API_ENDPOINTS_OPENAPI.json
 */

const fs = require('fs');
const path = require('path');

// Paths
const SCRIPT_DIR = __dirname;
const DOCS_DIR = path.join(SCRIPT_DIR, '..', 'docs');
const INPUT_FILE = path.join(DOCS_DIR, 'API_ENDPOINTS.csv');
const OUTPUT_FILE = path.join(DOCS_DIR, 'API_ENDPOINTS_OPENAPI.json');

/**
 * Parse CSV content into array of objects
 */
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  return values;
}

/**
 * Map CSV security value to OpenAPI security requirement
 */
function mapSecurity(security, scopes) {
  const scopeList = scopes ? scopes.split(',').map(s => s.trim()).filter(Boolean) : [];

  switch (security?.toUpperCase()) {
    case 'PUBLIC':
      return [];
    case 'AUTH':
      return [{ bearerAuth: [] }];
    case 'AUTH+LICENSE':
      return [{ bearerAuth: [], licenseRequired: [] }];
    case 'OAUTH':
      return [{ oauth2: scopeList }];
    case 'INTERNAL':
      return [{ serviceAuth: scopeList }];
    case 'LOCAL':
      return [{ localOnly: [] }];
    case 'N/A':
      return [];
    default:
      return [];
  }
}

/**
 * Normalize HTTP method for OpenAPI
 */
function normalizeMethod(method) {
  if (!method) return null;

  const m = method.toLowerCase().trim();

  // Handle special cases
  if (m === 'all') return null; // Will be expanded to multiple methods
  if (m === 'websocket') return null; // Not a standard HTTP method
  if (m === 'deep link') return null; // Not HTTP

  // Valid OpenAPI methods
  const validMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];
  return validMethods.includes(m) ? m : null;
}

/**
 * Convert endpoint path to OpenAPI format
 * e.g., /api/users/:id -> /api/users/{id}
 */
function convertPath(endpoint) {
  if (!endpoint) return null;

  // Skip non-HTTP endpoints
  if (endpoint.includes('://') && !endpoint.startsWith('/')) return null;
  if (endpoint.startsWith('localhost:')) return null;

  // Convert Express-style params to OpenAPI style
  return endpoint.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

/**
 * Extract path parameters from endpoint
 */
function extractPathParams(endpoint) {
  const params = [];
  const regex = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  let match;

  while ((match = regex.exec(endpoint)) !== null) {
    params.push({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' }
    });
  }

  return params;
}

/**
 * Build OpenAPI specification from parsed CSV data
 */
function buildOpenAPISpec(rows) {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Notely Platform API',
      description: 'API specification for Notely Platform microservices. Generated from API_ENDPOINTS.csv for security scanning and API management.',
      version: '3.0.0',
      contact: {
        name: 'Notely Team'
      }
    },
    servers: [
      {
        url: 'https://api.yourdomain.com',
        description: 'Production API'
      },
      {
        url: 'https://localhost:8443',
        description: 'Local development (via Nginx)'
      },
      {
        url: 'http://localhost:3200',
        description: 'Local development (Gateway direct - bypasses Nginx)'
      }
    ],
    tags: [],
    paths: {},
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authentication token'
        },
        oauth2: {
          type: 'oauth2',
          description: 'Microsoft OAuth 2.0 authentication',
          flows: {
            authorizationCode: {
              authorizationUrl: '/api/auth/microsoft/login',
              tokenUrl: '/api/auth/microsoft/callback',
              scopes: {}
            }
          }
        },
        serviceAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Service-Key',
          description: 'Internal service-to-service authentication'
        },
        licenseRequired: {
          type: 'apiKey',
          in: 'header',
          name: 'X-License-Key',
          description: 'Valid license required for this endpoint'
        },
        localOnly: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Local-Auth',
          description: 'Local-only endpoint (desktop application)'
        }
      }
    }
  };

  // Collect unique tags (services)
  const tagSet = new Set();

  // Process each row
  for (const row of rows) {
    const endpoint = convertPath(row.Endpoint);
    const method = normalizeMethod(row.Method);

    // Skip non-HTTP endpoints
    if (!endpoint || !method) continue;

    // Add tag
    if (row.Service) {
      tagSet.add(row.Service);
    }

    // Initialize path if needed
    if (!spec.paths[endpoint]) {
      spec.paths[endpoint] = {};
    }

    // Handle wildcard endpoints (ALL method)
    const methods = row.Method?.toUpperCase() === 'ALL'
      ? ['get', 'post', 'put', 'patch', 'delete']
      : [method];

    for (const m of methods) {
      if (!m) continue;

      // Build operation object
      const operation = {
        tags: row.Service ? [row.Service] : [],
        summary: row.Description || `${m.toUpperCase()} ${endpoint}`,
        description: buildDescription(row),
        operationId: generateOperationId(row.Service, m, endpoint),
        security: mapSecurity(row.Security, row.Scopes),
        responses: {
          '200': {
            description: 'Successful response'
          },
          '401': {
            description: 'Unauthorized - authentication required'
          },
          '403': {
            description: 'Forbidden - insufficient permissions'
          },
          '429': {
            description: 'Too Many Requests - rate limit exceeded'
          }
        }
      };

      // Add path parameters
      const pathParams = extractPathParams(endpoint);
      if (pathParams.length > 0) {
        operation.parameters = pathParams;
      }

      // Add custom extensions
      if (row.RateLimit) {
        operation['x-rate-limit'] = row.RateLimit;
      }
      if (row.Roles) {
        operation['x-roles'] = row.Roles.split(',').map(r => r.trim()).filter(Boolean);
      }
      if (row.Source) {
        operation['x-source'] = row.Source;
      }
      if (row.Destination) {
        operation['x-destination'] = row.Destination;
      }
      if (row.Type) {
        operation['x-type'] = row.Type;
      }
      if (row.File) {
        operation['x-source-file'] = row.File;
      }

      spec.paths[endpoint][m] = operation;
    }
  }

  // Build tags array
  spec.tags = Array.from(tagSet).sort().map(tag => ({
    name: tag,
    description: `${tag} service endpoints`
  }));

  return spec;
}

/**
 * Build extended description from row data
 */
function buildDescription(row) {
  const parts = [row.Description || ''];

  if (row.Security && row.Security !== 'PUBLIC') {
    parts.push(`\n\n**Security:** ${row.Security}`);
  }
  if (row.Scopes) {
    parts.push(`\n**Required Scopes:** ${row.Scopes}`);
  }
  if (row.Roles) {
    parts.push(`\n**Required Roles:** ${row.Roles}`);
  }

  return parts.join('').trim();
}

/**
 * Generate unique operation ID
 * Includes service name to ensure uniqueness across services with same endpoints
 */
function generateOperationId(service, method, endpoint) {
  // Normalize service name (remove hyphens, capitalize)
  const serviceName = (service || 'unknown')
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/\s+/g, '');

  // Convert /api/auth/login to AuthLogin
  const pathParts = endpoint
    .replace(/^\/api\//, '')
    .replace(/^\//, '')
    .replace(/\{[^}]+\}/g, 'ById')
    .split('/')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());

  const pathName = pathParts.join('');

  // Format: serviceName_method_pathName (e.g., auth_get_Login, gateway_get_Health)
  return `${serviceName}_${method}_${pathName || 'root'}`;
}

/**
 * Main execution
 */
function main() {
  console.log('CSV to OpenAPI Converter');
  console.log('========================\n');

  // Check input file exists
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Error: Input file not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  console.log(`Reading: ${INPUT_FILE}`);
  const csvContent = fs.readFileSync(INPUT_FILE, 'utf-8');

  console.log('Parsing CSV...');
  const rows = parseCSV(csvContent);
  console.log(`Found ${rows.length} endpoints`);

  console.log('Building OpenAPI specification...');
  const spec = buildOpenAPISpec(rows);

  const pathCount = Object.keys(spec.paths).length;
  const tagCount = spec.tags.length;
  console.log(`Generated ${pathCount} paths across ${tagCount} services`);

  console.log(`\nWriting: ${OUTPUT_FILE}`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(spec, null, 2));

  console.log('\nDone! OpenAPI specification generated successfully.');
  console.log('\nNext steps:');
  console.log('  1. Validate: https://editor.swagger.io (paste JSON or import file)');
  console.log('  2. OWASP ZAP: Import via "Import > Import an OpenAPI definition"');
  console.log('  3. Cloudflare: Upload to API Shield for schema validation');
}

main();
