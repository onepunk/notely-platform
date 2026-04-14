FROM node:18-alpine

RUN npm install -g npm@10.8.2

WORKDIR /workspace

# Note: ws-gateway doesn't use shared packages, but keeping structure consistent
# with other services for potential future shared package usage

# Setup service
WORKDIR /workspace/services/ws-gateway
COPY services/ws-gateway/package*.json ./
RUN npm install --omit=dev

# Copy service source
COPY services/ws-gateway/ ./

EXPOSE 3217

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3217/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["npm", "start"]
