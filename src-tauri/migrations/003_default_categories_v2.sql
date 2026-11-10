-- BunPocket 默认分类 v2（version 3）：两级默认分类 + 收入"补贴"
-- 全部幂等：同名子分类已存在则跳过；父级被用户改名过（name_key 已清空）按原名兜底。
-- 旧一级"零食/水果"的账单与预算先迁移到"餐饮"下的子分类，再删除；
-- 若仍有子分类或未迁移账单则保留该一级（迁移不因边界情况失败）。
-- 注意：子分类匹配必须限定在目标父级下，避免用户自建的同名子分类（如"购物/零食"）被误判/劫持；
--       预算迁移使用 INSERT OR IGNORE，不覆盖用户已有的子分类预算；
--       清理孤儿预算时保留 category_id = 0 的"总预算"哨兵行。

-- ── 收入：补贴 ──
INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT NULL, '补贴', 'category.subsidy', '💰', 'income', 1, 7
WHERE NOT EXISTS (
  SELECT 1 FROM category
  WHERE kind = 'income' AND (name_key = 'category.subsidy' OR name = '补贴')
);

-- ── 水电燃气：水 / 电 / 燃气 ──
INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '水', 'category.utilitiesWater', '💧', 'expense', 1, 1
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.utilities' OR (p.name_key IS NULL AND p.name = '水电燃气'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.utilitiesWater' OR c.name = '水')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '电', 'category.utilitiesPower', '💡', 'expense', 1, 2
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.utilities' OR (p.name_key IS NULL AND p.name = '水电燃气'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.utilitiesPower' OR c.name = '电')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '燃气', 'category.utilitiesGas', '🔥', 'expense', 1, 3
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.utilities' OR (p.name_key IS NULL AND p.name = '水电燃气'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.utilitiesGas' OR c.name = '燃气')
  )
HAVING MIN(p.id) IS NOT NULL;

-- ── 娱乐：麻将 / 游戏 / 娱乐（通用） ──
INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '麻将', 'category.entMahjong', '🀄', 'expense', 1, 1
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.entertainment' OR (p.name_key IS NULL AND p.name = '娱乐'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.entMahjong' OR c.name = '麻将')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '游戏', 'category.entGame', '🕹️', 'expense', 1, 2
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.entertainment' OR (p.name_key IS NULL AND p.name = '娱乐'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.entGame' OR c.name = '游戏')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '娱乐', 'category.entGeneral', '🎪', 'expense', 1, 3
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.entertainment' OR (p.name_key IS NULL AND p.name = '娱乐'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.entGeneral' OR (c.name = '娱乐' AND c.parent_id IS NOT NULL))
  )
HAVING MIN(p.id) IS NOT NULL;

-- ── 交通：地铁 / 高铁 / 公交 / 燃油 / 打车 ──
INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '地铁', 'category.transportMetro', '🚇', 'expense', 1, 1
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.transport' OR (p.name_key IS NULL AND p.name = '交通'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.transportMetro' OR c.name = '地铁')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '高铁', 'category.transportHsr', '🚅', 'expense', 1, 2
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.transport' OR (p.name_key IS NULL AND p.name = '交通'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.transportHsr' OR c.name = '高铁')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '公交', 'category.transportBus', '🚌', 'expense', 1, 3
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.transport' OR (p.name_key IS NULL AND p.name = '交通'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.transportBus' OR c.name = '公交')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '燃油', 'category.transportFuel', '⛽', 'expense', 1, 4
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.transport' OR (p.name_key IS NULL AND p.name = '交通'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.transportFuel' OR c.name = '燃油')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '打车', 'category.transportTaxi', '🚕', 'expense', 1, 5
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.transport' OR (p.name_key IS NULL AND p.name = '交通'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.transportTaxi' OR c.name = '打车')
  )
HAVING MIN(p.id) IS NOT NULL;

-- ── 餐饮：零食 / 水果 / 外卖 ──
INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '零食', 'category.foodSnacks', '🍭', 'expense', 1, 1
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.foodSnacks' OR c.name = '零食')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '水果', 'category.foodFruit', '🍓', 'expense', 1, 2
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.foodFruit' OR c.name = '水果')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '外卖', 'category.foodTakeout', '🛵', 'expense', 1, 3
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.foodTakeout' OR c.name = '外卖')
  )
HAVING MIN(p.id) IS NOT NULL;

-- ── 日用：洗浴 / 纸 / 其他 ──
INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '洗浴', 'category.dailyBath', '🧼', 'expense', 1, 1
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.daily' OR (p.name_key IS NULL AND p.name = '日用'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.dailyBath' OR c.name = '洗浴')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '纸', 'category.dailyPaper', '🧻', 'expense', 1, 2
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.daily' OR (p.name_key IS NULL AND p.name = '日用'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.dailyPaper' OR c.name = '纸')
  )
HAVING MIN(p.id) IS NOT NULL;

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT MIN(p.id), '其他', 'category.dailyOther', '📦', 'expense', 1, 3
FROM category p
WHERE p.kind = 'expense' AND p.parent_id IS NULL
  AND (p.name_key = 'category.daily' OR (p.name_key IS NULL AND p.name = '日用'))
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.dailyOther' OR c.name = '其他')
  )
HAVING MIN(p.id) IS NOT NULL;

-- ── 旧一级"零食/水果"：账单与预算迁到"餐饮"下同名子分类 ──
UPDATE bill SET category_id = (
  SELECT MIN(c.id) FROM category c
  JOIN category p ON p.id = c.parent_id
  WHERE p.parent_id IS NULL AND p.kind = 'expense'
    AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
    AND (c.name_key = 'category.foodSnacks' OR c.name = '零食')
) WHERE category_id IN (
  SELECT id FROM category
  WHERE parent_id IS NULL AND is_system = 1 AND kind = 'expense'
    AND (name_key = 'category.snacks' OR name = '零食')
) AND (
  SELECT MIN(c.id) FROM category c
  JOIN category p ON p.id = c.parent_id
  WHERE p.parent_id IS NULL AND p.kind = 'expense'
    AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
    AND (c.name_key = 'category.foodSnacks' OR c.name = '零食')
) IS NOT NULL;

UPDATE bill SET category_id = (
  SELECT MIN(c.id) FROM category c
  JOIN category p ON p.id = c.parent_id
  WHERE p.parent_id IS NULL AND p.kind = 'expense'
    AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
    AND (c.name_key = 'category.foodFruit' OR c.name = '水果')
) WHERE category_id IN (
  SELECT id FROM category
  WHERE parent_id IS NULL AND is_system = 1 AND kind = 'expense'
    AND (name_key = 'category.fruits' OR name = '水果')
) AND (
  SELECT MIN(c.id) FROM category c
  JOIN category p ON p.id = c.parent_id
  WHERE p.parent_id IS NULL AND p.kind = 'expense'
    AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
    AND (c.name_key = 'category.foodFruit' OR c.name = '水果')
) IS NOT NULL;

INSERT OR IGNORE INTO budget (category_id, amount_cents)
SELECT
  (SELECT MIN(c.id) FROM category c
   JOIN category p ON p.id = c.parent_id
   WHERE p.parent_id IS NULL AND p.kind = 'expense'
     AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
     AND (c.name_key = 'category.foodSnacks' OR c.name = '零食')),
  b.amount_cents
FROM budget b
WHERE b.category_id IN (
  SELECT id FROM category
  WHERE parent_id IS NULL AND is_system = 1 AND kind = 'expense'
    AND (name_key = 'category.snacks' OR name = '零食')
) AND (
  SELECT MIN(c.id) FROM category c
  JOIN category p ON p.id = c.parent_id
  WHERE p.parent_id IS NULL AND p.kind = 'expense'
    AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
     AND (c.name_key = 'category.foodSnacks' OR c.name = '零食')
) IS NOT NULL;

INSERT OR IGNORE INTO budget (category_id, amount_cents)
SELECT
  (SELECT MIN(c.id) FROM category c
   JOIN category p ON p.id = c.parent_id
   WHERE p.parent_id IS NULL AND p.kind = 'expense'
     AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
     AND (c.name_key = 'category.foodFruit' OR c.name = '水果')),
  b.amount_cents
FROM budget b
WHERE b.category_id IN (
  SELECT id FROM category
  WHERE parent_id IS NULL AND is_system = 1 AND kind = 'expense'
    AND (name_key = 'category.fruits' OR name = '水果')
) AND (
  SELECT MIN(c.id) FROM category c
  JOIN category p ON p.id = c.parent_id
  WHERE p.parent_id IS NULL AND p.kind = 'expense'
    AND (p.name_key = 'category.food' OR (p.name_key IS NULL AND p.name = '餐饮'))
     AND (c.name_key = 'category.foodFruit' OR c.name = '水果')
) IS NOT NULL;

-- ── 删除旧一级"零食/水果"（仍有子分类或账单时保留，不失败） ──
DELETE FROM category
WHERE parent_id IS NULL AND is_system = 1 AND kind = 'expense'
  AND (name_key IN ('category.snacks', 'category.fruits') OR name IN ('零食', '水果'))
  AND NOT EXISTS (SELECT 1 FROM category c WHERE c.parent_id = category.id)
  AND NOT EXISTS (SELECT 1 FROM bill b WHERE b.category_id = category.id);

-- 预算孤儿行兜底清理（category_id = 0 是"总预算"哨兵，不属于任何分类，必须保留）
DELETE FROM budget
WHERE category_id != 0
  AND category_id NOT IN (SELECT id FROM category);
