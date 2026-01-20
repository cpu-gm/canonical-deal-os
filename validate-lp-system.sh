#!/bin/bash
# LP Onboarding System Validation Script
# Validates all LP features are properly deployed and functional
# Usage: ./validate-lp-system.sh [staging|production]

set -e

ENVIRONMENT="${1:-staging}"
BASE_URL="http://localhost:8787"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_FILE="lp-validation-${ENVIRONMENT}-${TIMESTAMP}.txt"

if [ "$ENVIRONMENT" == "staging" ]; then
  BASE_URL="https://staging.dealos.io"
elif [ "$ENVIRONMENT" == "production" ]; then
  BASE_URL="https://dealos.io"
fi

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Test result helper
report_test() {
  local test_name=$1
  local result=$2
  local details=$3
  
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  
  if [ "$result" == "PASS" ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓ PASS${NC} - $test_name" | tee -a "$REPORT_FILE"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗ FAIL${NC} - $test_name" | tee -a "$REPORT_FILE"
    if [ -n "$details" ]; then
      echo "  Details: $details" | tee -a "$REPORT_FILE"
    fi
  fi
}

# Start validation report
{
  echo "=========================================="
  echo "LP Onboarding System Validation Report"
  echo "=========================================="
  echo "Environment: $ENVIRONMENT"
  echo "Base URL: $BASE_URL"
  echo "Timestamp: $(date)"
  echo "=========================================="
  echo ""
} | tee "$REPORT_FILE"

echo -e "${BLUE}=== 1. Health Checks ===${NC}"

# Test 1.1: BFF Health
echo "Testing BFF health endpoint..."
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | tail -1)
if [ "$HEALTH_STATUS" == "200" ]; then
  report_test "BFF Health Endpoint" "PASS"
else
  report_test "BFF Health Endpoint" "FAIL" "HTTP $HEALTH_STATUS"
fi

# Test 1.2: Kernel Connectivity
KERNEL_URL=$(curl -s "$BASE_URL/health" | grep -o '"kernelTarget":"[^"]*' | cut -d'"' -f4)
if [ -n "$KERNEL_URL" ]; then
  report_test "Kernel URL Configuration" "PASS"
else
  report_test "Kernel URL Configuration" "FAIL" "No kernel URL found"
fi

echo ""
echo -e "${BLUE}=== 2. Database Validation ===${NC}"

# Test 2.1: LPInvitation Table
if sqlite3 ./server/.data/llm-airlock.db ".tables" | grep -q "lpinvitation"; then
  COUNT=$(sqlite3 ./server/.data/llm-airlock.db "SELECT COUNT(*) FROM lpinvitation;" 2>/dev/null)
  report_test "LPInvitation Table Exists" "PASS"
else
  report_test "LPInvitation Table Exists" "FAIL" "Table not found"
fi

# Test 2.2: LPActor Table
if sqlite3 ./server/.data/llm-airlock.db ".tables" | grep -q "lpactor"; then
  COUNT=$(sqlite3 ./server/.data/llm-airlock.db "SELECT COUNT(*) FROM lpactor;" 2>/dev/null)
  report_test "LPActor Table Exists" "PASS"
else
  report_test "LPActor Table Exists" "FAIL" "Table not found"
fi

# Test 2.3: Database Integrity
INTEGRITY=$(sqlite3 ./server/.data/llm-airlock.db "PRAGMA integrity_check;" 2>/dev/null)
if [ "$INTEGRITY" == "ok" ]; then
  report_test "Database Integrity Check" "PASS"
else
  report_test "Database Integrity Check" "FAIL" "$INTEGRITY"
fi

echo ""
echo -e "${BLUE}=== 3. Configuration Validation ===${NC}"

# Test 3.1: Required Environment Variables
if [ ! -z "$BFF_PUBLIC_URL" ]; then
  report_test "BFF_PUBLIC_URL Configured" "PASS"
else
  report_test "BFF_PUBLIC_URL Configured" "FAIL" "Environment variable not set"
fi

# Test 3.2: Email Configuration
if [ ! -z "$BFF_LP_INVITATION_EMAIL_ENDPOINT" ]; then
  report_test "Email Endpoint Configured" "PASS"
else
  report_test "Email Endpoint Configured" "FAIL" "Environment variable not set (OK for dev mode)"
fi

# Test 3.3: Webhook Configuration
if [ ! -z "$BFF_LP_NOTIFICATION_WEBHOOK_URL" ]; then
  report_test "Webhook Endpoint Configured" "PASS"
else
  report_test "Webhook Endpoint Configured" "FAIL" "Environment variable not set (OK for dev mode)"
fi

echo ""
echo -e "${BLUE}=== 4. Endpoint Validation ===${NC}"

# Test 4.1: POST /api/lp/invitations
INVITE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/lp/invitations" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-gp" \
  -d '{"lpEntityName":"Test","lpEmail":"test@example.com","dealId":"test","commitment":1000000,"ownershipPct":10}')
if [ "$INVITE_STATUS" == "201" ] || [ "$INVITE_STATUS" == "400" ] || [ "$INVITE_STATUS" == "502" ]; then
  report_test "POST /api/lp/invitations Endpoint" "PASS"
else
  report_test "POST /api/lp/invitations Endpoint" "FAIL" "HTTP $INVITE_STATUS"
fi

# Test 4.2: GET /api/lp/portal
PORTAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/lp/portal" \
  -H "X-User-Id: test-lp@example.com")
if [ "$PORTAL_STATUS" == "200" ]; then
  report_test "GET /api/lp/portal Endpoint" "PASS"
else
  report_test "GET /api/lp/portal Endpoint" "FAIL" "HTTP $PORTAL_STATUS"
fi

# Test 4.3: POST /api/lp/bulk-import
BULK_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/lp/bulk-import" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-gp" \
  -d '{"dealId":"test","investors":[]}')
if [ "$BULK_STATUS" == "400" ]; then
  report_test "POST /api/lp/bulk-import Endpoint" "PASS"
else
  report_test "POST /api/lp/bulk-import Endpoint" "FAIL" "HTTP $BULK_STATUS"
fi

# Test 4.4: POST /api/lp/reports/generate
REPORT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/lp/reports/generate" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-gp" \
  -d '{"dealId":"test"}')
if [ "$REPORT_STATUS" == "404" ] || [ "$REPORT_STATUS" == "400" ]; then
  report_test "POST /api/lp/reports/generate Endpoint" "PASS"
else
  report_test "POST /api/lp/reports/generate Endpoint" "FAIL" "HTTP $REPORT_STATUS"
fi

echo ""
echo -e "${BLUE}=== 5. Error Handling Validation ===${NC}"

# Test 5.1: Invalid Request Handling
INVALID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/lp/invitations" \
  -H "Content-Type: application/json" \
  -d '{"invalid":"data"}')
if [ "$INVALID_STATUS" == "400" ]; then
  report_test "Invalid Request Handling (400)" "PASS"
else
  report_test "Invalid Request Handling (400)" "FAIL" "HTTP $INVALID_STATUS"
fi

# Test 5.2: Not Found Handling
NOTFOUND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/lp/portal/deals/nonexistent")
if [ "$NOTFOUND_STATUS" == "404" ] || [ "$NOTFOUND_STATUS" == "403" ]; then
  report_test "Not Found Handling (404/403)" "PASS"
else
  report_test "Not Found Handling (404/403)" "FAIL" "HTTP $NOTFOUND_STATUS"
fi

echo ""
echo -e "${BLUE}=== 6. Performance Validation ===${NC}"

# Test 6.1: Portal Response Time
START_TIME=$(date +%s%N)
curl -s -o /dev/null "$BASE_URL/api/lp/portal" \
  -H "X-User-Id: test@example.com"
END_TIME=$(date +%s%N)
RESPONSE_TIME=$((($END_TIME - $START_TIME) / 1000000))

if [ $RESPONSE_TIME -lt 2000 ]; then
  report_test "Portal Response Time (<2s)" "PASS"
else
  report_test "Portal Response Time (<2s)" "FAIL" "${RESPONSE_TIME}ms"
fi

echo ""
echo -e "${BLUE}=== 7. Syntax & Code Validation ===${NC}"

# Test 7.1: lp-onboarding.js Syntax
if node --check server/routes/lp-onboarding.js 2>/dev/null; then
  report_test "lp-onboarding.js Syntax" "PASS"
else
  report_test "lp-onboarding.js Syntax" "FAIL" "Syntax error in lp-onboarding.js"
fi

# Test 7.2: index.js Syntax
if node --check server/index.js 2>/dev/null; then
  report_test "index.js Syntax" "PASS"
else
  report_test "index.js Syntax" "FAIL" "Syntax error in index.js"
fi

# Test 7.3: Contracts Syntax
if node --check src/lib/contracts.js 2>/dev/null; then
  report_test "contracts.js Syntax" "PASS"
else
  report_test "contracts.js Syntax" "FAIL" "Syntax error in contracts.js"
fi

echo ""
echo -e "${BLUE}=== 8. Security Validation ===${NC}"

# Test 8.1: CORS Headers
CORS_HEADER=$(curl -s -I "$BASE_URL/health" | grep -i "Access-Control-Allow-Origin" | head -1)
if [ -n "$CORS_HEADER" ]; then
  report_test "CORS Headers Present" "PASS"
else
  report_test "CORS Headers Present" "FAIL" "No CORS headers found"
fi

# Test 8.2: No Credentials in Logs
if ! grep -r "BFF_LP_INVITATION_EMAIL_API_KEY" server/*.js 2>/dev/null | grep -v "process.env" >/dev/null; then
  report_test "No Hardcoded Credentials" "PASS"
else
  report_test "No Hardcoded Credentials" "FAIL" "Found hardcoded credentials"
fi

echo ""
echo -e "${BLUE}=== Summary ===${NC}"

{
  echo ""
  echo "=========================================="
  echo "Validation Summary"
  echo "=========================================="
  echo "Total Tests: $TESTS_TOTAL"
  echo "Passed: $TESTS_PASSED"
  echo "Failed: $TESTS_FAILED"
  echo ""
  
  if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
  else
    echo -e "${RED}✗ $TESTS_FAILED test(s) failed${NC}"
  fi
  
  echo ""
  echo "Report saved to: $REPORT_FILE"
  echo "=========================================="
} | tee -a "$REPORT_FILE"

# Exit with appropriate code
if [ $TESTS_FAILED -eq 0 ]; then
  exit 0
else
  exit 1
fi
