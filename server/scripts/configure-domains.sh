#!/usr/bin/env bash
################################################################################
# Notely Platform V3 - Domain Configuration Script
#
# Configures domain names for V3 API service by creating environment-
# specific override files and regenerating service configuration.
#
# Usage:
#   ./configure-domains.sh --base-domain yourdomain.com --apply
#   ./configure-domains.sh --api api.yourdomain.com --apply
################################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
DIR="$SCRIPT_DIR/.."
ENV=${NOTELY_CONFIG_ENV:-local}

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << 'EOF'
Notely Platform - Domain Configuration Script

USAGE:
    ./configure-domains.sh [OPTIONS]

DESCRIPTION:
    Configure domain names for Notely API service. Creates environment-
    specific configuration files and optionally applies changes by recreating
    Docker containers with updated environment variables.

OPTIONS:
    -e, --environment ENV     Environment name (default: local)
                             Valid values: local, staging, production

    --base-domain DOMAIN      Base domain for all services (e.g., yourdomain.com)
                             Auto-generates subdomains if not specified

    --api DOMAIN             API domain (default: api.<base-domain>)
    --portal DOMAIN          Portal domain (default: portal.<base-domain>)
    --calendar DOMAIN        Calendar domain (default: calendar.<base-domain>)

    --port-offset OFFSET     Add OFFSET to exposed service ports (default: 0)
                             Set to 0 to disable. Excludes infrastructure ports
                             such as PostgreSQL (5432) and Redis (6379).

    --dev                    Development mode - nginx on port 8443
                             URLs include :8443 for OAuth callbacks

    --staging                Staging mode - nginx on port 9443
                             URLs include :9443 for OAuth callbacks

    --production             Production mode - nginx on standard ports (443)
                             URLs use standard HTTPS (no port in URL)

    --apply                  Apply changes and recreate api container
    --skip-restart           Generate config but don't recreate container
    -h, --help               Show this help message

EXAMPLES:
    # Set all domains using base domain (recommended)
    ./configure-domains.sh --base-domain yourdomain.com --environment production --apply

    # Change only the API domain
    ./configure-domains.sh --api api.yourdomain.com --environment local --apply

    # Generate config without applying (dry-run)
    ./configure-domains.sh --base-domain example.com --environment production

ENVIRONMENT FILES:
    Configuration is saved to:
      - config/base.env (defaults, version controlled)
      - config/secrets.env (secrets, NOT version controlled)
      - .env (generated merged configuration, NOT version controlled)

WHAT THIS SCRIPT DOES:
    1. Loads config/base.env for defaults
    2. Validates config/secrets.env exists
    3. Generates .env file using root.env.template
    4. Recreates api Docker container to pick up new environment
    5. Verifies service is running with updated configuration

NOTES:
    - The script preserves existing configuration values when updating
    - Only specified domains are changed; others remain unchanged
    - Use --apply flag to automatically recreate container
    - Without --apply, only configuration files are generated
    - Container recreation is required for changes to take effect

COMPOSE OVERLAYS:
    When using --production mode, the script automatically includes
    docker-compose.production.yml if it exists. This overlay provides:
      - PostgreSQL SSL encryption
      - Production-mode service commands (npm start vs npm run dev)
      - Removed volume mounts for immutable containers

    Similarly, --staging will include docker-compose.staging.yml if present.

EOF
}

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

# Defaults
DEFAULT_PORT_OFFSET=0
PORT_OFFSET_OVERRIDE=""
DEPLOYMENT_MODE_OVERRIDE=""
JSON_OUTPUT=false

# Parse arguments
BASE_DOMAIN=""
API_DOMAIN=""
PORTAL_DOMAIN=""
CALENDAR_DOMAIN=""
APPLY=false
SKIP_RESTART=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENV="$2"
            shift 2
            ;;
        --base-domain)
            BASE_DOMAIN="$2"
            shift 2
            ;;
        --api)
            API_DOMAIN="$2"
            shift 2
            ;;
        --portal)
            PORTAL_DOMAIN="$2"
            shift 2
            ;;
        --calendar)
            CALENDAR_DOMAIN="$2"
            shift 2
            ;;
        --port-offset)
            PORT_OFFSET_OVERRIDE="$2"
            shift 2
            ;;
        --dev)
            DEPLOYMENT_MODE_OVERRIDE="dev"
            shift
            ;;
        --staging)
            DEPLOYMENT_MODE_OVERRIDE="staging"
            shift
            ;;
        --production)
            DEPLOYMENT_MODE_OVERRIDE="production"
            shift
            ;;
        --apply)
            APPLY=true
            shift
            ;;
        --skip-restart)
            APPLY=true
            SKIP_RESTART=true
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

# Resolve port offset (CLI > env > default)
if [[ -n "$PORT_OFFSET_OVERRIDE" ]]; then
    PORT_OFFSET="$PORT_OFFSET_OVERRIDE"
else
    PORT_OFFSET="$DEFAULT_PORT_OFFSET"
fi

if ! [[ "$PORT_OFFSET" =~ ^[0-9]+$ ]]; then
    log_error "Invalid --port-offset value: $PORT_OFFSET (must be non-negative integer)"
    exit 1
fi

export PORT_OFFSET

# Load defaults from base.env
BASE_CONFIG_FILE="$CONFIG_DIR/base.env"

if [[ ! -f "$BASE_CONFIG_FILE" ]]; then
    log_error "Base configuration file not found: $BASE_CONFIG_FILE"
    echo ""
    echo "The base.env file should contain default values like domains and OAuth callback paths."
    echo "This file should be version controlled and contain production defaults."
    echo ""
    exit 1
fi

log_info "Loading defaults from $BASE_CONFIG_FILE"

# Source the base config file to load all default variables
set -a  # Automatically export all variables
source "$BASE_CONFIG_FILE"
set +a  # Stop auto-exporting

log_success "Base configuration loaded"

# ============================================================================
# Sanity Check: Validate environment variables against template
# ============================================================================
# Ensures all variables defined in base.env and secrets.env.example are
# present in root.env.template. This prevents configuration drift where
# new variables are added but not properly propagated to containers.

validate_env_template() {
    local TEMPLATE_FILE="$CONFIG_DIR/root.env.template"
    local SECRETS_EXAMPLE_FILE="$CONFIG_DIR/secrets.env.example"

    if [[ ! -f "$TEMPLATE_FILE" ]]; then
        log_error "Template file not found: $TEMPLATE_FILE"
        exit 1
    fi

    log_info "Validating environment variable configuration..."

    # Variables that are intentionally internal-only (used by script, not in template)
    # These are used within configure-domains.sh to compute derived values
    local -a INTERNAL_VARS=(
        # Deployment mode port presets (selected based on DEPLOYMENT_MODE)
        "NGINX_HTTPS_PORT_PRODUCTION"
        "NGINX_HTTP_PORT_PRODUCTION"
        "NGINX_HTTPS_PORT_STAGING"
        "NGINX_HTTP_PORT_STAGING"
        "NGINX_HTTPS_PORT_DEV"
        "NGINX_HTTP_PORT_DEV"
        # Subdomain prefixes (combined with --base-domain to form full domains)
        "API_SUBDOMAIN"
        "PORTAL_SUBDOMAIN"
        "CALENDAR_SUBDOMAIN"
        "DOCS_SUBDOMAIN"
        "TRACKING_SUBDOMAIN"
        "WS_SUBDOMAIN"
        "GET_SUBDOMAIN"
        # Placeholders - generated dynamically by script from domain configuration
        "API_BASE_URL"
        "GRAFANA_ROOT_URL"
        "NEXT_PUBLIC_GRAFANA_URL"
        # NODE_ENV in base.env becomes NODE_ENV_VALUE in template
        "NODE_ENV"
    )

    # Extract variable references from template: ${VAR_NAME}
    local TEMPLATE_VARS
    TEMPLATE_VARS=$(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$TEMPLATE_FILE" | \
                    sed 's/\${//;s/}//' | sort -u)

    local -a MISSING_BASE_VARS=()
    local -a MISSING_SECRET_VARS=()

    # Function to check if variable is internal
    is_internal_var() {
        local var="$1"
        for internal in "${INTERNAL_VARS[@]}"; do
            [[ "$var" == "$internal" ]] && return 0
        done
        return 1
    }

    # Check base.env variables
    while IFS= read -r line; do
        # Skip empty lines and comments
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        # Skip lines without =
        [[ "$line" != *=* ]] && continue

        # Extract variable name (everything before first =)
        local var_name="${line%%=*}"
        # Trim whitespace
        var_name="${var_name#"${var_name%%[![:space:]]*}"}"
        var_name="${var_name%"${var_name##*[![:space:]]}"}"

        # Skip if empty or internal
        [[ -z "$var_name" ]] && continue
        is_internal_var "$var_name" && continue

        # Check if in template
        if ! echo "$TEMPLATE_VARS" | grep -qx "$var_name"; then
            MISSING_BASE_VARS+=("$var_name")
        fi
    done < "$BASE_CONFIG_FILE"

    # Check secrets.env.example variables
    if [[ -f "$SECRETS_EXAMPLE_FILE" ]]; then
        while IFS= read -r line; do
            [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
            [[ "$line" != *=* ]] && continue

            local var_name="${line%%=*}"
            var_name="${var_name#"${var_name%%[![:space:]]*}"}"
            var_name="${var_name%"${var_name##*[![:space:]]}"}"

            [[ -z "$var_name" ]] && continue
            is_internal_var "$var_name" && continue

            if ! echo "$TEMPLATE_VARS" | grep -qx "$var_name"; then
                MISSING_SECRET_VARS+=("$var_name")
            fi
        done < "$SECRETS_EXAMPLE_FILE"
    else
        log_warning "secrets.env.example not found at: $SECRETS_EXAMPLE_FILE"
        log_warning "Skipping secrets template validation"
    fi

    # Report errors
    if [[ ${#MISSING_BASE_VARS[@]} -gt 0 || ${#MISSING_SECRET_VARS[@]} -gt 0 ]]; then
        echo ""
        log_error "Environment variable validation failed!"
        echo ""

        if [[ ${#MISSING_BASE_VARS[@]} -gt 0 ]]; then
            echo -e "${RED}Variables in base.env missing from root.env.template:${NC}"
            for var in "${MISSING_BASE_VARS[@]}"; do
                echo "  - $var"
            done
            echo ""
        fi

        if [[ ${#MISSING_SECRET_VARS[@]} -gt 0 ]]; then
            echo -e "${RED}Variables in secrets.env.example missing from root.env.template:${NC}"
            for var in "${MISSING_SECRET_VARS[@]}"; do
                echo "  - $var"
            done
            echo ""
        fi

        echo "To fix this issue:"
        echo "  1. Add missing variables to: $TEMPLATE_FILE"
        echo "     Example: VARIABLE_NAME=\${VARIABLE_NAME}"
        echo ""
        echo "  2. Export them in configure-domains.sh (lines ~600-830)"
        echo "     Example: export VARIABLE_NAME"
        echo ""
        echo "  3. If the variable is intentionally internal-only, add it to"
        echo "     the INTERNAL_VARS array in the validate_env_template function."
        echo ""
        exit 1
    fi

    log_success "Environment variable configuration validated"
}

# Run the validation
validate_env_template

# =========================================================================
# Deployment Mode Resolution
# =========================================================================
# REQUIRED: Must explicitly specify --dev, --staging, or --production flag
# This ensures the correct environment-specific secrets file is loaded.

if [[ -z "$DEPLOYMENT_MODE_OVERRIDE" ]]; then
    log_error "Deployment mode flag is required!"
    echo ""
    echo "You must specify one of the following flags:"
    echo "  ${YELLOW}--dev${NC}         Development mode (nginx on port 8443, loads secrets.dev.env)"
    echo "  ${YELLOW}--staging${NC}     Staging mode (nginx on port 9443, loads secrets.staging.env)"
    echo "  ${YELLOW}--production${NC}  Production mode (nginx on port 443, loads secrets.prod.env)"
    echo ""
    echo "Example:"
    echo "  ${YELLOW}./scripts/configure-domains.sh --base-domain yourdomain.com --dev --apply${NC}"
    echo ""
    echo "Each deployment mode loads its own secrets file (secrets.{mode}.env) which must"
    echo "contain all required secrets for that environment."
    echo ""
    exit 1
fi

DEPLOYMENT_MODE="$DEPLOYMENT_MODE_OVERRIDE"

# Validate deployment mode value
case "$DEPLOYMENT_MODE" in
    production|staging|dev)
        ;;
    *)
        log_error "Invalid DEPLOYMENT_MODE: $DEPLOYMENT_MODE (valid: production, staging, dev)"
        exit 1
        ;;
esac

log_info "Deployment mode: $DEPLOYMENT_MODE"

# Select port preset based on deployment mode
case "$DEPLOYMENT_MODE" in
    production)
        NGINX_HTTPS_PORT="${NGINX_HTTPS_PORT_PRODUCTION}"
        NGINX_HTTP_PORT="${NGINX_HTTP_PORT_PRODUCTION}"
        ;;
    staging)
        NGINX_HTTPS_PORT="${NGINX_HTTPS_PORT_STAGING}"
        NGINX_HTTP_PORT="${NGINX_HTTP_PORT_STAGING}"
        ;;
    dev)
        NGINX_HTTPS_PORT="${NGINX_HTTPS_PORT_DEV}"
        NGINX_HTTP_PORT="${NGINX_HTTP_PORT_DEV}"
        ;;
esac

# Compute URL port suffix (empty for standard 443, otherwise :PORT)
if [[ "$NGINX_HTTPS_PORT" == "443" ]]; then
    URL_PORT_SUFFIX=""
else
    URL_PORT_SUFFIX=":${NGINX_HTTPS_PORT}"
fi

export DEPLOYMENT_MODE
export NGINX_HTTPS_PORT
export NGINX_HTTP_PORT
export URL_PORT_SUFFIX

# Apply port offset (CLI only; defaults to zero)
if (( PORT_OFFSET != 0 )); then
    log_info "Applying port offset of ${PORT_OFFSET} to exposed service ports"

    # List of ports to offset (excludes infrastructure ports like PostgreSQL, Redis)
    OFFSET_PORTS=("API_PORT" "AUTH_PORT" "PORTAL_PORT" "CALENDAR_PORT" "WHISPER_PORT" "LLM_PORT" "GRAFANA_PORT" "LOKI_PORT" "LOGS_PORT" "DOCKER_MANAGER_PORT")

    for PORT_VAR in "${OFFSET_PORTS[@]}"; do
        # Get current value
        CURRENT_VALUE="${!PORT_VAR}"

        # Skip if not set
        if [[ -z "$CURRENT_VALUE" ]]; then
            continue
        fi

        # Validate it's numeric
        if ! [[ "$CURRENT_VALUE" =~ ^[0-9]+$ ]]; then
            log_error "${PORT_VAR} '$CURRENT_VALUE' is not numeric; cannot apply port offset"
            exit 1
        fi

        # Calculate new port
        NEW_PORT=$(( CURRENT_VALUE + PORT_OFFSET ))

        # Validate port range
        if (( NEW_PORT > 65535 )); then
            log_error "${PORT_VAR} would exceed 65535 after offset (${CURRENT_VALUE} + ${PORT_OFFSET})"
            exit 1
        fi

        # Update the variable
        eval "$PORT_VAR=$NEW_PORT"
        log_info "  ${PORT_VAR}: ${CURRENT_VALUE} → ${NEW_PORT}"
    done
fi

# Require --base-domain flag (no fallback allowed)
if [[ -z "$BASE_DOMAIN" ]]; then
    log_error "--base-domain flag is required"
    echo ""
    echo "The --base-domain flag must be provided to generate domain configuration."
    echo "No default base domain is configured to ensure explicit domain selection."
    echo ""
    echo "Example usage:"
    echo -e "  ${YELLOW}./configure-domains.sh --base-domain yourdomain.com --apply${NC}"
    echo ""
    echo "This will generate:"
    echo "  • API: ${API_SUBDOMAIN}.yourdomain.com"
    echo "  • Portal: ${PORTAL_SUBDOMAIN}.yourdomain.com"
    echo "  • Calendar: ${CALENDAR_SUBDOMAIN}.yourdomain.com"
    echo ""
    exit 1
fi

# Generate subdomains using prefixes from base.env
[[ -z "$API_DOMAIN" ]] && API_DOMAIN="${API_SUBDOMAIN}.$BASE_DOMAIN"
[[ -z "$PORTAL_DOMAIN" ]] && PORTAL_DOMAIN="${PORTAL_SUBDOMAIN}.$BASE_DOMAIN"
[[ -z "$CALENDAR_DOMAIN" ]] && CALENDAR_DOMAIN="${CALENDAR_SUBDOMAIN}.$BASE_DOMAIN"
WS_DOMAIN="${WS_SUBDOMAIN}.$BASE_DOMAIN"
GET_DOMAIN="${GET_SUBDOMAIN}.$BASE_DOMAIN"
DOCS_DOMAIN="${DOCS_SUBDOMAIN}.$BASE_DOMAIN"

# Generate Grafana URLs (accessed via nginx proxy at /grafana/)
GRAFANA_ROOT_URL="https://${PORTAL_DOMAIN}${URL_PORT_SUFFIX}/grafana"
NEXT_PUBLIC_GRAFANA_URL="https://${PORTAL_DOMAIN}${URL_PORT_SUFFIX}/grafana"

# Export all domain variables
export BASE_DOMAIN
export API_DOMAIN
export PORTAL_DOMAIN
export CALENDAR_DOMAIN
export WS_DOMAIN
export GET_DOMAIN
export DOCS_DOMAIN

# Show what will be used
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW} Configuration Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "  ${YELLOW}Environment:${NC}     $ENV"
echo -e "  ${YELLOW}Deployment Mode:${NC} $DEPLOYMENT_MODE"
echo -e "  ${YELLOW}Port Offset:${NC}     $PORT_OFFSET"
echo ""
echo -e "${YELLOW}Nginx External Ports:${NC}"
echo -e "  ${YELLOW}HTTP:${NC}            $NGINX_HTTP_PORT"
echo -e "  ${YELLOW}HTTPS:${NC}           $NGINX_HTTPS_PORT"
if [[ -n "$URL_PORT_SUFFIX" ]]; then
    echo -e "  ${YELLOW}URL Suffix:${NC}      $URL_PORT_SUFFIX (included in OAuth URLs)"
fi
echo ""
echo -e "${YELLOW}Domains:${NC}"
echo -e "  ${YELLOW}API:${NC}             $API_DOMAIN"
echo -e "  ${YELLOW}Portal:${NC}          $PORTAL_DOMAIN"
echo -e "  ${YELLOW}Calendar:${NC}        $CALENDAR_DOMAIN"
echo -e "  ${YELLOW}WebSocket:${NC}       $WS_DOMAIN"
echo -e "  ${YELLOW}Downloads:${NC}       $GET_DOMAIN"
echo -e "  ${YELLOW}Docs:${NC}            $DOCS_DOMAIN"
echo ""
echo -e "${YELLOW}Service Ports:${NC}"
echo -e "  ${YELLOW}API/Gateway:${NC}     $API_PORT"
echo -e "  ${YELLOW}Auth:${NC}            $AUTH_PORT"
echo -e "  ${YELLOW}Portal:${NC}          $PORTAL_PORT"
echo -e "  ${YELLOW}Calendar:${NC}        $CALENDAR_PORT"
echo -e "  ${YELLOW}Whisper:${NC}         $WHISPER_PORT"
echo -e "  ${YELLOW}LLM:${NC}             $LLM_PORT"
echo -e "  ${YELLOW}Grafana:${NC}         $GRAFANA_PORT"
echo -e "  ${YELLOW}Loki:${NC}            $LOKI_PORT"
echo -e "  ${YELLOW}Logs:${NC}            $LOGS_PORT"
echo -e "  ${YELLOW}Docker Manager:${NC}  $DOCKER_MANAGER_PORT"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

if [[ "$APPLY" == true ]]; then
    log_info "Applying configuration..."

    # Set environment variable for config loading
    export NOTELY_CONFIG_ENV=$ENV

    # Change to directory
    cd "$DIR"

    # =========================================================================
    # Compose File Selection Based on Deployment Mode
    # =========================================================================
    COMPOSE_FILES="-f docker-compose.yml"
    if [[ "$DEPLOYMENT_MODE" == "production" ]]; then
        if [[ -f "docker-compose.production.yml" ]]; then
            COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.production.yml"
            log_info "Using production overlay: docker-compose.production.yml"
        else
            log_warning "Production mode but docker-compose.production.yml not found"
            log_warning "Production-specific settings (SSL, npm start) will not be applied"
        fi
    elif [[ "$DEPLOYMENT_MODE" == "staging" ]]; then
        if [[ -f "docker-compose.staging.yml" ]]; then
            COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.staging.yml"
            log_info "Using staging overlay: docker-compose.staging.yml"
        fi
    fi
    export COMPOSE_FILES

    # Determine NODE_ENV based on NOTELY_CONFIG_ENV
    NODE_ENV_VALUE="development"
    case "$ENV" in
        production)
            NODE_ENV_VALUE="production"
            ;;
        staging)
            NODE_ENV_VALUE="production"
            ;;
        local|*)
            NODE_ENV_VALUE="development"
            ;;
    esac

    # =========================================================================
    # Load Environment-Specific Secrets (Required)
    # =========================================================================
    # Each deployment mode has its own secrets file containing ALL secrets:
    # - secrets.dev.env     → Development (--dev)
    # - secrets.staging.env → Staging (--staging)
    # - secrets.prod.env    → Production (--production)
    #
    # There is NO fallback - you must have the correct secrets file for your
    # deployment mode. This ensures complete environment isolation.

    SECRETS_FILE=""
    case "$DEPLOYMENT_MODE" in
        production)
            SECRETS_FILE="$CONFIG_DIR/secrets.prod.env"
            ;;
        staging)
            SECRETS_FILE="$CONFIG_DIR/secrets.staging.env"
            ;;
        dev)
            SECRETS_FILE="$CONFIG_DIR/secrets.dev.env"
            ;;
    esac

    if [[ ! -f "$SECRETS_FILE" ]]; then
        log_error "Secrets file not found: $SECRETS_FILE"
        echo ""
        echo "Each deployment mode requires its own secrets file."
        echo "You are running in ${YELLOW}$DEPLOYMENT_MODE${NC} mode, which requires:"
        echo ""
        echo "  ${YELLOW}$SECRETS_FILE${NC}"
        echo ""
        echo "To create it, copy the example template:"
        echo ""
        echo "  cp $CONFIG_DIR/secrets.${DEPLOYMENT_MODE}.env.example $SECRETS_FILE"
        echo "  # Edit $SECRETS_FILE with your actual secrets"
        echo ""
        exit 1
    fi

    log_info "Loading $DEPLOYMENT_MODE secrets from $SECRETS_FILE"

    # Source the secrets file
    set -a
    source "$SECRETS_FILE"
    set +a

    log_success "Secrets loaded for $DEPLOYMENT_MODE environment"

    # =========================================================================
    # Validate Microsoft OAuth Configuration
    # =========================================================================
    # Warn if Microsoft OAuth is not configured for this environment.
    # This is a warning (not an error) since Microsoft OAuth is optional.

    if [[ -z "$MICROSOFT_CLIENT_ID" ]] || [[ "$MICROSOFT_CLIENT_ID" == *"your_"* ]] || [[ "$MICROSOFT_CLIENT_ID" == *"placeholder"* ]]; then
        log_warning "MICROSOFT_CLIENT_ID not configured for $DEPLOYMENT_MODE mode"
        echo "  Microsoft OAuth login will not work until configured."
        echo "  Edit: $SECRETS_FILE"
        echo ""
    fi

    # Validate critical secrets
    SECRETS_MISSING=false

    if [[ -z "$JWT_SECRET" ]]; then
        log_error "JWT_SECRET not found in secrets.env"
        SECRETS_MISSING=true
    fi

    if [[ -z "$JWT_PRIVATE_KEY" ]]; then
        log_error "JWT_PRIVATE_KEY not found in secrets.env"
        SECRETS_MISSING=true
    fi

    if [[ -z "$JWT_PUBLIC_KEY" ]]; then
        log_error "JWT_PUBLIC_KEY not found in secrets.env"
        SECRETS_MISSING=true
    fi

    if [[ -z "$POSTGRES_PASSWORD" ]]; then
        log_error "POSTGRES_PASSWORD not found in secrets.env"
        SECRETS_MISSING=true
    fi

    if [[ "$SECRETS_MISSING" == true ]]; then
        echo ""
        log_error "Required secrets are missing from $SECRETS_FILE!"
        exit 1
    fi

    log_success "All required secrets loaded successfully"

    # =========================================================================
    # Secret Age and Strength Validation
    # =========================================================================

    log_info "Validating secret age and strength..."

    # Check file age (warn if > 90 days old)
    if [[ -f "$SECRETS_FILE" ]]; then
        FILE_AGE_DAYS=$(( ($(date +%s) - $(stat -c %Y "$SECRETS_FILE" 2>/dev/null || stat -f %m "$SECRETS_FILE" 2>/dev/null)) / 86400 ))

        if (( FILE_AGE_DAYS > 90 )); then
            log_warning "secrets.env is $FILE_AGE_DAYS days old (last modified: $(date -r "$SECRETS_FILE" 2>/dev/null || stat -f %Sm "$SECRETS_FILE" 2>/dev/null))"
            echo ""
            echo "  ${YELLOW}Security Recommendation:${NC} Rotate secrets quarterly"
            echo "  Run: ${BLUE}./scripts/generate-secrets.sh --missing-only${NC}"
            echo ""
        elif (( FILE_AGE_DAYS > 60 )); then
            log_warning "secrets.env is $FILE_AGE_DAYS days old - consider rotating soon"
        else
            log_success "secrets.env age: $FILE_AGE_DAYS days (fresh)"
        fi
    fi

    # Validate JWT_SECRET strength
    JWT_SECRET_LENGTH=${#JWT_SECRET}
    if (( JWT_SECRET_LENGTH < 32 )); then
        log_error "JWT_SECRET is too short ($JWT_SECRET_LENGTH chars)"
        echo ""
        echo "  Security requirement: JWT_SECRET must be at least 32 characters"
        echo "  Recommended: 64 characters (32 bytes hex)"
        echo ""
        echo "  Generate new secret: ${BLUE}./scripts/generate-secrets.sh${NC}"
        echo ""
        exit 1
    elif (( JWT_SECRET_LENGTH < 64 )); then
        log_warning "JWT_SECRET is short ($JWT_SECRET_LENGTH chars) - recommend 64+ chars"
    else
        log_success "JWT_SECRET length: $JWT_SECRET_LENGTH chars ✓"
    fi

    # Validate ENCRYPTION_KEY strength
    if [[ -n "$ENCRYPTION_KEY" ]]; then
        ENCRYPTION_KEY_LENGTH=${#ENCRYPTION_KEY}
        if (( ENCRYPTION_KEY_LENGTH < 64 )); then
            log_error "ENCRYPTION_KEY is too short ($ENCRYPTION_KEY_LENGTH chars)"
            echo ""
            echo "  Security requirement: ENCRYPTION_KEY must be at least 64 characters"
            echo "  Recommended: 128 characters (64 bytes hex)"
            echo ""
            echo "  Generate new key: ${BLUE}./scripts/generate-secrets.sh${NC}"
            echo ""
            exit 1
        elif (( ENCRYPTION_KEY_LENGTH < 128 )); then
            log_warning "ENCRYPTION_KEY is short ($ENCRYPTION_KEY_LENGTH chars) - recommend 128+ chars"
        else
            log_success "ENCRYPTION_KEY length: $ENCRYPTION_KEY_LENGTH chars ✓"
        fi
    fi

    # Check for placeholder values
    PLACEHOLDERS_FOUND=false

    if [[ "$POSTGRES_PASSWORD" == *"your_"* ]] || [[ "$POSTGRES_PASSWORD" == *"placeholder"* ]]; then
        log_error "POSTGRES_PASSWORD contains placeholder value"
        PLACEHOLDERS_FOUND=true
    fi

    if [[ "$JWT_SECRET" == *"your_"* ]] || [[ "$JWT_SECRET" == *"placeholder"* ]] || [[ "$JWT_SECRET" == *"secret_here"* ]]; then
        log_error "JWT_SECRET contains placeholder value"
        PLACEHOLDERS_FOUND=true
    fi

    if [[ "$JWT_PRIVATE_KEY" == *"replace_with"* ]] || [[ "$JWT_PRIVATE_KEY" == "" ]]; then
        log_error "JWT_PRIVATE_KEY contains placeholder value"
        PLACEHOLDERS_FOUND=true
    fi

    if [[ "$JWT_PUBLIC_KEY" == *"replace_with"* ]] || [[ "$JWT_PUBLIC_KEY" == "" ]]; then
        log_error "JWT_PUBLIC_KEY contains placeholder value"
        PLACEHOLDERS_FOUND=true
    fi

    # Validate database password strength (should be 20+ chars for auto-generated)
    POSTGRES_PASSWORD_LENGTH=${#POSTGRES_PASSWORD}
    if (( POSTGRES_PASSWORD_LENGTH < 20 )); then
        log_warning "POSTGRES_PASSWORD is short ($POSTGRES_PASSWORD_LENGTH chars) - recommend 40+ chars"
    fi

    if [[ "$PLACEHOLDERS_FOUND" == true ]]; then
        echo ""
        log_error "Placeholder values found in secrets.env!"
        echo ""
        echo "  Please run: ${BLUE}./scripts/generate-secrets.sh${NC}"
        echo ""
        exit 1
    fi

    log_success "Secret validation passed"

    # Delete existing .env file to ensure fresh generation
    if [[ -f .env ]]; then
        log_info "Removing existing .env file..."
        rm -f .env
    fi

    # Generate root .env file for Docker Compose
    log_info "Generating Docker Compose .env file..."

    # Export all variables needed by the template
    export GENERATION_TIMESTAMP="$(date -u +"%Y-%m-%d %H:%M:%S UTC")"
    export ENV
    export NODE_ENV_VALUE

    # Export all base.env variables
    export API_PORT
    export API_HOST
    export AUTH_PORT
    export USERS_PORT
    export ADMIN_CONFIG_PORT
    export ADMIN_DATABASE_PORT
    export PORTAL_PORT
    export CALENDAR_PORT
    export WHISPER_PORT
    export LLM_PORT
    export GRAFANA_PORT
    export LOKI_PORT
    export LOGS_PORT
    export LICENSE_PORT
    export SUMMARIES_PORT
    export SUPPORT_PORT
    export DOCKER_MANAGER_PORT
    export EMAIL_PORT
    export POSTGRES_DB
    export POSTGRES_USER
    export POSTGRES_HOST
    export POSTGRES_PORT
    export POSTGRES_AUTH_USER
    export POSTGRES_AUTH_PASSWORD
    export POSTGRES_USERS_USER
    export POSTGRES_USERS_PASSWORD
    export POSTGRES_CALENDAR_USER
    export POSTGRES_CALENDAR_PASSWORD
    export POSTGRES_MEETINGS_USER
    export POSTGRES_MEETINGS_PASSWORD
    export POSTGRES_TRANSCRIPTS_USER
    export POSTGRES_TRANSCRIPTS_PASSWORD
    export POSTGRES_NOTES_USER
    export POSTGRES_NOTES_PASSWORD
    export POSTGRES_SUMMARIES_USER
    export POSTGRES_SUMMARIES_PASSWORD
    export POSTGRES_ADMIN_SERVICE_USER
    export POSTGRES_ADMIN_SERVICE_PASSWORD
    export POSTGRES_ACTIONS_USER
    export POSTGRES_ACTIONS_PASSWORD
    export POSTGRES_PORTAL_USER
    export POSTGRES_PORTAL_PASSWORD
    export POSTGRES_SUPPORT_USER
    export POSTGRES_SUPPORT_PASSWORD
    export POSTGRES_EMAIL_USER
    export POSTGRES_EMAIL_PASSWORD
    export ADMIN_DATABASE_ALLOWED_SCHEMAS
    export ADMIN_DATABASE_DEFAULT_DB
    export ADMIN_DATABASE_MAX_PAGE_SIZE
    export ADMIN_DATABASE_DEFAULT_PAGE_SIZE
    export REDIS_HOST
    export REDIS_PORT
    export REDIS_DB
    export REDIS_KEY_PREFIX
    export DB_POOL_MAX
    export DB_POOL_MIN
    export DB_POOL_IDLE_TIMEOUT_MS
    export DB_POOL_CONNECTION_TIMEOUT_MS
    export DB_POOL_ACQUIRE_TIMEOUT_MS
    export DB_STATEMENT_TIMEOUT_MS
    export DB_QUERY_TIMEOUT_MS
    export REDIS_MAX_RETRIES
    export REDIS_CONNECT_TIMEOUT_MS
    export REDIS_COMMAND_TIMEOUT_MS
    export CACHE_TTL_SHORT
    export CACHE_TTL_MEDIUM
    export CACHE_TTL_LONG
    export CACHE_TTL_USER_PROFILE
    export CACHE_TTL_CALENDAR_EVENTS
    export CACHE_TTL_MEETINGS
    export CACHE_ENABLED
    export CACHE_KEY_PREFIX
    export RATE_LIMIT_WINDOW_MS
    export RATE_LIMIT_MAX_REQUESTS
    export RATE_LIMIT_AUTH_MAX
    export RATE_LIMIT_AUTH_WINDOW_MS
    export RATE_LIMIT_API_MAX
    export RATE_LIMIT_API_WINDOW_MS
    export RATE_LIMIT_REDIS_ENABLED
    export RATE_LIMIT_WHITELIST_IPS
    export LOG_LEVEL
    export LOG_FORMAT
    export LOG_TIMESTAMP
    export LOG_REQUESTS
    export LOG_RESPONSES
    export LOG_SLOW_REQUESTS
    export LOG_SLOW_THRESHOLD_MS
    export LOG_REDACT_FIELDS
    export JWT_SECRET
    export JWT_PRIVATE_KEY
    export JWT_PUBLIC_KEY
    export JWT_KEY_ID
    export JWT_EXPIRES_IN
    export ENCRYPTION_KEY
    export CORS_ENABLED
    export CORS_ORIGIN
    export CORS_CREDENTIALS
    export SESSION_TTL_SECONDS
    export SESSION_COOKIE_NAME
    export SESSION_SECURE
    export SECURITY_HEADERS_ENABLED
    export SECURITY_HSTS_ENABLED
    export SECURITY_CSP_ENABLED
    export INPUT_VALIDATION_ENABLED
    export INPUT_SANITIZATION_ENABLED
    export HTTP_CLIENT_TIMEOUT_MS
    export HTTP_CLIENT_RETRY_MAX
    export HTTP_CLIENT_RETRY_DELAY_MS
    export GRAPH_API_TIMEOUT_MS
    export GRAPH_API_RETRY_MAX
    export GOOGLE_API_TIMEOUT_MS
    export GOOGLE_API_RETRY_MAX
    export WHISPER_API_TIMEOUT_MS
    export WHISPER_API_RETRY_MAX
    export LLM_API_TIMEOUT_MS
    export LLM_API_RETRY_MAX
    export SHUTDOWN_TIMEOUT_MS
    export SHUTDOWN_DRAIN_REQUESTS
    export HEALTH_CHECK_ENABLED
    export HEALTH_CHECK_DB_ENABLED
    export HEALTH_CHECK_REDIS_ENABLED
    export SERVICE_API_INTERNAL_URL
    export SERVICE_PORTAL_INTERNAL_URL
    export SERVICE_CALENDAR_INTERNAL_URL
    export SERVICE_WHISPER_URL
    export SERVICE_LLM_URL
    export LOGS_SERVICE_URL
    export LICENSE_SERVICE_URL
    export SUMMARIES_SERVICE_URL
    export SUPPORT_SERVICE_URL
    export LLM_GATEWAY_URL
    export OAUTH_MICROSOFT_AUTH_PATH
    export OAUTH_MICROSOFT_CALENDAR_PATH
    export OAUTH_MICROSOFT_OUTLOOK_PATH
    export OAUTH_GOOGLE_AUTH_PATH
    export OAUTH_GOOGLE_CALENDAR_PATH
    export OAUTH_GOOGLE_DESKTOP_AUTH_PATH
    export AUTH_DESKTOP_STATE_TTL_SECONDS
    export AUTH_DESKTOP_LOGIN_TEMPLATE_VERSION
    export AUTH_DESKTOP_DEFAULT_SCOPE
    export CALENDAR_AUTO_SYNC_ENABLED
    export CALENDAR_AUTO_SYNC_CRON
    export CALENDAR_SYNC_MAX_USERS_PER_RUN
    export CALENDAR_SYNC_USER_DELAY
    export CALENDAR_SYNC_THROTTLE_BACKOFF
    export TEAMS_DEFAULT_JOIN_MODE
    export USE_ACS_BY_DEFAULT
    export TEAMS_JOIN_MAX_ATTEMPTS
    export TEAMS_JOIN_LEAD_SECONDS
    export TEAMS_JOIN_CLAIM_HOLD_MINUTES
    export TEAMS_JOIN_STALE_MINUTES
    export TEAMS_CALLBACK_TOKEN_TTL_MINUTES
    export ACS_DISPLAY_PREFIX_DEFAULT
    export ACS_CAPTIONS_LANG
    export ACS_TOKEN_TTL_MINUTES
    export ACS_FROM_NUMBER
    export ACS_TRANSCRIPTION_LOCALE
    export ACS_JOINER_CALLBACK_URI
    export ACS_JOINER_WEBHOOK_SECRET
    export ACS_JOINER_MAX_CONCURRENT_JOBS
    export ACS_JOINER_POLL_SECONDS
    export ACS_JOINER_PUBLIC_BASE_URL
    export ACS_CAPTION_SEGMENT_LIMIT
    export ACS_JOINER_FORWARD_URL
    export ACS_JOINER_FORWARD_TIMEOUT_MS
    export ACS_JOINER_LOG_LEVEL
    export LOKI_RETENTION_DAYS
    export LOKI_BASE_URL
    export GRAFANA_ADMIN_USER
    export GRAFANA_ADMIN_PASSWORD
    export GRAFANA_ROOT_URL
    export NEXT_PUBLIC_GRAFANA_URL
    export GRAFANA_INTERNAL_URL
    export NODE_OPTIONS

    # Export deployment mode configuration
    export DEPLOYMENT_MODE
    export NGINX_HTTPS_PORT
    export NGINX_HTTP_PORT
    export URL_PORT_SUFFIX

    # Export WebSocket Gateway configuration
    export WS_SUBDOMAIN
    export WS_DOMAIN
    export WS_GATEWAY_PORT
    export WS_HEARTBEAT_INTERVAL_MS
    export WS_MAX_CONNECTIONS_PER_USER

    # Export all secrets from secrets.env
    export POSTGRES_PASSWORD
    export REDIS_PASSWORD
    export MICROSOFT_CLIENT_ID
    export MICROSOFT_CLIENT_SECRET
    export MICROSOFT_TENANT
    export MICROSOFT_OIDC_SCOPE
    export MAIL_APP_CLIENT_ID
    export MAIL_APP_CLIENT_SECRET
    export MAIL_TENANT_ID
    export EMAIL_FROM
    export EMAIL_FROM_NAME
    export MICROSOFT_SENDER_EMAIL
    export GOOGLE_CLIENT_ID
    export GOOGLE_CLIENT_SECRET
    export GOOGLE_REDIRECT_URI
    export HUGGINGFACE_TOKEN
    export PIP_INDEX_URL
    export PIP_EXTRA_INDEX_URL
    export PIP_TRUSTED_HOST
    export CUSTOM_CA_PEM
    export ACS_ENDPOINT
    export ACS_RESOURCE_ID
    export ACS_CONNECTION_STRING
    export ACS_SERVICE_ACCOUNT_EMAIL
    export ACS_SERVICE_ACCOUNT_PASSWORD
    export ACS_IDENTITY_CLIENT_ID
    export ACS_IDENTITY_CLIENT_SECRET
    export ACS_IDENTITY_TENANT_ID
    export ACS_SERVICE_ACCOUNT_OBJECT_ID
    export TEAMS_ACS_CALLBACK_SECRET

    # Export service-to-service authentication keys
    export GATEWAY_SERVICE_API_KEY
    export INTERNAL_API_KEY
    export SYNC_ADMIN_API_KEY
    export BACKUP_ENCRYPTION_KEY

    # Export signed download URL key
    export RELEASES_SIGNING_KEY

    # Export CrowdSec configuration
    export CROWDSEC_API_KEY
    export CROWDSEC_BOUNCER_API_KEY

    # Export Diagnostics Analysis Service
    export ANALYSIS_SERVICE_API_KEY

    # Export Google reCAPTCHA configuration
    export RECAPTCHA_SECRET_KEY

    # Export SSL configuration
    export SSL_MODE
    export SSL_CERT_PATH
    export SSL_KEY_PATH
    export LETSENCRYPT_EMAIL
    export LETSENCRYPT_STAGING

    # Use envsubst to generate .env from template
    if command -v envsubst &> /dev/null; then
        envsubst < "$CONFIG_DIR/root.env.template" > .env
    else
        log_error "envsubst not found. Please install gettext package."
        exit 1
    fi

    log_success "Generated .env file"

    # Restart api service unless skip-restart flag is set
    if [[ "$SKIP_RESTART" != true ]]; then
        log_info "Restarting api service..."

        # Check if docker compose is available
        if ! command -v docker &> /dev/null; then
            log_error "Docker is not installed or not in PATH"
            exit 1
        fi

        # Recreate containers that depend on configuration
        log_info "  → Recreating services..."

        # Try to recreate auth service if it exists
        docker compose $COMPOSE_FILES ps auth &>/dev/null && {
            docker compose $COMPOSE_FILES up -d --force-recreate --no-deps auth 2>&1 || {
                log_warning "Failed to restart auth service"
            }
        }

        # Try to recreate gateway service if it exists
        docker compose $COMPOSE_FILES ps gateway &>/dev/null && {
            docker compose $COMPOSE_FILES up -d --force-recreate --no-deps gateway 2>&1 || {
                log_warning "Failed to restart gateway service"
            }
        }

        # Try to recreate logs service if it exists
        docker compose $COMPOSE_FILES ps logs &>/dev/null && {
            docker compose $COMPOSE_FILES up -d --force-recreate --no-deps logs 2>&1 || {
                log_warning "Failed to restart logs service"
            }
        }

        log_success "Configuration applied successfully!"

        echo ""
        log_info "Next steps:"
        echo "  1. Ensure all services are defined in docker-compose.yml"
        echo "  2. Run: docker compose $COMPOSE_FILES up -d --build"
        echo "  3. Test auth: curl http://localhost:3201/health"
        echo "  4. Test gateway: curl http://localhost:3200/health"
    else
        log_warning "Service restart skipped (--skip-restart flag set)"
    fi

    echo ""
    log_success "Configuration applied successfully!"
    echo ""
    log_info "API will be available at:"
    echo "  • https://$API_DOMAIN (via nginx)"
    echo "  • http://localhost:3100 (direct)"
    echo ""

else
    echo ""
    log_warning "Configuration file created but NOT applied."
    echo ""

    # Determine compose files for display
    COMPOSE_CMD="docker compose"
    if [[ "$DEPLOYMENT_MODE" == "production" ]] && [[ -f "$DIR/docker-compose.production.yml" ]]; then
        COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.production.yml"
    fi

    echo "To apply these changes manually, run:"
    echo ""
    echo -e "  ${YELLOW}export NOTELY_CONFIG_ENV=$ENV${NC}"
    echo -e "  ${YELLOW}cd $DIR${NC}"
    echo -e "  ${YELLOW}$COMPOSE_CMD up -d --force-recreate${NC}"
    echo ""
    echo -e "Or run this script with ${YELLOW}--apply${NC} flag:"
    echo -e "  ${YELLOW}$0 --environment $ENV --apply${NC}"
    echo ""
fi

# Output JSON if requested (for installer API)
if [[ "$JSON_OUTPUT" == true ]]; then
    cat << EOF
{
  "success": true,
  "baseDomain": "$BASE_DOMAIN",
  "deploymentMode": "$DEPLOYMENT_MODE",
  "domains": {
    "api": "$API_DOMAIN",
    "portal": "$PORTAL_DOMAIN",
    "calendar": "$CALENDAR_DOMAIN",
    "ws": "$WS_DOMAIN",
    "get": "$GET_DOMAIN",
    "docs": "$DOCS_DOMAIN"
  },
  "ports": {
    "https": $NGINX_HTTPS_PORT,
    "http": $NGINX_HTTP_PORT
  },
  "urlPortSuffix": "$URL_PORT_SUFFIX",
  "applied": $APPLY
}
EOF
fi
