# BunPocket

本地优先的个人记账 App：数据只存在本机 SQLite，无账号、无云同步。Tauri 2 桌面端 + Android 原生壳，桌面（Windows）与 Android 真机均可跑。

- 前端：React 19 + TypeScript + Vite，移动端优先的 UI 与交互动效
- 后端：Rust / Tauri 2，SQLite 由 `tauri-plugin-sql`（sqlx）管理，迁移在 Rust 侧注册
- 平台：Windows 桌面 + Android（含桌面小组件）；iOS 未适配

## 功能

- **记一笔**：支出/收入，金额、分类、备注、日期、时间，可标记"不计入预算"；保存后可直接"再记"。
- **首页**：今日/本月支出、预算周期剩余与剩余日均、距结算日、最近记录、分类预算进度。
- **账单**：按日分组、按备注/分类（含当前语言分类名）搜索、分页加载、编辑/删除。
- **统计**：月度/年度、支出/收入/净收入、每日收支柱状图、月趋势、分类占比（可单击下穿子分类、面包屑返回）、预算执行。
- **分类**：两级分类；预置分类可改名/隐藏/换图标（图标库、emoji、相册图片三种），也可新增自定义分类。
- **预算**：月总预算 + 分类预算 + 结算日（1–28），周期内按"是否计入预算"统计。
- **数据备份/恢复**：每日自动备份、手动立即备份、VACUUM 快照 + 完整性校验、恢复前自动快照、旧版本备份两阶段恢复（详见下文）。
- **Android 桌面小组件**：今日支出 / 本月支出 / 周期剩余预算，点击整条进入"记一笔"。
- **深链**：Android 注册 `bunpocket://add`，从系统入口直达记账页。
- **外观**：浅色/深色/跟随系统；中英文双语；Android 返回键与手势返回适配。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19、TypeScript 6、Vite 8、Tailwind CSS 4、ECharts 6、react-router-dom 7（HashRouter）、i18next |
| 后端 | Rust（stable，本机 1.99）、Tauri 2、tauri-plugin-sql（SQLite/sqlx）、tauri-plugin-fs、tauri-plugin-deep-link |
| 数据 | SQLite 单文件主库 + sqlx migrations（append-only） |
| Android | Tauri 生成的 Gradle 工程（已入库）+ Kotlin 小组件/返回键定制 |
| 工具链 | Node 24 + corepack pnpm 12.18.0；JDK 21 + Android SDK（compileSdk/targetSdk 36）+ NDK |

## 目录结构

```
BunPocket/
├─ src/                          前端源码（React）
│  ├─ pages/                     首页 / 记一笔 / 账单 / 统计 / 设置 / 分类 / 预算
│  ├─ components/                通用 UI（含 ECharts 封装、ErrorBoundary、Sheet/Confirm 等）
│  ├─ lib/                       业务与工具（backup 备份恢复、分类、金额、主题、图片…）
│  ├─ hooks/                     主题 / 语言 / 返回键
│  ├─ i18n/locales/              zh-CN.json / en-US.json
│  └─ db.ts                      SQLite 访问层（Database.load 时自动跑迁移）
├─ src-tauri/
│  ├─ src/lib.rs                 插件初始化 + 迁移注册（版本 1–4）
│  ├─ src/main.rs                Tauri 桌面入口
│  ├─ migrations/                001–004，只追加（见"数据库迁移"）
│  ├─ capabilities/default.json  Tauri 权限（能力）配置
│  ├─ tauri.conf.json            窗口 / CSP / 打包配置
│  └─ gen/android/               Android Gradle 工程（已入库，勿删除/重新 init）
├─ .github/workflows/ci.yml      CI：前端构建 + cargo check
├─ index.html                    前端入口（含深色模式冷启动预上色内联脚本）
├─ vite.config.ts                Vite 配置（固定 1420 端口、HMR 1421）
├─ dev-usb.ps1                   Android USB 真机热重载脚本
└─ LICENSE                       MIT
```

## 环境要求

- **桌面开发**：Node 24、corepack（随 Node 提供）；Windows 上需 WebView2 运行时（Win11 自带）与 MSVC Build Tools（Rust 链接）；Rust stable。
- **Android 构建**：JDK 21、Android SDK（platform 36 / build-tools）、NDK、adb。本机已安装并配置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`，`adb` 若不在 PATH 可用 `"$env:ANDROID_HOME\platform-tools\adb.exe"`。
- **pnpm 约定**：本机 `pnpm` 不在 PATH，前端相关命令统一用 **`corepack pnpm ...`**（包括 `dev-usb.ps1` 等脚本里的 `pnpm` 调用，不要执行 `pnpm install` 手工改锁文件；依赖变更由维护者统一处理并提交 `pnpm-lock.yaml`）。未 `corepack enable` 的机器上，Android Gradle 构建也已内置 `corepack pnpm` 兜底（见"Android 工程"）。

## 开发命令

```pwsh
# 前端：类型检查 + 构建产物到 dist/
corepack pnpm build

# 桌面端调试（Vite devServer + Tauri 窗口）
# tauri.conf.json 的 beforeDevCommand/beforeBuildCommand 也写成 corepack pnpm ...，避免依赖全局 pnpm
corepack pnpm tauri dev

# 桌面端打包（msi/nsis 等）
corepack pnpm tauri build
```

Rust 侧校验（**注意本机 TMP 问题**）：

```pwsh
# 本机默认 %TEMP% 目录权限受限，cargo/rustc 的临时文件会失败；
# 把 TMP/TEMP 指到项目内目录后再跑（与 CI 无关，仅本机需要）
$env:TMP = 'D:\Projects\BunPocket\src-tauri\target\tmp'
$env:TEMP = $env:TMP
New-Item -ItemType Directory -Force -Path $env:TMP | Out-Null

cargo check --all-targets --manifest-path src-tauri/Cargo.toml
```

## Android 构建与真机

**工程位置**：`src-tauri/gen/android/`，已随仓库入库。

> ⚠️ 不要删除 `gen/android`，也不要重新执行 `tauri android init`（除非确认要重做全部 Android 定制）。该目录除 Tauri 生成内容外，还有人工维护的定制：小组件（`BunPocketWidgetProvider.kt`、`res/layout/widget_today.xml`、`res/xml/widget_info.xml`）、`MainActivity.kt` 返回键处理、manifest 深链配置、`app/build.gradle.kts` 的 release 签名配置等；重新生成会覆盖/丢失这些修改。

```pwsh
# Debug APK（真机调试 / 冒烟）
corepack pnpm tauri android build --debug --apk

# Release APK / AAB（签名见"发布签名"；无 keystore.properties 时为未签名产物）
corepack pnpm tauri android build --apk
corepack pnpm tauri android build --aab
```

### USB 真机热重载

```pwsh
# 手机的 1420(页面)/1421(HMR) 经 USB 转发到电脑；USB 重插后 reverse 失效需重跑
& "$env:ANDROID_HOME\platform-tools\adb.exe" reverse tcp:1420 tcp:1420
& "$env:ANDROID_HOME\platform-tools\adb.exe" reverse tcp:1421 tcp:1421
corepack pnpm tauri android dev --host 127.0.0.1
```

`dev-usb.ps1` 封装了同样流程；若脚本内 `pnpm` 命令不可用，把它替换为 `corepack pnpm` 或直接执行上面三行。

### 真机冒烟清单（发版前逐项过）

1. 冷启动：无白屏；深色模式跟随系统/设置生效；启动无报错日志。
2. 记一笔：支出/收入切换、金额校验、分类、备注、日期、时间、"不计入预算"；保存与"再记"。
3. 首页：今日/本月支出与账单一致；预算周期、剩余、剩余日均、距结算日；最近记录。
4. 账单：按月切换、搜索（备注/分类名）、加载更多、删除确认与列表刷新。
5. 统计：月/年切换、收支切换、每日收支、月趋势、分类占比（单击下穿/面包屑返回）、预算执行。
6. 分类：新增/重命名/隐藏/删除限制（有子分类或有账单时拒绝）；图标库/emoji/图片三种图标与"恢复默认"。
7. 预算：总预算、分类预算、结算日、分类合计超总预算提示、超支状态。
8. 设置：主题、语言、立即备份、恢复最近备份、恢复前快照、备份保留份数。
9. 小组件：添加 1x4 小组件，数据与 App 一致（App 退到后台后刷新）；点击进入"记一笔"。
10. 深链：`adb shell am start -a android.intent.action.VIEW -d "bunpocket://add"` 直达记账页，返回栈为"首页 → 记一笔"。
11. 返回键/手势：首页返回退到桌面；其他页面返回上一页；深链入口不产生空栈。
12. 升级/重装：debug 包与 release 包签名不同，不能覆盖安装；切换前先手动备份（卸载会清数据）。

## 数据库迁移（append-only）

- 迁移文件位于 `src-tauri/migrations/`，由 `src-tauri/src/lib.rs` 的 `migrations` 向量注册（`version` 递增，SQL 用 `migration_sql(include_str!(...))` 包一层）。
- **只追加新迁移文件，禁止修改已发布的旧迁移文件**：sqlx 用迁移 SQL 字节做 checksum，改动旧文件会让已装机用户升级时报"迁移被修改"而失败。
- `migration_sql()` 会把 CRLF 归一为 LF，保证同一迁移在 Windows/Linux 签出时 checksum 一致；仓库文本文件也由 `.gitattributes` 统一为 LF（只有 `*.ps1`/`*.bat`/`*.cmd` 保持 CRLF），迁移 SQL 运行时归一后跨平台字节一致。
- 版本 4（`004_business_constraints.sql`）是业务一致性触发器：`bill.exclude_budget/date/time/kind` 与 `category.hidden/is_system/父子 kind` 等约束。**触发器只对后续写入生效**，历史脏数据不会被自动清理。
- ⚠️ **升级后清一次数据**：本 App 处于开发阶段、无历史数据兼容包袱。若从旧的调试包/旧 schema 升级，建议升级后清一次应用数据（Android：系统设置里清除数据或卸载重装；桌面：退出后删除 `%APPDATA%\com.bunpocket.app` 下的 `bunpocket.db`），让 001–004 迁移从干净状态全量重放，避免旧脏数据触发新触发器或影响默认分类结构。

## Android 工程（gen/android）说明

- 已入库并被 Tauri 构建依赖；删除会导致 Android 构建失败，重新 `android init` 会丢失下述定制。
- 人工维护点：
  - `app/src/main/java/com/bunpocket/app/MainActivity.kt`：返回键/手势返回策略。
  - `app/src/main/java/com/bunpocket/app/BunPocketWidgetProvider.kt` + `res/layout/widget_today.xml` + `res/xml/widget_info.xml`：桌面小组件（只读打开 `bunpocket.db`）。
  - `app/build.gradle.kts`：release 签名（条件启用，见下）。
  - `buildSrc/src/main/java/com/bunpocket/app/kotlin/BuildTask.kt`：Gradle 内调用 Tauri CLI 的构建任务；`pnpm` 不在 PATH 时自动回退到 `corepack pnpm`（无需先 `corepack enable`）。
  - `app/src/main/AndroidManifest.xml`：应用配置与深链；其中 `DEEP LINK PLUGIN. AUTO-GENERATED` 注释区块由插件维护，勿手改。
- 安全加固：`AndroidManifest.xml` 的 `<application>` 已加 `android:allowBackup="false"`（禁止 adb backup / 系统云备份带走数据库）；`res/xml/file_paths.xml` 仅保留 `cache-path`（FileProvider 只共享缓存目录）。
- 已清理未被引用的模板资源：`res/layout/activity_main.xml`、`res/drawable/widget_plus_bg.xml`。

## 备份与恢复语义

- **主库**：`$APPCONFIG/bunpocket.db`（桌面为 `%APPDATA%\com.bunpocket.app`，Android 为应用私有 dataDir）。
- **备份目录**：`$APPCONFIG/backups/`。
- **自动备份**：每天首次连库时触发；当天已有备份则跳过。**手动备份**："设置 → 数据备份 → 立即备份"。
- **单个备份文件**：`backups/bunpocket-YYYYMMDD-HHmmss.db`。生成流程是先写 `*.db.partial` → `VACUUM INTO` 原子快照 → `PRAGMA integrity_check` + schema 版本校验 → rename 成正式文件名；进程被杀/断电只会留下 `.partial`，不会出现"看起来有效但已损坏"的最新备份。
- **轮转**：保留最近 N 份（设置页 1–30，默认 7 份）。
- **恢复来源**：自动选择"最新一份完整性校验通过、schema 版本不高于当前应用、且迁移记录与当前构建兼容"的备份；来自更新版本或迁移 checksum 不一致的备份会被跳过（后者会在换库前拦住，避免换库成功后应用打不开）。
- **恢复前快照**：每次恢复前自动把当前数据快照为 `backups/prerestore-<时间戳>.db`（只保留最近一份）。误恢复后可在设置页用"恢复前快照"回滚。
- **同版本恢复（进程内）**：备份 copy 到 `bunpocket.db-restore-tmp` → 关闭 SQLite 连接池 → 主库连同 `-wal/-shm/-journal` 成组 rename 为 `bunpocket.db.old*` → tmp rename 为主库 → 刷新页面。`bunpocket.db.old` 会保留作人工回退副本，直到下一次恢复时被覆盖。任一步失败会成组回滚，不会在误删 WAL 后留下不完整主库。
- **旧版本备份恢复（两阶段）**：当前进程无法对旧 schema 跑迁移，因此先把备份 copy 到 `bunpocket.db.pending-restore`，并弹常驻提示要求"立即完全退出应用后重新打开"；下次启动时 `src/main.tsx` 在打开数据库之前调用 `applyPendingRestore()`：校验 pending 文件完整性 + 迁移记录 → **先把"当前主库"快照到 `backups/prerestore-<时间戳>.db`**（暂存后新记的账可从这里找回）→ 主库连同 sidecar 换到 `.old*` → pending 换入主库 → 由 sqlx 执行迁移完成升级。
- 备份目录不会自动导出到外部存储；换机/重装前请手动把 `backups/` 拷出。

## 发布签名（Android release）

1. 生成 keystore（**keystore 与密码禁止入库**，仓库 `.gitignore` 已忽略 `*.jks`/`*.keystore`）：

   ```pwsh
   # 建议在 src-tauri/gen/android 目录内生成，storeFile 即可用相对路径
   cd src-tauri/gen/android
   keytool -genkeypair -v -keystore bunpocket-release.jks -alias bunpocket `
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. 在 `src-tauri/gen/android/keystore.properties`（已被 `src-tauri/gen/android/.gitignore` 忽略）填写：

   ```properties
   storeFile=bunpocket-release.jks
   storePassword=******
   keyAlias=bunpocket
   keyPassword=******
   ```

   `storeFile` 建议用相对 `src-tauri/gen/android` 的路径；若用绝对路径，请写正斜杠（`C:/Users/.../bunpocket-release.jks`）或双反斜杠——`keystore.properties` 由 Java `Properties.load` 读取，反斜杠会被当作转义符吞掉，非 ASCII 密码也可能乱码。四个字段缺任意一个时 release 保持未签名（构建可过但产物不能安装/上架）。

3. 构建：`corepack pnpm tauri android build --apk`（或 `--aab`）。`app/build.gradle.kts` 检测到该文件且四个字段齐全时才创建 release `signingConfig` 并启用；文件缺失时 release 保持未签名（构建可过，但产物不能安装/上架），无需改代码。
4. 密钥丢失将无法更新已发布版本；请离线备份 keystore 与密码。
5. 发版前同步 bump `package.json` / `tauri.conf.json` / `Cargo.toml` 的 version（Android `versionCode` 由 Tauri 从 version 生成，重复 versionCode 会被应用商店拒绝）。
6. 首次从 debug 包切换到 release 签名包必须卸载重装（签名不同无法覆盖安装，会清数据）——切换前先手动备份并拷出 `backups/`。

## 安全配置

- **CSP**（`src-tauri/tauri.conf.json` → `app.security.csp`）：

  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self' data:;
  connect-src 'self' ipc: http://ipc.localhost;
  object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  ```

  Tauri 构建期会为 HTML 内联脚本计算 sha256 并注入 CSP（Tauri 自身的初始化脚本走 WebView 注入、不受 CSP 管辖），因此 `script-src 'self'` 下无需 `'unsafe-inline'`；`style-src` 因前端内联样式（Tailwind/组件样式）保留 `'unsafe-inline'`。

- **能力（capabilities/default.json）**：已移除 `opener:default`（当前无打开外链需求；后续需要时再单独引入插件与权限）。备份/恢复用到的文件路径在 capability 中显式列出：`$APPCONFIG/backups/**`（含目录本身）、`$APPCONFIG/bunpocket.db`、`bunpocket.db.old`、`bunpocket.db-restore-tmp`、`bunpocket.db.pending-restore`，以及恢复时清理的 `bunpocket.db-wal/-shm/-journal`；读取能力由 `fs:default`（应用目录递归）承担。注意：`fs:default` 的全局 scope 会与命令 scope 取并集，因此这**不是**把 fs 彻底收窄到数据库文件，实际边界仍是"应用自己的数据目录"；本 App 无用户文件读写需求，后续如需更强隔离应移除 `fs:default` 并改为逐命令显式授权（需回归备份/恢复）。

## CI

`.github/workflows/ci.yml` 单 job（Ubuntu）：

checkout → Node 24（`actions/setup-node`）→ pnpm 12.18.0（`pnpm/action-setup@v4`，`package.json` 暂无 `packageManager` 字段，故在此显式固定版本）→ `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm build` → 安装 Linux Tauri 依赖（libwebkit2gtk-4.1-dev、libgtk-3-dev、libayatana-appindicator3-dev、libsoup-3.0-dev、libxdo-dev、librsvg2-dev、patchelf）→ Rust stable（`dtolnay/rust-toolchain` + `Swatinem/rust-cache`）→ `cargo check --locked --all-targets --manifest-path src-tauri/Cargo.toml`。

CI 不构建 Android（需要签名与 NDK，且耗时），Android 产物由本地/发布流水线负责。

## 已知限制

- **Android 构建未在本机验证**：本机只做了 `corepack pnpm build` 与 `cargo check`；`gen/android` 的改动（签名配置、资源删除、allowBackup）待 CI/真机完整 Gradle 构建验证。
- 桌面端只有 Windows 验证过；Linux/macOS 未验证（CI 仅做 cargo check）。
- iOS 未适配。
- 备份恢复只支持"自动选最新一份可用备份"，不支持选择任意历史备份或导出为外部文件；换机需手动拷 `backups/`。
- 日期选择不允许未来日期（保证账单列表/统计/预算口径一致）；已存在的历史未来账单仍会显示在列表中。
- 账单列表按全历史分页加载（不是按月切换）；统计页的月份/年份选择器会覆盖到账本最早一笔账单。
- 旧版本备份的两阶段恢复期间请立即重启；重启换库前会自动快照当前主库，但恢复请求之后的新记账仍会进入 `.old`/快照，而不是保留在新主库。
- 桌面小组件只在 App 退到后台（`onPause`）时刷新，不是实时数据；数据库被加密/损坏时小组件显示"--"。
- 单机单用户：无账号、无多账本、无云同步/协作。
- CSP 仅在 `tauri build` 产物（Tauri 自定义协议资源）上注入生效；桌面端 `tauri dev` 直接加载 Vite devServer，开发态不受该 CSP 约束（Tauri 行为），发布前请以打包产物验证。
- 深链 `bunpocket://add` 当前只配置在 Android；桌面端未注册 scheme。

## License

MIT，见 `LICENSE`。
