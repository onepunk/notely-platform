FROM node:18-alpine

# Install npm 10.8.2 globally for consistency with other services
RUN npm install -g npm@10.8.2

# Set working directory to mirror the monorepo structure
WORKDIR /workspace

# First, copy and install shared packages
COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

# Now set up the summaries service
WORKDIR /workspace/services/summaries

# Copy summaries service package files
COPY services/summaries/package*.json ./
COPY services/summaries/tsconfig.json ./

# Install summaries service dependencies
RUN npm install --ignore-scripts

# Copy summaries service source code
COPY services/summaries/ ./

# Build TypeScript
RUN npm run build

# Expose summaries port
EXPOSE 3207

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3207/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start summaries service
CMD ["npm", "start"]
