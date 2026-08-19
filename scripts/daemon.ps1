param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet(
    'start', 'stop', 'restart', 'status', 'logs',
    'enable-startup', 'disable-startup', 'startup-status', 'run-task'
  )]
  [string]$Command,

  [string]$Instance = $(if ($env:WCC_INSTANCE) { $env:WCC_INSTANCE } else { 'default' }),
  [string]$DataDirectory,
  [string]$NodeExecutable
)

$ErrorActionPreference = 'Stop'

if ($Instance -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$') {
  throw "Invalid instance id: $Instance"
}

$projectDir = Split-Path -Parent $PSScriptRoot
$baseDataDir = if ($DataDirectory) {
  [System.IO.Path]::GetFullPath($DataDirectory)
} elseif ($env:WCC_DATA_DIR) {
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
$taskName = "WeChatClaudeCode-$Instance"
$nodePath = if ($NodeExecutable) {
  [System.IO.Path]::GetFullPath($NodeExecutable)
} else {
  (Get-Command node -ErrorAction Stop).Source
}

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

function Get-StartupTask {
  return Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Wait-ForBridge {
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $process = Get-ManagedProcess
    if ($process) { return $process }
    Start-Sleep -Milliseconds 100
  }
  throw "Bridge did not start within 10 seconds (instance: $Instance)"
}

function Start-UnmanagedBridge {
  $existing = Get-ManagedProcess
  if ($existing) {
    Write-Output "Already running (instance: $Instance, PID: $($existing.ProcessId))"
    return
  }
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  $startParameters = @{
    FilePath = $nodePath
    ArgumentList = @("`"$entryPath`"", 'start', '--instance', $Instance)
    WorkingDirectory = $projectDir
    RedirectStandardOutput = $stdoutPath
    RedirectStandardError = $stderrPath
    WindowStyle = 'Hidden'
    PassThru = $true
  }
  $process = Start-Process @startParameters
  Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
  Write-Output "Started (instance: $Instance, PID: $($process.Id), mode: manual)"
}

function Start-Bridge {
  $existing = Get-ManagedProcess
  if ($existing) {
    Write-Output "Already running (instance: $Instance, PID: $($existing.ProcessId))"
    return
  }

  $task = Get-StartupTask
  if (-not $task) {
    Start-UnmanagedBridge
    return
  }

  if ($task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  Start-ScheduledTask -TaskName $taskName
  $process = Wait-ForBridge
  Write-Output "Started (instance: $Instance, PID: $($process.ProcessId), mode: scheduled)"
}

function Stop-Bridge {
  $process = Get-ManagedProcess
  $task = Get-StartupTask
  if ($task -and $task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }

  if ($process) {
    Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $process.ProcessId -Force
    }
  }
  if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }

  if ($process) {
    Write-Output "Stopped (instance: $Instance, PID: $($process.ProcessId))"
  } else {
    Write-Output "Not running (instance: $Instance)"
  }
}

function Show-Status {
  $process = Get-ManagedProcess
  $task = Get-StartupTask
  if ($process) {
    Write-Output "Running (instance: $Instance, PID: $($process.ProcessId))"
  } else {
    Write-Output "Not running (instance: $Instance)"
  }
  if ($task) {
    Write-Output "Autostart: enabled at logon (task: $taskName, state: $($task.State))"
  } else {
    Write-Output "Autostart: disabled (task: $taskName)"
  }
}

function Show-StartupStatus {
  $task = Get-StartupTask
  if (-not $task) {
    Write-Output "Autostart disabled (instance: $Instance, task: $taskName)"
    return
  }
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  Write-Output "Autostart enabled (instance: $Instance, task: $taskName, state: $($task.State))"
  Write-Output "Last run: $($info.LastRunTime); last result: $($info.LastTaskResult); next run: $($info.NextRunTime)"
}

function Enable-Startup {
  if (-not (Test-Path -LiteralPath $entryPath)) {
    throw "Built entry point not found: $entryPath. Run npm run build first."
  }
  Stop-Bridge
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

  $powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
  $scriptPath = $PSCommandPath
  $arguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', "`"$scriptPath`"",
    'run-task',
    '-Instance', "`"$Instance`"",
    '-DataDirectory', "`"$baseDataDir`"",
    '-NodeExecutable', "`"$nodePath`""
  ) -join ' '
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $projectDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "WeChat Claude Code instance '$Instance'; starts at user logon and restarts after failure." `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $taskName
  $process = Wait-ForBridge
  Write-Output "Autostart enabled and running (instance: $Instance, PID: $($process.ProcessId), task: $taskName)"
}

function Disable-Startup {
  $task = Get-StartupTask
  if (-not $task) {
    Write-Output "Autostart already disabled (instance: $Instance, task: $taskName)"
    return
  }
  Stop-Bridge
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Autostart disabled (instance: $Instance, task: $taskName)"
  Start-UnmanagedBridge
}

function Run-TaskBridge {
  while ($true) {
    $existing = Get-ManagedProcess
    if ($existing) {
      Wait-Process -Id $existing.ProcessId -ErrorAction SilentlyContinue
    } else {
      New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
      $startParameters = @{
        FilePath = $nodePath
        ArgumentList = @("`"$entryPath`"", 'start', '--instance', $Instance)
        WorkingDirectory = $projectDir
        RedirectStandardOutput = $stdoutPath
        RedirectStandardError = $stderrPath
        WindowStyle = 'Hidden'
        PassThru = $true
      }
      $process = Start-Process @startParameters
      Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
      try {
        $process.WaitForExit()
      } finally {
        if (Test-Path -LiteralPath $pidPath) {
          $savedPid = (Get-Content -LiteralPath $pidPath -Raw).Trim()
          if ($savedPid -eq [string]$process.Id) { Remove-Item -LiteralPath $pidPath -Force }
        }
      }
    }

    # Supervise the Node child directly. Task Scheduler's restart policy is a
    # second layer for failures of this PowerShell supervisor itself.
    Start-Sleep -Seconds 60
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
  'enable-startup' { Enable-Startup }
  'disable-startup' { Disable-Startup }
  'startup-status' { Show-StartupStatus }
  'run-task' { Run-TaskBridge }
}
