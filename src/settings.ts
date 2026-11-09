import { getDb } from "./db";

// 浏览器 dev 时无 Tauri IPC，设置落到 localStorage；真机/模拟器走 SQLite settings 表
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getSetting(key: string): Promise<string | null> {
  if (isTauri) {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = $1",
      [key],
    );
    return rows[0]?.value ?? null;
  }
  return localStorage.getItem(`setting:${key}`);
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (isTauri) {
    const db = await getDb();
    await db.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
    return;
  }
  localStorage.setItem(`setting:${key}`, value);
}
