# BunPocket 真机 USB 热重载启动脚本
# 用法：USB 连接手机后在项目根目录执行  .\dev-usb.ps1
# 原理：--host 127.0.0.1 让 app 加载手机本地回环地址，
#       adb reverse 把手机的 1420(页面)/1421(HMR) 通过 USB 转发到电脑。
# 注意：USB 重插后 reverse 会失效，重新执行本脚本即可。

adb reverse tcp:1420 tcp:1420
adb reverse tcp:1421 tcp:1421
pnpm tauri android dev --host 127.0.0.1
