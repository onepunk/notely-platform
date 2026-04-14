#!/bin/bash
################################################################################
# Notely Platform - Installation Script
#
# Provides multiple installation modes:
#   - Interactive (default): Launch web-based installation wizard
#   - CLI: Automated installation from configuration file
#   - Skip installer: Use existing configuration
#
# Usage:
#   ./install.sh                              # Interactive web wizard
#   ./install.sh --cli --config config.json   # Headless/CI mode
#   ./install.sh --skip-installer             # Use existing .env
#
################################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Default configuration
INSTALLER_PORT="${INSTALLER_PORT:-9000}"
INSTALLER_TIMEOUT="${INSTALLER_TIMEOUT:-30}"
CLI_MODE=false
CONFIG_FILE=""
SKIP_INSTALLER=false
BUILD_UI=true

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
Notely Platform - Installation Script

USAGE:
    ./install.sh [OPTIONS]

DESCRIPTION:
    Installs and configures the Notely Platform. By default, launches a
    web-based installation wizard on port 9000 for guided setup.

OPTIONS:
    --cli                  Run in CLI mode (non-interactive)
    --config FILE          Configuration file for CLI mode (JSON)
    --skip-installer       Skip installer, use existing .env configuration
    --skip-ui-build        Skip building the installer UI
    --port PORT            Installer web interface port (default: 9000)
    --timeout MINUTES      Installer inactivity timeout (default: 30)
    -h, --help             Show this help message

MODES:

    Interactive (Default):
        ./install.sh

        Launches a web-based installation wizard. Open your browser to
        https://<server-ip>:9000 and follow the guided setup process.
        A one-time setup token is displayed in the terminal.

    CLI Mode:
        ./install.sh --cli --config production.json

        Performs automated installation using a JSON configuration file.
        Ideal for CI/CD pipelines and scripted deployments.

        Config file format:
        {
          "baseDomain": "example.com",
          "deploymentMode": "production",
          "generateSecrets": true,
          "oauth": {
            "microsoft": {
              "clientId": "...",
              "clientSecret": "...",
              "tenant": "..."
            }
          }
        }

    Skip Installer:
        ./install.sh --skip-installer

        Skips the installer and starts the platform using existing
        configuration in the .env file. Use after manual configuration.

REQUIREMENTS:
    - Docker Engine 20.10+
    - Docker Compose v2+
    - 4GB+ RAM (8GB recommended)
    - 20GB+ disk space (50GB recommended)
    - Ports 443 and 80 available (or custom ports for dev/staging)

EXAMPLES:
    # First-time setup with web wizard
    ./install.sh

    # Automated production deployment
    ./install.sh --cli --config /path/to/config.json

    # Start platform with existing configuration
    ./install.sh --skip-installer

EOF
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        echo ""
        echo "Please install Docker first:"
        echo "  https://docs.docker.com/engine/install/"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running or you don't have permission"
        echo ""
        echo "Try: sudo systemctl start docker"
        echo "Or add your user to the docker group: sudo usermod -aG docker \$USER"
        exit 1
    fi

    # Check Docker Compose
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available"
        echo ""
        echo "Please install Docker Compose v2:"
        echo "  https://docs.docker.com/compose/install/"
        exit 1
    fi

    log_success "Docker and Docker Compose are available"
}

build_installer_ui() {
    log_info "Building installer UI..."

    cd "$SCRIPT_DIR/services/installer/ui"

    # Check if node_modules exists
    if [[ ! -d "node_modules" ]]; then
        log_info "Installing UI dependencies..."
        npm install --silent
    fi

    # Build the UI
    npm run build --silent

    log_success "Installer UI built successfully"
    cd "$SCRIPT_DIR"
}

start_installer() {
    log_info "Starting installation wizard..."

    # Build UI if needed
    if [[ "$BUILD_UI" == true ]] && [[ -f "services/installer/ui/package.json" ]]; then
        if [[ ! -d "services/installer/ui/dist" ]]; then
            build_installer_ui
        fi
    fi

    # Start the installer container
    INSTALLER_PORT="$INSTALLER_PORT" \
    INSTALLER_TIMEOUT_MINUTES="$INSTALLER_TIMEOUT" \
    docker compose -f docker-compose.installer.yml up --build

    # Installer has exited
    log_info "Installer has shut down"
}

run_cli_install() {
    log_info "Running CLI installation..."

    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_error "Configuration file not found: $CONFIG_FILE"
        exit 1
    fi

    # Parse JSON configuration
    if ! command -v jq &> /dev/null; then
        log_error "jq is required for CLI mode. Install with: apt install jq"
        exit 1
    fi

    BASE_DOMAIN=$(jq -r '.baseDomain // empty' "$CONFIG_FILE")
    DEPLOYMENT_MODE=$(jq -r '.deploymentMode // "production"' "$CONFIG_FILE")
    GENERATE_SECRETS=$(jq -r '.generateSecrets // true' "$CONFIG_FILE")

    if [[ -z "$BASE_DOMAIN" ]]; then
        log_error "baseDomain is required in configuration file"
        exit 1
    fi

    log_info "Base domain: $BASE_DOMAIN"
    log_info "Deployment mode: $DEPLOYMENT_MODE"

    # Generate secrets if requested
    if [[ "$GENERATE_SECRETS" == "true" ]]; then
        log_info "Generating secrets..."
        ./scripts/generate-secrets.sh --force

        # Copy to environment-specific file
        SECRETS_MODE_FILE="config/secrets.${DEPLOYMENT_MODE/production/prod}.env"
        if [[ "$DEPLOYMENT_MODE" == "production" ]]; then
            SECRETS_MODE_FILE="config/secrets.prod.env"
        fi
        cp config/secrets.env "$SECRETS_MODE_FILE"
        log_success "Secrets generated"
    fi

    # Configure domains
    log_info "Configuring domains..."
    ./scripts/configure-domains.sh --base-domain "$BASE_DOMAIN" --"$DEPLOYMENT_MODE" --apply

    # Extract and configure OAuth if provided
    MS_CLIENT_ID=$(jq -r '.oauth.microsoft.clientId // empty' "$CONFIG_FILE")
    if [[ -n "$MS_CLIENT_ID" ]]; then
        log_info "Configuring Microsoft OAuth..."
        MS_CLIENT_SECRET=$(jq -r '.oauth.microsoft.clientSecret' "$CONFIG_FILE")
        MS_TENANT=$(jq -r '.oauth.microsoft.tenant // "common"' "$CONFIG_FILE")

        SECRETS_FILE="config/secrets.${DEPLOYMENT_MODE/production/prod}.env"
        if [[ "$DEPLOYMENT_MODE" == "production" ]]; then
            SECRETS_FILE="config/secrets.prod.env"
        fi

        sed -i "s/MICROSOFT_CLIENT_ID=.*/MICROSOFT_CLIENT_ID=$MS_CLIENT_ID/" "$SECRETS_FILE"
        sed -i "s/MICROSOFT_CLIENT_SECRET=.*/MICROSOFT_CLIENT_SECRET=$MS_CLIENT_SECRET/" "$SECRETS_FILE"
        sed -i "s/MICROSOFT_TENANT=.*/MICROSOFT_TENANT=$MS_TENANT/" "$SECRETS_FILE"
    fi

    # Start the platform
    log_info "Starting Notely Platform..."
    docker compose up -d --build

    log_success "Installation complete!"
    echo ""
    echo "Access your platform at:"
    echo "  https://portal.${BASE_DOMAIN}"
    echo ""
}

skip_and_start() {
    if [[ ! -f ".env" ]]; then
        log_error ".env file not found"
        echo ""
        echo "Run the installer first or create .env manually:"
        echo "  ./install.sh"
        echo ""
        echo "Or run the domain configurator:"
        echo "  ./scripts/configure-domains.sh --base-domain example.com --production --apply"
        exit 1
    fi

    log_info "Starting Notely Platform with existing configuration..."
    docker compose up -d --build

    log_success "Platform started!"
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --cli)
            CLI_MODE=true
            shift
            ;;
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --skip-installer)
            SKIP_INSTALLER=true
            shift
            ;;
        --skip-ui-build)
            BUILD_UI=false
            shift
            ;;
        --port)
            INSTALLER_PORT="$2"
            shift 2
            ;;
        --timeout)
            INSTALLER_TIMEOUT="$2"
            shift 2
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
# Main
# ============================================================================

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}                 ${BOLD}Notely Platform Installer${NC}                       ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
check_docker

# Run appropriate mode
if [[ "$SKIP_INSTALLER" == true ]]; then
    skip_and_start
elif [[ "$CLI_MODE" == true ]]; then
    if [[ -z "$CONFIG_FILE" ]]; then
        log_error "--config FILE is required for CLI mode"
        exit 1
    fi
    run_cli_install
else
    start_installer
fi
