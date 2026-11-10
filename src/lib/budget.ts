import type { BillRow, Category } from "../db";

export interface CategoryBudgetRow {
  cat: Category;
  /** 层级深度：0 = 一级分类 */
  depth: number;
  /** 分类预算（分），0 表示未设置 */
  budget: number;
  /** 该分类整棵子树在统计区间内的支出（分，默认排除"不计入预算"的账单） */
  spent: number;
}

/**
 * 计算分类预算执行情况。
 * - 每个分类的 spent = 该分类及其所有子分类的支出之和（子树上卷）；
 * - 默认排除 exclude_budget=1 的账单（与 Home 预算卡口径一致）；
 * - 返回整棵分类树（含未设置预算的分类），调用方按需过滤。
 */
export function categoryBudgetRows(
  roots: Category[],
  budgetsByCategory: Record<number, number>,
  bills: BillRow[],
  includeExcludedFromBudget = false,
): CategoryBudgetRow[] {
  const ancestorsOf = new Map<number, number[]>();

  const walk = (cat: Category, path: number[]) => {
    const next = [...path, cat.id];
    ancestorsOf.set(cat.id, next);
    for (const child of cat.children) walk(child, next);
  };
  for (const root of roots) walk(root, []);

  const spentById = new Map<number, number>();
  for (const bill of bills) {
    if (bill.kind !== "expense") continue;
    if (!includeExcludedFromBudget && bill.exclude_budget) continue;
    const path = ancestorsOf.get(bill.category_id);
    if (!path) continue;
    for (const id of path) {
      spentById.set(id, (spentById.get(id) ?? 0) + bill.amount_cents);
    }
  }

  const rows: CategoryBudgetRow[] = [];
  const flatten = (cat: Category, depth: number) => {
    rows.push({
      cat,
      depth,
      budget: budgetsByCategory[cat.id] ?? 0,
      spent: spentById.get(cat.id) ?? 0,
    });
    for (const child of cat.children) flatten(child, depth + 1);
  };
  for (const root of roots) flatten(root, 0);
  return rows;
}

/** 只保留设置了预算的分类，并按"预算使用率"从高到低排序 */
export function budgetedRowsByUsage(
  rows: CategoryBudgetRow[],
  limit?: number,
): CategoryBudgetRow[] {
  const budgeted = rows
    .filter((r) => r.budget > 0)
    .sort((a, b) => b.spent / b.budget - a.spent / a.budget);
  return typeof limit === "number" ? budgeted.slice(0, limit) : budgeted;
}

/** 预算使用率 0~1（超支按 1 截断，用于进度条） */
export function budgetProgress(row: CategoryBudgetRow): number {
  if (row.budget <= 0) return 0;
  return Math.min(Math.max(row.spent / row.budget, 0), 1);
}

export function isOverBudget(row: CategoryBudgetRow): boolean {
  return row.budget > 0 && row.spent > row.budget;
}

/**
 * 分类预算合计：只统计"最上层已设预算的节点"（自身有预算且没有任何祖先设预算）。
 * 这样只设子分类预算时不会漏算，父子都设时也不会重复计算。
 * rows 必须是 categoryBudgetRows 返回的先序（preorder）行。
 */
export function topmostBudgetTotal(rows: CategoryBudgetRow[]): number {
  const budgetByDepth: boolean[] = [];
  let sum = 0;
  for (const row of rows) {
    const ancestorHasBudget = budgetByDepth
      .slice(0, row.depth)
      .some(Boolean);
    budgetByDepth.length = row.depth;
    const hasBudget = row.budget > 0;
    budgetByDepth[row.depth] = hasBudget;
    if (hasBudget && !ancestorHasBudget) sum += row.budget;
  }
  return sum;
}

export interface BudgetRowMeta extends CategoryBudgetRow {
  /** 是否有后代分类也设了预算（父行 spent 会包含这些后代，展示时应标注"含子分类"） */
  hasBudgetedDescendant: boolean;
  /** 该分类下"最上层已设预算的后代"预算合计（用于提示"子预算合计 > 本分类预算"） */
  childBudgetSum: number;
}

/** 给先序 rows 补父子关系元信息（父子预算展示/提示用） */
export function annotateBudgetRows(
  rows: CategoryBudgetRow[],
): BudgetRowMeta[] {
  const out: BudgetRowMeta[] = rows.map((row) => ({
    ...row,
    hasBudgetedDescendant: false,
    childBudgetSum: 0,
  }));
  const stack: number[] = [];
  for (let i = 0; i < out.length; i++) {
    const row = out[i];
    stack.length = row.depth;
    if (row.budget > 0) {
      // 找最近的"已设预算的祖先"，把它作为该预算的上一层上限；没有则它是顶层预算节点
      for (let depth = stack.length - 1; depth >= 0; depth--) {
        const ancestor = out[stack[depth]];
        if (ancestor.budget > 0) {
          ancestor.hasBudgetedDescendant = true;
          ancestor.childBudgetSum += row.budget;
          break;
        }
      }
    }
    stack[row.depth] = i;
  }
  return out;
}

/**
 * 只保留"最具体"的已设预算节点（自身有预算且没有设预算的后代）。
 * Home Top3 用它避免父子两行同时出现、把同一笔支出展示两次。
 */
export function leafmostBudgetRows(
  rows: CategoryBudgetRow[],
): CategoryBudgetRow[] {
  return annotateBudgetRows(rows)
    .filter((row) => row.budget > 0 && !row.hasBudgetedDescendant)
    .map((row) => ({
      cat: row.cat,
      depth: row.depth,
      budget: row.budget,
      spent: row.spent,
    }));
}
