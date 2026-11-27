package com.bunpocket.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.io.File
import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import kotlin.math.roundToInt

/**
 * 4x1 桌面小组件（B1-C1）：今日支出 / 本月支出 / 剩余周期预算，底部预算条，整卡点击"记一笔"。
 * 数据直接只读打开 tauri-plugin-sql 的 bunpocket.db（应用 dataDir 根目录），
 * 口径与前端一致：本月支出按自然月；剩余预算按结算日周期，
 * 剩余 = 总预算 - 周期内不含 exclude_budget 的支出。
 *
 * B1-C1 的三态只在 provider 侧判定：
 *  - 今日超剩余日均：今日预算内支出 * 剩余天数 > max(剩余, 0)，只把今日数字转支出红；
 *  - 周期超支：剩余 < 0，剩余数字显示真实负值并转支出红，预算条满且转支出红；
 *  - 无预算 / 读取失败：剩余显示 "--"，隐藏预算条，不变红。
 */
class BunPocketWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val views = buildViews(context)
        appWidgetManager.updateAppWidget(appWidgetIds, views)
    }

    companion object {

        private const val TAG = "BunPocketWidget"
        private const val MILLIS_PER_DAY = 86_400_000L

        /** app 退出前台时调用，立即刷新桌面数据 */
        fun pushAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, BunPocketWidgetProvider::class.java),
            )
            if (ids.isNotEmpty()) {
                manager.updateAppWidget(ids, buildViews(context))
            }
        }

        private fun buildViews(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_today)
            val data = queryData(context)

            views.setTextViewText(R.id.widget_today_value, formatCents(data.todayCents))
            views.setTextViewText(R.id.widget_month_value, formatCents(data.monthCents))
            views.setTextViewText(
                R.id.widget_budget_value,
                // 剩余不截断：周期超支时显示真实负值；无预算/失败显示 "--"
                if (data.remainingCents != null) formatCents(data.remainingCents) else "--",
            )

            // 今日数字：正常墨色，超剩余日均转支出红；本月数字保持墨色不动
            views.setTextColor(
                R.id.widget_today_value,
                context.getColor(
                    if (data.todayOverDaily) R.color.widget_expense_color
                    else R.color.widget_value_color,
                ),
            )
            // 剩余预算：正常墨青，周期超支转支出红
            views.setTextColor(
                R.id.widget_budget_value,
                context.getColor(
                    if (data.cycleOverBudget) R.color.widget_expense_color
                    else R.color.widget_remaining_color,
                ),
            )

            if (!data.hasBudget || data.remainingCents == null) {
                views.setViewVisibility(R.id.widget_bar, View.GONE)
            } else if (data.cycleOverBudget) {
                views.setViewVisibility(R.id.widget_bar, View.VISIBLE)
                views.setViewVisibility(R.id.widget_bar_normal, View.GONE)
                views.setViewVisibility(R.id.widget_bar_over, View.VISIBLE)
                views.setProgressBar(R.id.widget_bar_over, 100, 100, false)
            } else {
                views.setViewVisibility(R.id.widget_bar, View.VISIBLE)
                views.setViewVisibility(R.id.widget_bar_normal, View.VISIBLE)
                views.setViewVisibility(R.id.widget_bar_over, View.GONE)
                // 参数顺序是 (viewId, max, progress, indeterminate)：max 固定 100，progress 才是已用百分比
                views.setProgressBar(R.id.widget_bar_normal, 100, data.budgetPercent, false)
            }

            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("bunpocket://add")).apply {
                setPackage(context.packageName)
            }
            val pending = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, pending)
            views.setContentDescription(
                R.id.widget_root,
                context.getString(R.string.widget_action_add),
            )
            return views
        }

        /**
         * 任一字段为 null 表示无数据或读取失败，渲染为 "--" 而不是误导性的 0。
         * remainingCents 为 null 表示无预算/读取失败；hasBudget 只描述是否存在有效总预算。
         */
        private data class WidgetData(
            val todayCents: Long?,
            val monthCents: Long?,
            val remainingCents: Long?,
            val hasBudget: Boolean,
            val todayOverDaily: Boolean,
            val cycleOverBudget: Boolean,
            val budgetPercent: Int,
        )

        private fun emptyData() = WidgetData(
            todayCents = null,
            monthCents = null,
            remainingCents = null,
            hasBudget = false,
            todayOverDaily = false,
            cycleOverBudget = false,
            budgetPercent = 0,
        )

        private fun queryData(context: Context): WidgetData {
            val dbFile = File(context.dataDir, "bunpocket.db")
            if (!dbFile.exists()) {
                return emptyData()
            }
            return try {
                SQLiteDatabase.openDatabase(
                    dbFile.absolutePath,
                    null,
                    SQLiteDatabase.OPEN_READONLY,
                ).use { db ->
                    val billingDay = rawSetting(db, "billing_day")?.toIntOrNull()
                        ?.coerceIn(1, 28) ?: 1
                    val cycle = budgetCycle(billingDay)

                    val todayCents = sumExpense(
                        db,
                        "date(occurred_at_ms / 1000, 'unixepoch', 'localtime') = date('now','localtime')",
                        null,
                    )
                    // 页头"本月支出"按自然月，与 App 首页/统计页口径一致；预算剩余按结算周期
                    val month = monthRange()
                    val monthCents = sumExpense(
                        db,
                        "date(occurred_at_ms / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ?",
                        arrayOf(month.first, month.second),
                    )
                    val total = rawLong(db, "SELECT amount_cents FROM budget WHERE category_id = 0") ?: 0L
                    if (total <= 0L) {
                        // 无预算：剩余显示 "--"，不参与超支判定，也不显示预算条
                        return@use WidgetData(
                            todayCents = todayCents,
                            monthCents = monthCents,
                            remainingCents = null,
                            hasBudget = false,
                            todayOverDaily = false,
                            cycleOverBudget = false,
                            budgetPercent = 0,
                        )
                    }

                    // 周期内预算内支出（exclude_budget = 0）；今日颜色判定也用同一口径
                    val spent = sumExpense(
                        db,
                        "date(occurred_at_ms / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ? AND exclude_budget = 0",
                        arrayOf(cycle.first, cycle.second),
                    )
                    val todayIncluded = sumExpense(
                        db,
                        "date(occurred_at_ms / 1000, 'unixepoch', 'localtime') = date('now','localtime') AND exclude_budget = 0",
                        null,
                    )
                    // 剩余不截断为 0：周期超支时保留真实负值供 UI 显示
                    val remaining = total - spent
                    val daysLeft = daysUntilCycleEnd(cycle.second)
                    // 用整数乘法比较，避免除法取整误差；日预算为 0 时任何预算内支出都会超
                    val todayOverDaily = todayIncluded * daysLeft > maxOf(remaining, 0L)
                    val cycleOverBudget = remaining < 0L
                    val budgetPercent = if (remaining <= 0L) {
                        100
                    } else {
                        ((spent * 100L) / total).coerceIn(0L, 100L).toInt()
                    }

                    WidgetData(
                        todayCents = todayCents,
                        monthCents = monthCents,
                        remainingCents = remaining,
                        hasBudget = true,
                        todayOverDaily = todayOverDaily,
                        cycleOverBudget = cycleOverBudget,
                        budgetPercent = budgetPercent,
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "query failed", e)
                // 读取失败时显示 "--"：显示 0 会被误读为"今天没记账"
                emptyData()
            }
        }

        private fun sumExpense(
            db: SQLiteDatabase,
            where: String,
            args: Array<String>?,
        ): Long {
            db.rawQuery(
                "SELECT COALESCE(SUM(amount_cents), 0) FROM bill WHERE kind = 'expense' AND $where",
                args,
            ).use { cursor ->
                return if (cursor.moveToFirst()) cursor.getLong(0) else 0
            }
        }

        private fun rawSetting(db: SQLiteDatabase, key: String): String? {
            db.rawQuery(
                "SELECT value FROM settings WHERE key = ?",
                arrayOf(key),
            ).use { cursor ->
                return if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }

        private fun rawLong(db: SQLiteDatabase, sql: String): Long? {
            db.rawQuery(sql, null).use { cursor ->
                return if (cursor.moveToFirst()) cursor.getLong(0) else null
            }
        }

        /** 当前自然月 [1 号, 月末]，与前端"本月支出"口径一致 */
        private fun monthRange(): Pair<String, String> {
            val now = Calendar.getInstance()
            val y = now.get(Calendar.YEAR)
            val m = now.get(Calendar.MONTH)
            return Pair(
                "%04d-%02d-01".format(y, m + 1),
                "%04d-%02d-%02d".format(y, m + 1, lastDay(y, m)),
            )
        }

        /** 结算日 B 的预算周期 [B号, 下月B-1号]，与前端 db.ts budgetCycle 规则一致（内部也 clamp 1–28） */
        private fun budgetCycle(billingDay: Int): Pair<String, String> {
            val now = Calendar.getInstance()
            val y = now.get(Calendar.YEAR)
            val m = now.get(Calendar.MONTH)
            val b = billingDay.coerceIn(1, 28)

            val curB = minOf(b, lastDay(y, m))
            val inCurrent = now.get(Calendar.DAY_OF_MONTH) >= curB

            val startCal = Calendar.getInstance().apply { set(y, m - (if (inCurrent) 0 else 1), 1) }
            val sy = startCal.get(Calendar.YEAR)
            val sm = startCal.get(Calendar.MONTH)
            val sd = minOf(b, lastDay(sy, sm))

            val endCal = Calendar.getInstance().apply { set(sy, sm + 1, 1) }
            val ey = endCal.get(Calendar.YEAR)
            val em = endCal.get(Calendar.MONTH)
            val ed = if (b == 1) {
                lastDay(sy, sm)
            } else {
                minOf(b - 1, lastDay(ey, em))
            }

            return Pair(
                "%04d-%02d-%02d".format(sy, sm + 1, sd),
                "%04d-%02d-%02d".format(ey, em + 1, ed),
            )
        }

        /**
         * 距周期结束的剩余天数（含今天，至少 1），与 app db.ts daysUntilCycleEnd 口径一致：
         * 周期末与今天相差的整天数 + 1。用 Calendar/SimpleDateFormat，避免 minSdk 24 不支持的 java.time。
         */
        private fun daysUntilCycleEnd(cycleTo: String): Int {
            val format = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val endDate = try {
                format.parse(cycleTo)
            } catch (e: Exception) {
                null
            } ?: return 1
            val end = Calendar.getInstance().apply {
                time = endDate
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val today = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val days = ((end.timeInMillis - today.timeInMillis) / MILLIS_PER_DAY.toDouble()).roundToInt()
            return maxOf(1, days + 1)
        }

        private fun lastDay(year: Int, month: Int): Int {
            val cal = Calendar.getInstance().apply { set(year, month, 1) }
            return cal.getActualMaximum(Calendar.DAY_OF_MONTH)
        }

        private val compactFormat = DecimalFormat("#,##0")
        private val exactFormat = DecimalFormat("#,##0.00")

        private fun formatCents(cents: Long?): String {
            if (cents == null) return "--"
            return if (cents % 100 == 0L) {
                compactFormat.format(cents / 100)
            } else {
                exactFormat.format(cents / 100.0)
            }
        }
    }
}
