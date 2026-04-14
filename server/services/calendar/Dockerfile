FROM node:18-alpine

# Update npm to latest version
RUN npm install -g npm@10.8.2

WORKDIR /workspace

# Install shared packages first
COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

# Set up calendar service
WORKDIR /workspace/services/calendar

# Copy package files
COPY services/calendar/package.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY services/calendar/ ./

# Expose port
EXPOSE 3203

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3203/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start service
CMD ["npm", "start"]
