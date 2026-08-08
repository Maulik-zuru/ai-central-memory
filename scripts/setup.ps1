# One-command setup for Windows: installs Node.js and PostgreSQL if they're missing, starts the
# Postgres service, then hands off to scripts/setup.mjs for the app-specific setup (databases,
# .env files, npm installs, migrations).
#
# Usage (from an elevated PowerShell prompt — winget install needs it):
#   .\scripts\setup.ps1
#
# Safe to re-run: every step checks whether it's already done before doing anything.

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "==> AI Memory & Context Platform - setup (Windows)" -ForegroundColor Cyan

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Test-Winget {
  return Test-Command "winget"
}

# --- 1. Node.js ---------------------------------------------------------------------------

if (Test-Command "node") {
  Write-Host "==> Node.js already installed: $(node -v)"
} else {
  Write-Host "==> Node.js not found - installing..."
  if (Test-Winget) {
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    # winget updates PATH for new shells, not this one — refresh it for the rest of this script.
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  } else {
    Write-Host "    winget not found. Install Node.js 20+ manually from https://nodejs.org, then re-run this script." -ForegroundColor Yellow
    exit 1
  }
  if (-not (Test-Command "node")) {
    Write-Host "    Node.js install finished but isn't on PATH yet. Close and reopen PowerShell, then re-run this script." -ForegroundColor Yellow
    exit 1
  }
  Write-Host "==> Installed Node.js: $(node -v)"
}

# --- 2. PostgreSQL -------------------------------------------------------------------------

if (Test-Command "psql") {
  Write-Host "==> PostgreSQL client already installed"
} else {
  Write-Host "==> PostgreSQL not found - installing..."
  if (Test-Winget) {
    winget install --id PostgreSQL.PostgreSQL.16 -e --source winget --accept-package-agreements --accept-source-agreements
    # The installer's bin directory isn't reliably on PATH in the current session — add the
    # common default location so `psql` resolves without reopening the shell.
    $pgBin = "C:\Program Files\PostgreSQL\16\bin"
    if (Test-Path $pgBin) { $env:Path += ";$pgBin" }
  } else {
    Write-Host "    winget not found. Install PostgreSQL manually from https://www.postgresql.org/download/windows/, then re-run this script." -ForegroundColor Yellow
    exit 1
  }
  if (-not (Test-Command "psql")) {
    Write-Host "    PostgreSQL installed but 'psql' isn't on PATH yet. Close and reopen PowerShell, then re-run this script." -ForegroundColor Yellow
    exit 1
  }
  Write-Host ""
  Write-Host "    NOTE: the PostgreSQL installer sets its own superuser password interactively." -ForegroundColor Yellow
  Write-Host "    If you were prompted for one, set it here before continuing so setup.mjs can connect:" -ForegroundColor Yellow
  Write-Host '      $env:DB_PASSWORD = "the-password-you-set"' -ForegroundColor Yellow
  Write-Host "    then re-run: .\scripts\setup.ps1"
  Write-Host ""
}

# --- 3. Make sure the PostgreSQL service is running -----------------------------------------

Write-Host "==> Ensuring PostgreSQL service is running"
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService) {
  if ($pgService.Status -ne "Running") {
    try {
      Start-Service $pgService.Name
      Write-Host "    started $($pgService.Name)"
    } catch {
      Write-Host "    ! Could not start $($pgService.Name) automatically. Start it from Services.msc, then re-run this script." -ForegroundColor Yellow
    }
  } else {
    Write-Host "    already running"
  }
} else {
  Write-Host "    ! Could not find a PostgreSQL Windows service. If Postgres was installed a non-standard way, make sure it's running before continuing." -ForegroundColor Yellow
}

# --- 4. Hand off to the cross-platform setup script -------------------------------------------

Write-Host "==> Running app setup (databases, .env files, npm install, migrations)"
node "$RootDir\scripts\setup.mjs"
