#!/bin/bash
# Copy SSL certs to PostgreSQL data directory with correct permissions
cp /ssl/server.crt /var/lib/postgresql/data/server.crt
cp /ssl/server.key /var/lib/postgresql/data/server.key
chown postgres:postgres /var/lib/postgresql/data/server.crt /var/lib/postgresql/data/server.key
chmod 600 /var/lib/postgresql/data/server.key
chmod 644 /var/lib/postgresql/data/server.crt

# Enable SSL in postgresql.conf
echo "ssl = on" >> /var/lib/postgresql/data/postgresql.conf
echo "ssl_cert_file = 'server.crt'" >> /var/lib/postgresql/data/postgresql.conf
echo "ssl_key_file = 'server.key'" >> /var/lib/postgresql/data/postgresql.conf
