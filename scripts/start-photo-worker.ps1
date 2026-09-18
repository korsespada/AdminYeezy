param(
  # Проверка сообщений и шагов без запуска воркера.
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
# Скрипт лежит в scripts\, поэтому корень проекта — родительский каталог.
$project = Split-Path -Parent $PSScriptRoot
$adminUrl = 'http://localhost:3210'
$adminPort = 3210
Set-Location -LiteralPath $project

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

# Порт может быть занят зависшей админкой: тогда воркер не получит задания,
# поэтому проверяем именно ответ по HTTP, а не только факт прослушивания.
function Test-Admin {
  try {
    $response = Invoke-WebRequest -Uri "$adminUrl/login" -TimeoutSec 25 -UseBasicParsing
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Stop-StaleAdmin {
  $listeners = Get-NetTCPConnection -LocalPort $adminPort -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    Write-Host "      останавливаю зависший процесс $($process.Id) ($($process.ProcessName))"
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 3
}

function Start-Admin {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "cd /d $project && npx next dev -p $adminPort"
}

Write-Host '============================================================'
Write-Host '  Очистка фото David Studio от вотермарки'
Write-Host '  Воркер берёт задания из очереди и чистит кадры нейросетью LaMa.'
Write-Host '============================================================'
Write-Host ''

Write-Host '[1/3] Туннель к боевой базе (localhost:15432)...'
if (Test-Port 15432) {
  Write-Host '      уже поднят.'
} else {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $project 'scripts\db-tunnel.ps1')
  if (-not (Test-Port 15432)) {
    Write-Host '      НЕ УДАЛОСЬ поднять туннель. Проверьте ключ C:\Users\korse\.ssh\adminyeezy_ed25519' -ForegroundColor Red
    if (-not $DryRun) { Read-Host 'Нажмите Enter, чтобы закрыть' }
    exit 1
  }
}

Write-Host ''
Write-Host "[2/3] Локальная админка на $adminUrl (воркер берёт задания у неё)..."
if (Test-Admin) {
  Write-Host '      отвечает.'
} else {
  if (Test-Port $adminPort) {
    Write-Host '      порт занят, но админка не отвечает - перезапускаю.'
    Stop-StaleAdmin
  } else {
    Write-Host '      не запущена, поднимаю в отдельном окне.'
  }
  Start-Admin
  Write-Host '      жду до 90 секунд, пока админка соберётся...'
  $ready = $false
  for ($attempt = 1; $attempt -le 9; $attempt++) {
    Start-Sleep -Seconds 10
    if (Test-Admin) { $ready = $true; break }
    Write-Host "      попытка $attempt из 9..."
  }
  if (-not $ready) {
    Write-Host '      админка не ответила. Запустите её вручную: npx next dev -p 3210' -ForegroundColor Red
    if (-not $DryRun) { Read-Host 'Нажмите Enter, чтобы закрыть' }
    exit 1
  }
  Write-Host '      админка отвечает.'
}

Write-Host ''
Write-Host '[3/3] Запускаю воркер чистки.'
Write-Host ''
Write-Host '  ВАЖНО: не запускайте второй такой же воркер, LaMa забирает все ядра.'
Write-Host '  Остановить: Ctrl+C в этом окне.'
Write-Host ''

if ($DryRun) {
  Write-Host '(DryRun: воркер здесь не запускается)'
  exit 0
}

node (Join-Path $project 'scripts\photo-clean-worker.mjs')

Write-Host ''
Write-Host 'Воркер остановлен.'
Read-Host 'Нажмите Enter, чтобы закрыть'
