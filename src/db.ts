import Database from "@tauri-apps/plugin-sql";
import {
  dateStrFromMs,
  nextLocalDayStartMs,
  startOfLocalDayMs,
  timeStrFromMs,
} from "./lib/format";

// 只能在 Tauri 环境中调用（真机/模拟器/桌面端），纯浏览器中会失败；
// 迁移由 Rust 侧 add_migrations 注册，Database.load 时自动执行。

export type BillKind = "expense" | "income";

/** 分类图标类型：auto=系统分类默认 emoji（icon 为空才回退图标库）/自定义分类 emoji；emoji=强制显示 icon；image=显示 icon_image */
export type IconType = "auto" | "emoji" | "image";

export interface CategoryRow {
  id: number;
  parent_id: number | null;
  name: string;
  name_key: string | null;
  icon: string;
  icon_image: string | null;
  icon_type: IconType;
  kind: BillKind;
  is_system: number;
  hidden: number;
  sort: number;
  created_at: string;
}

export interface Category extends CategoryRow {
  children: Category[];
}

interface BillRecord {
  id: number;
  amount_cents: number;
  kind: BillKind;
  category_id: number;
  note: string | null;
  exclude_budget: number;
  /** UTC epoch ms；唯一时间源，显示/分组按设备本地时区 */
  occurred_at_ms: number;
  created_at_ms: number;
}

export interface BillRow extends BillRecord {
  /** 由 occurred_at_ms 派生的本地日期，供页面显示/分组 */
  date: string;
  /** 由 occurred_at_ms 派生的本地时间 HH:MM */
  time: string;
}

export interface NewBill {
  amount_cents: number;
  kind: BillKind;
  category_id: number;
  note: string | null;
  exclude_budget: boolean;
  /** UTC epoch ms；新增/编辑时由本地日期时间换算 */
  occurred_at_ms: number;
}

/** DB 行 → 页面行：date/time 从毫秒派生，数据库不再存这两个字段 */
function toBillRow(row: BillRecord): BillRow {
  return {
    ...row,
    date: dateStrFromMs(row.occurred_at_ms),
    time: timeStrFromMs(row.occurred_at_ms),
  };
}

let dbPromise: Promise<Database> | null = null;

/** 串行化首次加载：并发调用共享同一个 load Promise，避免插件重复建连接池 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:bunpocket.db").catch((e) => {
      // 失败不缓存 rejected promise，允许后续重试（如迁移失败修复后重开）
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** 恢复备份前必须关闭连接池，再清空缓存让下次 getDb 重开 */
export async function closeDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (pending) {
    const database = await pending;
    await database.close();
  }
}

// ---------- 分类 ----------

export async function loadCategoryRows(): Promise<CategoryRow[]> {
  const database = await getDb();
  return database.select<CategoryRow[]>(
    "SELECT * FROM category ORDER BY sort, id",
  );
}

export async function insertCategory(input: {
  parent_id: number | null;
  name: string;
  icon: string;
  icon_image: string | null;
  icon_type: IconType;
  kind: BillKind;
}): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `INSERT INTO category (parent_id, name, icon, icon_image, icon_type, kind, is_system, sort)
     VALUES ($1, $2, $3, $4, $5, $6, 0, (SELECT COALESCE(MAX(sort), 0) + 1 FROM category WHERE parent_id IS $7))`,
    [input.parent_id, input.name, input.icon, input.icon_image, input.icon_type, input.kind, input.parent_id],
  );
  return result.lastInsertId ?? 0;
}

export async function updateCategory(
  id: number,
  patch: Partial<Pick<CategoryRow, "name" | "name_key" | "icon" | "icon_image" | "icon_type" | "hidden" | "sort">>,
): Promise<void> {
  const cols: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    params.push(value);
    cols.push(`${key} = $${params.length}`);
  }
  if (cols.length === 0) return;
  params.push(id);
  const database = await getDb();
  await database.execute(
    `UPDATE category SET ${cols.join(", ")} WHERE id = $${params.length}`,
    params,
  );
}

/**
 * 同级重排：把同一父级（null=一级）下 orderedIds 的 sort 依次重写为 1..n。
 * 单条 UPDATE + CASE 完成：tauri-plugin-sql 的连接池不保证多次 execute 落在同一连接，
 * 所以不用 BEGIN/COMMIT，改由一条语句保证原子性；WHERE 限定父级，跨父级 id 写不进去。
 * 不在 orderedIds 里的兄弟保持原 sort，因此调用方必须传该组完整顺序。
 */
export async function reorderCategoryGroup(
  parentId: number | null,
  orderedIds: number[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  const params: unknown[] = [];
  const cases: string[] = [];
  for (let i = 0; i < orderedIds.length; i += 1) {
    params.push(orderedIds[i]);
    cases.push(`WHEN $${params.length} THEN ${i + 1}`);
  }
  const placeholders = orderedIds.map((_, i) => `$${i + 1}`).join(", ");
  params.push(parentId);
  const database = await getDb();
  await database.execute(
    `UPDATE category SET sort = CASE id ${cases.join(" ")} END
     WHERE parent_id IS $${params.length} AND id IN (${placeholders})`,
    params,
  );
}

/** 删除前检查：返回 null 表示可删，否则返回拒绝原因 */
export async function categoryDeleteBlocker(id: number): Promise<"children" | "bills" | null> {
  const database = await getDb();
  const children = await database.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM category WHERE parent_id = $1",
    [id],
  );
  if ((children[0]?.n ?? 0) > 0) return "children";
  const bills = await database.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM bill WHERE category_id = $1",
    [id],
  );
  if ((bills[0]?.n ?? 0) > 0) return "bills";
  return null;
}

export async function deleteCategory(id: number): Promise<void> {
  const database = await getDb();
  // 先删分类、再删预算：即使第二步失败也只留下不可见的孤儿预算；
  // 反过来先删预算再删分类失败会丢用户预算数据。
  await database.execute("DELETE FROM category WHERE id = $1", [id]);
  await database.execute("DELETE FROM budget WHERE category_id = $1", [id]);
}

// ---------- 账单 ----------

export async function insertBill(bill: NewBill): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `INSERT INTO bill (amount_cents, kind, category_id, note, exclude_budget, occurred_at_ms, created_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      bill.amount_cents,
      bill.kind,
      bill.category_id,
      bill.note,
      bill.exclude_budget ? 1 : 0,
      bill.occurred_at_ms,
      Date.now(),
    ],
  );
  return result.lastInsertId ?? 0;
}

export async function updateBill(id: number, bill: NewBill): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE bill SET amount_cents = $1, kind = $2, category_id = $3, note = $4,
       exclude_budget = $5, occurred_at_ms = $6 WHERE id = $7`,
    [
      bill.amount_cents,
      bill.kind,
      bill.category_id,
      bill.note,
      bill.exclude_budget ? 1 : 0,
      bill.occurred_at_ms,
      id,
    ],
  );
}

export async function deleteBill(id: number): Promise<void> {
  const database = await getDb();
  await database.execute("DELETE FROM bill WHERE id = $1", [id]);
}

export async function getBill(id: number): Promise<BillRow | null> {
  const database = await getDb();
  const rows = await database.select<BillRecord[]>(
    "SELECT * FROM bill WHERE id = $1",
    [id],
  );
  return rows[0] ? toBillRow(rows[0]) : null;
}

export async function recentBills(limit = 20): Promise<BillRow[]> {
  const database = await getDb();
  const rows = await database.select<BillRecord[]>(
    "SELECT * FROM bill ORDER BY occurred_at_ms DESC, id DESC LIMIT $1",
    [limit],
  );
  return rows.map(toBillRow);
}

export async function billsInDateRange(
  dateFrom: string,
  dateTo: string,
): Promise<BillRow[]> {
  const database = await getDb();
  const rows = await database.select<BillRecord[]>(
    `SELECT * FROM bill WHERE occurred_at_ms >= $1 AND occurred_at_ms < $2
     ORDER BY occurred_at_ms DESC, id DESC`,
    [startOfLocalDayMs(dateFrom), nextLocalDayStartMs(dateTo)],
  );
  return rows.map(toBillRow);
}

/** 分页版流水（Bills 页"加载更多"用） */
export async function billsInDateRangePaged(
  dateFrom: string,
  dateTo: string,
  limit: number,
  offset: number,
): Promise<BillRow[]> {
  const database = await getDb();
  const rows = await database.select<BillRecord[]>(
    `SELECT * FROM bill WHERE occurred_at_ms >= $1 AND occurred_at_ms < $2
     ORDER BY occurred_at_ms DESC, id DESC LIMIT $3 OFFSET $4`,
    [
      startOfLocalDayMs(dateFrom),
      nextLocalDayStartMs(dateTo),
      limit,
      offset,
    ],
  );
  return rows.map(toBillRow);
}

/** 全历史分页（不限起始日期）：列表页"加载更多"可到达任意旧账 */
export async function billsPage(
  limit: number,
  offset: number,
): Promise<BillRow[]> {
  const database = await getDb();
  const rows = await database.select<BillRecord[]>(
    `SELECT * FROM bill ORDER BY occurred_at_ms DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map(toBillRow);
}

/** 账本最早账单日期（统计页月份/年份选择器的下界）；按设备本地日期换算 */
export async function earliestBillDate(): Promise<string | null> {
  const database = await getDb();
  const rows = await database.select<{ ms: number | null }[]>(
    "SELECT MIN(occurred_at_ms) AS ms FROM bill",
  );
  const ms = rows[0]?.ms;
  return typeof ms === "number" ? dateStrFromMs(ms) : null;
}

/** 某区间内按日的支出合计（Home 日头展示用，避免用最近 N 条账单近似） */
export async function dailyExpenseTotals(
  dateFrom: string,
  dateTo: string,
): Promise<{ date: string; total: number }[]> {
  const database = await getDb();
  return database.select<{ date: string; total: number }[]>(
    `SELECT date(occurred_at_ms / 1000, 'unixepoch', 'localtime') AS date,
            SUM(amount_cents) AS total
     FROM bill
     WHERE kind = 'expense' AND occurred_at_ms >= $1 AND occurred_at_ms < $2
     GROUP BY date`,
    [startOfLocalDayMs(dateFrom), nextLocalDayStartMs(dateTo)],
  );
}

/** LIKE 通配符转义（配合 ESCAPE '\' 使用） */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 搜索账单：备注 / 分类存储名 / 当前语言下的分类显示名（由调用方先把
 * 显示名命中的分类 id 传进来）。keyword 中的 %/_/\ 会被转义，避免通配符污染。
 */
export async function searchBills(
  keyword: string,
  matchedCategoryIds: number[] = [],
  limit = 50,
  offset = 0,
): Promise<BillRow[]> {
  const database = await getDb();
  const like = `%${escapeLike(keyword)}%`;
  const params: unknown[] = [like];
  let categoryClause = "";
  if (matchedCategoryIds.length > 0) {
    const placeholders = matchedCategoryIds.map((id) => {
      params.push(id);
      return `$${params.length}`;
    });
    categoryClause = ` OR b.category_id IN (${placeholders.join(", ")})`;
  }
  params.push(limit, offset);
  const rows = await database.select<BillRecord[]>(
    `SELECT b.* FROM bill b JOIN category c ON c.id = b.category_id
     WHERE b.note LIKE $1 ESCAPE '\\' OR c.name LIKE $1 ESCAPE '\\'${categoryClause}
     ORDER BY b.occurred_at_ms DESC, b.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(toBillRow);
}

/**
 * 某分类下最近用过的备注（只按分类本身，不含子分类）。
 * 先多取一些再排除用户粉碎掉的标签，避免隐藏项占满结果。
 */
export async function recentNotesByCategory(
  categoryId: number,
  limit = 8,
  exclude: string[] = [],
): Promise<string[]> {
  const database = await getDb();
  const rows = await database.select<{ note: string }[]>(
    `SELECT note FROM bill
     WHERE category_id = $1 AND note IS NOT NULL AND note != ''
     GROUP BY note
     ORDER BY MAX(created_at_ms) DESC LIMIT 50`,
    [categoryId],
  );
  const blocked = new Set(exclude);
  return rows
    .map((r) => r.note)
    .filter((note) => !blocked.has(note))
    .slice(0, limit);
}

export interface BillsSummary {
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  /** 最近若干天的每日笔数（日期倒序） */
  recentDays: { date: string; count: number }[];
}

/** 供运行日志做启动快照：总量、时间跨度、最近几天笔数，用于事后核对数据是否减少 */
export async function billsSummary(recentDayCount = 8): Promise<BillsSummary> {
  const database = await getDb();
  const agg = await database.select<{
    n: number;
    first: number | null;
    last: number | null;
  }[]>(
    "SELECT COUNT(*) AS n, MIN(occurred_at_ms) AS first, MAX(occurred_at_ms) AS last FROM bill",
  );
  const row = agg[0];
  const days = await database.select<{ date: string; n: number }[]>(
    `SELECT date(occurred_at_ms / 1000, 'unixepoch', 'localtime') AS date,
            COUNT(*) AS n
     FROM bill
     GROUP BY date
     ORDER BY date DESC
     LIMIT $1`,
    [recentDayCount],
  );
  return {
    count: row?.n ?? 0,
    firstDate:
      typeof row?.first === "number" ? dateStrFromMs(row.first) : null,
    lastDate: typeof row?.last === "number" ? dateStrFromMs(row.last) : null,
    recentDays: days.map((d) => ({ date: d.date, count: d.n })),
  };
}

/** 当前主库已应用的最新迁移版本（运行日志诊断用） */
export async function schemaVersion(): Promise<number | null> {
  const database = await getDb();
  const rows = await database.select<{ version: number | null }[]>(
    "SELECT MAX(version) AS version FROM _sqlx_migrations",
  );
  return rows[0]?.version ?? null;
}

// ---------- 预算 ----------

export interface Budgets {
  total: number;
  byCategory: Record<number, number>;
}

export async function getBudgets(): Promise<Budgets> {
  const database = await getDb();
  const rows = await database.select<{
    category_id: number;
    amount_cents: number;
  }[]>("SELECT category_id, amount_cents FROM budget");
  const budgets: Budgets = { total: 0, byCategory: {} };
  for (const row of rows) {
    if (row.category_id === 0) budgets.total = row.amount_cents;
    else budgets.byCategory[row.category_id] = row.amount_cents;
  }
  return budgets;
}

/** amount_cents 为 0 时表示清除该预算 */
export async function setBudget(
  categoryId: number,
  amountCents: number,
): Promise<void> {
  const database = await getDb();
  if (amountCents <= 0) {
    await database.execute(
      "DELETE FROM budget WHERE category_id = $1",
      [categoryId],
    );
    return;
  }
  await database.execute(
    `INSERT INTO budget (category_id, amount_cents) VALUES ($1, $2)
     ON CONFLICT(category_id) DO UPDATE SET amount_cents = excluded.amount_cents`,
    [categoryId, amountCents],
  );
}

// ---------- 预算周期 ----------

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** 结算日 B 的预算周期：[本月B号, 下月B-1号]；月内不足 B 天时取该月最后一天。
 *  结算日统一限制在 1–28（避免 29–31 在短月份产生周期首尾重叠，UI/小组件同规则）。 */
export function budgetCycle(billingDay: number, now = new Date()): DateRange {
  const safe = Number.isFinite(billingDay) ? billingDay : 1;
  const b = Math.min(Math.max(safe, 1), 28);
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const effectiveB = Math.min(b, lastDayOfMonth(curY, curM));
  const inCurrentCycle = now.getDate() >= effectiveB;

  const start = new Date(curY, curM - (inCurrentCycle ? 0 : 1), 1);
  start.setDate(Math.min(b, lastDayOfMonth(start.getFullYear(), start.getMonth())));

  let end: Date;
  if (b === 1) {
    // B=1 即自然月：周期末 = 开始月最后一天
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  } else {
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    end.setDate(
      Math.min(b - 1, lastDayOfMonth(end.getFullYear(), end.getMonth())),
    );
  }
  return { from: toDateStr(start), to: toDateStr(end) };
}

/** 距结算日剩余天数（含今天） */
export function daysUntilCycleEnd(range: DateRange, now = new Date()): number {
  const end = new Date(`${range.to}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.round((end.getTime() - today.getTime()) / 86400000) + 1);
}
