import Database from "@tauri-apps/plugin-sql";

// 只能在 Tauri 环境中调用（真机/模拟器/桌面端），纯浏览器中会失败；
// 迁移由 Rust 侧 add_migrations 注册，Database.load 时自动执行。

export type BillKind = "expense" | "income";

/** 分类图标类型：auto=系统分类用图标库/自定义分类用 emoji；emoji=强制显示 icon；image=显示 icon_image */
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

export interface BillRow {
  id: number;
  amount_cents: number;
  kind: BillKind;
  category_id: number;
  note: string | null;
  exclude_budget: number;
  date: string;
  time: string;
  created_at: string;
}

export interface NewBill {
  amount_cents: number;
  kind: BillKind;
  category_id: number;
  note: string | null;
  exclude_budget: boolean;
  date: string;
  time: string;
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
  // budget 表没有外键，删除分类时同步清理其预算行，避免永久孤儿数据
  await database.execute("DELETE FROM budget WHERE category_id = $1", [id]);
  await database.execute("DELETE FROM category WHERE id = $1", [id]);
}

// ---------- 账单 ----------

export async function insertBill(bill: NewBill): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `INSERT INTO bill (amount_cents, kind, category_id, note, exclude_budget, date, time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      bill.amount_cents,
      bill.kind,
      bill.category_id,
      bill.note,
      bill.exclude_budget ? 1 : 0,
      bill.date,
      bill.time,
    ],
  );
  return result.lastInsertId ?? 0;
}

export async function updateBill(id: number, bill: NewBill): Promise<void> {
  const database = await getDb();
  await database.execute(
    `UPDATE bill SET amount_cents = $1, kind = $2, category_id = $3, note = $4,
       exclude_budget = $5, date = $6, time = $7 WHERE id = $8`,
    [
      bill.amount_cents,
      bill.kind,
      bill.category_id,
      bill.note,
      bill.exclude_budget ? 1 : 0,
      bill.date,
      bill.time,
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
  const rows = await database.select<BillRow[]>(
    "SELECT * FROM bill WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function recentBills(limit = 20): Promise<BillRow[]> {
  const database = await getDb();
  return database.select<BillRow[]>(
    "SELECT * FROM bill ORDER BY date DESC, time DESC, id DESC LIMIT $1",
    [limit],
  );
}

export async function billsInDateRange(
  dateFrom: string,
  dateTo: string,
): Promise<BillRow[]> {
  const database = await getDb();
  return database.select<BillRow[]>(
    "SELECT * FROM bill WHERE date >= $1 AND date <= $2 ORDER BY date DESC, time DESC, id DESC",
    [dateFrom, dateTo],
  );
}

export async function searchBills(keyword: string): Promise<BillRow[]> {
  const database = await getDb();
  return database.select<BillRow[]>(
    `SELECT b.* FROM bill b JOIN category c ON c.id = b.category_id
     WHERE b.note LIKE $1 OR c.name LIKE $1
     ORDER BY b.date DESC, b.time DESC, b.id DESC LIMIT 200`,
    [`%${keyword}%`],
  );
}

export async function recentNotes(limit = 10): Promise<string[]> {
  const database = await getDb();
  const rows = await database.select<{ note: string }[]>(
    `SELECT note FROM bill
     WHERE note IS NOT NULL AND note != ''
     GROUP BY note
     ORDER BY MAX(created_at) DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.note);
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

/** 结算日 B 的预算周期：[本月B号, 下月B-1号]；月内不足 B 天时取该月最后一天 */
export function budgetCycle(billingDay: number, now = new Date()): DateRange {
  const b = Math.min(Math.max(billingDay, 1), 31);
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
