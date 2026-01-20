# Simple test
$BASE_URL = "http://localhost:8787"
$DEAL_ID = "550e8400-e29b-41d4-a716-446655440000"
$GP_USER = "gp@example.com"
$LP_EMAIL = "invest@acme.example.com"
$PASS = 0; $FAIL = 0

Write-Host "LP Endpoint Tests" -ForegroundColor Cyan
Write-Host ""

# Test 1
Write-Host "1. Health Check" -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/health" -Method GET -UseBasicParsing -ErrorAction Stop
    Write-Host "  [OK] Status 200" -ForegroundColor Green
    $PASS++
} catch {
    Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red
    $FAIL++
}

# Test 2
Write-Host "2. Create LP Invitation" -ForegroundColor Yellow
$body = @{
    lpEntityName = "Test Fund"
    lpEmail = $LP_EMAIL
    dealId = $DEAL_ID
    commitment = 5000000
    ownershipPct = 10
} | ConvertTo-Json

try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/lp/invitations" -Method POST `
        -UseBasicParsing `
        -Headers @{"X-User-Id"=$GP_USER;"Content-Type"="application/json"} `
        -Body $body `
        -ErrorAction Stop
    Write-Host "  [OK] Invitation created" -ForegroundColor Green
    $PASS++
} catch {
    Write-Host "  [FAIL] $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    $FAIL++
}

# Test 3
Write-Host "3. List Invitations" -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/lp/deals/$DEAL_ID/invitations" -Method GET `
        -UseBasicParsing `
        -Headers @{"X-User-Id"=$GP_USER} `
        -ErrorAction Stop
    $data = $r.Content | ConvertFrom-Json
    Write-Host "  [OK] Found $($data.items.Count) invitations" -ForegroundColor Green
    $PASS++
} catch {
    Write-Host "  [FAIL] $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    $FAIL++
}

# Test 4
Write-Host "4. LP Portal Landing" -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/lp/portal" -Method GET `
        -UseBasicParsing `
        -Headers @{"X-User-Id"=$LP_EMAIL} `
        -ErrorAction Stop
    $data = $r.Content | ConvertFrom-Json
    Write-Host "  [OK] Portal loaded ($($data.summary.active_investments) active)" -ForegroundColor Green
    $PASS++
} catch {
    Write-Host "  [FAIL] $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    $FAIL++
}

# Test 5
Write-Host "5. Bulk LP Import" -ForegroundColor Yellow
$bulkBody = @{
    dealId = $DEAL_ID
    investors = @(
        @{lpEntityName="Fund A";lpEmail="funda@example.com";commitment=2000000;ownershipPct=4},
        @{lpEntityName="Fund B";lpEmail="fundb@example.com";commitment=3000000;ownershipPct=6}
    )
} | ConvertTo-Json -Depth 3

try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/lp/bulk-import" -Method POST `
        -UseBasicParsing `
        -Headers @{"X-User-Id"=$GP_USER;"Content-Type"="application/json"} `
        -Body $bulkBody `
        -ErrorAction Stop
    $data = $r.Content | ConvertFrom-Json
    Write-Host "  [OK] Bulk import ($($data.succeeded)/$($data.total) succeeded)" -ForegroundColor Green
    $PASS++
} catch {
    Write-Host "  [FAIL] $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    $FAIL++
}

# Test 6
Write-Host "6. Generate Custom Report" -ForegroundColor Yellow
$reportBody = @{
    dealId = $DEAL_ID
    reportType = "capital_statement"
    filters = @{lpEmails = @($LP_EMAIL)}
} | ConvertTo-Json -Depth 3

try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/lp/reports/generate" -Method POST `
        -UseBasicParsing `
        -Headers @{"X-User-Id"=$GP_USER;"Content-Type"="application/json"} `
        -Body $reportBody `
        -ErrorAction Stop
    $data = $r.Content | ConvertFrom-Json
    Write-Host "  [OK] Report generated ($($data.reportType))" -ForegroundColor Green
    $PASS++
} catch {
    Write-Host "  [FAIL] $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    $FAIL++
}

# Test 7
Write-Host "7. List LP Actors" -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "$BASE_URL/api/lp/actors/$DEAL_ID" -Method GET `
        -UseBasicParsing `
        -Headers @{"X-User-Id"=$GP_USER} `
        -ErrorAction Stop
    $data = $r.Content | ConvertFrom-Json
    Write-Host "  [OK] Found $($data.items.Count) actors" -ForegroundColor Green
    $PASS++
} catch {
    Write-Host "  [FAIL] $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    $FAIL++
}

# Summary
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "TEST RESULTS" -ForegroundColor Cyan
Write-Host "  Passed: $PASS" -ForegroundColor Green
Write-Host "  Failed: $FAIL" -ForegroundColor Red
Write-Host "  Total:  $($PASS + $FAIL)" -ForegroundColor Gray
Write-Host "=============================================" -ForegroundColor Cyan
