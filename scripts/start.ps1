#requires -Version 5.1
<#
.SYNOPSIS
  任务看板 · Windows 一键启动脚本

.DESCRIPTION
  双击根目录的「启动看板.cmd」即可进入交互式菜单；也支持命令行直接指定模式：
    start.ps1 dev       开发模式（热更新）
    start.ps1 prod      生产模式（构建 + 后台常驻服务）
    start.ps1 serve     仅启动服务（不重新构建）
    start.ps1 stop      停止后台服务
    start.ps1 install   重新安装依赖
    start.ps1 open      打开应用页面
    start.ps1 shortcut  创建桌面快捷方式

  可选开关：
    -NoPause  所有等待按键处不再停顿（适合命令行/自动化）
    -NoOpen   不自动打开浏览器（适合无头运行）
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Mode = '',
  [switch]$NoPause,
  [switch]$NoOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DevPort = 5173
$ProdPort = 4173
$RunDir = Join-Path $ProjectRoot '.run'
$LogDir = Join-Path $ProjectRoot 'logs'
$PidFile = Join-Path $RunDir 'server.json'

# ---------- 输出辅助 ----------

function Write-Step([string]$Message) {
  Write-Host '==> ' -ForegroundColor Cyan -NoNewline
  Write-Host $Message
}

function Write-Ok([string]$Message) {
  Write-Host '[OK] ' -ForegroundColor Green -NoNewline
  Write-Host $Message
}

function Write-Warn([string]$Message) {
  Write-Host '[!] ' -ForegroundColor Yellow -NoNewline
  Write-Host $Message
}

function Write-Err([string]$Message) {
  Write-Host '[X] ' -ForegroundColor Red -NoNewline
  Write-Host $Message
}

function Show-Banner {
  Write-Host ''
  Write-Host '  =========================================' -ForegroundColor Cyan
  Write-Host '       任务看板 · Task Dashboard 启动器      ' -ForegroundColor White
  Write-Host '  =========================================' -ForegroundColor Cyan
  Write-Host ''
}

function Pause-IfNeeded([string]$Prompt = '按回车键继续...') {
  if ($NoPause) { return }
  try { Read-Host $Prompt | Out-Null } catch { }
}

# ---------- 环境检查 ----------

function Assert-Prerequisites {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err '未检测到 Node.js。请先到 https://nodejs.org 安装 LTS 版本（>= 18）。'
    return $false
  }
  $versionText = ''
  try { $versionText = (& node -v 2>$null | Select-Object -First 1) } catch { }
  $major = -1
  if ($versionText -match '^v?(\d+)') { $major = [int]$Matches[1] }
  if ($major -lt 18) {
    Write-Err "Node.js 版本过低（当前 $versionText），本项目要求 >= 18，请升级后重试。"
    return $false
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Err '未检测到 npm（通常随 Node.js 一起安装）。'
    return $false
  }
  return $true
}

function Ensure-Dependencies {
  if (Test-Path (Join-Path $ProjectRoot 'node_modules')) { return $true }
  Write-Warn '首次运行：未检测到 node_modules，正在安装依赖（可能需要几分钟）...'
  Push-Location $ProjectRoot
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) {
      Write-Err '依赖安装失败，请检查网络后重试（或运行 npm install 查看详细错误）。'
      return $false
    }
  } finally {
    Pop-Location
  }
  Write-Ok '依赖安装完成'
  return $true
}

function Invoke-InstallDeps {
  if (-not (Assert-Prerequisites)) { return }
  Write-Step '重新安装依赖（npm install）...'
  Push-Location $ProjectRoot
  try {
    & npm install
    if ($LASTEXITCODE -eq 0) { Write-Ok '依赖安装完成' } else { Write-Err '依赖安装失败，请检查上方错误信息' }
  } finally {
    Pop-Location
  }
}

# ---------- 端口检测 ----------

function Get-ListenerPid([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -ne 0 } |
    Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  try {
    $line = (& netstat -ano 2>$null |
        Select-String -Pattern ":\s*$Port\s+\S+\s+LISTENING" |
        Select-Object -First 1).ToString()
    if ($line -match 'LISTENING\s+(\d+)') { return [int]$Matches[1] }
  } catch { }
  return 0
}

function Get-ProcessNameOrEmpty([int]$ProcessId) {
  if ($ProcessId -le 0) { return '' }
  try { return (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName } catch { return '' }
}

# ---------- 浏览器 / 就绪探测 ----------

function Open-Browser([string]$Url) {
  if ($NoOpen) {
    Write-Host "  应用地址：$Url（已跳过自动打开浏览器）"
    return
  }
  try {
    Start-Process $Url
    Write-Ok "已在默认浏览器打开：$Url"
  } catch {
    Write-Warn "无法自动打开浏览器，请手动访问：$Url"
  }
}

function Wait-ForHealth([int]$Port, [int]$MaxTries) {
  for ($i = 0; $i -lt $MaxTries; $i++) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$Port/health"
      if ($res.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# ---------- 后台服务管理 ----------

function Get-RunningServiceInfo {
  if (-not (Test-Path $PidFile)) { return $null }
  try {
    $info = Get-Content $PidFile -Raw | ConvertFrom-Json
    if ($null -eq $info -or $null -eq $info.pid) { throw 'bad file' }
    $pidValue = [int]$info.pid
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if (-not $proc) { throw 'process gone' }
    $listener = Get-ListenerPid ([int]$info.port)
    if ($listener -eq $pidValue) { return $info }
  } catch {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  }
  return $null
}

function Invoke-Serve([bool]$Build) {
  if (-not (Assert-Prerequisites)) { return }
  if (-not (Ensure-Dependencies)) { return }

  if ($Build) {
    Write-Step '构建生产版本（tsc 类型检查 + vite build）...'
    Push-Location $ProjectRoot
    try {
      & npm run build
      if ($LASTEXITCODE -ne 0) {
        Write-Err '构建失败，请检查上方错误信息后重试。'
        return
      }
    } finally {
      Pop-Location
    }
    Write-Ok '构建完成'
  } elseif (-not (Test-Path (Join-Path $ProjectRoot 'dist\index.html'))) {
    Write-Err '未找到 dist/index.html。请先选择「生产模式」完成构建，或运行 npm run build。'
    return
  }

  $running = Get-RunningServiceInfo
  if ($running) {
    Write-Warn "后台服务已在运行（PID $($running.pid)，端口 $($running.port)）。"
    Open-Browser "http://127.0.0.1:$($running.port)"
    return
  }

  $busyPid = Get-ListenerPid $ProdPort
  if ($busyPid -gt 0) {
    Write-Warn "端口 $ProdPort 被其他进程占用（PID $busyPid · $(Get-ProcessNameOrEmpty $busyPid)）。"
    $choice = Read-Host '输入 K 结束该进程后继续，O 仅打开页面，其他键返回'
    switch ($choice.ToLowerInvariant()) {
      'k' {
        Write-Step "正在结束进程 $busyPid ..."
        Stop-Process -Id $busyPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
        if ((Get-ListenerPid $ProdPort) -gt 0) {
          Write-Err '端口仍被占用，请手动处理后重试。'
          return
        }
      }
      'o' { Open-Browser "http://127.0.0.1:$ProdPort"; return }
      default { return }
    }
  }

  New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null
  $outLog = Join-Path $LogDir 'server.out.log'
  $errLog = Join-Path $LogDir 'server.err.log'
  Set-Content -Path $outLog -Value '' -ErrorAction SilentlyContinue
  Set-Content -Path $errLog -Value '' -ErrorAction SilentlyContinue

  Write-Step '启动后台常驻服务...'
  $nodePath = (Get-Command node).Source
  $proc = Start-Process -FilePath $nodePath `
    -ArgumentList @('scripts/server.mjs', '--port', "$ProdPort") `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

  @{
    pid       = $proc.Id
    port      = $ProdPort
    startedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  } | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8

  Write-Step '等待服务就绪...'
  if (Wait-ForHealth $ProdPort 30) {
    Write-Ok "服务已就绪：http://127.0.0.1:$ProdPort （PID $($proc.Id)）"
    Write-Host "  日志文件：logs\server.out.log / logs\server.err.log" -ForegroundColor DarkGray
    Open-Browser "http://127.0.0.1:$ProdPort"
  } else {
    Write-Err "服务启动超时，请查看日志：$errLog"
  }
}

function Invoke-StopService {
  $running = Get-RunningServiceInfo
  if (-not $running) {
    Write-Warn '没有正在运行的后台服务。'
    return
  }
  Write-Step "正在停止后台服务（PID $($running.pid)）..."
  Stop-Process -Id ([int]$running.pid) -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  Write-Ok '服务已停止'
}

# ---------- 开发模式 ----------

function Invoke-Dev {
  if (-not (Assert-Prerequisites)) { return }
  if (-not (Ensure-Dependencies)) { return }

  $busyPid = Get-ListenerPid $DevPort
  if ($busyPid -gt 0) {
    Write-Warn "端口 $DevPort 被占用（PID $busyPid · $(Get-ProcessNameOrEmpty $busyPid)）。"
    $choice = Read-Host '输入 K 结束该进程后继续，O 仅打开页面，其他键返回'
    switch ($choice.ToLowerInvariant()) {
      'k' {
        Write-Step "正在结束进程 $busyPid ..."
        Stop-Process -Id $busyPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
        if ((Get-ListenerPid $DevPort) -gt 0) {
          Write-Err '端口仍被占用，请手动处理后重试。'
          return
        }
      }
      'o' { Open-Browser "http://127.0.0.1:$DevPort"; return }
      default { return }
    }
  }

  Write-Step '启动开发服务器（热更新；关闭所有页面后服务自动停止）...'
  Write-Host '  按 Ctrl+C 可随时停止。' -ForegroundColor DarkGray

  $viteBin = Join-Path $ProjectRoot 'node_modules\vite\bin\vite.js'
  Push-Location $ProjectRoot
  try {
    if ($NoOpen) {
      & node $viteBin
    } else {
      & node $viteBin --open
    }
  } finally {
    Pop-Location
  }
  Write-Ok '开发服务器已停止'
}

# ---------- 其他 ----------

function Invoke-OpenPage {
  $running = Get-RunningServiceInfo
  if ($running) { Open-Browser "http://127.0.0.1:$($running.port)"; return }
  if ((Get-ListenerPid $ProdPort) -gt 0) { Open-Browser "http://127.0.0.1:$ProdPort"; return }
  if ((Get-ListenerPid $DevPort) -gt 0) { Open-Browser "http://127.0.0.1:$DevPort"; return }
  Write-Warn '未检测到正在运行的服务，请先选择「生产模式」或「仅启动服务」。'
}

function Invoke-CreateShortcut {
  try {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    $linkPath = Join-Path $desktop '任务看板.lnk'
    $target = Join-Path $ProjectRoot '启动看板.cmd'
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = $target
    $link.WorkingDirectory = $ProjectRoot
    $link.Description = '一键启动任务看板（任务/习惯/日历/统计）'
    $link.Save()
    Write-Ok "桌面快捷方式已创建：$linkPath"
  } catch {
    Write-Err "创建快捷方式失败：$($_.Exception.Message)"
  }
}

# ---------- 交互式菜单 ----------

function Show-Menu {
  while ($true) {
    Show-Banner
    Write-Host '  [1] 开发模式       热更新调试（Ctrl+C 停止）'
    Write-Host '  [2] 生产模式       构建 + 后台常驻服务（推荐日常使用）'
    Write-Host '  [3] 仅启动服务     不重新构建，直接托管现有 dist'
    Write-Host '  [4] 停止后台服务'
    Write-Host '  [5] 重新安装依赖'
    Write-Host '  [6] 打开应用页面'
    Write-Host '  [7] 创建桌面快捷方式'
    Write-Host '  [0] 退出'
    Write-Host ''

    $choice = $null
    try {
      $choice = Read-Host '  请选择 [0-7]'
    } catch {
      Write-Warn '当前环境不支持交互输入。请改用命令行模式：启动看板.cmd [dev|prod|serve|stop|install|open|shortcut]'
      return
    }
    if ($null -eq $choice) { return }  # 标准输入已关闭（管道/重定向场景），安全退出
    switch ($choice.Trim()) {
      '1' { Invoke-Dev; Pause-IfNeeded }
      '2' { Invoke-Serve $true; Pause-IfNeeded }
      '3' { Invoke-Serve $false; Pause-IfNeeded }
      '4' { Invoke-StopService; Pause-IfNeeded }
      '5' { Invoke-InstallDeps; Pause-IfNeeded }
      '6' { Invoke-OpenPage; Pause-IfNeeded }
      '7' { Invoke-CreateShortcut; Pause-IfNeeded }
      '0' { Write-Host '再见！'; return }
      default { Write-Warn '无效选择，请输入 0-7。' }
    }
  }
}

# ---------- 入口 ----------

try {
  New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null

  switch ($Mode.ToLowerInvariant()) {
    ''         { Show-Menu }
    'dev'      { Invoke-Dev }
    'prod'     { Invoke-Serve $true }
    'serve'    { Invoke-Serve $false }
    'stop'     { Invoke-StopService }
    'install'  { Invoke-InstallDeps }
    'open'     { Invoke-OpenPage }
    'shortcut' { Invoke-CreateShortcut }
    default    { Write-Err "未知模式：$Mode（可用：dev / prod / serve / stop / install / open / shortcut）" }
  }
} catch {
  Write-Err "发生未预期错误：$($_.Exception.Message)"
  Pause-IfNeeded '按回车键退出...'
}
