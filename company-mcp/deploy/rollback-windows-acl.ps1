# AICO Windows NTFS ACL Rollback Script (v2.2.1)
param(
  [string]$BackupFile,
  [string]$AicoRoot = "D:\AI-COMPANY"
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================================="
Write-Host "  AICO NTFS ACL ROLLBACK TOOLKIT (v2.2.1)"
Write-Host "=========================================================="

if (-not $BackupFile) {
  # Find latest backup file
  $latest = Get-ChildItem -Path "D:\AI-COMPANY\backup" -Filter "acl_backup_*.txt" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) {
    # Check pre-v2.2.1 baseline backup
    if (Test-Path "D:\AI-COMPANY\backup\acl_pre_v221.txt") {
      $BackupFile = "D:\AI-COMPANY\backup\acl_pre_v221.txt"
    } else {
      Write-Error "No ACL backup file specified or found in D:\AI-COMPANY\backup"
      exit 1
    }
  } else {
    $BackupFile = $latest.FullName
  }
}

Write-Host "Restoring ACL from: $BackupFile"
& icacls "$AicoRoot" /restore "$BackupFile" /c /q
if ($LASTEXITCODE -ne 0) {
  throw "ICACLS_RESTORE_ERROR: icacls returned exit code $LASTEXITCODE during restore"
}

Write-Host "NTFS ACL rollback finished."
