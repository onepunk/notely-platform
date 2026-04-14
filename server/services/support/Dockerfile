FROM node:18-alpine

# Install npm 10.8.2 globally
RUN npm install -g npm@10.8.2

# Set working directory to mirror the monorepo structure
WORKDIR /workspace

# First, copy and install shared packages
COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

# Now set up the support service
WORKDIR /workspace/services/support

# Copy service package files
COPY services/support/package*.json ./

# Install service dependencies
RUN npm install --omit=dev

# Copy service source
COPY services/support/ .

EXPOSE 3209

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3209/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["npm", "start"]
