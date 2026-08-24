#!/usr/bin/env bash
# smoke-local.sh — local-only end-to-end smoke test against a real gateway.
#
# Hits a live gateway with a real backend: /healthz, /v1/models,
# POST /v1/chat/completions, and an interactive forced-failover step.
#
# Environment:
#   GATEWAY_URL  — gateway base URL  (default: http://localhost:8080)
#   MODEL        — logical model name (default: fast)
#
# Never wired into CI, verify.sh, or package.json.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
MODEL="${MODEL:-fast}"

failures=0
fail() { echo "smoke: FAIL — $1"; failures=$((failures + 1)); }

# ── Step 1: GET /healthz ──────────────────────────────────────────────────────
echo "━━━ Step 1: GET /healthz ━━━"
healthz="$(curl -sS "$GATEWAY_URL/healthz" || true)"
if [ -z "$healthz" ]; then
  fail "gateway not answering at $GATEWAY_URL/healthz"
else
  echo "$healthz"
fi

# ── Step 2: GET /v1/models ───────────────────────────────────────────────────
echo ""
echo "━━━ Step 2: GET /v1/models ━━━"
models="$(curl -sS "$GATEWAY_URL/v1/models" || true)"
if echo "$models" | grep -q '"object":"list"'; then
  echo "OK — object is list"
else
  fail "/v1/models does not contain \"object\":\"list\""
fi

# ── Step 3: POST /v1/chat/completions ────────────────────────────────────────
echo ""
echo "━━━ Step 3: POST /v1/chat/completions ━━━"
chat_body=$(printf '{"model":"%s","messages":[{"role":"user","content":"Say hello in one word."}]}' "$MODEL")
chat_resp="$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d "$chat_body" \
  "$GATEWAY_URL/v1/chat/completions" || true)"
if echo "$chat_resp" | grep -q '"choices"'; then
  echo "OK — response contains choices"
else
  fail "POST /v1/chat/completions did not return \"choices\""
fi
echo "$chat_resp"

# ── Step 4: Forced failover ──────────────────────────────────────────────────
echo ""
echo "━━━ Step 4: Forced failover ━━━"
echo "STOP the primary backend now (e.g. systemctl stop your-model-server),"
echo "then press Enter when ready..."
read -r

echo "Retrying POST /v1/chat/completions with primary down..."
failover_resp="$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d "$chat_body" \
  "$GATEWAY_URL/v1/chat/completions" || true)"
if echo "$failover_resp" | grep -q '"choices"'; then
  echo "OK — request succeeded after primary went down (failover worked)"
else
  fail "POST /v1/chat/completions failed after primary backend was stopped"
fi
echo "$failover_resp"

echo ""
echo "━━━ Post-failover /healthz ━━━"
healthz_after="$(curl -sS "$GATEWAY_URL/healthz" || true)"
if [ -z "$healthz_after" ]; then
  fail "gateway not answering at $GATEWAY_URL/healthz after failover"
else
  echo "$healthz_after"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [ "$failures" -gt 0 ]; then
  echo "smoke: $failures failure(s)"
  exit 1
fi

echo "smoke: all clear"
exit 0
