param(
  [string]$PB_URL,
  [string]$PB_TOKEN
)

if (-not $PB_URL) { $PB_URL = $env:PB_URL }
if (-not $PB_URL) { $PB_URL = Read-Host "PB_URL" }

if (-not $PB_TOKEN) { $PB_TOKEN = $env:PB_TOKEN }
if (-not $PB_TOKEN) { $PB_TOKEN = Read-Host "PB_TOKEN" }

$env:PB_URL = $PB_URL
$env:PB_TOKEN = $PB_TOKEN

Write-Output "PB_URL set"
Write-Output "PB_TOKEN set"
