FROM node:18-alpine

# Install npm 10.8.2 globally
RUN npm install -g npm@10.8.2

# Set working directory to mirror the monorepo structure
WORKDIR /workspace

# First, copy and install shared packages
COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

# Now set up the auth service
WORKDIR /workspace/services/auth

# Copy auth service package files
COPY services/auth/package*.json ./

# Install auth service dependencies
# The file:../../packages reference will now resolve correctly
RUN npm install --omit=dev

# Copy auth service source code
COPY services/auth/ ./

# Expose auth port
EXPOSE 3201

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3201/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start auth service
CMD ["npm", "start"]
