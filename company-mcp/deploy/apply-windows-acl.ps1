# AICO Windows NTFS ACL Configuration Script (v2.2.1)
# Enforces Option A (OS-level isolation with dedicated SIDs: aico_svc, aico_flash1, aico_flash2, aico_codex)
param(
  [switch]$Apply = $false,
  [switch]$OptionA = $true,
  [string]$AicoRoot = "D:\AI-COMPANY",
  [string]$BackupDir = "D:\AI-COMPANY\backup"
)

$ErrorActionPreference = "Stop"

function Invoke-IcaclsCommand {
  param(
    [string]$Target,
    [string[]]$ArgsList
  )
  Write-Host "   -> icacls $Target $($ArgsList -join ' ')"
  & icacls $Target @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "ICACLS_ERROR: icacls returned exit code $LASTEXITCODE for target '$Target'"
  }
}

Write-Host "=========================================================="
Write-Host "  AICO NTFS ACL ENFORCEMENT TOOLKIT (v2.2.1) - Option A"
Write-Host "=========================================================="
Write-Host "Target Root : $AicoRoot"
Write-Host "Backup Dir  : $BackupDir"
Write-Host "Mode        : $(if ($Apply) { 'ENFORCING (-Apply)' } else { 'DRY-RUN (audit only)' })"

if (-not (Test-Path $AicoRoot)) {
  Write-Error "AICO Root directory does not exist: $AicoRoot"
  exit 1
}

$timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$aclBackupFile = Join-Path $BackupDir "acl_backup_$timestamp.txt"

if (-not (Test-Path $BackupDir)) {
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

Write-Host "1. Backing up existing NTFS ACLs to: $aclBackupFile"
Invoke-IcaclsCommand "$AicoRoot\*" @("/save", "$aclBackupFile", "/t", "/c", "/q")

if (-not $Apply) {
  Write-Host "[DRY RUN COMPLETE] ACL backup generated at $aclBackupFile."
  Write-Host "[DRY RUN COMPLETE] Pass -Apply switch when Founder approves Gate G2."
  exit 0
}

Write-Host "2. Enforcing Isolation Boundaries on Scoped Directories..."

$dataDir = Join-Path $AicoRoot "data"
$logsDir = Join-Path $AicoRoot "logs"
$workspacesDir = if (Test-Path "D:\AICO-WORKSPACES") { "D:\AICO-WORKSPACES" } else { Join-Path $AicoRoot "workspaces" }

# Verify if service account exists on host
$hasServiceAccount = $false
try {
  $accountCheck = net user aico_svc 2>&1
  if ($LASTEXITCODE -eq 0) { $hasServiceAccount = $true }
} catch {
  $hasServiceAccount = $false
}

$agentWorkspaces = @{
  "flash-01" = "aico_flash1"
  "flash-02" = "aico_flash2"
  "codex-01" = "aico_codex"
}

# If Apply is requested, verify all required Option A accounts are provisioned
if ($Apply -and $OptionA) {
  $missingAccounts = @()
  if (-not $hasServiceAccount) { $missingAccounts += "aico_svc" }
  foreach ($u in $agentWorkspaces.Values) {
    try {
      $uCheck = net user $u 2>&1
      if ($LASTEXITCODE -ne 0) { $missingAccounts += $u }
    } catch {
      $missingAccounts += $u
    }
  }
  if ($missingAccounts.Count -gt 0) {
    throw "OPTION_A_ACCOUNTS_MISSING: Dedicated Windows accounts missing: $($missingAccounts -join ', '). Cannot enforce Option A ACL without provisioned SIDs."
  }
}

# 2.1 Core data directory: Protected (SYSTEM, Administrators, Founder, Service Account)
if (Test-Path $dataDir) {
  Write-Host "   - Configuring $dataDir"
  $grants = @("SYSTEM:(OI)(CI)F", "Administrators:(OI)(CI)F", "kietp:(OI)(CI)F")
  if ($hasServiceAccount) {
    $grants += "aico_svc:(OI)(CI)M"
  } else {
    Write-Warning "User 'aico_svc' not found on system. Service account grant skipped until account creation."
  }
  $dataArgs = @("/inheritance:r", "/grant:r") + $grants + @("/t", "/c", "/q")
  Invoke-IcaclsCommand "$dataDir" $dataArgs
}

# 2.2 Logs directory: Service can write, Founder can read/write
if (Test-Path $logsDir) {
  Write-Host "   - Configuring $logsDir"
  $grants = @("SYSTEM:(OI)(CI)F", "Administrators:(OI)(CI)F", "kietp:(OI)(CI)F")
  if ($hasServiceAccount) { $grants += "aico_svc:(OI)(CI)M" }
  $logsArgs = @("/grant:r") + $grants + @("/t", "/c", "/q")
  Invoke-IcaclsCommand "$logsDir" $logsArgs
}

# 2.3 Backup directory: Service can write, Founder can read/write
if (Test-Path $BackupDir) {
  Write-Host "   - Configuring $BackupDir"
  $grants = @("SYSTEM:(OI)(CI)F", "Administrators:(OI)(CI)F", "kietp:(OI)(CI)F")
  if ($hasServiceAccount) { $grants += "aico_svc:(OI)(CI)M" }
  $backupArgs = @("/inheritance:r", "/grant:r") + $grants + @("/t", "/c", "/q")
  Invoke-IcaclsCommand "$BackupDir" $backupArgs
}

# 2.4 Option A: Agent Workspaces Isolation
if ($OptionA) {
  Write-Host "3. Configuring per-agent isolated workspace DACLs (Option A) on $workspacesDir..."
  if (-not (Test-Path $workspacesDir)) {
    New-Item -ItemType Directory -Path $workspacesDir -Force | Out-Null
  }

  foreach ($agent in $agentWorkspaces.Keys) {
    $wsPath = Join-Path $workspacesDir $agent
    if (-not (Test-Path $wsPath)) {
      New-Item -ItemType Directory -Path $wsPath -Force | Out-Null
    }

    $agentUser = $agentWorkspaces[$agent]
    $userExists = $false
    try {
      $uCheck = net user $agentUser 2>&1
      if ($LASTEXITCODE -eq 0) { $userExists = $true }
    } catch { $userExists = $false }

    $wsGrants = @("SYSTEM:(OI)(CI)F", "Administrators:(OI)(CI)F", "kietp:(OI)(CI)F")
    if ($hasServiceAccount) {
      $wsGrants += "aico_svc:(OI)(CI)M"
    }
    if ($userExists) {
      $wsGrants += "$agentUser`:(OI)(CI)M"
    } else {
      Write-Host "     [Audit] Workspace user '$agentUser' not yet provisioned; will be granted upon creation."
    }

    # Explicitly remove unauthorized agent accounts to strip pre-existing explicit ACEs
    $removeArgs = @()
    foreach ($otherUser in $agentWorkspaces.Values) {
      if ($otherUser -ne $agentUser) {
        $removeArgs += @("/remove:g", $otherUser)
      }
    }

    $wsArgs = @("/inheritance:r", "/grant:r") + $wsGrants + $removeArgs + @("/t", "/c", "/q")
    Invoke-IcaclsCommand "$wsPath" $wsArgs
  }
}

Write-Host "=========================================================="
Write-Host "  NTFS ACL ENFORCEMENT COMPLETED SUCCESSFULLY"
Write-Host "  Rollback File: $aclBackupFile"
Write-Host "=========================================================="
