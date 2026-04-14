#!/bin/bash
# Custom entrypoint wrapper for PostgreSQL with SSL

# Copy SSL certificates to data directory after initialization
setup_ssl() {
    local data_dir="$PGDATA"
    local ssl_src="/var/lib/postgresql"

    # Wait for PGDATA to be initialized
    if [ -f "$data_dir/postgresql.conf" ]; then
        # Copy certificates to data directory
        cp "$ssl_src/server.crt" "$data_dir/server.crt"
        cp "$ssl_src/server.key" "$data_dir/server.key"

        # Ensure proper ownership and permissions
        chown postgres:postgres "$data_dir/server.crt" "$data_dir/server.key"
        chmod 600 "$data_dir/server.key"
        chmod 644 "$data_dir/server.crt"

        # Enable SSL in postgresql.conf if not already enabled
        if ! grep -q "^ssl = on" "$data_dir/postgresql.conf"; then
            echo "" >> "$data_dir/postgresql.conf"
            echo "# SSL Configuration" >> "$data_dir/postgresql.conf"
            echo "ssl = on" >> "$data_dir/postgresql.conf"
            echo "ssl_cert_file = 'server.crt'" >> "$data_dir/postgresql.conf"
            echo "ssl_key_file = 'server.key'" >> "$data_dir/postgresql.conf"
        fi

        # Enable connection logging if not already enabled
        if ! grep -q "^log_connections = on" "$data_dir/postgresql.conf"; then
            echo "" >> "$data_dir/postgresql.conf"
            echo "# Connection Logging" >> "$data_dir/postgresql.conf"
            echo "log_connections = on" >> "$data_dir/postgresql.conf"
            echo "log_disconnections = on" >> "$data_dir/postgresql.conf"
            echo "log_line_prefix = '%m [%p] %r %u@%d '" >> "$data_dir/postgresql.conf"
        fi

        echo "PostgreSQL SSL configuration complete."
    fi
}

# If postgres command, handle SSL setup
if [ "$1" = 'postgres' ]; then
    # Check if this is initial run or restart
    if [ -s "$PGDATA/PG_VERSION" ]; then
        # Database already initialized, setup SSL before starting
        setup_ssl
    else
        # First run - set up a background task to configure SSL after init completes
        (
            while [ ! -f "$PGDATA/postgresql.conf" ]; do
                sleep 1
            done
            sleep 2  # Give postgres time to finish initial setup
            setup_ssl
        ) &
    fi
fi

# Call the original entrypoint
exec docker-entrypoint.sh "$@"
