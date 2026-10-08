$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$projectEnv = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $projectEnv)) {
  throw '缺少项目 .env 配置文件'
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $projectEnv) {
  if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
    $settings[$matches[1]] = $matches[2].Trim('"')
  }
}

$modelEnvPath = if ($env:AI_GAMES_MODEL_ENV_FILE) {
  $env:AI_GAMES_MODEL_ENV_FILE
} else {
  $settings['AI_GAMES_MODEL_ENV_FILE']
}
if (-not $modelEnvPath -or -not (Test-Path -LiteralPath $modelEnvPath -PathType Leaf)) {
  throw '模型凭据文件不存在；请检查 .env 中的 AI_GAMES_MODEL_ENV_FILE'
}

$modelSettings = @{}
foreach ($line in Get-Content -LiteralPath $modelEnvPath) {
  if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
    $modelSettings[$matches[1]] = $matches[2]
  }
}
foreach ($name in @('MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_PROTOCOL', 'MODEL_API_KEY')) {
  if (-not $modelSettings[$name]) {
    throw "模型凭据文件缺少 $name"
  }
}

$modelEnabled = if ($env:WEREWOLF_MODEL_ENABLED) { $env:WEREWOLF_MODEL_ENABLED } else { $settings['WEREWOLF_MODEL_ENABLED'] }
$localTest = if ($env:WEREWOLF_LOCAL_TEST) { $env:WEREWOLF_LOCAL_TEST } else { $settings['WEREWOLF_LOCAL_TEST'] }
if ($modelEnabled -ne 'true' -or $localTest -ne 'true') {
  throw '本机狼人杀模型测试未启用；请检查 WEREWOLF_MODEL_ENABLED 和 WEREWOLF_LOCAL_TEST'
}

$portText = if ($env:APP_PORT) { $env:APP_PORT } else { $settings['APP_PORT'] }
if (-not $portText) { $portText = '3000' }
$port = 0
if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
  throw 'APP_PORT 必须是有效端口号'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw '未找到 Docker 命令'
}

Push-Location $projectRoot
try {
  $composeFiles = @('-f', 'compose.yaml')
  $activeCompose = Join-Path $projectRoot '.local/compose.active.yaml'
  if (Test-Path -LiteralPath $activeCompose -PathType Leaf) {
    $composeFiles += @('-f', $activeCompose)
  }
  & docker compose @composeFiles config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 配置无效' }
  & docker compose @composeFiles up -d --no-build app
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 启动失败；请确认本机已有应用镜像' }

  $healthUrl = "http://127.0.0.1:$port/api/health"
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw '狼人杀网页服务未通过健康检查；请查看 docker compose logs app' }
  Write-Output "狼人杀网页已就绪：http://127.0.0.1:$port/werewolf"
} finally {
  Pop-Location
}
