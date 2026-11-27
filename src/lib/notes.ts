import { getSetting, setSetting } from "../settings";

/** 被用户长按"粉碎"的备注标签（只影响候选列表，不改历史账单上的备注文字） */
const KEY = "hidden_notes";
/** 防御性上限：备注候选本身只取最近几十条，隐藏列表不需要无限增长 */
const MAX_HIDDEN = 200;

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export async function getHiddenNotes(): Promise<string[]> {
  return parse(await getSetting(KEY));
}

export async function hideNote(note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) return;
  const list = await getHiddenNotes();
  if (list.includes(trimmed)) return;
  const next = [...list, trimmed].slice(-MAX_HIDDEN);
  await setSetting(KEY, JSON.stringify(next));
}

/** 用户重新主动使用某条被隐藏的备注时，让它回到候选里 */
export async function unhideNote(note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) return;
  const list = await getHiddenNotes();
  if (!list.includes(trimmed)) return;
  await setSetting(
    KEY,
    JSON.stringify(list.filter((item) => item !== trimmed)),
  );
}
