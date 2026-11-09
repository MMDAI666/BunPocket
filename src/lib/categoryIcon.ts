import {
  Apple,
  BookOpen,
  Briefcase,
  Candy,
  Gamepad2,
  Gift,
  House,
  Package,
  PartyPopper,
  Phone,
  Pill,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Smartphone,
  TrainFront,
  TrendingUp,
  Undo2,
  Utensils,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** 系统分类（name_key）→ 图标库映射；自定义分类不在此表，走 emoji/图片 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "category.food": Utensils,
  "category.transport": TrainFront,
  "category.shopping": ShoppingBag,
  "category.daily": Package,
  "category.entertainment": Gamepad2,
  "category.medical": Pill,
  "category.housing": House,
  "category.telecom": Phone,
  "category.utilities": Zap,
  "category.education": BookOpen,
  "category.digital": Smartphone,
  "category.clothing": Shirt,
  "category.snacks": Candy,
  "category.fruits": Apple,
  "category.insurance": ShieldCheck,
  "category.giftOut": Gift,
  "category.salary": Briefcase,
  "category.bonus": PartyPopper,
  "category.investment": TrendingUp,
  "category.partTime": Wrench,
  "category.giftIn": Gift,
  "category.refund": Undo2,
};

/** 按系统分类 name_key 查图标库图标，查不到返回 null */
export function categoryIcon(
  nameKey: string | null | undefined,
): LucideIcon | null {
  if (!nameKey) return null;
  return CATEGORY_ICONS[nameKey] ?? null;
}
