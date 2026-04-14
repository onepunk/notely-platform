#!/bin/bash
# PostgreSQL SSL Setup Script
# This script is executed as part of the container entrypoint to enable SSL

set -e

SSL_DIR="/var/lib/postgresql/ssl"
DATA_DIR="/var/lib/postgresql/data"

echo "Setting up PostgreSQL SSL..."

# Copy certificates to the data directory where PostgreSQL expects them
cp "$SSL_DIR/server.crt" "$DATA_DIR/server.crt"
cp "$SSL_DIR/server.key" "$DATA_DIR/server.key"

# Set proper ownership (postgres user)
chown postgres:postgres "$DATA_DIR/server.crt" "$DATA_DIR/server.key"

# Set proper permissions (key must be 600 or less)
chmod 600 "$DATA_DIR/server.key"
chmod 644 "$DATA_DIR/server.crt"

# Enable SSL in postgresql.conf if not already enabled
if ! grep -q "^ssl = on" "$DATA_DIR/postgresql.conf" 2>/dev/null; then
    echo "Enabling SSL in postgresql.conf..."
    cat >> "$DATA_DIR/postgresql.conf" << EOF

# SSL Configuration (added by setup-ssl.sh)
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
EOF
fi

echo "PostgreSQL SSL setup complete."
