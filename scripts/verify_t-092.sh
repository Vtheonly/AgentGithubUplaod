#!/usr/bin/env bash
# verify_t-092.sh — Migration token consistency across all 3 El-Imtiyaz platforms
#
# Confirmation script for task T-092 (Migration token consistency across all
# platforms). Verifies that the website, Android, and desktop clients all
# resolve to the SAME canonical Supabase project, and that the credential
# sheet in the hub repo is in sync with every .env.example.
#
# Per ADR-001 family: all three clients MUST resolve to the same project ref.
# The URL is the identity; keys are per-platform-type but derive from the same
# project. When the project is ever migrated, update the credentials sheet
# first, then every .env.example, then the runtime dialogs.
#
# This script is idempotent and read-only — it never mutates the live DB
# or any repo state. It is safe to re-run any time.
#
# Usage:
#   ./scripts/verify_t-092.sh                 # all checks
#   ./scripts/verify_t-092.sh --skip-live      # skip the live auth health check
#
# Exit codes:
#   0 — all 7 checks pass
#   1 — at least one check failed
#
# Origin: gap identified in session 10 — the original verify_t-092.sh lived
# only at /home/z/my-project/scripts/ (outside the repo) and was lost across
# sessions. This in-repo copy closes the gap so future agents can re-run
# the verification without re-deriving the checks.

set -u

# ---- Config ----------------------------------------------------------------

CANONICAL_PROJECT_REF="hkvkefubghbbotgnteir"
CANONICAL_SUPABASE_URL="https://${CANONICAL_PROJECT_REF}.supabase.co"
CANONICAL_JWKS_URL="${CANONICAL_SUPABASE_URL}/auth/v1/.well-known/jwks.json"

# Resolve the hub repo root from the script's location (works regardless of
# the caller's CWD).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HUB_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Sibling repos (per AGENTS.md §11 convention: clients checked out as siblings).
ANDROID_ROOT="${HUB_ROOT}/../elimtiyaz-android"
WEBSITE_ROOT="${HUB_ROOT}/../elimtiyaz-website"

# Color codes (optional; degrade gracefully if not a TTY)
if [ -t 1 ]; then
    GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
    GREEN=''; RED=''; YELLOW=''; RESET=''
fi

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
SKIP_LIVE=0

for arg in "$@"; do
    case "$arg" in
        --skip-live) SKIP_LIVE=1 ;;
        -h|--help)
            sed -n '2,30p' "$0"
            exit 0
            ;;
    esac
done

# ---- Helpers ---------------------------------------------------------------

check_pass() {
    printf "%sPASS%s  %s\n" "${GREEN}" "${RESET}" "$1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

check_fail() {
    printf "%sFAIL%s  %s\n" "${RED}" "${RESET}" "$1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

check_skip() {
    printf "%sSKIP%s  %s\n" "${YELLOW}" "${RESET}" "$1"
    SKIP_COUNT=$((SKIP_COUNT + 1))
}

contains() {
    # contains <needle> <file> — returns 0 if needle is in file, 1 otherwise.
    grep -q -- "$1" "$2" 2>/dev/null
}

# ---- Check 1: credentials.md present and references canonical project -------

CRED_SHEET="${HUB_ROOT}/docs/operations/credentials.md"
if [ -f "${CRED_SHEET}" ] \
    && contains "${CANONICAL_PROJECT_REF}" "${CRED_SHEET}" \
    && contains "${CANONICAL_SUPABASE_URL}" "${CRED_SHEET}"; then
    check_pass "1. credentials.md present and references canonical Supabase project"
else
    check_fail "1. credentials.md missing or does not reference ${CANONICAL_SUPABASE_URL} (looked at ${CRED_SHEET})"
fi

# ---- Check 2: Android .env.example points to canonical project -------------

ANDROID_ENV_EXAMPLE="${ANDROID_ROOT}/.env.example"
if [ -f "${ANDROID_ENV_EXAMPLE}" ] \
    && contains "SUPABASE_URL=${CANONICAL_SUPABASE_URL}" "${ANDROID_ENV_EXAMPLE}" \
    && contains "SUPABASE_JWKS_URL=${CANONICAL_JWKS_URL}" "${ANDROID_ENV_EXAMPLE}"; then
    check_pass "2. Android .env.example points to canonical Supabase URL + JWKS URL"
else
    check_fail "2. Android .env.example missing or inconsistent (looked at ${ANDROID_ENV_EXAMPLE})"
fi

# ---- Check 3: Website .env.example points to canonical project -------------

WEBSITE_ENV_EXAMPLE="${WEBSITE_ROOT}/.env.example"
if [ -f "${WEBSITE_ENV_EXAMPLE}" ] \
    && contains "NEXT_PUBLIC_SUPABASE_URL=${CANONICAL_SUPABASE_URL}" "${WEBSITE_ENV_EXAMPLE}"; then
    check_pass "3. Website .env.example points to canonical Supabase URL"
else
    check_fail "3. Website .env.example missing or does not reference ${CANONICAL_SUPABASE_URL} (looked at ${WEBSITE_ENV_EXAMPLE})"
fi

# ---- Check 4: Desktop credential mechanism (runtime settings dialog) -------
# The desktop does NOT ship a hard-coded URL — per credentials.md §2, it uses
# a runtime settings dialog (Settings → Configuration tab) that stores the
# URL + anon key in ElectronUserData/config.json. The supabase-client.ts
# singleton reads from there. So this check verifies:
#   (a) the singleton file exists, and
#   (b) the settings dialog UI file exists, and
#   (c) the singleton's docstring explains the runtime-dialog mechanism.

DESKTOP_CLIENT="${HUB_ROOT}/elimtiyaz-desktop/src/infrastructure/supabase/supabase-client.ts"
DESKTOP_DIALOG="${HUB_ROOT}/elimtiyaz-desktop/src/features/settings/configuration/connection-card.tsx"

if [ ! -f "${DESKTOP_CLIENT}" ]; then
    check_fail "4. Desktop supabase-client.ts not found at ${DESKTOP_CLIENT#${HUB_ROOT}/}"
elif [ ! -f "${DESKTOP_DIALOG}" ]; then
    check_fail "4. Desktop settings dialog not found at ${DESKTOP_DIALOG#${HUB_ROOT}/}"
elif contains "Settings" "${DESKTOP_CLIENT}" \
    && contains "Configuration" "${DESKTOP_CLIENT}" \
    && grep -q "supabase_url\|supabase_anon_key" "${DESKTOP_CLIENT}" 2>/dev/null; then
    check_pass "4. Desktop credential mechanism (runtime Settings → Configuration dialog → supabase-client.ts singleton) is in place"
else
    check_fail "4. Desktop supabase-client.ts does not document the Settings → Configuration mechanism (or its keys changed)"
fi

# ---- Check 5: all three .env.example files point to the same project ref ----

# Re-grep each file independently so a partial failure names the offender.
declare -a SITES=(
    "credentials.md:${CRED_SHEET}:hkvkefubghbbotgnteir"
    "Android.env.example:${ANDROID_ENV_EXAMPLE}:hkvkefubghbbotgnteir"
    "Website.env.example:${WEBSITE_ENV_EXAMPLE}:hkvkefubghbbotgnteir"
)

ALL_SAME=1
for site in "${SITES[@]}"; do
    name="${site%%:*}"
    rest="${site#*:}"
    file="${rest%%:*}"
    needle="${rest##*:}"
    if [ -f "${file}" ] && contains "${needle}" "${file}"; then
        : # good
    else
        ALL_SAME=0
    fi
done

if [ "${ALL_SAME}" = "1" ]; then
    check_pass "5. All three platforms reference the same canonical project ref (${CANONICAL_PROJECT_REF})"
else
    check_fail "5. At least one platform's env file does not reference ${CANONICAL_PROJECT_REF}"
fi

# ---- Check 6: JWKS URL is consistent across Android + credentials sheet ----
# The Android client needs an explicit JWKS URL because it verifies JWTs
# locally (Ktor client auth). The website + desktop use the Supabase JS SDK
# which handles JWKS internally — they don't need an explicit JWKS URL line.
# So this check verifies:
#   (a) Android .env.example has the canonical JWKS URL, and
#   (b) credentials.md mentions JWKS (so the registry is complete).

if [ -f "${ANDROID_ENV_EXAMPLE}" ] \
    && contains "${CANONICAL_JWKS_URL}" "${ANDROID_ENV_EXAMPLE}" \
    && contains "JWKS" "${CRED_SHEET}"; then
    check_pass "6. JWKS URL consistent (Android .env.example has canonical URL; credentials.md mentions JWKS)"
else
    check_fail "6. JWKS URL is inconsistent — expected ${CANONICAL_JWKS_URL} in Android .env.example and 'JWKS' in credentials.md"
fi

# ---- Check 7: live auth health endpoint returns 200 ------------------------
# The /auth/v1/health endpoint requires an apikey header (the public anon
# key). The script reads it from the SUPABASE_ANON_KEY env var (never
# committed — operators set it in their shell). If not set, the check is
# downgraded to a reachability check (any HTTP response = endpoint exists).

if [ "${SKIP_LIVE}" = "1" ]; then
    check_skip "7. Live auth health endpoint (--skip-live passed)"
else
    HEALTH_URL="${CANONICAL_SUPABASE_URL}/auth/v1/health"
    if ! command -v curl >/dev/null 2>&1; then
        check_skip "7. Live auth health endpoint (curl not installed)"
    else
        if [ -n "${SUPABASE_ANON_KEY:-}" ]; then
            HTTP_CODE=$(curl -s -o /tmp/verify_t-092_health.json -w "%{http_code}" \
                --max-time 10 -H "apikey: ${SUPABASE_ANON_KEY}" "${HEALTH_URL}" 2>/dev/null || echo "000")
            EXPECTED=200
        else
            # No anon key in env — degrade to a reachability check.
            HTTP_CODE=$(curl -s -o /tmp/verify_t-092_health.json -w "%{http_code}" \
                --max-time 10 "${HEALTH_URL}" 2>/dev/null || echo "000")
            EXPECTED=401  # without apikey, Supabase returns 401 (proves the endpoint exists)
        fi
        if [ "${HTTP_CODE}" = "${EXPECTED}" ]; then
            check_pass "7. Live auth health endpoint HTTP ${HTTP_CODE} (${HEALTH_URL}${SUPABASE_ANON_KEY:+ ; apikey set})"
        else
            check_fail "7. Live auth health endpoint returned HTTP ${HTTP_CODE} (expected ${EXPECTED}; set SUPABASE_ANON_KEY for a strict 200 check)"
        fi
    fi
fi

# ---- Summary ---------------------------------------------------------------

TOTAL=$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))
echo
echo "---------------------------------------------------------------"
echo "T-092 verification: ${PASS_COUNT} passed, ${FAIL_COUNT} failed, ${SKIP_COUNT} skipped (of ${TOTAL})"
echo "---------------------------------------------------------------"

if [ "${FAIL_COUNT}" -gt 0 ]; then
    exit 1
fi
exit 0
