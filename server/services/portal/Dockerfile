# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM node:18-alpine AS dependencies

WORKDIR /app

# Copy shared packages (needed for @notely/shared local dependency)
COPY packages /packages

# Copy package files from portal service
COPY services/portal/package.json ./

# Install all dependencies (dev dependencies needed for build)
# Note: Lock file excluded due to local file: dependencies compatibility issues
RUN npm install && npm cache clean --force

# ============================================================================
# Stage 2: Builder
# ============================================================================
FROM node:18-alpine AS builder

WORKDIR /app

# Copy shared packages (needed at build time)
COPY packages /packages

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy all portal source files
COPY services/portal .

# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Set build-time API_BASE_URL for Next.js rewrites
ARG API_BASE_URL=http://gateway:3200
ENV API_BASE_URL=${API_BASE_URL}

# NEXT_PUBLIC_ vars must be set at build time for Next.js client-side code
ARG NEXT_PUBLIC_GRAFANA_URL
ENV NEXT_PUBLIC_GRAFANA_URL=${NEXT_PUBLIC_GRAFANA_URL}

# Build the Next.js application
RUN npm run build

# ============================================================================
# Stage 3: Runner (Production)
# ============================================================================
FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create system user for running the app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy shared packages (needed at runtime for @notely/shared)
COPY --from=builder /packages /packages

# Copy standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3204

# Set environment variable for port
ENV PORT=3204

# Start the application
CMD ["node", "server.js"]
