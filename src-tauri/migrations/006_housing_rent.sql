-- BunPocket 默认分类 v3（version 6）：住房下预置二级分类「房租」
-- 全幂等：住房下已有同 name_key 或同名的子分类则跳过；
-- 识别宿主：name_key = 'category.housing'，或 name_key 为空但 name 仍是「住房」（旧库/自建同名兜底）；
-- 用户把「住房」改成别的名字后不再识别、本次不插入；住房不存在/已删除同样跳过（迁移不因边界情况失败）。
-- 只取 MIN(id) 的那个住房，避免用户自建的第二个同名一级分类被误判成宿主。
-- 不迁移任何历史账单：历史上记在「住房」的账目保持原样，迁移后仍可继续记在「住房」本身。

INSERT INTO category (parent_id, name, name_key, icon, kind, is_system, sort)
SELECT p.id, '房租', 'category.housingRent', '🔑', 'expense', 1, 1
FROM category p
WHERE p.id = (
  SELECT MIN(p2.id) FROM category p2
  WHERE p2.kind = 'expense' AND p2.parent_id IS NULL
    AND (p2.name_key = 'category.housing' OR (p2.name_key IS NULL AND p2.name = '住房'))
)
  AND NOT EXISTS (
    SELECT 1 FROM category c
    WHERE c.kind = 'expense' AND c.parent_id = p.id
      AND (c.name_key = 'category.housingRent' OR c.name = '房租')
  );
