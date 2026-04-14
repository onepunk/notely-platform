FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY services/license/package.json ./
COPY services/license/package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Copy tsconfig.json and source code
COPY services/license/tsconfig.json ./
COPY services/license/src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY services/license/package.json ./
COPY services/license/package-lock.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy docs (OpenAPI spec loaded at runtime)
COPY services/license/docs/ ./docs/

# Expose port 3211
EXPOSE 3211

# HEALTHCHECK
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3211/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the service
CMD ["npm", "start"]
