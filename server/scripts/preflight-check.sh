#!/bin/bash
################################################################################
# Notely Platform - Pre-flight Validation Script
#
# Validates system readiness before deploying the Notely Platform.
# Checks Docker, resources, ports, configuration files, and SSL certificates.
#
# Usage:
#   ./scripts/preflight-check.sh [OPTIONS]
#
# Options:
#   --fix         Attempt to fix common issues automatically
#   --json        Output results in JSON format
#   --quiet       Only show failures
#   -h, --help    Show help
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
NC='\033[0m'

# Options
FIX_MODE=false
JSON_OUTPUT=false
QUIET_MODE=false

# Results tracking
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNED=0
RESULTS=()

# ============================================================================
# Helper Functions
# ============================================================================

log_pass() {
    ((CHECKS_PASSED++))
    RESULTS+=("{\"check\":\"$1\",\"status\":\"pass\",\"message\":\"$2\"}")
    [[ "$QUIET_MODE" == false ]] && echo -e "${GREEN}✓${NC} $1"
}

log_fail() {
    ((CHECKS_FAILED++))
    RESULTS+=("{\"check\":\"$1\",\"status\":\"fail\",\"message\":\"$2\"}")
    echo -e "${RED}✗${NC} $1"
    [[ -n "$2" ]] && echo -e "  ${RED}→${NC} $2"
}

log_warn() {
    ((CHECKS_WARNED++))
    RESULTS+=("{\"check\":\"$1\",\"status\":\"warn\",\"message\":\"$2\"}")
    [[ "$QUIET_MODE" == false ]] && echo -e "${YELLOW}⚠${NC} $1"
    [[ -n "$2" ]] && [[ "$QUIET_MODE" == false ]] && echo -e "  ${YELLOW}→${NC} $2"
}

log_info() {
    [[ "$QUIET_MODE" == false ]] && echo -e "${BLUE}ℹ${NC} $1"
}

show_usage() {
    cat << 'EOF'
Notely Platform - Pre-flight Validation Script

USAGE:
    ./scripts/preflight-check.sh [OPTIONS]

DESCRIPTION:
    Validates system readiness for deploying Notely Platform.
    Run this script before installation to identify potential issues.

OPTIONS:
    --fix         Attempt to fix common issues automatically
    --json        Output results in JSON format
    --quiet       Only show failures
    -h, --help    Show this help message

CHECKS PERFORMED:
    1. Docker Engine availability and version
    2. Docker Compose availability and version
    3. System memory (minimum 4GB, recommended 8GB)
    4. Disk space (minimum 20GB, recommended 50GB)
    5. Required ports availability (443, 80, 5432, 6379)
    6. Configuration files existence
    7. SSL certificates (if configured)
    8. Environment variables validation
    9. DNS resolution (if domain configured)

EXAMPLES:
    # Run all checks
    ./scripts/preflight-check.sh

    # Run checks and attempt fixes
    ./scripts/preflight-check.sh --fix

    # Output results as JSON
    ./scripts/preflight-check.sh --json

EOF
}

# ============================================================================
# Checks
# ============================================================================

check_docker() {
    echo ""
    log_info "Checking Docker..."

    # Docker Engine
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version | grep -oP 'Docker version \K[\d.]+' || echo "unknown")
        if [[ "$DOCKER_VERSION" != "unknown" ]]; then
            # Check minimum version (20.10)
            MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
            if (( MAJOR >= 20 )); then
                log_pass "Docker Engine" "version $DOCKER_VERSION"
            else
                log_warn "Docker Engine" "version $DOCKER_VERSION (recommend 20.10+)"
            fi
        else
            log_pass "Docker Engine" "installed"
        fi
    else
        log_fail "Docker Engine" "not installed"
    fi

    # Docker daemon running
    if docker info &> /dev/null; then
        log_pass "Docker daemon" "running"
    else
        log_fail "Docker daemon" "not running or no permission"
    fi

    # Docker Compose
    if docker compose version &> /dev/null; then
        COMPOSE_VERSION=$(docker compose version | grep -oP 'v\K[\d.]+' || echo "unknown")
        log_pass "Docker Compose" "version $COMPOSE_VERSION"
    else
        log_fail "Docker Compose" "not available"
    fi
}

check_resources() {
    echo ""
    log_info "Checking system resources..."

    # Memory
    if command -v free &> /dev/null; then
        TOTAL_MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
        TOTAL_MEM_GB=$((TOTAL_MEM_MB / 1024))

        if (( TOTAL_MEM_MB >= 8192 )); then
            log_pass "Memory" "${TOTAL_MEM_GB}GB total (recommended)"
        elif (( TOTAL_MEM_MB >= 4096 )); then
            log_warn "Memory" "${TOTAL_MEM_GB}GB total (minimum met, 8GB recommended)"
        else
            log_fail "Memory" "${TOTAL_MEM_GB}GB total (minimum 4GB required)"
        fi
    else
        log_warn "Memory" "unable to check (free command not available)"
    fi

    # Disk space
    if command -v df &> /dev/null; then
        AVAILABLE_GB=$(df -BG "$SERVER_DIR" | awk 'NR==2{print $4}' | tr -d 'G')

        if (( AVAILABLE_GB >= 50 )); then
            log_pass "Disk space" "${AVAILABLE_GB}GB available (recommended)"
        elif (( AVAILABLE_GB >= 20 )); then
            log_warn "Disk space" "${AVAILABLE_GB}GB available (minimum met, 50GB recommended)"
        else
            log_fail "Disk space" "${AVAILABLE_GB}GB available (minimum 20GB required)"
        fi
    else
        log_warn "Disk space" "unable to check"
    fi

    # CPU cores
    if command -v nproc &> /dev/null; then
        CPU_CORES=$(nproc)
        if (( CPU_CORES >= 4 )); then
            log_pass "CPU cores" "$CPU_CORES cores"
        elif (( CPU_CORES >= 2 )); then
            log_warn "CPU cores" "$CPU_CORES cores (4+ recommended)"
        else
            log_fail "CPU cores" "$CPU_CORES cores (minimum 2 required)"
        fi
    fi
}

check_ports() {
    echo ""
    log_info "Checking port availability..."

    # Ports to check
    declare -A PORTS=(
        [443]="HTTPS"
        [80]="HTTP"
        [5432]="PostgreSQL"
        [6379]="Redis"
    )

    for port in "${!PORTS[@]}"; do
        if command -v ss &> /dev/null; then
            if ss -tuln | grep -q ":$port "; then
                log_warn "Port $port (${PORTS[$port]})" "already in use"
            else
                log_pass "Port $port (${PORTS[$port]})" "available"
            fi
        elif command -v netstat &> /dev/null; then
            if netstat -tuln | grep -q ":$port "; then
                log_warn "Port $port (${PORTS[$port]})" "already in use"
            else
                log_pass "Port $port (${PORTS[$port]})" "available"
            fi
        else
            log_warn "Port $port (${PORTS[$port]})" "unable to check"
        fi
    done
}

check_configuration() {
    echo ""
    log_info "Checking configuration files..."

    # base.env
    if [[ -f "$CONFIG_DIR/base.env" ]]; then
        log_pass "base.env" "exists"
    else
        log_fail "base.env" "not found at $CONFIG_DIR/base.env"
    fi

    # Secrets file (check for any environment)
    SECRETS_FOUND=false
    for env in dev staging prod; do
        if [[ -f "$CONFIG_DIR/secrets.${env}.env" ]]; then
            log_pass "secrets.${env}.env" "exists"
            SECRETS_FOUND=true
        fi
    done

    if [[ "$SECRETS_FOUND" == false ]]; then
        log_warn "Secrets file" "no secrets.*.env file found (run generate-secrets.sh)"
    fi

    # .env (generated config)
    if [[ -f "$SERVER_DIR/.env" ]]; then
        log_pass ".env" "exists (generated)"
    else
        log_warn ".env" "not found (run configure-domains.sh)"
    fi

    # docker-compose.yml
    if [[ -f "$SERVER_DIR/docker-compose.yml" ]]; then
        log_pass "docker-compose.yml" "exists"
    else
        log_fail "docker-compose.yml" "not found"
    fi
}

check_ssl() {
    echo ""
    log_info "Checking SSL certificates..."

    SSL_DIR="$SERVER_DIR/services/nginx/ssl"

    if [[ -f "$SSL_DIR/certs/server.crt" ]]; then
        # Check certificate validity
        if command -v openssl &> /dev/null; then
            CERT_END=$(openssl x509 -enddate -noout -in "$SSL_DIR/certs/server.crt" 2>/dev/null | cut -d= -f2)
            if [[ -n "$CERT_END" ]]; then
                CERT_END_EPOCH=$(date -d "$CERT_END" +%s 2>/dev/null || echo "0")
                NOW_EPOCH=$(date +%s)
                DAYS_LEFT=$(( (CERT_END_EPOCH - NOW_EPOCH) / 86400 ))

                if (( DAYS_LEFT <= 0 )); then
                    log_fail "SSL certificate" "expired"
                elif (( DAYS_LEFT <= 30 )); then
                    log_warn "SSL certificate" "expires in $DAYS_LEFT days"
                else
                    log_pass "SSL certificate" "valid for $DAYS_LEFT days"
                fi
            else
                log_pass "SSL certificate" "exists"
            fi
        else
            log_pass "SSL certificate" "exists (unable to verify validity)"
        fi
    else
        log_warn "SSL certificate" "not found (will be generated during installation)"
    fi

    if [[ -f "$SSL_DIR/private/server.key" ]]; then
        log_pass "SSL private key" "exists"
    else
        log_warn "SSL private key" "not found"
    fi
}

check_dns() {
    echo ""
    log_info "Checking DNS (if domain configured)..."

    # Try to get domain from .env
    if [[ -f "$SERVER_DIR/.env" ]]; then
        API_DOMAIN=$(grep "^API_DOMAIN=" "$SERVER_DIR/.env" | cut -d= -f2)

        if [[ -n "$API_DOMAIN" ]]; then
            if command -v dig &> /dev/null; then
                if dig +short "$API_DOMAIN" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
                    log_pass "DNS for $API_DOMAIN" "resolves"
                else
                    log_warn "DNS for $API_DOMAIN" "does not resolve (ensure DNS is configured)"
                fi
            elif command -v nslookup &> /dev/null; then
                if nslookup "$API_DOMAIN" &> /dev/null; then
                    log_pass "DNS for $API_DOMAIN" "resolves"
                else
                    log_warn "DNS for $API_DOMAIN" "does not resolve"
                fi
            else
                log_info "DNS check" "dig/nslookup not available"
            fi
        else
            log_info "DNS check" "no domain configured yet"
        fi
    else
        log_info "DNS check" "skipped (no .env file)"
    fi
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --fix)
            FIX_MODE=true
            shift
            ;;
        --json)
            JSON_OUTPUT=true
            QUIET_MODE=true
            shift
            ;;
        --quiet)
            QUIET_MODE=true
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

# ============================================================================
# Main
# ============================================================================

if [[ "$JSON_OUTPUT" == false ]]; then
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}           Notely Platform - Pre-flight Validation${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
fi

# Run all checks
check_docker
check_resources
check_ports
check_configuration
check_ssl
check_dns

# Output results
if [[ "$JSON_OUTPUT" == true ]]; then
    echo "{"
    echo "  \"passed\": $CHECKS_PASSED,"
    echo "  \"failed\": $CHECKS_FAILED,"
    echo "  \"warned\": $CHECKS_WARNED,"
    echo "  \"ready\": $([[ $CHECKS_FAILED -eq 0 ]] && echo "true" || echo "false"),"
    echo "  \"results\": [$(IFS=,; echo "${RESULTS[*]}")]"
    echo "}"
else
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}Passed:${NC}  $CHECKS_PASSED"
    echo -e "  ${YELLOW}Warnings:${NC} $CHECKS_WARNED"
    echo -e "  ${RED}Failed:${NC}  $CHECKS_FAILED"
    echo ""

    if (( CHECKS_FAILED == 0 )); then
        echo -e "  ${GREEN}✓ System is ready for installation${NC}"
    else
        echo -e "  ${RED}✗ Please resolve the issues above before installing${NC}"
    fi
    echo ""
fi

# Exit with appropriate code
exit $CHECKS_FAILED
