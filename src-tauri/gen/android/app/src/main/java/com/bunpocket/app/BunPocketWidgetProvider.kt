package com.bunpocket.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.widget.RemoteViews
import java.io.File
import java.text.DecimalFormat
import java.util.Calendar

/**
 * 1x4 桌面小组件：今日支出 / 本月支出 / 剩余月预算，整条点击打开"记一笔"。
 * 数据直接只读打开 tauri-plugin-sql 的 bunpocket.db（应用 dataDir 根目录），
 * 口径与前端一致：本月支出按自然月；剩余预算按结算日周期，
 * 剩余 = 总预算 - 周期内不含 exclude_budget 的支出。
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
                if (data.hasBudget) formatCents(data.budgetRemaining.coerceAtLeast(0)) else "--",
            )

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
            return views
        }

        private data class WidgetData(
            val todayCents: Long,
            val monthCents: Long,
            val budgetRemaining: Long,
            val hasBudget: Boolean,
        )

        private fun queryData(context: Context): WidgetData {
            val dbFile = File(context.dataDir, "bunpocket.db")
            if (!dbFile.exists()) {
                return WidgetData(0, 0, 0, false)
            }
            return try {
                SQLiteDatabase.openDatabase(
                    dbFile.absolutePath,
                    null,
                    SQLiteDatabase.OPEN_READONLY,
                ).use { db ->
                    val billingDay = rawSetting(db, "billing_day")?.toIntOrNull()
                        ?.coerceIn(1, 31) ?: 1
                    val cycle = budgetCycle(billingDay)

                    val todayCents = sumExpense(db, "date = date('now','localtime')", null)
                    // 页头"本月支出"按自然月，与 App 首页/统计页口径一致；预算剩余按结算周期
                    val month = monthRange()
                    val monthCents = sumExpense(
                        db,
                        "date BETWEEN ? AND ?",
                        arrayOf(month.first, month.second),
                    )
                    val total = rawLong(db, "SELECT amount_cents FROM budget WHERE category_id = 0")
                    val spent = sumExpense(
                        db,
                        "date BETWEEN ? AND ? AND exclude_budget = 0",
                        arrayOf(cycle.first, cycle.second),
                    )
                    WidgetData(
                        todayCents = todayCents,
                        monthCents = monthCents,
                        budgetRemaining = (total ?: 0) - spent,
                        hasBudget = (total ?: 0) > 0,
                    )
                }
            } catch (e: Exception) {
                android.util.Log.w("BunPocketWidget", "query failed", e)
                WidgetData(0, 0, 0, false)
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

        /** 结算日 B 的预算周期 [B号, 下月B-1号]，与前端 db.ts budgetCycle 规则一致 */
        private fun budgetCycle(billingDay: Int): Pair<String, String> {
            val now = Calendar.getInstance()
            val y = now.get(Calendar.YEAR)
            val m = now.get(Calendar.MONTH)

            val curB = minOf(billingDay, lastDay(y, m))
            val inCurrent = now.get(Calendar.DAY_OF_MONTH) >= curB

            val startCal = Calendar.getInstance().apply { set(y, m - (if (inCurrent) 0 else 1), 1) }
            val sy = startCal.get(Calendar.YEAR)
            val sm = startCal.get(Calendar.MONTH)
            val sd = minOf(billingDay, lastDay(sy, sm))

            val endCal = Calendar.getInstance().apply { set(sy, sm + 1, 1) }
            val ey = endCal.get(Calendar.YEAR)
            val em = endCal.get(Calendar.MONTH)
            val ed = if (billingDay == 1) {
                lastDay(sy, sm)
            } else {
                minOf(billingDay - 1, lastDay(ey, em))
            }

            return Pair(
                "%04d-%02d-%02d".format(sy, sm + 1, sd),
                "%04d-%02d-%02d".format(ey, em + 1, ed),
            )
        }

        private fun lastDay(year: Int, month: Int): Int {
            val cal = Calendar.getInstance().apply { set(year, month, 1) }
            return cal.getActualMaximum(Calendar.DAY_OF_MONTH)
        }

        private val compactFormat = DecimalFormat("#,##0")
        private val exactFormat = DecimalFormat("#,##0.00")

        private fun formatCents(cents: Long): String {
            return if (cents % 100 == 0L) {
                compactFormat.format(cents / 100)
            } else {
                exactFormat.format(cents / 100.0)
            }
        }
    }
}
