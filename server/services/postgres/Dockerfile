FROM postgres:15-alpine

# Copy SSL certificates with proper ownership
COPY --chown=postgres:postgres ops/postgres/ssl/server.crt /var/lib/postgresql/server.crt
COPY --chown=postgres:postgres ops/postgres/ssl/server.key /var/lib/postgresql/server.key

# Set proper permissions for SSL key (must be 600 or less)
RUN chmod 600 /var/lib/postgresql/server.key && \
    chmod 644 /var/lib/postgresql/server.crt

# Add custom entrypoint script to enable SSL
COPY --chmod=755 services/postgres/docker-entrypoint-ssl.sh /usr/local/bin/

ENTRYPOINT ["docker-entrypoint-ssl.sh"]
CMD ["postgres"]
