import type { BillKind, BillRow, Category, CategoryRow } from "../db";

/** 平铺行 → 按父子组装的树（保持 sort, id 顺序） */
export function buildCategoryTree(rows: CategoryRow[]): Category[] {
  const byId = new Map<number, Category>();
  const roots: Category[] = [];
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }
  for (const cat of byId.values()) {
    if (cat.parent_id != null && byId.has(cat.parent_id)) {
      byId.get(cat.parent_id)!.children.push(cat);
    } else {
      roots.push(cat);
    }
  }
  return roots;
}

/** 从根到该节点的路径（含自身），找不到返回空数组 */
export function categoryPath(
  roots: Category[],
  id: number,
): Category[] {
  for (const root of roots) {
    if (root.id === id) return [root];
    const sub = categoryPath(root.children, id);
    if (sub.length > 0) return [root, ...sub];
  }
  return [];
}

/** 从树里按 id 找节点 */
export function findCategory(roots: Category[], id: number): Category | null {
  for (const root of roots) {
    if (root.id === id) return root;
    const hit = findCategory(root.children, id);
    if (hit) return hit;
  }
  return null;
}

/** 按先序展开分类树，附带层级深度（Budget 列表 / 搜索匹配用） */
export function flattenCategoryTree(
  roots: Category[],
  depth = 0,
): { cat: Category; depth: number }[] {
  const out: { cat: Category; depth: number }[] = [];
  for (const cat of roots) {
    out.push({ cat, depth });
    out.push(...flattenCategoryTree(cat.children, depth + 1));
  }
  return out;
}

/**
 * 按一级分类聚合账单（子树递归上卷）。
 * 返回 Map<顶级分类id, 金额（支出为正数绝对值）>
 */
export function rollupByTopLevel(
  bills: BillRow[],
  roots: Category[],
  kind: BillKind,
  includeExcludedFromBudget = true,
): Map<number, number> {
  const nodeToTop = new Map<number, number>();
  const assign = (cat: Category, top: number) => {
    nodeToTop.set(cat.id, top);
    for (const child of cat.children) assign(child, top);
  };
  for (const root of roots) assign(root, root.id);

  const sums = new Map<number, number>();
  for (const bill of bills) {
    if (bill.kind !== kind) continue;
    if (!includeExcludedFromBudget && bill.exclude_budget) continue;
    const top = nodeToTop.get(bill.category_id);
    if (top == null) continue;
    sums.set(top, (sums.get(top) ?? 0) + bill.amount_cents);
  }
  return sums;
}

export interface NodeShare {
  cat: Category;
  cents: number;
}

/**
 * 下钻聚合：node 的每个直接子分类按整棵子树求和，
 * 外加"直接记在 node 本身"的账单一桶（cat 即 node 自身）。
 * 只返回金额 > 0 的桶，按金额降序；语义与 rollupByTopLevel 一致（含 exclude_budget）。
 */
export function rollupByNode(
  bills: BillRow[],
  node: Category,
  kind: BillKind,
  includeExcludedFromBudget = true,
): NodeShare[] {
  const owner = new Map<number, number>();
  const assign = (cat: Category, bucket: number) => {
    owner.set(cat.id, bucket);
    for (const child of cat.children) assign(child, bucket);
  };
  for (const child of node.children) assign(child, child.id);

  const sums = new Map<number, number>([[node.id, 0]]);
  for (const child of node.children) sums.set(child.id, 0);
  for (const bill of bills) {
    if (bill.kind !== kind) continue;
    if (!includeExcludedFromBudget && bill.exclude_budget) continue;
    const bucket = bill.category_id === node.id ? node.id : owner.get(bill.category_id);
    if (bucket == null) continue;
    sums.set(bucket, (sums.get(bucket) ?? 0) + bill.amount_cents);
  }

  return [
    ...node.children.map((child) => ({ cat: child, cents: sums.get(child.id) ?? 0 })),
    { cat: node, cents: sums.get(node.id) ?? 0 },
  ]
    .filter((s) => s.cents > 0)
    .sort((a, b) => b.cents - a.cents);
}
