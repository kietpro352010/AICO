# AICO Independent Verification Script
# Executable verification for Phase 0.3 security, quality, fixture, and database safety

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  AICO PHASE 0.3 INDEPENDENT REPRODUCIBLE VERIFICATION    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$companyRoot = Split-Path -Parent $PSScriptRoot
$companyMcp = Join-Path $companyRoot "company-mcp"
$prodDb = Join-Path $companyRoot "data\aico.db"
$expectedDbHash = "17BD93214291E33260DF4A3D0B7DAD417BCA05C137770443D4D3FA965595E416"
$fixturePath = Join-Path $companyMcp "test\fixtures\aico_v030_pre_v221.db"
$expectedFixtureHash = "2F73A9602DBBC50DA68B323FA00D2D7808855DF7A21FAA3DBEE64EC3EFD1477A"

# Step 1: Pre-run DB Check (Distinguish PASS, FAIL, SKIPPED)
Write-Host "[1/6] Checking production database availability..." -ForegroundColor Yellow
$prodDbStatus = "NOT_CHECKED"
if (Test-Path $prodDb) {
    $initialHash = (Get-FileHash -Algorithm SHA256 $prodDb).Hash
    if ($initialHash -ne $expectedDbHash) {
        Write-Error "FAIL: Initial production DB hash mismatch! Expected $expectedDbHash, got $initialHash"
        exit 1
    }
    $prodDbStatus = "PRESENT_VERIFIED"
    Write-Host "  -> RESULT: PASS - Local production DB verified: $initialHash" -ForegroundColor Green
} else {
    $prodDbStatus = "SKIPPED_NOT_PRESENT"
    Write-Host "  -> RESULT: SKIPPED - data/aico.db not present in environment (clean CI / isolated checkout)." -ForegroundColor Cyan
    Write-Host "     Production DB immutability will NOT be claimed as verified in this environment." -ForegroundColor Cyan
}

# Step 2: Canonical Fixture Integrity Check
Write-Host "[2/6] Verifying canonical baseline fixture integrity..." -ForegroundColor Yellow
if (-not (Test-Path $fixturePath)) {
    Write-Error "FAIL: Canonical test fixture '$fixturePath' not found!"
    exit 1
}
$actualFixtureHash = (Get-FileHash -Algorithm SHA256 $fixturePath).Hash
if ($actualFixtureHash -ne $expectedFixtureHash) {
    Write-Error "FAIL: Fixture hash mismatch! Expected $expectedFixtureHash, got $actualFixtureHash"
    exit 1
}
Write-Host "  -> RESULT: PASS - Baseline fixture verified intact ($actualFixtureHash)" -ForegroundColor Green

# Step 3: npm ci
Write-Host "[3/6] Running npm ci in company-mcp..." -ForegroundColor Yellow
Push-Location $companyMcp
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm ci failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Write-Host "  -> RESULT: PASS - npm ci completed successfully (Exit Code 0)" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 4: npm run typecheck
Write-Host "[4/6] Running TypeScript strict typecheck..." -ForegroundColor Yellow
Push-Location $companyMcp
try {
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Typecheck failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Write-Host "  -> RESULT: PASS - Typecheck passed with 0 errors (Exit Code 0)" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 5: npm test
Write-Host "[5/6] Executing full test suite (11 suites)..." -ForegroundColor Yellow
Push-Location $companyMcp
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Test suite failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Write-Host "  -> RESULT: PASS - All 11 test suites passed 100% (Exit Code 0)" -ForegroundColor Green
} finally {
    Pop-Location
}

# Step 6: Post-run DB Immutability Check (Distinguish PASS, FAIL, SKIPPED)
Write-Host "[6/6] Verifying post-run production database status..." -ForegroundColor Yellow
if ($prodDbStatus -eq "PRESENT_VERIFIED") {
    $postHash = (Get-FileHash -Algorithm SHA256 $prodDb).Hash
    if ($postHash -ne $expectedDbHash) {
        Write-Error "FAIL: Production DB hash changed after verification! Expected $expectedDbHash, got $postHash"
        exit 1
    }
    Write-Host "  -> RESULT: PASS - Production DB immutability confirmed: $postHash (0 bytes modified)" -ForegroundColor Green
} else {
    Write-Host "  -> RESULT: SKIPPED - Production DB was not present in this environment." -ForegroundColor Cyan
    Write-Host "     Immutability check is explicitly SKIPPED (not claimed as verified)." -ForegroundColor Cyan
}

Write-Host "==========================================================" -ForegroundColor Cyan
if ($prodDbStatus -eq "PRESENT_VERIFIED") {
    Write-Host "  VERIFICATION COMPLETE: ALL GATES PASS (EXIT CODE 0)    " -ForegroundColor Green
    Write-Host "  (INCLUDING LOCAL PRODUCTION DB IMMUTABILITY VERIFIED)  " -ForegroundColor Green
} else {
    Write-Host "  ALL APPLICABLE GATES PASS -- PRODUCTION DB CHECK SKIPPED" -ForegroundColor Yellow
    Write-Host "  (EXIT CODE 0)                                          " -ForegroundColor Yellow
}
Write-Host "==========================================================" -ForegroundColor Cyan
exit 0
