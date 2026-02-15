#!/usr/bin/env bash
# demo_preflight.sh — Pre-demo health check for LocalGuard
# Checks all endpoints and reports PASS/FAIL with latency.
# Exit 0 if all critical checks pass, 1 otherwise.

set -euo pipefail

DASHBOARD="${LOCALGUARD_DASHBOARD_URL:-http://192.168.50.1:3000}"
JETSON="${NEXT_PUBLIC_JETSON_URL:-http://192.168.50.4:8080}"
SPARK="${NEXT_PUBLIC_SPARK_URL:-http://192.168.50.2:8090}"
ORANGEPI="${NEXT_PUBLIC_ORANGEPI_URL:-http://192.168.50.3:8070}"
SPARK_SSH="${SPARK_SSH_TARGET:-asus@192.168.50.2}"
TIMEOUT=3

PASS=0
FAIL=0
WARN=0

pass() { echo "  ✓ PASS  $1 (${2}ms)"; ((PASS++)); }
fail() { echo "  ✗ FAIL  $1${2:+ — $2}"; ((FAIL++)); }
warn() { echo "  ~ WARN  $1${2:+ — $2}"; ((WARN++)); }

# check_endpoint URL LABEL [required_key]
check_endpoint() {
    local url="$1" label="$2" key="${3:-}"
    local start end ms body

    start=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
    if body=$(curl -sf --max-time "$TIMEOUT" "$url" 2>/dev/null); then
        end=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
        ms=$(( end - start ))

        if [ -n "$key" ]; then
            if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$key' in d" 2>/dev/null; then
                pass "$label" "$ms"
            else
                fail "$label" "missing key: $key"
            fi
        else
            pass "$label" "$ms"
        fi
    else
        fail "$label" "unreachable or timeout"
    fi
}

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       LocalGuard Demo Preflight          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# --- Dashboard ---
echo "Dashboard ($DASHBOARD)"
check_endpoint "$DASHBOARD/api/insights" "Insights API" "alert_level"
check_endpoint "$DASHBOARD/api/insights/brief" "Insights Brief" "person_count"
check_endpoint "$DASHBOARD/api/events?limit=1" "Events API" "events"
echo ""

# --- Jetson ---
echo "Jetson ($JETSON)"
check_endpoint "$JETSON/detections" "Detections" "person_count"
echo ""

# --- Spark ---
echo "Spark ($SPARK)"
check_endpoint "$SPARK/health" "Health"
check_endpoint "$SPARK/results" "Results"
echo ""

# --- Orange Pi ---
echo "Orange Pi ($ORANGEPI)"
check_endpoint "$ORANGEPI/health" "Health"
check_endpoint "$ORANGEPI/status" "Status" "state"
echo ""

# --- Spark Internet (optional, premium narrative) ---
echo "Spark Internet (optional)"
if ssh -o ConnectTimeout=3 -o BatchMode=yes "$SPARK_SSH" \
    "curl -sf --max-time 3 https://www.google.com/generate_204" >/dev/null 2>&1; then
    pass "Spark internet access" "n/a"
else
    warn "Spark internet access" "offline (premium context unavailable)"
fi
echo ""

# --- Summary ---
echo "─────────────────────────────────────────"
TOTAL=$((PASS + FAIL + WARN))
echo "  Results: $PASS passed, $FAIL failed, $WARN warnings ($TOTAL checks)"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "  ⚠ NOT DEMO-READY — fix failures above"
    echo ""
    exit 1
else
    echo "  ✓ DEMO-READY"
    echo ""
    exit 0
fi
