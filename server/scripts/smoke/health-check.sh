#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

response_file=$(mktemp)
trap 'rm -f "${response_file}"' EXIT

services=(
  "gateway:3200/health"
  "auth:3201/health"
)

for service in "${services[@]}"; do
  name="${service%%:*}"
  path="${service#*:}"
  url="http://localhost:${path}"
  echo "Checking ${name} service at ${url}..."
  status_code=$(curl -s -o "${response_file}" -w "%{http_code}" "${url}") || status_code=000
  if [[ "${status_code}" != "200" ]]; then
    echo "[FAIL] ${name} health check returned ${status_code}" >&2
    cat "${response_file}" >&2 || true
    exit 1
  fi
  echo "[OK] ${name} service healthy"
done

echo "All health checks passed."
