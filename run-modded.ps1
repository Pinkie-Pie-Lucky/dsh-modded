# run-modded.ps1 — 启动魔改版 DeepSeek Harness（独立家目录，与官方版隔离并存）
#
# 用法（在仓库根目录）：
#   .\run-modded.ps1                    # 浏览器界面
#   .\run-modded.ps1 -Mode headless     # 纯命令行
#   .\run-modded.ps1 -Home 'D:\my-home' # 自定义家目录
#
# 前置（只需一次）：
#   pnpm install
#   pnpm run build
#   （本机若没装全局 pnpm，脚本会自动使用 DSH runtime 自带的那套）

param(
    [string]$Home = 'U:\魔改deepseek-home',
    [ValidateSet('web', 'headless')]
    [string]$Mode = 'web'
)

$ErrorActionPreference = 'Stop'

# 1) 独立家目录：会话/设置/凭据都存这里，与官方版的 ~/.dsh 完全隔离，
#    这样官方版和魔改版可以同时运行、互不干扰。
$env:DSH_HOME = $Home
New-Item -ItemType Directory -Force -Path $env:DSH_HOME | Out-Null
Write-Host "[modded] DSH_HOME = $env:DSH_HOME" -ForegroundColor Cyan

# 2) 进入仓库根目录（脚本所在目录）
Set-Location $PSScriptRoot

# 3) 前置检查：尚未构建则提示
if (-not (Test-Path 'node_modules')) {
    Write-Host '[modded] 未找到 node_modules，请先构建：' -ForegroundColor Yellow
    Write-Host '          pnpm install' -ForegroundColor Yellow
    Write-Host '          pnpm run build' -ForegroundColor Yellow
    exit 1
}

# 4) 定位 pnpm：优先全局 pnpm，否则回退到 DSH runtime 自带的（本机可能没装全局 pnpm）
$globalPnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if ($globalPnpm) {
    Write-Host '[modded] 使用全局 pnpm' -ForegroundColor DarkGray
    & pnpm dsh $Mode
}
else {
    $rtNode = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    $rtPnpm = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
    if ((Test-Path $rtNode) -and (Test-Path $rtPnpm)) {
        Write-Host '[modded] 使用 DSH runtime 自带 pnpm' -ForegroundColor DarkGray
        & $rtNode $rtPnpm dsh $Mode
    }
    else {
        Write-Host '[modded] 未找到 pnpm，请先执行 corepack enable 或 npm i -g pnpm' -ForegroundColor Red
        exit 1
    }
}
