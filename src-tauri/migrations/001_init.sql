-- BunPocket 初始 schema + 预置数据（version 1）
-- 后续变更一律新增 00X_*.sql 并递增版本号，禁止修改本文件。

CREATE TABLE category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES category(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  name_key TEXT,
  icon TEXT NOT NULL DEFAULT '',
  icon_image TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  is_system INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_category_parent ON category(parent_id);
CREATE INDEX idx_category_kind ON category(kind, hidden, sort);

CREATE TABLE bill (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  note TEXT,
  exclude_budget INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_bill_date ON bill(date);
CREATE INDEX idx_bill_category ON bill(category_id);

CREATE TABLE budget (
  category_id INTEGER PRIMARY KEY,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('billing_day', '1'),
  ('theme', 'auto'),
  ('locale', 'auto');

-- 预置一级分类（任意节点可直接记账，无默认节点机制）
INSERT INTO category (name, name_key, icon, kind, is_system, sort) VALUES
  ('餐饮', 'category.food', '🍕', 'expense', 1, 1),
  ('交通', 'category.transport', '🚄', 'expense', 1, 2),
  ('购物', 'category.shopping', '🛍️', 'expense', 1, 3),
  ('日用', 'category.daily', '🧻', 'expense', 1, 4),
  ('娱乐', 'category.entertainment', '🎮', 'expense', 1, 5),
  ('医疗', 'category.medical', '💊', 'expense', 1, 6),
  ('住房', 'category.housing', '🏠', 'expense', 1, 7),
  ('通讯', 'category.telecom', '☎️', 'expense', 1, 8),
  ('水电燃气', 'category.utilities', '⚡', 'expense', 1, 9),
  ('学习', 'category.education', '📝', 'expense', 1, 10),
  ('数码', 'category.digital', '📱', 'expense', 1, 11),
  ('服饰', 'category.clothing', '👕', 'expense', 1, 12),
  ('零食', 'category.snacks', '🍭', 'expense', 1, 13),
  ('水果', 'category.fruits', '🍓', 'expense', 1, 14),
  ('保险', 'category.insurance', '🛡️', 'expense', 1, 15),
  ('红包', 'category.giftOut', '🧧', 'expense', 1, 16),
  ('工资', 'category.salary', '💼', 'income', 1, 1),
  ('奖金', 'category.bonus', '🎉', 'income', 1, 2),
  ('理财', 'category.investment', '📈', 'income', 1, 3),
  ('兼职', 'category.partTime', '🔧', 'income', 1, 4),
  ('红包', 'category.giftIn', '🧧', 'income', 1, 5),
  ('退款', 'category.refund', '↩️', 'income', 1, 6);
