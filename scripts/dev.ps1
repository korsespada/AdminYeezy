$ErrorActionPreference = "Stop"

function Test-TcpPort([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Get-FreeWebPort {
  for ($port = 3000; $port -le 3100; $port++) {
    # Rails API in Yeezy-Site always uses this port.
    if ($port -ne 3001 -and -not (Test-TcpPort $port)) {
      return $port
    }
  }

  throw "No available web port found between 3000 and 3100."
}

$root = Split-Path -Parent $PSScriptRoot
$next = Join-Path $root "node_modules\.bin\next.cmd"
if (-not (Test-Path -LiteralPath $next)) {
  throw "Next.js is not installed. Run npm install in $root."
}

$webPort = Get-FreeWebPort
Write-Host "Starting admin on http://127.0.0.1:$webPort"
Set-Location $root
& $next dev --port $webPort
