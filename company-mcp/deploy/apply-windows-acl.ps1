# AICO Windows NTFS ACL Configuration Script (v2.2.1)
# Enforces Option A (OS-level isolation with separate SIDs) or fallback logical isolation
param(
  [switch]$Apply = $false,
  [string]$AicoRoot = "D:\AI-COMPANY",
  [string]$BackupDir = "D:\AI-COMPANY\backup"
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================================="
Write-Host "  AICO NTFS ACL ENFORCEMENT TOOLKIT (v2.2.1)"
Write-Host "=========================================================="
Write-Host "Target Root: $AicoRoot"

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
icacls "$AicoRoot\*" /save "$aclBackupFile" /t /c /q

if (-not $Apply) {
  Write-Host "[DRY RUN] ACL backup completed. Pass -Apply switch to enforce permissions."
  exit 0
}

Write-Host "2. Enforcing Isolation Boundaries on Scoped Directories..."

# Core data directory: Protected (Only Founder and Service Account)
$dataDir = Join-Path $AicoRoot "data"
if (Test-Path $dataDir) {
  Write-Host "   - Protecting $dataDir"
  icacls "$dataDir" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "kietp:(OI)(CI)F" /c /q
}

# Logs directory
$logsDir = Join-Path $AicoRoot "logs"
if (Test-Path $logsDir) {
  Write-Host "   - Protecting $logsDir"
  icacls "$logsDir" /grant:r "kietp:(OI)(CI)F" /c /q
}

# Backup directory
if (Test-Path $BackupDir) {
  Write-Host "   - Protecting $BackupDir"
  icacls "$BackupDir" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "kietp:(OI)(CI)F" /c /q
}

Write-Host "=========================================================="
Write-Host "  NTFS ACL ENFORCEMENT COMPLETED SUCCESSFULLY"
Write-Host "  Rollback File: $aclBackupFile"
Write-Host "=========================================================="
