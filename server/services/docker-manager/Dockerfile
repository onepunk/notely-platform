FROM node:18-alpine

# Install curl for health checks and docker-compose for container recreation
RUN apk add --no-cache curl docker-compose

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Create non-root user for security
RUN addgroup -S notely && adduser -S notely -G notely -u 1001

# Create logs directory
RUN mkdir -p logs && chown -R notely:notely logs

USER notely

EXPOSE 8005

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8005/health || exit 1

CMD ["node", "app.js"]
