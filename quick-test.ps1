$baseUrl = "http://localhost:8787"

Write-Host "Test 1: Health Check" -ForegroundColor Yellow
$r1 = Invoke-WebRequest -Uri "$baseUrl/health" -Method GET -UseBasicParsing -ErrorAction SilentlyContinue
Write-Host "Status: $($r1.StatusCode)" -ForegroundColor Green

Write-Host "`nTest 2: Create Invitation" -ForegroundColor Yellow
try {
  $r2 = Invoke-WebRequest -Uri "$baseUrl/api/lp/invitations" -Method POST -ContentType "application/json" -Body '{"lpEntityName":"Test","lpEmail":"t@example.com","dealId":"550e8400-e29b-41d4-a716-446655440000","commitment":1000000,"ownershipPct":5}' -UseBasicParsing -ErrorAction Stop
  Write-Host "Status: $($r2.StatusCode)" -ForegroundColor Green
  Write-Host "Body: $($r2.Content | Select-Object -First 200)" 
} catch {
  Write-Host "Error: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor Red
  try { $body = $_.Exception.Response | ConvertFrom-Json; Write-Host $body } catch { }
}

Write-Host "`nTest 3: LP Portal Landing" -ForegroundColor Yellow
try {
  $r3 = Invoke-WebRequest -Uri "$baseUrl/api/lp/portal" -Method GET -UseBasicParsing -ErrorAction Stop
  Write-Host "Status: $($r3.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "Error: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor Red
}
