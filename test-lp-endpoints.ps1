# LP Onboarding Endpoint Tests - PowerShell Version
# Run against local BFF at http://localhost:8787

$BASE_URL = "http://localhost:8787"
$DEAL_ID = "550e8400-e29b-41d4-a716-446655440000"
$GP_USER_ID = "gp@example.com"
$LP_EMAIL = "invest@acme.example.com"
$PASSED = 0
$FAILED = 0

Write-Host "🧪 LP Onboarding Endpoint Testing" -ForegroundColor Cyan
Write-Host "Base URL: $BASE_URL`n" -ForegroundColor Gray

try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/health" -Method GET -UseBasicParsing -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ PASS - BFF is healthy`n" -ForegroundColor Green
    } else {
        Write-Host "❌ FAIL - BFF health check failed`n" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ FAIL - $($_.Exception.Message)`n" -ForegroundColor Red
}

# Test 2: Send LP Invitation
Write-Host "Test 2: Send LP Invitation" -ForegroundColor Yellow
$inviteBody = @{
    lpEntityName = "Acme Capital Partners"
    lpEmail = $LP_EMAIL
    dealId = $DEAL_ID
    commitment = 5000000
    ownershipPct = 10
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/lp/invitations" `
        -Method POST `
        -Headers @{"X-User-Id" = $GP_USER_ID; "Content-Type" = "application/json"} `
        -Body $inviteBody `
        -UseBasicParsing `
        -ErrorAction Stop
    
    $invitation = $response.Content | ConvertFrom-Json
    $INVITATION_ID = $invitation.id
    Write-Host "✅ PASS - Invitation created: $INVITATION_ID" -ForegroundColor Green
    Write-Host "   Status: $($invitation.status)`n" -ForegroundColor Gray
    $PASSED++
} catch {
    $statusCode = $_.Exception.Response.StatusCode.Value
    Write-Host "❌ FAIL - HTTP $statusCode - $($_.Exception.Message)`n" -ForegroundColor Red
    $FAILED++
}

# Test 3: List LP Invitations
Write-Host "Test 3: List LP Invitations" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/lp/deals/$DEAL_ID/invitations" `
        -Method GET `
        -Headers @{"X-User-Id" = $GP_USER_ID} `
        -UseBasicParsing `
        -ErrorAction Stop
    
    $invitations = $response.Content | ConvertFrom-Json
    Write-Host "✅ PASS - Listed $($invitations.items.Count) invitations`n" -ForegroundColor Green
    $PASSED++
} catch {
    Write-Host "❌ FAIL - $($_.Exception.Message)`n" -ForegroundColor Red
    $FAILED++
}

# Test 4: LP Portal Landing
Write-Host "Test 4: LP Portal Landing" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/lp/portal" `
        -Method GET `
        -Headers @{"X-User-Id" = $LP_EMAIL} `
        -UseBasicParsing `
        -ErrorAction Stop
    
    $portal = $response.Content | ConvertFrom-Json
    Write-Host "✅ PASS - Portal loaded`n" -ForegroundColor Green
    Write-Host "   Active Investments: $($portal.summary.active_investments)" -ForegroundColor Gray
    Write-Host "   Capital Committed: $$($portal.summary.capital_committed)`n" -ForegroundColor Gray
    $PASSED++
} catch {
    Write-Host "❌ FAIL - $($_.Exception.Message)`n" -ForegroundColor Red
    $FAILED++
}

# Test 5: Bulk LP Import
Write-Host "Test 5: Bulk LP Import" -ForegroundColor Yellow
$bulkBody = @{
    dealId = $DEAL_ID
    investors = @(
        @{
            lpEntityName = "Fund A"
            lpEmail = "funda@example.com"
            commitment = 2000000
            ownershipPct = 4
        },
        @{
            lpEntityName = "Fund B"
            lpEmail = "fundb@example.com"
            commitment = 3000000
            ownershipPct = 6
        }
    )
} | ConvertTo-Json -Depth 3

try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/lp/bulk-import" `
        -Method POST `
        -Headers @{"X-User-Id" = $GP_USER_ID; "Content-Type" = "application/json"} `
        -Body $bulkBody `
        -UseBasicParsing `
        -ErrorAction Stop
    
    $result = $response.Content | ConvertFrom-Json
    Write-Host "✅ PASS - Bulk import completed`n" -ForegroundColor Green
    Write-Host "   Succeeded: $($result.succeeded)/$($result.total)" -ForegroundColor Gray
    Write-Host "   Failed: $($result.failed)`n" -ForegroundColor Gray
    $PASSED++
} catch {
    Write-Host "❌ FAIL - $($_.Exception.Message)`n" -ForegroundColor Red
    $FAILED++
}

# Test 6: Generate Custom Report
Write-Host "Test 6: Generate Custom Report" -ForegroundColor Yellow
$reportBody = @{
    dealId = $DEAL_ID
    reportType = "capital_statement"
    filters = @{
        lpEmails = @($LP_EMAIL)
    }
} | ConvertTo-Json -Depth 3

try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/lp/reports/generate" `
        -Method POST `
        -Headers @{"X-User-Id" = $GP_USER_ID; "Content-Type" = "application/json"} `
        -Body $reportBody `
        -UseBasicParsing `
        -ErrorAction Stop
    
    $report = $response.Content | ConvertFrom-Json
    Write-Host "✅ PASS - Report generated`n" -ForegroundColor Green
    Write-Host "   Type: $($report.reportType)" -ForegroundColor Gray
    Write-Host "   Generated: $($report.generatedAt)`n" -ForegroundColor Gray
    $PASSED++
} catch {
    Write-Host "❌ FAIL - $($_.Exception.Message)`n" -ForegroundColor Red
    $FAILED++
}

# Test 7: List LP Actors
Write-Host "Test 7: List LP Actors" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/lp/actors/$DEAL_ID" `
        -Method GET `
        -Headers @{"X-User-Id" = $GP_USER_ID} `
        -UseBasicParsing `
        -ErrorAction Stop
    
    $actors = $response.Content | ConvertFrom-Json
    Write-Host "✅ PASS - Listed $($actors.items.Count) LP actors`n" -ForegroundColor Green
    $PASSED++
} catch {
    Write-Host "❌ FAIL - $($_.Exception.Message)`n" -ForegroundColor Red
    $FAILED++
}

# Test 8: Error Handling - Invalid Email
Write-Host "Test 8: Error Handling - Invalid Email" -ForegroundColor Yellow
$badBody = @{
    lpEntityName = "Bad Fund"
    lpEmail = "not-an-email"
    dealId = $DEAL_ID
    commitment = 1000000
    ownershipPct = 5
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/lp/invitations" `
        -Method POST `
        -Headers @{"X-User-Id" = $GP_USER_ID; "Content-Type" = "application/json"} `
        -Body $badBody `
        -UseBasicParsing `
        -ErrorAction Stop
    
    Write-Host "⚠️  WARN - Should have rejected invalid email`n" -ForegroundColor Yellow
    $FAILED++
} catch {
    $statusCode = $_.Exception.Response.StatusCode.Value
    if ($statusCode -eq 400) {
        Write-Host "✅ PASS - Invalid email rejected with 400`n" -ForegroundColor Green
        $PASSED++
    } else {
        Write-Host "❌ FAIL - Expected 400, got $statusCode`n" -ForegroundColor Red
        $FAILED++
    }
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "🏁 Test Summary" -ForegroundColor Cyan
Write-Host "  ✅ Passed: $PASSED" -ForegroundColor Green
Write-Host "  ❌ Failed: $FAILED" -ForegroundColor Red
Write-Host "  📊 Total: $($PASSED + $FAILED)" -ForegroundColor Gray
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
