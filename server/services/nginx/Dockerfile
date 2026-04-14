# Use OpenResty (nginx + Lua) for CrowdSec bouncer support
FROM openresty/openresty:alpine

# Install dependencies
RUN apk add --no-cache \
    curl \
    gettext

# Install lua-resty-http for CrowdSec bouncer HTTP requests
# Download directly from GitHub since opm requires perl
# Pinned to v0.17.2 for reproducible builds
RUN curl -sL https://raw.githubusercontent.com/ledgetech/lua-resty-http/v0.17.2/lib/resty/http.lua \
    -o /usr/local/openresty/lualib/resty/http.lua && \
    curl -sL https://raw.githubusercontent.com/ledgetech/lua-resty-http/v0.17.2/lib/resty/http_headers.lua \
    -o /usr/local/openresty/lualib/resty/http_headers.lua && \
    curl -sL https://raw.githubusercontent.com/ledgetech/lua-resty-http/v0.17.2/lib/resty/http_connect.lua \
    -o /usr/local/openresty/lualib/resty/http_connect.lua

# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy nginx main configuration to OpenResty's config path
# OpenResty uses /usr/local/openresty/nginx/conf/nginx.conf by default
COPY services/nginx/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

# Create symlink for /etc/nginx/conf.d to OpenResty's conf.d
RUN mkdir -p /usr/local/openresty/nginx/conf/conf.d && \
    ln -sf /usr/local/openresty/nginx/conf/conf.d /etc/nginx/conf.d

# Copy Lua scripts
COPY services/nginx/lua/crowdsec.lua /usr/local/openresty/lualib/crowdsec.lua
COPY services/nginx/lua/signed_downloads.lua /usr/local/openresty/lualib/signed_downloads.lua

# Copy template files for dynamic domain configuration
# These will be processed by envsubst at container startup
# Output goes to /etc/nginx/conf.d/*.conf
COPY services/nginx/templates/*.template /etc/nginx/templates/

# Create dynamic config directory and copy default IP whitelist
# This directory is bind-mounted at runtime with dynamically generated configs
# The default file is used if no bind mount is present (e.g., during build)
RUN mkdir -p /etc/nginx/dynamic
COPY services/nginx/dynamic/ip-whitelist.conf /etc/nginx/dynamic/ip-whitelist.conf

# Create directory for static files
RUN mkdir -p /usr/share/nginx/html

# Copy a simple index.html for now
RUN echo '<!DOCTYPE html><html><head><title>Notely V3</title></head><body><h1>Notely Platform V3</h1><p>API Gateway: <a href="/api/health">/api/health</a></p></body></html>' > /usr/share/nginx/html/index.html

# Create SSL directories (certs will be mounted)
RUN mkdir -p /etc/nginx/ssl/certs /etc/nginx/ssl/private /etc/nginx/ssl/webroot

# Create log directory for nginx with actual files (not symlinks to stdout/stderr)
# The base OpenResty image symlinks logs to /dev/stdout and /dev/stderr,
# but CrowdSec needs real log files to read. Remove symlinks and create files.
RUN rm -f /usr/local/openresty/nginx/logs/access.log /usr/local/openresty/nginx/logs/error.log && \
    touch /usr/local/openresty/nginx/logs/access.log /usr/local/openresty/nginx/logs/error.log && \
    chmod 644 /usr/local/openresty/nginx/logs/access.log /usr/local/openresty/nginx/logs/error.log

# Expose ports
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

# OpenResty uses a different entrypoint than stock nginx
# We need to handle template processing ourselves
COPY services/nginx/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Environment variables for template substitution
# Use OpenResty's config directory
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/local/openresty/nginx/conf/conf.d

# Start nginx via our custom entrypoint
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["openresty", "-g", "daemon off;"]
