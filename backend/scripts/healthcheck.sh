#!/usr/bin/env bash
# ==============================================================================
# SILVERHAWK DIGITAL BANKING — API HEALTHCHECK & LIVENESS MONITOR
# ==============================================================================

set -euo pipefail

API_URL="${API_URL:-http://localhost:4000/api/v1/health}"

echo "🩺 Probing Silverhawk API health endpoint: ${API_URL}..."

STATUS_CODE=$(curl -s -o /tmp/silverhawk_health_response.json -w "%{http_code}" "${API_URL}" || echo "000")

if [ "${STATUS_CODE}" -eq 200 ]; then
  echo "✅ HEALTHY (HTTP 200)"
  cat /tmp/silverhawk_health_response.json
  echo ""
  exit 0
else
  echo "❌ UNHEALTHY (HTTP ${STATUS_CODE})"
  cat /tmp/silverhawk_health_response.json 2>/dev/null || true
  echo ""
  exit 1
fi

