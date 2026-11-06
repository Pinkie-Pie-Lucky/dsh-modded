# run-modded.ps1 — 启动魔改版 DeepSeek Harness（独立家目录，与官方版隔离并存）
#
# 用法（在仓库根目录）：
#   .\run-modded.ps1            # 浏览器界面
#   .\run-modded.ps1 -Mode headless   # 纯命令行
#   .\run-modded.ps1 -Home 'D:\my-home'  # 自定义家目录
#
# 前置（只需一次）：
#   corepack enable            # 启用 pnpm（Node 自带 corepack）
#   pnpm install
#   pnpm run build

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
    Write-Host '[modded] 未找到 node_modules，请先运行:' -ForegroundColor Yellow
    Write-Host '          corepack enable' -ForegroundColor Yellow
    Write-Host '          pnpm install' -ForegroundColor Yellow
    Write-Host '          pnpm run build' -ForegroundColor Yellow
    exit 1
}

# 4) 启动（如端口与官方版冲突，用 `pnpm dsh --profile web --help` 查端口参数）
pnpm dsh $Mode
