#!/bin/sh
set -e

# OpenResty Docker Entrypoint Script
# Handles template processing for nginx configuration

echo "Starting OpenResty entrypoint..."

# Process nginx templates (like the official nginx image does)
# Convert .template files to .conf using envsubst
TEMPLATE_DIR="/etc/nginx/templates"
OUTPUT_DIR="${NGINX_ENVSUBST_OUTPUT_DIR:-/etc/nginx/conf.d}"

if [ -d "$TEMPLATE_DIR" ]; then
    echo "Processing nginx templates..."

    # Define which environment variables to substitute
    # This prevents envsubst from replacing nginx variables like $host, $uri, etc.
    DEFINED_ENVS=$(printf '${%s} ' $(env | cut -d= -f1 | grep -E '^(BASE_DOMAIN|API_DOMAIN|PORTAL_DOMAIN|WS_DOMAIN|GET_DOMAIN|DOCS_DOMAIN|WEBSITE_DOMAIN)'))

    for template in "$TEMPLATE_DIR"/*.template; do
        if [ -f "$template" ]; then
            # Get base filename without .template extension
            # e.g., api.conf.template -> api.conf
            filename=$(basename "$template" .template)
            output_file="$OUTPUT_DIR/${filename}"
            echo "  Processing: $template -> $output_file"
            envsubst "$DEFINED_ENVS" < "$template" > "$output_file"
        fi
    done

    echo "Template processing complete."
fi

# Log CrowdSec bouncer status
if [ -n "$CROWDSEC_BOUNCER_API_KEY" ]; then
    echo "CrowdSec bouncer API key detected - bouncer will actively block banned IPs"
else
    echo "INFO: CROWDSEC_BOUNCER_API_KEY not set - CrowdSec running in detection-only mode"
    echo "To enable active blocking, run: docker exec notely-crowdsec-v3 cscli bouncers add nginx-bouncer -o raw"
    echo "Then add the key to secrets.env and restart nginx"
fi

# Test nginx configuration
echo "Testing nginx configuration..."
openresty -t

# Start nginx (exec replaces the shell process with nginx)
echo "Starting OpenResty..."
exec "$@"
