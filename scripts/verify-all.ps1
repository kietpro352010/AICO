# AICO Independent Verification Script
# Executable verification for Phase 0.2 security, quality, and database safety

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  AICO PHASE 0.2 INDEPENDENT REPRODUCIBLE VERIFICATION    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$companyRoot = Split-Path -Parent $PSScriptRoot
$companyMcp = Join-Path $companyRoot "company-mcp"
$prodDb = Join-Path $companyRoot "data\aico.db"
$expectedDbHash = "17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416"

# Step 1: Pre-run DB Hash Check
Write-Host "[1/5] Checking initial production database hash..." -ForegroundColor Yellow
if (Test-Path $prodDb) {
    $initialHash = (Get-FileHash -Algorithm SHA256 $prodDb).Hash
    if ($initialHash -ne $expectedDbHash) {
        Write-Error "CRITICAL: Initial production DB hash mismatch! Expected $expectedDbHash, got $initialHash"
        exit 1
    }
    Write-Host "  -> Verified: $initialHash" -ForegroundColor Green
}

# Step 2: npm ci
Write-Host "[2/5] Running npm ci in company-mcp..." -ForegroundColor Yellow
Push-Location $companyMcp
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm ci failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Write-Host "  -> npm ci completed successfully (Exit Code 0)" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 3: npm run typecheck
Write-Host "[3/5] Running TypeScript strict typecheck..." -ForegroundColor Yellow
Push-Location $companyMcp
try {
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Typecheck failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Write-Host "  -> Typecheck passed with 0 errors (Exit Code 0)" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 4: npm test
Write-Host "[4/5] Executing full test suite (11 suites)..." -ForegroundColor Yellow
Push-Location $companyMcp
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Test suite failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Write-Host "  -> All test suites passed 100% (Exit Code 0)" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 5: Post-run DB Hash Check
Write-Host "[5/5] Verifying production database immutability..." -ForegroundColor Yellow
if (Test-Path $prodDb) {
    $postHash = (Get-FileHash -Algorithm SHA256 $prodDb).Hash
    if ($postHash -ne $expectedDbHash) {
        Write-Error "CRITICAL: Production DB hash changed after verification! Expected $expectedDbHash, got $postHash"
        exit 1
    }
    Write-Host "  -> Post-verification hash match confirmed: $postHash (0 bytes modified)" -ForegroundColor Green
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  VERIFICATION COMPLETE: ALL GATES PASS (EXIT CODE 0)    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
exit 0
