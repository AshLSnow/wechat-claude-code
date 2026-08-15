param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
  [string]$Command,

  [string]$Instance = $(if ($env:WCC_INSTANCE) { $env:WCC_INSTANCE } else { 'default' })
)

$ErrorActionPreference = 'Stop'

if ($Instance -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$') {
  throw "Invalid instance id: $Instance"
}

$projectDir = Split-Path -Parent $PSScriptRoot
$baseDataDir = if ($env:WCC_DATA_DIR) {
  [System.IO.Path]::GetFullPath($env:WCC_DATA_DIR)
} else {
  Join-Path $HOME '.wechat-claude-code'
}
$dataDir = if ($Instance -eq 'default') {
  $baseDataDir
} else {
  Join-Path (Join-Path $baseDataDir 'instances') $Instance
}
$logsDir = Join-Path $dataDir 'logs'
$pidPath = Join-Path $dataDir 'wechat-claude-code.pid'
$stdoutPath = Join-Path $logsDir 'stdout.log'
$stderrPath = Join-Path $logsDir 'stderr.log'
$entryPath = Join-Path $projectDir 'dist\main.js'

function Get-ManagedProcess {
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  $savedPid = (Get-Content -LiteralPath $pidPath -Raw).Trim()
  if ($savedPid -notmatch '^\d+$') { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  if ($process.CommandLine -notlike "*$entryPath*" -or $process.CommandLine -notlike "*--instance*$Instance*") {
    return $null
  }
  return $process
}

function Start-Bridge {
  $existing = Get-ManagedProcess
  if ($existing) {
    Write-Output "Already running (instance: $Instance, PID: $($existing.ProcessId))"
    return
  }
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  $node = (Get-Command node -ErrorAction Stop).Source
  $startParameters = @{
    FilePath = $node
    ArgumentList = @("`"$entryPath`"", 'start', '--instance', $Instance)
    WorkingDirectory = $projectDir
    RedirectStandardOutput = $stdoutPath
    RedirectStandardError = $stderrPath
    WindowStyle = 'Hidden'
    PassThru = $true
  }
  $process = Start-Process @startParameters
  Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
  Write-Output "Started (instance: $Instance, PID: $($process.Id))"
}

function Stop-Bridge {
  $process = Get-ManagedProcess
  if (-not $process) {
    if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
    Write-Output "Not running (instance: $Instance)"
    return
  }
  Stop-Process -Id $process.ProcessId
  Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
  if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
    Stop-Process -Id $process.ProcessId -Force
  }
  if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
  Write-Output "Stopped (instance: $Instance, PID: $($process.ProcessId))"
}

function Show-Status {
  $process = Get-ManagedProcess
  if ($process) {
    Write-Output "Running (instance: $Instance, PID: $($process.ProcessId))"
  } else {
    Write-Output "Not running (instance: $Instance)"
  }
}

function Show-Logs {
  foreach ($path in @($stdoutPath, $stderrPath)) {
    if (Test-Path -LiteralPath $path) {
      Write-Output "--- $(Split-Path -Leaf $path) ---"
      Get-Content -LiteralPath $path -Tail 100
    }
  }
}

switch ($Command) {
  'start' { Start-Bridge }
  'stop' { Stop-Bridge }
  'restart' { Stop-Bridge; Start-Bridge }
  'status' { Show-Status }
  'logs' { Show-Logs }
}
