-- BunPocket 业务一致性约束（version 4）
-- SQLite 不能给已有表追加 CHECK；这里用触发器约束"被外键约束管不到"的业务不变量，
-- 只对后续写入生效（历史脏数据需单独清理；开发期重置数据库即可）。
-- 关闭后三条触发器分别校验：
--   bill.exclude_budget ∈ {0,1}；bill.date/time 合法；bill.kind 与所属分类 kind 一致。
--   category.hidden/is_system ∈ {0,1}；子分类 kind 与父分类一致、不能自引用。

CREATE TRIGGER IF NOT EXISTS trg_bill_guard_insert
BEFORE INSERT ON bill
BEGIN
  SELECT RAISE(ABORT, 'bill.exclude_budget must be 0 or 1')
  WHERE NEW.exclude_budget NOT IN (0, 1);

  SELECT RAISE(ABORT, 'bill.date must be a valid YYYY-MM-DD')
  WHERE date(NEW.date) IS NULL OR date(NEW.date) <> NEW.date;

  SELECT RAISE(ABORT, 'bill.time must be a valid HH:MM')
  WHERE time(NEW.time) IS NULL OR length(NEW.time) <> 5;

  SELECT RAISE(ABORT, 'bill.kind must match category.kind')
  WHERE NEW.kind <> (SELECT kind FROM category WHERE id = NEW.category_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_bill_guard_update
BEFORE UPDATE OF kind, category_id, exclude_budget, date, time ON bill
BEGIN
  SELECT RAISE(ABORT, 'bill.exclude_budget must be 0 or 1')
  WHERE NEW.exclude_budget NOT IN (0, 1);

  SELECT RAISE(ABORT, 'bill.date must be a valid YYYY-MM-DD')
  WHERE date(NEW.date) IS NULL OR date(NEW.date) <> NEW.date;

  SELECT RAISE(ABORT, 'bill.time must be a valid HH:MM')
  WHERE time(NEW.time) IS NULL OR length(NEW.time) <> 5;

  SELECT RAISE(ABORT, 'bill.kind must match category.kind')
  WHERE NEW.kind <> (SELECT kind FROM category WHERE id = NEW.category_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_category_guard_insert
BEFORE INSERT ON category
BEGIN
  SELECT RAISE(ABORT, 'category.hidden must be 0 or 1')
  WHERE NEW.hidden NOT IN (0, 1);

  SELECT RAISE(ABORT, 'category.is_system must be 0 or 1')
  WHERE NEW.is_system NOT IN (0, 1);

  SELECT RAISE(ABORT, 'child category kind must match parent kind')
  WHERE NEW.parent_id IS NOT NULL
    AND NEW.kind <> (SELECT kind FROM category WHERE id = NEW.parent_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_category_guard_update
BEFORE UPDATE OF parent_id, kind, hidden, is_system ON category
BEGIN
  SELECT RAISE(ABORT, 'category.hidden must be 0 or 1')
  WHERE NEW.hidden NOT IN (0, 1);

  SELECT RAISE(ABORT, 'category.is_system must be 0 or 1')
  WHERE NEW.is_system NOT IN (0, 1);

  SELECT RAISE(ABORT, 'category cannot be its own parent')
  WHERE NEW.parent_id IS NOT NULL AND NEW.parent_id = NEW.id;

  SELECT RAISE(ABORT, 'child category kind must match parent kind')
  WHERE NEW.parent_id IS NOT NULL
    AND NEW.kind <> (SELECT kind FROM category WHERE id = NEW.parent_id);
END;
