#!/bin/bash
#
# Notely Enterprise License Signing Tool
# ======================================
# Signs license payloads for enterprise appliance deployment
#
# Usage:
#   ./sign-license.sh <license.json> [output-file]
#
# Example:
#   ./sign-license.sh license-payload.json enterprise-license.key
#
# The license.json should contain:
# {
#   "license_id": "LIC-2024-XXXX-XXXX",
#   "organization": "Acme Corporation",
#   "type": "enterprise",
#   "max_users": "unlimited",
#   "features": ["core", "ai_summaries", "sso"],
#   "issued_at": "2024-01-15T00:00:00Z",
#   "expires_at": "2025-01-15T23:59:59Z"
# }
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS_DIR="${SCRIPT_DIR}/../config/keys"
PRIVATE_KEY="${KEYS_DIR}/license-signing-private.pem"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

usage() {
    cat << EOF
Notely Enterprise License Signing Tool

Usage: $(basename "$0") <license.json> [output-file]

Arguments:
  license.json    Path to JSON file containing license payload
  output-file     Output file path (default: <license_id>.key)

Options:
  -h, --help      Show this help message
  -v, --verify    Verify an existing license file
  --generate      Generate a sample license payload

Examples:
  # Sign a license
  $(basename "$0") acme-license.json

  # Sign and specify output file
  $(basename "$0") acme-license.json /path/to/license.key

  # Generate sample payload
  $(basename "$0") --generate > sample-license.json

  # Verify a license
  $(basename "$0") --verify license.key

EOF
}

generate_sample() {
    local license_id="LIC-$(date +%Y)-$(openssl rand -hex 4 | tr '[:lower:]' '[:upper:]')"
    local issued_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local expires_at=$(date -u -d "+1 year" +"%Y-%m-%dT%H:%M:%SZ")

    cat << EOF
{
  "license_id": "${license_id}",
  "organization": "Your Organization Name",
  "type": "enterprise",
  "max_users": "unlimited",
  "features": [
    "core",
    "ai_summaries",
    "sso",
    "custom_branding",
    "priority_support"
  ],
  "issued_at": "${issued_at}",
  "expires_at": "${expires_at}",
  "contact_email": "admin@example.com",
  "notes": "Enterprise license for on-premises deployment"
}
EOF
}

verify_license() {
    local license_file="$1"
    local public_key="${KEYS_DIR}/license-signing-public.pem"

    if [[ ! -f "$license_file" ]]; then
        log_error "License file not found: $license_file"
        exit 1
    fi

    if [[ ! -f "$public_key" ]]; then
        log_error "Public key not found: $public_key"
        exit 1
    fi

    local content
    content=$(cat "$license_file")

    local payload_b64
    payload_b64=$(echo "$content" | cut -d'.' -f1)

    local signature_b64
    signature_b64=$(echo "$content" | cut -d'.' -f2)

    if [[ -z "$payload_b64" || -z "$signature_b64" ]]; then
        log_error "Invalid license format"
        exit 1
    fi

    # Create temp files
    local tmpdir
    tmpdir=$(mktemp -d)
    trap "rm -rf $tmpdir" EXIT

    echo -n "$payload_b64" > "${tmpdir}/payload.b64"
    echo "$signature_b64" | base64 -d > "${tmpdir}/signature.bin"

    # Verify signature
    if openssl dgst -sha256 -verify "$public_key" \
        -signature "${tmpdir}/signature.bin" \
        "${tmpdir}/payload.b64" &>/dev/null; then
        log_info "Signature verification: PASSED"

        # Decode and display payload
        local payload
        payload=$(echo "$payload_b64" | base64 -d)

        echo ""
        echo "License Details:"
        echo "================"
        echo "$payload" | jq -r '
            "License ID:   \(.license_id // "N/A")",
            "Organization: \(.organization // "N/A")",
            "Type:         \(.type // "N/A")",
            "Max Users:    \(.max_users // "N/A")",
            "Features:     \(.features // [] | join(", "))",
            "Issued:       \(.issued_at // "N/A")",
            "Expires:      \(.expires_at // "Never")"
        '

        # Check expiration
        local expires_at
        expires_at=$(echo "$payload" | jq -r '.expires_at // ""')
        if [[ -n "$expires_at" && "$expires_at" != "null" ]]; then
            local expires_ts
            expires_ts=$(date -d "$expires_at" +%s 2>/dev/null || echo "0")
            local now_ts
            now_ts=$(date +%s)

            if [[ $expires_ts -lt $now_ts ]]; then
                log_warn "License has EXPIRED"
            else
                local days_remaining=$(( (expires_ts - now_ts) / 86400 ))
                log_info "Days remaining: $days_remaining"
            fi
        fi

        return 0
    else
        log_error "Signature verification: FAILED"
        log_error "License may be tampered or invalid"
        return 1
    fi
}

sign_license() {
    local payload_file="$1"
    local output_file="${2:-}"

    # Check private key exists
    if [[ ! -f "$PRIVATE_KEY" ]]; then
        log_error "Private key not found: $PRIVATE_KEY"
        log_error "Generate keys first with: openssl genrsa -out $PRIVATE_KEY 4096"
        exit 1
    fi

    # Check payload file exists
    if [[ ! -f "$payload_file" ]]; then
        log_error "Payload file not found: $payload_file"
        exit 1
    fi

    # Validate JSON
    if ! jq empty "$payload_file" 2>/dev/null; then
        log_error "Invalid JSON in payload file"
        exit 1
    fi

    # Read and minify payload
    local payload
    payload=$(jq -c . "$payload_file")

    # Extract license_id for default filename
    local license_id
    license_id=$(echo "$payload" | jq -r '.license_id // "license"')

    # Set output file if not specified
    if [[ -z "$output_file" ]]; then
        output_file="${license_id}.key"
    fi

    log_info "Signing license: $license_id"

    # Create temp directory
    local tmpdir
    tmpdir=$(mktemp -d)
    trap "rm -rf $tmpdir" EXIT

    # Base64 encode payload
    local payload_b64
    payload_b64=$(echo -n "$payload" | base64 -w 0)
    echo -n "$payload_b64" > "${tmpdir}/payload.b64"

    # Sign the base64 payload
    openssl dgst -sha256 -sign "$PRIVATE_KEY" \
        -out "${tmpdir}/signature.bin" \
        "${tmpdir}/payload.b64"

    # Base64 encode signature
    local signature_b64
    signature_b64=$(base64 -w 0 "${tmpdir}/signature.bin")

    # Create license file: payload.signature
    echo "${payload_b64}.${signature_b64}" > "$output_file"

    log_info "License signed successfully!"
    log_info "Output file: $output_file"

    # Display license info
    echo ""
    echo "License Details:"
    echo "================"
    echo "$payload" | jq -r '
        "License ID:   \(.license_id // "N/A")",
        "Organization: \(.organization // "N/A")",
        "Type:         \(.type // "N/A")",
        "Expires:      \(.expires_at // "Never")"
    '

    echo ""
    log_info "To verify: $(basename "$0") --verify $output_file"
}

# Parse arguments
case "${1:-}" in
    -h|--help)
        usage
        exit 0
        ;;
    --generate)
        generate_sample
        exit 0
        ;;
    -v|--verify)
        if [[ -z "${2:-}" ]]; then
            log_error "Please specify a license file to verify"
            exit 1
        fi
        verify_license "$2"
        exit $?
        ;;
    "")
        usage
        exit 1
        ;;
    *)
        sign_license "$1" "${2:-}"
        ;;
esac
