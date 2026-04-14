#!/bin/bash
################################################################################
# Notely Platform Installer - Entrypoint Script
#
# Generates self-signed SSL certificate and one-time setup token.
# Displays access instructions in the console.
################################################################################

set -e

CERT_DIR="/installer/certs"
RUNTIME_DIR="/installer/runtime"
TOKEN_FILE="$RUNTIME_DIR/setup-token"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}           ${BOLD}Notely Platform - Installation Wizard${NC}              ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Generate self-signed SSL certificate (24-hour validity)
if [[ ! -f "$CERT_DIR/installer.crt" ]]; then
    echo -e "${BLUE}[1/3]${NC} Generating self-signed SSL certificate..."

    openssl req -x509 -nodes -days 1 \
        -newkey rsa:2048 \
        -keyout "$CERT_DIR/installer.key" \
        -out "$CERT_DIR/installer.crt" \
        -subj "/CN=notely-installer/O=Notely/C=US" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
        2>/dev/null

    chmod 600 "$CERT_DIR/installer.key"
    echo -e "   ${GREEN}✓${NC} Certificate generated (valid for 24 hours)"
else
    echo -e "${BLUE}[1/3]${NC} Using existing SSL certificate"
fi

# Generate one-time setup token
if [[ ! -f "$TOKEN_FILE" ]]; then
    echo -e "${BLUE}[2/3]${NC} Generating one-time setup token..."

    SETUP_TOKEN=$(openssl rand -hex 16)
    echo "$SETUP_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"

    echo -e "   ${GREEN}✓${NC} Setup token generated"
else
    SETUP_TOKEN=$(cat "$TOKEN_FILE")
    echo -e "${BLUE}[2/3]${NC} Using existing setup token"
fi

# Export token for the Node.js application
export SETUP_TOKEN

# Detect server IP addresses
echo -e "${BLUE}[3/3]${NC} Detecting server IP addresses..."
SERVER_IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -3 || echo "localhost")

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}                    ${BOLD}Installation Ready${NC}                          ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "   ${BOLD}Open the installer in your browser:${NC}"
echo ""

for ip in $SERVER_IPS; do
    echo -e "   ${CYAN}→${NC} https://${ip}:${INSTALLER_PORT:-9000}"
done
echo -e "   ${CYAN}→${NC} https://localhost:${INSTALLER_PORT:-9000}"

echo ""
echo -e "   ${BOLD}Setup Token (enter when prompted):${NC}"
echo ""
echo -e "   ${YELLOW}${SETUP_TOKEN}${NC}"
echo ""
echo -e "   ${BOLD}Security Notes:${NC}"
echo -e "   • This token is valid for one session only"
echo -e "   • The installer will auto-shutdown after ${INSTALLER_TIMEOUT_MINUTES:-30} minutes of inactivity"
echo -e "   • Accept the browser's SSL warning (self-signed certificate)"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "   ${BOLD}Waiting for browser connection...${NC}"
echo ""

# Start the Node.js application
exec "$@"
