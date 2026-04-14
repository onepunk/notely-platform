FROM node:18-alpine

# Install npm 10.8.2 globally
RUN npm install -g npm@10.8.2

# Set working directory to mirror the monorepo structure
WORKDIR /workspace

# First, copy and install shared packages
COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

# Now set up the gateway service
WORKDIR /workspace/services/gateway

# Copy gateway package files
COPY services/gateway/package*.json ./

# Install gateway service dependencies
RUN npm install --omit=dev

# Copy gateway source
COPY services/gateway/ .

# Expose gateway port
EXPOSE 3200

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3200/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start gateway
CMD ["npm", "start"]
