import { twMerge } from "tailwind-merge";

/** 合并 className：先拼接、再用 tailwind-merge 让后写的同类工具类覆盖前写（h-5 覆盖 h-9 等） */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return twMerge(parts.filter(Boolean).join(" "));
}
