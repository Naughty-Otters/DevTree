# Azure Artifact Signing wrapper for Tauri `bundle.windows.signCommand`.
# Same AZURE_* env vars as OpenFDE (electron-builder azureSignOptions).
#
# Configure via object-form signCommand so Tauri does NOT split on spaces:
#   { "cmd": "powershell.exe", "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "<abs>/scripts/sign-windows.ps1", "%1"] }
# The literal "%1" arg is replaced with the binary path by Tauri.

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$FilePath
)

$ErrorActionPreference = 'Stop'

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }
  return $value.Trim()
}

$endpoint = (Require-Env 'AZURE_SIGNING_ENDPOINT').TrimEnd('/')
$account = Require-Env 'AZURE_SIGNING_ACCOUNT_NAME'
$profile = Require-Env 'AZURE_SIGNING_CERTIFICATE_PROFILE'
$null = Require-Env 'AZURE_TENANT_ID'
$null = Require-Env 'AZURE_CLIENT_ID'
$null = Require-Env 'AZURE_CLIENT_SECRET'

if (-not (Test-Path -LiteralPath $FilePath)) {
  throw "File to sign not found: $FilePath"
}

$signCmd = Get-Command sign -ErrorAction SilentlyContinue
if ($signCmd) {
  $signExe = $signCmd.Source
} else {
  $dotnetTools = Join-Path $env:USERPROFILE '.dotnet\tools\sign.exe'
  if (-not (Test-Path -LiteralPath $dotnetTools)) {
    throw "Microsoft 'sign' tool not found. Install with: dotnet tool install -g --prerelease sign"
  }
  $signExe = $dotnetTools
}

# NOTE: do not use $args — it is a PowerShell automatic variable.
$signArgs = @(
  'code',
  'artifact-signing',
  '--artifact-signing-endpoint', $endpoint,
  '--artifact-signing-account', $account,
  '--artifact-signing-certificate-profile', $profile,
  '--timestamp-url', 'http://timestamp.acs.microsoft.com',
  '--file-digest', 'sha256',
  $FilePath
)

Write-Host "Signing $FilePath"
Write-Host "  endpoint=$endpoint account=$account profile=$profile"
$publisher = [Environment]::GetEnvironmentVariable('AZURE_SIGNING_PUBLISHER_NAME')
if (-not [string]::IsNullOrWhiteSpace($publisher)) {
  Write-Host "  publisher=$($publisher.Trim())"
}
Write-Host "  sign=$signExe"

& $signExe @signArgs
if ($LASTEXITCODE -ne 0) {
  throw "sign failed with exit code $LASTEXITCODE for $FilePath"
}

Write-Host "Signed OK: $FilePath"
