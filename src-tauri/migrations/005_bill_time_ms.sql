-- BunPocket 时间模型：bill 只存 UTC 毫秒（version 5）
-- 旧 date/time 是本地墙钟（按 +08:00 解释），迁移时转成 occurred_at_ms；
-- 显示/日分组/统计由应用按设备本地时区换算，数据库不再保存 date/time。
-- 旧 created_at 同样是本地墙钟，转成 created_at_ms；解析失败时回退 occurred_at_ms。

DROP TRIGGER IF EXISTS trg_bill_guard_insert;
DROP TRIGGER IF EXISTS trg_bill_guard_update;

CREATE TABLE bill_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  note TEXT,
  exclude_budget INTEGER NOT NULL DEFAULT 0,
  occurred_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

INSERT INTO bill_new (
  id, amount_cents, kind, category_id, note, exclude_budget, occurred_at_ms, created_at_ms
)
SELECT
  id,
  amount_cents,
  kind,
  category_id,
  note,
  exclude_budget,
  CAST(strftime('%s', date || 'T' || time || ':00+08:00') AS INTEGER) * 1000,
  COALESCE(
    CAST(strftime('%s', replace(created_at, ' ', 'T') || '+08:00') AS INTEGER) * 1000,
    CAST(strftime('%s', date || 'T' || time || ':00+08:00') AS INTEGER) * 1000
  )
FROM bill;

DROP TABLE bill;
ALTER TABLE bill_new RENAME TO bill;

CREATE INDEX idx_bill_occurred_at_ms ON bill(occurred_at_ms);
CREATE INDEX idx_bill_category ON bill(category_id);

CREATE TRIGGER trg_bill_guard_insert
BEFORE INSERT ON bill
BEGIN
  SELECT RAISE(ABORT, 'bill.exclude_budget must be 0 or 1')
  WHERE NEW.exclude_budget NOT IN (0, 1);

  SELECT RAISE(ABORT, 'bill.occurred_at_ms must be positive')
  WHERE NEW.occurred_at_ms IS NULL OR NEW.occurred_at_ms <= 0;

  SELECT RAISE(ABORT, 'bill.created_at_ms must be positive')
  WHERE NEW.created_at_ms IS NULL OR NEW.created_at_ms <= 0;

  SELECT RAISE(ABORT, 'bill.kind must match category.kind')
  WHERE NEW.kind <> (SELECT kind FROM category WHERE id = NEW.category_id);
END;

CREATE TRIGGER trg_bill_guard_update
BEFORE UPDATE OF kind, category_id, exclude_budget, occurred_at_ms, created_at_ms ON bill
BEGIN
  SELECT RAISE(ABORT, 'bill.exclude_budget must be 0 or 1')
  WHERE NEW.exclude_budget NOT IN (0, 1);

  SELECT RAISE(ABORT, 'bill.occurred_at_ms must be positive')
  WHERE NEW.occurred_at_ms IS NULL OR NEW.occurred_at_ms <= 0;

  SELECT RAISE(ABORT, 'bill.created_at_ms must be positive')
  WHERE NEW.created_at_ms IS NULL OR NEW.created_at_ms <= 0;

  SELECT RAISE(ABORT, 'bill.kind must match category.kind')
  WHERE NEW.kind <> (SELECT kind FROM category WHERE id = NEW.category_id);
END;
