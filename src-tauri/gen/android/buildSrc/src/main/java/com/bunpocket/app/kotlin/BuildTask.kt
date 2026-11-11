import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val executable = """pnpm""";
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            // 只有"命令启动失败"才回退；Rust/CLI 真实构建错误必须立刻抛出，避免重试多次并掩盖首错
            if (!isCommandNotFound(e)) throw e
            var lastException: Exception = e
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                // Try different Windows-specific extensions
                val fallbacks = listOf(
                    "$executable.exe",
                    "$executable.cmd",
                    "$executable.bat",
                )
                for (fallback in fallbacks) {
                    try {
                        runTauriCli(fallback)
                        return
                    } catch (fallbackException: Exception) {
                        if (!isCommandNotFound(fallbackException)) throw fallbackException
                        lastException = fallbackException
                    }
                }
            }
            // 兜底：pnpm 不在 PATH 但 Node 自带 corepack 时，改走 `corepack pnpm ...`
            // （未执行过 `corepack enable` 的机器上 Gradle 找不到 pnpm 命令）。
            // Windows 上 CreateProcess 不会按 PATHEXT 解析无扩展名命令，必须把 .cmd/.bat 也列进候选。
            // 只有上面所有 pnpm 尝试都失败后才走到这里，不改变 pnpm 优先行为。
            val corepackCandidates =
                if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                    listOf("corepack", "corepack.cmd", "corepack.bat")
                } else {
                    listOf("corepack")
                }
            for (candidate in corepackCandidates) {
                try {
                    runTauriCli(candidate, listOf("pnpm"))
                    return
                } catch (fallbackException: Exception) {
                    if (!isCommandNotFound(fallbackException)) throw fallbackException
                    lastException = fallbackException
                }
            }
            throw lastException
        }
    }

    /** Gradle/ProcessBuilder 在命令不存在时抛 IOException 或 "Cannot run program"/"error=2" 包装异常 */
    private fun isCommandNotFound(e: Throwable): Boolean {
        var cause: Throwable? = e
        while (cause != null) {
            if (cause is java.io.IOException) return true
            val message = cause.message ?: ""
            if (
                message.contains("error=2") ||
                message.contains("Cannot run program", ignoreCase = true) ||
                message.contains("CreateProcess", ignoreCase = true) ||
                message.contains("starting process", ignoreCase = true)
            ) {
                return true
            }
            cause = cause.cause
        }
        return false
    }

    fun runTauriCli(executable: String, prefixArgs: List<String> = emptyList()) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = prefixArgs + listOf("tauri", "android", "android-studio-script");

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}
