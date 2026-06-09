$ErrorActionPreference = "Stop"

$keyPath = Join-Path $env:USERPROFILE ".ssh\adminyeezy_ed25519"
if (!(Test-Path $keyPath)) {
  throw "SSH key not found: $keyPath"
}

$existing = Get-NetTCPConnection -LocalPort 15432 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "DB tunnel already listens on localhost:15432"
  exit 0
}

$sshArgs = @(
  "-i", $keyPath,
  "-N",
  "-L", "15432:127.0.0.1:5432",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "root@85.198.97.100"
)

Start-Process -FilePath "ssh.exe" -ArgumentList $sshArgs -WindowStyle Hidden
Start-Sleep -Seconds 2

$started = Get-NetTCPConnection -LocalPort 15432 -State Listen -ErrorAction SilentlyContinue
if (!$started) {
  throw "DB tunnel did not start on localhost:15432"
}

Write-Host "DB tunnel ready: localhost:15432 -> 85.198.97.100:127.0.0.1:5432"
