FROM node:18-alpine

# Ensure consistent npm version
RUN npm install -g npm@10.8.2

# Set workspace root to mirror monorepo layout
WORKDIR /workspace

# Copy shared packages first (used by all services)
COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

# Prepare admin-config service
WORKDIR /workspace/services/admin-config

# Copy package manifests and install dependencies
COPY services/admin-config/package.json ./
RUN npm install --omit=dev

# Copy service source
COPY services/admin-config/ ./

# Expose port
EXPOSE 3206

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3206/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["npm", "start"]
