FROM node:18-alpine

# Install npm 10.8.2 globally for consistency with other services
RUN npm install -g npm@10.8.2

# Set working directory to mirror the monorepo structure
WORKDIR /workspace

# First, copy and install shared packages
COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

# Now set up the sync service
WORKDIR /workspace/services/sync

# Copy sync service package files
COPY services/sync/package*.json ./
COPY services/sync/tsconfig.json ./

# Install sync service dependencies
RUN npm install --ignore-scripts

# Copy sync service source code
COPY services/sync/ ./

# Build TypeScript
RUN npm run build

# Expose sync port
EXPOSE 3205

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3205/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start sync service
CMD ["npm", "start"]
