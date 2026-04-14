FROM node:18-alpine

# Install PostgreSQL client tools for pg_dump/pg_restore
RUN apk add --no-cache postgresql-client openssl

# Ensure consistent npm version
RUN npm install -g npm@10.8.2

# Set workspace root to mirror monorepo layout
WORKDIR /workspace

# Copy shared packages first (used by multiple services)
COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

# Prepare admin-database service
WORKDIR /workspace/services/admin-database

# Copy package manifests and install dependencies
COPY services/admin-database/package.json ./
RUN npm install --omit=dev

# Copy service source
COPY services/admin-database/ ./

# Expose service port
EXPOSE 3208

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3208/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["npm", "start"]
