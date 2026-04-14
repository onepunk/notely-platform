# Notely Platform Installer Container
# Web-based installation wizard for enterprise deployments
#
# This container provides a guided setup experience for first-time installations.
# It auto-generates a self-signed SSL certificate and one-time setup token for security.

FROM node:20-alpine

# Install dependencies for SSL certificate generation and Docker CLI
RUN apk add --no-cache \
    openssl \
    bash \
    docker-cli \
    docker-compose \
    curl \
    gettext \
    && rm -rf /var/cache/apk/*

WORKDIR /installer

# Copy package files first for better caching
COPY app/package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY app/ .

# Copy UI build (built separately or during container build)
COPY ui/dist ./public

# Create directories for certificates and runtime data
RUN mkdir -p /installer/certs /installer/runtime

# Environment variables with defaults
ENV NODE_ENV=production \
    INSTALLER_PORT=9000 \
    INSTALLER_TIMEOUT_MINUTES=30 \
    WORKSPACE_PATH=/workspace

# Expose installer port
EXPOSE 9000

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsk https://localhost:9000/api/health || exit 1

# Entrypoint script handles SSL cert generation and token display
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
