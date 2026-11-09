-- 分类图标类型：auto=系统分类用图标库/自定义分类用 emoji，emoji=强制显示 icon 字段，image=显示 icon_image
ALTER TABLE category ADD COLUMN icon_type TEXT NOT NULL DEFAULT 'auto';
