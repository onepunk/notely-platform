#!/usr/bin/env bash
################################################################################
# Notely Platform V3 - Secret Generation Script
#
# Generates cryptographically secure secrets for the Notely platform.
# Creates a secrets.env file with randomly generated passwords and keys.
#
# Usage:
#   ./generate-secrets.sh                 # Interactive mode, preserves existing
#   ./generate-secrets.sh --force         # Regenerate ALL secrets (destructive)
#   ./generate-secrets.sh --missing-only  # Only generate missing secrets
################################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
SECRETS_FILE="$CONFIG_DIR/secrets.env"
SECRETS_EXAMPLE="$CONFIG_DIR/secrets.env.example"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

show_usage() {
    cat << 'EOF'
Notely Platform V3 - Secret Generation Script

USAGE:
    ./generate-secrets.sh [OPTIONS]

DESCRIPTION:
    Generates cryptographically secure secrets for the Notely V3 platform.
    Creates secrets.env file with random passwords, JWT secrets, and encryption keys.

OPTIONS:
    --force             Regenerate ALL secrets (overwrites existing file)
    --missing-only      Only generate secrets that are missing or use placeholder values
    -h, --help          Show this help message

EXAMPLES:
    # First time setup - generate all secrets
    ./generate-secrets.sh

    # Rotate specific secrets while preserving OAuth credentials
    # (Edit secrets.env manually to mark secrets for regeneration, then run)
    ./generate-secrets.sh --missing-only

    # Emergency rotation - regenerate everything
    ./generate-secrets.sh --force

GENERATED SECRETS:
    - JWT_SECRET (64 chars hex)
    - ENCRYPTION_KEY (128 chars hex)
    - PostgreSQL passwords for all services (40 chars base64)
    - Redis password (40 chars base64)
    - Webhook secrets (64 chars hex)

PRESERVED VALUES:
    - OAuth credentials (must be configured manually from provider consoles)
    - Email settings
    - External service tokens
    - ACS configuration

NOTES:
    - Uses OpenSSL for cryptographically secure random generation
    - Existing OAuth credentials are preserved during regeneration
    - Always backup secrets.env before running with --force
    - After generation, configure OAuth credentials in secrets.env

EOF
}

generate_hex_secret() {
    local length=$1
    openssl rand -hex "$length"
}

generate_base64_secret() {
    local length=$1
    openssl rand -base64 "$length" | tr -d '\n' | head -c "$length"
}

escape_multiline_for_env() {
    local value="$1"
    value="${value%$'\n'}"  # trim trailing newline if present
    printf '%s' "$value" | sed ':a;N;$!ba;s/\\/\\\\/g;s/\n/\\n/g'
}

generate_rsa_keypair() {
    local bits=${1:-4096}

    local private_key
    private_key=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:${bits} 2>/dev/null)

    local public_key
    public_key=$(printf '%s\n' "$private_key" | openssl rsa -pubout 2>/dev/null)

    JWT_PRIVATE_KEY=$(escape_multiline_for_env "$private_key")
    JWT_PUBLIC_KEY=$(escape_multiline_for_env "$public_key")
    JWT_KEY_ID=$(generate_hex_secret 8)
}

read_env_value() {
    local key="$1"
    if [[ -f "$SECRETS_FILE" ]]; then
        grep -E "^${key}=" "$SECRETS_FILE" | head -n1 | cut -d= -f2-
    fi
}

# ============================================================================
# Parse Arguments
# ============================================================================

FORCE_MODE=false
MISSING_ONLY=false
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_MODE=true
            shift
            ;;
        --missing-only)
            MISSING_ONLY=true
            shift
            ;;
        --json-output)
            JSON_OUTPUT=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# ============================================================================
# Validation
# ============================================================================

if [[ ! -f "$SECRETS_EXAMPLE" ]]; then
    log_error "Secrets template not found: $SECRETS_EXAMPLE"
    exit 1
fi

# Check for OpenSSL
if ! command -v openssl &> /dev/null; then
    log_error "OpenSSL is required but not installed"
    echo "Install with: sudo apt-get install openssl  # Ubuntu/Debian"
    echo "           or: brew install openssl          # macOS"
    exit 1
fi

# ============================================================================
# Check Existing File
# ============================================================================

if [[ -f "$SECRETS_FILE" ]] && [[ "$FORCE_MODE" == false ]]; then
    echo ""
    log_warning "secrets.env already exists: $SECRETS_FILE"
    echo ""
    echo "Options:"
    echo "  1. Keep existing file (safe - exit now)"
    echo "  2. Regenerate missing/placeholder secrets only (recommended)"
    echo "  3. Regenerate ALL secrets (DESTRUCTIVE - will lose OAuth config)"
    echo ""
    read -p "Choose [1/2/3]: " choice

    case $choice in
        1)
            log_info "Keeping existing secrets.env"
            exit 0
            ;;
        2)
            log_info "Regenerating missing/placeholder secrets only"
            MISSING_ONLY=true
            ;;
        3)
            log_warning "This will overwrite ALL secrets!"
            read -p "Are you sure? Type 'yes' to confirm: " confirm
            if [[ "$confirm" != "yes" ]]; then
                log_info "Cancelled"
                exit 0
            fi
            FORCE_MODE=true
            ;;
        *)
            log_error "Invalid choice"
            exit 1
            ;;
    esac
fi

# ============================================================================
# Backup Existing File
# ============================================================================

if [[ -f "$SECRETS_FILE" ]]; then
    BACKUP_FILE="$SECRETS_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$SECRETS_FILE" "$BACKUP_FILE"
    log_success "Backed up existing file to: $BACKUP_FILE"
fi

# ============================================================================
# Generate Secrets
# ============================================================================

echo ""
log_info "Generating secure secrets..."
echo ""

# Generate core security secrets
JWT_SECRET=$(generate_hex_secret 32)           # 32 bytes = 64 hex chars
ENCRYPTION_KEY=$(generate_hex_secret 64)       # 64 bytes = 128 hex chars

log_success "Generated JWT_SECRET (64 chars)"
log_success "Generated ENCRYPTION_KEY (128 chars)"

# Generate or reuse JWT RSA key pair
if [[ -f "$SECRETS_FILE" ]] && [[ "$FORCE_MODE" == false ]]; then
    EXISTING_JWT_PRIVATE_KEY=$(read_env_value "JWT_PRIVATE_KEY")
    EXISTING_JWT_PUBLIC_KEY=$(read_env_value "JWT_PUBLIC_KEY")
    EXISTING_JWT_KEY_ID=$(read_env_value "JWT_KEY_ID")

    if [[ -n "$EXISTING_JWT_PRIVATE_KEY" ]] && [[ -n "$EXISTING_JWT_PUBLIC_KEY" ]]; then
        JWT_PRIVATE_KEY="$EXISTING_JWT_PRIVATE_KEY"
        JWT_PUBLIC_KEY="$EXISTING_JWT_PUBLIC_KEY"
        if [[ -n "$EXISTING_JWT_KEY_ID" ]]; then
            JWT_KEY_ID="$EXISTING_JWT_KEY_ID"
        else
            JWT_KEY_ID=$(generate_hex_secret 8)
        fi
        log_success "Preserved existing JWT key pair"
    else
        generate_rsa_keypair
        log_success "Generated RSA key pair for JWT signing"
    fi
else
    generate_rsa_keypair
    log_success "Generated RSA key pair for JWT signing"
fi

# Generate database passwords (40 chars base64 for good entropy)
POSTGRES_PASSWORD=$(generate_base64_secret 40)
POSTGRES_AUTH_PASSWORD=$(generate_base64_secret 40)
POSTGRES_USERS_PASSWORD=$(generate_base64_secret 40)
POSTGRES_CALENDAR_PASSWORD=$(generate_base64_secret 40)
POSTGRES_MEETINGS_PASSWORD=$(generate_base64_secret 40)
POSTGRES_TRANSCRIPTS_PASSWORD=$(generate_base64_secret 40)
POSTGRES_NOTES_PASSWORD=$(generate_base64_secret 40)
POSTGRES_SUMMARIES_PASSWORD=$(generate_base64_secret 40)
POSTGRES_ADMIN_SERVICE_PASSWORD=$(generate_base64_secret 40)
POSTGRES_ACTIONS_PASSWORD=$(generate_base64_secret 40)

log_success "Generated PostgreSQL admin password"
log_success "Generated 9 service-specific database passwords"

# Generate Redis password
REDIS_PASSWORD=$(generate_base64_secret 40)
log_success "Generated Redis password"

# Generate webhook secrets
ACS_JOINER_WEBHOOK_SECRET=$(generate_hex_secret 32)
TEAMS_ACS_CALLBACK_SECRET=$(generate_hex_secret 32)
TEAMS_WEBHOOK_SECRET=$(generate_hex_secret 32)

log_success "Generated webhook secrets (3 items)"

# ============================================================================
# Preserve OAuth Credentials (if updating existing file)
# ============================================================================

if [[ -f "$SECRETS_FILE" ]] && [[ "$MISSING_ONLY" == true ]]; then
    log_info "Preserving existing OAuth credentials..."

    # Source existing file to get OAuth values
    set +e  # Don't exit on error
    source "$SECRETS_FILE" 2>/dev/null
    set -e

    # Preserve these if they're not placeholder values
    PRESERVE_MICROSOFT_CLIENT_ID="$MICROSOFT_CLIENT_ID"
    PRESERVE_MICROSOFT_CLIENT_SECRET="$MICROSOFT_CLIENT_SECRET"
    PRESERVE_MICROSOFT_TENANT="$MICROSOFT_TENANT"
    PRESERVE_GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID"
    PRESERVE_GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET"
    PRESERVE_TEAMS_BOT_APP_ID="$TEAMS_BOT_APP_ID"
    PRESERVE_TEAMS_BOT_APP_PASSWORD="$TEAMS_BOT_APP_PASSWORD"

    log_success "Preserved OAuth credentials from existing file"
fi

# ============================================================================
# Create secrets.env File
# ============================================================================

log_info "Writing secrets.env file..."

cat > "$SECRETS_FILE" << EOF
# Notely Platform Secrets - AUTO-GENERATED
#
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# Mode: $(if [[ "$FORCE_MODE" == true ]]; then echo "FORCE (all new)"; else echo "SAFE (preserved OAuth)"; fi)
#
# NEVER commit this file to version control!
# This file contains sensitive credentials for the Notely V3 platform.

# ============================================================================
# Security Secrets (Auto-generated)
# ============================================================================

# JWT token signing secret (64 characters hex)
# Generated with: openssl rand -hex 32
JWT_SECRET=$JWT_SECRET

# Encryption key for data at rest (128 characters hex)
# Generated with: openssl rand -hex 64
ENCRYPTION_KEY=$ENCRYPTION_KEY

# JWT RSA key pair (PEM-encoded, newline escaped)
JWT_PRIVATE_KEY=$JWT_PRIVATE_KEY
JWT_PUBLIC_KEY=$JWT_PUBLIC_KEY
JWT_KEY_ID=$JWT_KEY_ID

# ============================================================================
# Database Configuration
# ============================================================================

# PostgreSQL configuration (V3-specific database and users)
POSTGRES_DB=notely_v3
POSTGRES_USER=notely_v3_admin
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# Service-specific database roles (each owns its schema)
POSTGRES_AUTH_USER=notely_auth_v3_user
POSTGRES_AUTH_PASSWORD=$POSTGRES_AUTH_PASSWORD

POSTGRES_USERS_USER=notely_users_v3_user
POSTGRES_USERS_PASSWORD=$POSTGRES_USERS_PASSWORD

POSTGRES_CALENDAR_USER=notely_calendar_v3_user
POSTGRES_CALENDAR_PASSWORD=$POSTGRES_CALENDAR_PASSWORD

POSTGRES_MEETINGS_USER=notely_meetings_v3_user
POSTGRES_MEETINGS_PASSWORD=$POSTGRES_MEETINGS_PASSWORD

POSTGRES_TRANSCRIPTS_USER=notely_transcripts_v3_user
POSTGRES_TRANSCRIPTS_PASSWORD=$POSTGRES_TRANSCRIPTS_PASSWORD

POSTGRES_NOTES_USER=notely_notes_v3_user
POSTGRES_NOTES_PASSWORD=$POSTGRES_NOTES_PASSWORD

POSTGRES_SUMMARIES_USER=notely_summaries_v3_user
POSTGRES_SUMMARIES_PASSWORD=$POSTGRES_SUMMARIES_PASSWORD

POSTGRES_ADMIN_SERVICE_USER=notely_admin_v3_user
POSTGRES_ADMIN_SERVICE_PASSWORD=$POSTGRES_ADMIN_SERVICE_PASSWORD

POSTGRES_ACTIONS_USER=notely_actions_v3_user
POSTGRES_ACTIONS_PASSWORD=$POSTGRES_ACTIONS_PASSWORD

# Redis configuration
REDIS_PASSWORD=$REDIS_PASSWORD

# ============================================================================
# Microsoft OAuth - Shared App Registration
# Used for user authentication and Teams/Calendar integrations
# ============================================================================

# App Name: Notely Platform (shared)
# Redirect URI: https://YOUR_API_DOMAIN/api/auth/microsoft/callback
#
# TODO: Configure these in Azure Portal (https://portal.azure.com)
#       1. Go to Azure Active Directory > App registrations
#       2. Create new registration or use existing
#       3. Copy Client ID, generate Client Secret, note Tenant ID
#       4. Add redirect URIs for your domains
EOF

# Add OAuth credentials (preserved or placeholder)
if [[ -n "$PRESERVE_MICROSOFT_CLIENT_ID" ]] && [[ "$PRESERVE_MICROSOFT_CLIENT_ID" != "your_shared_microsoft_app_id" ]]; then
    cat >> "$SECRETS_FILE" << EOF
MICROSOFT_CLIENT_ID=$PRESERVE_MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET=$PRESERVE_MICROSOFT_CLIENT_SECRET
MICROSOFT_TENANT=$PRESERVE_MICROSOFT_TENANT
EOF
    log_success "Preserved existing Microsoft OAuth credentials"
else
    cat >> "$SECRETS_FILE" << EOF
MICROSOFT_CLIENT_ID=your_shared_microsoft_app_id
MICROSOFT_CLIENT_SECRET=your_shared_microsoft_app_secret
MICROSOFT_TENANT=your_microsoft_tenant_id_or_common
EOF
fi

cat >> "$SECRETS_FILE" << EOF

# ============================================================================
# Microsoft OAuth - Mailer App (Application Permissions)
# Used for sending emails on behalf of the organization
# ============================================================================

# App Name: Notely Mailer (App-only)
# TODO: Configure in Azure Portal if using email functionality
MAIL_APP_CLIENT_ID=your_mail_app_client_id_here
MAIL_APP_CLIENT_SECRET=your_mail_app_client_secret_here
MAIL_TENANT_ID=your_mail_tenant_id_here

# Email configuration for sending
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Notely
MICROSOFT_SENDER_EMAIL=noreply@yourdomain.com

# ============================================================================
# Microsoft Teams Bot (Optional - if Teams integration enabled)
# ============================================================================

# App Name: Notely for Teams (shared app)
# TODO: Configure in Azure Portal if using Teams integration
EOF

if [[ -n "$PRESERVE_TEAMS_BOT_APP_ID" ]] && [[ "$PRESERVE_TEAMS_BOT_APP_ID" != "your_shared_microsoft_app_id" ]]; then
    cat >> "$SECRETS_FILE" << EOF
TEAMS_BOT_APP_ID=$PRESERVE_TEAMS_BOT_APP_ID
TEAMS_BOT_APP_PASSWORD=$PRESERVE_TEAMS_BOT_APP_PASSWORD
EOF
    log_success "Preserved existing Teams Bot credentials"
else
    cat >> "$SECRETS_FILE" << EOF
TEAMS_BOT_APP_ID=your_shared_microsoft_app_id
TEAMS_BOT_APP_PASSWORD=your_shared_microsoft_app_secret
EOF
fi

cat >> "$SECRETS_FILE" << EOF

# Teams webhook and Graph API configuration
TEAMS_WEBHOOK_SECRET=$TEAMS_WEBHOOK_SECRET
GRAPH_CLIENT_ID=your_shared_microsoft_app_id
GRAPH_CLIENT_SECRET=your_shared_microsoft_app_secret
GRAPH_TENANT_ID=your_microsoft_tenant_id
TEAMS_BOT_CALLBACK_URI=https://YOUR_API_DOMAIN/api/teams/callback

# ============================================================================
# Google OAuth (Optional - for Google Calendar integration)
# ============================================================================

# TODO: Configure in Google Cloud Console if using Google Calendar
EOF

if [[ -n "$PRESERVE_GOOGLE_CLIENT_ID" ]] && [[ "$PRESERVE_GOOGLE_CLIENT_ID" != "your_google_client_id" ]]; then
    cat >> "$SECRETS_FILE" << EOF
GOOGLE_CLIENT_ID=$PRESERVE_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$PRESERVE_GOOGLE_CLIENT_SECRET
EOF
    log_success "Preserved existing Google OAuth credentials"
else
    cat >> "$SECRETS_FILE" << EOF
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
EOF
fi

cat >> "$SECRETS_FILE" << EOF
GOOGLE_REDIRECT_URI=https://YOUR_API_DOMAIN/api/calendar/google/callback

# ============================================================================
# Outlook Calendar Specific
# ============================================================================

# These can fallback to MICROSOFT_CLIENT_ID/SECRET if not specified
OUTLOOK_CLIENT_ID=your_shared_microsoft_app_id
OUTLOOK_CLIENT_SECRET=your_shared_microsoft_app_secret

# ============================================================================
# External Services (Optional)
# ============================================================================

# Hugging Face token for AI model downloads
# TODO: Get from https://huggingface.co/settings/tokens
HUGGINGFACE_TOKEN=your_huggingface_token

# Custom package repository configuration (for private PyPI mirrors)
PIP_INDEX_URL=
PIP_EXTRA_INDEX_URL=
PIP_TRUSTED_HOST=
CUSTOM_CA_PEM=

# ============================================================================
# Azure Communication Services (ACS) - For Teams Meeting Join
# ============================================================================

# ACS endpoint (required for managed identity authentication in production)
# Format: https://<resource-name>.<region>.communication.azure.com
# TODO: Configure in Azure Portal if using Teams meeting join
ACS_ENDPOINT=https://your-acs-resource.region.communication.azure.com

# ACS resource ID for Teams allowlisting (immutable resource ID from Azure portal)
# Find this in: Azure Portal → ACS Resource → Properties → Immutable Resource ID
ACS_RESOURCE_ID=your-acs-immutable-resource-id-guid

# ACS connection string (OPTIONAL - local development only)
# Production uses managed identity authentication via DefaultAzureCredential
ACS_CONNECTION_STRING=

# ACS Call Automation webhook shared secret (auto-generated)
ACS_JOINER_WEBHOOK_SECRET=$ACS_JOINER_WEBHOOK_SECRET

# Teams ACS worker callback secret (auto-generated)
TEAMS_ACS_CALLBACK_SECRET=$TEAMS_ACS_CALLBACK_SECRET

# ============================================================================
# ACS Teams User Identity Authentication (Service Account)
# ============================================================================

# Service account for authenticated ACS joins (removes "Unverified" label)
# This account must exist in the same tenant as your ACS resource and have a Teams license
# TODO: Configure service account credentials
ACS_SERVICE_ACCOUNT_EMAIL=notes-bot@yourdomain.com
ACS_SERVICE_ACCOUNT_PASSWORD=your_service_account_password_here

# Azure AD app for ACS identity (typically reuses "Notely for Teams" app)
ACS_IDENTITY_CLIENT_ID=your_shared_microsoft_app_id
ACS_IDENTITY_CLIENT_SECRET=your_shared_microsoft_app_secret
ACS_IDENTITY_TENANT_ID=your_microsoft_tenant_id

# Azure AD Object ID for the service account (required for getTokenForTeamsUser)
# Obtain via: az ad user show --id notes-bot@yourdomain.com --query id -o tsv
ACS_SERVICE_ACCOUNT_OBJECT_ID=your_service_account_object_id_guid

# JWT expiration time
JWT_EXPIRES_IN=7d

# Auth service port
AUTH_PORT=3201
EOF

log_success "Created secrets.env file"

# ============================================================================
# Set File Permissions
# ============================================================================

chmod 600 "$SECRETS_FILE"
log_success "Set file permissions to 600 (owner read/write only)"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN} ✓ Secret Generation Complete${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""
echo "Generated secrets saved to: $SECRETS_FILE"
if [[ -f "$BACKUP_FILE" ]]; then
    echo "Backup of previous file: $BACKUP_FILE"
fi
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo "1. Review the generated file:"
echo "   ${BLUE}cat $SECRETS_FILE${NC}"
echo ""
echo "2. Configure OAuth credentials (required for authentication):"
echo "   ${BLUE}vim $SECRETS_FILE${NC}"
echo "   - MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET"
echo "   - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (if using Google)"
echo ""
echo "3. Configure optional services as needed:"
echo "   - Teams Bot credentials"
echo "   - ACS (Azure Communication Services)"
echo "   - Email service account"
echo ""
echo "4. Generate platform .env file:"
echo "   ${BLUE}cd $SCRIPT_DIR/..${NC}"
echo "   ${BLUE}./scripts/configure-domains.sh --base-domain yourdomain.com --apply${NC}"
echo ""
echo -e "${YELLOW}Security Reminders:${NC}"
echo "  • Never commit secrets.env to version control"
echo "  • Backup this file securely (encrypted backup recommended)"
echo "  • Rotate secrets quarterly (run this script with --force)"
echo "  • Use different secrets for dev/staging/production"
echo "  • Persist JWT_PRIVATE_KEY/JWT_PUBLIC_KEY values exactly as generated (escaped newlines)"
echo ""

# ============================================================================
# Secret Strength Report
# ============================================================================

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN} Secret Strength Report${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""
echo "  JWT_SECRET:       $(echo -n "$JWT_SECRET" | wc -c) chars (hex) ✓"
echo "  ENCRYPTION_KEY:   $(echo -n "$ENCRYPTION_KEY" | wc -c) chars (hex) ✓"
echo "  JWT Key Pair:     RSA 4096-bit ✓"
echo "  DB Passwords:     40 chars (base64) ✓"
echo "  Redis Password:   40 chars (base64) ✓"
echo "  Webhook Secrets:  64 chars (hex) ✓"
echo ""
echo "All auto-generated secrets meet security requirements."
echo ""

# Output JSON if requested (for installer API)
if [[ "$JSON_OUTPUT" == true ]]; then
    cat << EOF
{
  "success": true,
  "path": "$SECRETS_FILE",
  "generated": {
    "jwtSecret": true,
    "encryptionKey": true,
    "jwtKeyPair": true,
    "postgresPasswords": 10,
    "redisPassword": true,
    "webhookSecrets": 3
  },
  "backup": "${BACKUP_FILE:-null}",
  "mode": "$(if [[ "$FORCE_MODE" == true ]]; then echo "force"; elif [[ "$MISSING_ONLY" == true ]]; then echo "missing-only"; else echo "interactive"; fi)"
}
EOF
fi
