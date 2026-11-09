export type PadKey =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "." | "+" | "-" | "back";

const MAX_INPUT_LENGTH = 12; // 表达式总长度上限，防止无限输入

/** 数字键盘按键 → 表达式字符串的纯函数变换 */
export function pressKey(expr: string, key: PadKey): string {
  if (key === "back") return expr.slice(0, -1);
  if (expr.length >= MAX_INPUT_LENGTH) return expr;

  if (key === "." ) {
    const current = currentNumber(expr);
    if (current.includes(".")) return expr;
    return expr === "" || isOperator(expr.slice(-1)) ? expr + "0." : expr + ".";
  }

  if (key === "+" || key === "-") {
    if (expr === "") return key === "-" ? "-" : expr;
    if (isOperator(expr.slice(-1))) return expr.slice(0, -1) + key;
    return expr + key;
  }

  // 数字：单段数字限制 9 位（含小数点）
  const current = currentNumber(expr);
  if (current.replace(".", "").length >= 9) return expr;
  return expr + key;
}

/** 解析表达式并返回分（整数字），非法或结果非正返回 null */
export function exprToCents(expr: string): number | null {
  const trimmed = expr.trim();
  if (trimmed === "" || isOperator(trimmed.slice(-1))) return null;
  const parts = trimmed.split(/(?=[+-])/).filter(Boolean);
  if (parts.length === 0) return null;
  let total = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    total += n;
  }
  const cents = Math.round(total * 100);
  return cents > 0 ? cents : null;
}

function isOperator(ch: string): boolean {
  return ch === "+" || ch === "-";
}

function currentNumber(expr: string): string {
  const match = expr.match(/(\d+\.?\d*|\.\d+)$/);
  return match ? match[1] : "";
}
