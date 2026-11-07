$ErrorActionPreference = "Stop"

# SSH tunnel localhost:15432 -> Postgres on the YUCONCIERGE server.
# Postgres runs as a Coolify database without a host port, so the tunnel
# targets the container IP on the Docker network. Override for another server:
#   $env:YU_SSH_HOST     ssh host alias from ~/.ssh/config (default: yu)
#   $env:YU_PG_CONTAINER Coolify database UUID / container name
$sshHost = if ($env:YU_SSH_HOST) { $env:YU_SSH_HOST } else { "yu" }
$container = if ($env:YU_PG_CONTAINER) { $env:YU_PG_CONTAINER } else { "tsq6n4yyapu6mdcqv8isbhqn" }
$localPort = 15432

$existing = Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "DB tunnel already listens on localhost:$localPort"
  exit 0
}

$containerIp = (& ssh.exe -o BatchMode=yes $sshHost "sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' $container").Trim().Split(" ")[0]
if (-not $containerIp) {
  throw "Postgres container $container not found on $sshHost"
}

$sshArgs = @(
  "-N",
  "-L", "${localPort}:${containerIp}:5432",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  $sshHost
)

Start-Process -FilePath "ssh.exe" -ArgumentList $sshArgs -WindowStyle Hidden
Start-Sleep -Seconds 2

$started = Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
if (!$started) {
  throw "DB tunnel did not start on localhost:$localPort"
}

Write-Host "DB tunnel ready: localhost:$localPort -> ${sshHost}:${containerIp}:5432 ($container)"
