#!/bin/bash
################################################################################
# Notely Platform - OAuth Validation & URI Generator
#
# Generates the required OAuth redirect URIs for Microsoft Azure and Google
# Cloud Platform based on your domain configuration.
#
# Usage:
#   ./scripts/validate-oauth.sh [OPTIONS]
#
################################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/.."
CONFIG_DIR="$SERVER_DIR/config"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Options
JSON_OUTPUT=false
DOMAIN_OVERRIDE=""
MODE_OVERRIDE=""

show_usage() {
    cat << 'EOF'
Notely Platform - OAuth Validation & URI Generator

USAGE:
    ./scripts/validate-oauth.sh [OPTIONS]

DESCRIPTION:
    Generates OAuth redirect URIs that must be registered with identity
    providers (Microsoft Azure AD, Google Cloud Platform).

OPTIONS:
    --domain DOMAIN       Override domain (default: from .env)
    --mode MODE           Override deployment mode (dev|staging|production)
    --json                Output as JSON
    -h, --help            Show this help message

OUTPUT:
    Generates redirect URIs for:
    - Microsoft Azure AD (authentication, calendar, Outlook)
    - Google Cloud (authentication, calendar)

EXAMPLES:
    # Generate URIs from current configuration
    ./scripts/validate-oauth.sh

    # Generate URIs for a specific domain
    ./scripts/validate-oauth.sh --domain example.com --mode production

    # Output as JSON for automation
    ./scripts/validate-oauth.sh --json

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --domain)
            DOMAIN_OVERRIDE="$2"
            shift 2
            ;;
        --mode)
            MODE_OVERRIDE="$2"
            shift 2
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Load domain configuration
if [[ -n "$DOMAIN_OVERRIDE" ]]; then
    BASE_DOMAIN="$DOMAIN_OVERRIDE"
    API_DOMAIN="api.$BASE_DOMAIN"
elif [[ -f "$SERVER_DIR/.env" ]]; then
    source "$SERVER_DIR/.env"
    BASE_DOMAIN="${BASE_DOMAIN:-}"
    API_DOMAIN="${API_DOMAIN:-api.$BASE_DOMAIN}"
else
    echo -e "${RED}Error:${NC} No domain configuration found"
    echo ""
    echo "Either:"
    echo "  1. Run configure-domains.sh first"
    echo "  2. Use --domain flag to specify domain"
    echo ""
    exit 1
fi

# Determine port suffix
if [[ -n "$MODE_OVERRIDE" ]]; then
    DEPLOYMENT_MODE="$MODE_OVERRIDE"
fi

PORT_SUFFIX=""
case "${DEPLOYMENT_MODE:-production}" in
    dev)
        PORT_SUFFIX=":8443"
        ;;
    staging)
        PORT_SUFFIX=":9443"
        ;;
    production)
        PORT_SUFFIX=""
        ;;
esac

# Build base URL
BASE_URL="https://${API_DOMAIN}${PORT_SUFFIX}"

# Define redirect URIs
MICROSOFT_URIS=(
    "${BASE_URL}/api/auth/microsoft/callback"
    "${BASE_URL}/api/outlook/callback"
    "${BASE_URL}/api/calendar/microsoft/callback"
    "${BASE_URL}/api/desktop-auth/microsoft/callback"
)

GOOGLE_URIS=(
    "${BASE_URL}/api/auth/google/callback"
    "${BASE_URL}/api/calendar/google/callback"
    "${BASE_URL}/api/desktop-auth/google/callback"
)

# Output
if [[ "$JSON_OUTPUT" == true ]]; then
    cat << EOF
{
  "domain": "$BASE_DOMAIN",
  "apiDomain": "$API_DOMAIN",
  "deploymentMode": "${DEPLOYMENT_MODE:-production}",
  "portSuffix": "$PORT_SUFFIX",
  "microsoft": {
    "redirectUris": [
$(printf '      "%s",\n' "${MICROSOFT_URIS[@]}" | sed '$ s/,$//')
    ],
    "requiredPermissions": [
      "openid",
      "offline_access",
      "email",
      "profile",
      "User.Read",
      "Calendars.ReadWrite",
      "Mail.Read"
    ]
  },
  "google": {
    "redirectUris": [
$(printf '      "%s",\n' "${GOOGLE_URIS[@]}" | sed '$ s/,$//')
    ],
    "requiredScopes": [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events"
    ]
  }
}
EOF
else
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}                OAuth Redirect URI Generator${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BLUE}Configuration:${NC}"
    echo -e "  Domain:          ${BASE_DOMAIN}"
    echo -e "  API Domain:      ${API_DOMAIN}"
    echo -e "  Deployment Mode: ${DEPLOYMENT_MODE:-production}"
    [[ -n "$PORT_SUFFIX" ]] && echo -e "  Port Suffix:     ${PORT_SUFFIX}"
    echo ""

    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}                    Microsoft Azure AD${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}Redirect URIs (add all of these to your Azure AD app registration):${NC}"
    echo ""
    for uri in "${MICROSOFT_URIS[@]}"; do
        echo "  $uri"
    done
    echo ""
    echo -e "${YELLOW}Required API Permissions:${NC}"
    echo "  - Microsoft Graph:"
    echo "    • openid (Sign users in)"
    echo "    • offline_access (Maintain access)"
    echo "    • email (View email address)"
    echo "    • profile (View basic profile)"
    echo "    • User.Read (Read user profile)"
    echo "    • Calendars.ReadWrite (Read/write calendars)"
    echo "    • Mail.Read (Read mail - for notifications)"
    echo ""
    echo -e "${YELLOW}Azure Portal Steps:${NC}"
    echo "  1. Go to: https://portal.azure.com"
    echo "  2. Navigate to: Azure Active Directory → App registrations"
    echo "  3. Create new registration or select existing"
    echo "  4. Under 'Authentication', add the redirect URIs above"
    echo "  5. Under 'API permissions', add the required permissions"
    echo "  6. Create a client secret under 'Certificates & secrets'"
    echo ""

    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}                    Google Cloud Platform${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}Authorized redirect URIs:${NC}"
    echo ""
    for uri in "${GOOGLE_URIS[@]}"; do
        echo "  $uri"
    done
    echo ""
    echo -e "${YELLOW}Required OAuth Scopes:${NC}"
    echo "  • openid"
    echo "  • email"
    echo "  • profile"
    echo "  • https://www.googleapis.com/auth/calendar.readonly"
    echo "  • https://www.googleapis.com/auth/calendar.events"
    echo ""
    echo -e "${YELLOW}Google Cloud Console Steps:${NC}"
    echo "  1. Go to: https://console.cloud.google.com"
    echo "  2. Navigate to: APIs & Services → Credentials"
    echo "  3. Create OAuth 2.0 Client ID (Web application)"
    echo "  4. Add the authorized redirect URIs above"
    echo "  5. Enable Calendar API under 'APIs & Services → Library'"
    echo ""

    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BLUE}Tip:${NC} Run with --json flag to get machine-readable output"
    echo ""
fi
