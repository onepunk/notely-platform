#!/bin/bash

# Test script for the apply-nginx endpoint
# This demonstrates how to test the IP whitelist application to nginx

set -e

echo "================================================"
echo "Testing IP Whitelist Application to Nginx"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ADMIN_CONFIG_URL="http://localhost:3206"
PORTAL_BFF_URL="http://localhost:3215"
GATEWAY_URL="http://localhost:3200"

echo -e "${YELLOW}Step 1: Checking service availability...${NC}"
echo ""

# Check if admin-config is accessible
if curl -s -f "${ADMIN_CONFIG_URL}/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Admin Config Service is running${NC}"
else
    echo -e "${RED}✗ Admin Config Service is not accessible${NC}"
    exit 1
fi

# Check if nginx container is running
if docker ps | grep -q "notely-nginx-v3"; then
    echo -e "${GREEN}✓ Nginx container is running${NC}"
else
    echo -e "${RED}✗ Nginx container is not running${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 2: Update IP whitelist configuration (example)...${NC}"
echo ""

# Note: This requires authentication. In a real scenario, you would:
# 1. Login via /api/auth/login to get a session cookie or JWT token
# 2. Include the Authorization header or cookies in the request
# 3. The gateway will validate the token and forward auth headers to admin-config

echo "Example: Update security config with IP whitelist"
echo "POST ${GATEWAY_URL}/api/admin/config/security"
echo ""
echo "Request body example:"
cat << 'EOF'
{
  "ipWhitelist": [
    "192.168.1.100",
    "10.0.0.0/8",
    "172.16.0.0/12"
  ]
}
EOF
echo ""

echo -e "${YELLOW}Step 3: Apply IP whitelist to nginx...${NC}"
echo ""

echo "Example: Apply configuration to nginx"
echo "POST ${GATEWAY_URL}/api/admin/config/security/apply-nginx"
echo ""

echo -e "${YELLOW}Testing via direct service call (for development only)...${NC}"
echo ""

# For development testing, we can call the admin-config service directly
# This bypasses authentication - only use in development!
echo "Calling admin-config service directly (development only):"
echo "curl -X POST ${ADMIN_CONFIG_URL}/api/admin/config/security/apply-nginx"
echo ""

# Note: This will fail if we don't have auth headers
# To test properly, we need to:
# 1. Get an admin user session
# 2. Call through the gateway which will validate auth and add headers

echo -e "${YELLOW}Step 4: Verify nginx configuration...${NC}"
echo ""

# Check if ip-whitelist.conf exists in nginx container
if docker exec notely-nginx-v3 test -f /etc/nginx/ip-whitelist.conf 2>/dev/null; then
    echo -e "${GREEN}✓ IP whitelist config file exists in nginx${NC}"
    echo ""
    echo "Current IP whitelist content:"
    docker exec notely-nginx-v3 cat /etc/nginx/ip-whitelist.conf
else
    echo -e "${YELLOW}⚠ IP whitelist config file does not exist yet${NC}"
    echo "Run the apply-nginx endpoint to create it"
fi

echo ""
echo -e "${YELLOW}Step 5: Test nginx configuration validity...${NC}"
echo ""

if docker exec notely-nginx-v3 nginx -t 2>&1; then
    echo -e "${GREEN}✓ Nginx configuration is valid${NC}"
else
    echo -e "${RED}✗ Nginx configuration has errors${NC}"
    exit 1
fi

echo ""
echo "================================================"
echo "Test Information"
echo "================================================"
echo ""
echo "Endpoint: POST /api/portal/admin/config/security/apply-nginx"
echo "Via Gateway: POST ${GATEWAY_URL}/api/admin/config/security/apply-nginx"
echo "Via Portal BFF: POST ${PORTAL_BFF_URL}/portal/admin/config/security/apply-nginx"
echo ""
echo "Authentication: Required (Admin role)"
echo ""
echo "To test with authentication:"
echo "1. Login via the portal UI or API"
echo "2. Use the session cookie or JWT token"
echo "3. Make the request through the gateway or portal-bff"
echo ""
echo "Example using curl with session cookie:"
echo "  curl -X POST \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -b 'access_token=YOUR_TOKEN_HERE' \\"
echo "    ${GATEWAY_URL}/api/admin/config/security/apply-nginx"
echo ""
echo "Expected response:"
cat << 'EOF'
{
  "success": true,
  "message": "IP whitelist applied and nginx reloaded successfully",
  "ipsConfigured": 3,
  "ipWhitelist": ["192.168.1.100", "10.0.0.0/8", "172.16.0.0/12"],
  "reloadedAt": "2025-11-05T20:45:00.000Z",
  "executionTimeMs": 234
}
EOF
echo ""
