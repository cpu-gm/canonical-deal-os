#!/usr/bin/env pwsh
# Simple LP endpoint test
$ErrorActionPreference = "Continue"

$baseUrl = "http://localhost:8787"
$endpoints = @(
    @{
        Name = "Health Check"
        Method = "GET"
        Path = "/health"
        Body = $null
    },
    @{
        Name = "Create LP Invitation"
        Method = "POST"
        Path = "/api/lp/invitations"
        Body = @{
            lpEntityName = "Test LP"
            lpEmail = "test@example.com"
            dealId = "550e8400-e29b-41d4-a716-446655440000"
            commitment = 1000000
            ownershipPct = 5
        } | ConvertTo-Json
    }
)

Write-Host "=== LP Endpoint Tests ===" -ForegroundColor Cyan
Write-Host "Target: $baseUrl`n" -ForegroundColor Gray

$passed = 0
$failed = 0

foreach ($endpoint in $endpoints) {
    try {
        Write-Host "Testing: $($endpoint.Name)" -ForegroundColor Yellow
        Write-Host "  Method: $($endpoint.Method) $($endpoint.Path)"
        
        $params = @{
            Uri = "$baseUrl$($endpoint.Path)"
            Method = $endpoint.Method
            ContentType = "application/json"
            UseBasicParsing = $true
            ErrorAction = "Stop"
        }
        
        if ($endpoint.Body) {
            $params["Body"] = $endpoint.Body
        }
        
        $response = Invoke-WebRequest @params
        
        Write-Host "  ✓ Status: $($response.StatusCode)" -ForegroundColor Green
        
        # Try to parse response
        try {
            $body = $response.Content | ConvertFrom-Json
            Write-Host "  Response: $(($body | ConvertTo-Json -Depth 1).Substring(0, [Math]::Min(100, ($body | ConvertTo-Json -Depth 1).Length)))"
        } catch {
            Write-Host "  Response: $($response.Content.Substring(0, [Math]::Min(100, $response.Content.Length)))"
        }
        
        $passed++
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        $errorMessage = $_.ErrorDetails.Message
        
        Write-Host "  ✗ Error: HTTP $statusCode" -ForegroundColor Red
        
        # Try to get response body
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
            Write-Host "  Response: $(($body).Substring(0, [Math]::Min(100, ($body).Length)))"
        } catch {
            Write-Host "  Response: $_"
        }
        
        $failed++
    }
    
    Write-Host ""
}

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor Red
Write-Host "Total: $($passed + $failed)" 
