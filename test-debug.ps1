$body = @{
    lpEntityName = "Test"
    lpEmail = "test@example.com"
    dealId = "550e8400-e29b-41d4-a716-446655440000"
    commitment = 1000000
    ownershipPct = 10
} | ConvertTo-Json

Write-Host "Testing: POST /api/lp/invitations"
Write-Host "Body: $body"
Write-Host ""

try {
    $r = Invoke-WebRequest `
        -Uri "http://localhost:8787/api/lp/invitations" `
        -Method POST `
        -UseBasicParsing `
        -Headers @{
            "X-User-Id" = "gp@example.com"
            "Content-Type" = "application/json"
        } `
        -Body $body `
        -ErrorAction Stop
    
    Write-Host "SUCCESS - Status: $($r.StatusCode)"
    Write-Host "Response:"
    $r.Content | ConvertFrom-Json | ConvertTo-Json -Depth 3
} catch {
    Write-Host "ERROR - Status: $($_.Exception.Response.StatusCode.Value)"
    Write-Host "Message: $($_.Exception.Message)"
}
