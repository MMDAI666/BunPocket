# BunPocket 真机 USB 热重载启动脚本
# 用法：USB 连接手机后在项目根目录执行  .\dev-usb.ps1
# 原理：--host 127.0.0.1 让 app 加载手机本地回环地址，
#       adb reverse 把手机的 1420(页面)/1421(HMR) 通过 USB 转发到电脑。
# 注意：USB 重插后 reverse 会失效，重新执行本脚本即可。

$ErrorActionPreference = "Stop"

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    Write-Error "未找到 adb，请把 Android SDK platform-tools 加入 PATH"
}

$devices = (adb devices) | Select-Object -Skip 1 | Where-Object { $_ -match "\sdevice$" }
if (-not $devices) {
    Write-Error "没有已授权的 Android 设备：请连接手机并允许 USB 调试后重试"
}

adb reverse tcp:1420 tcp:1420
adb reverse tcp:1421 tcp:1421

# 本机 PATH 可能没有全局 pnpm，统一用 corepack 运行
corepack pnpm tauri android dev --host 127.0.0.1
