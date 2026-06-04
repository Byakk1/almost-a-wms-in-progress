-- Dictionary seed data for WMS
-- Run after prisma db push: psql $DATABASE_URL -f prisma/seed-dictionaries.sql

-- Battery Config (电池配置)
INSERT INTO "Dictionary" (id, category, code, label, "labelEn", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'BATTERY_CONFIG', 'NONE', '不含电池', 'No Battery', 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_CONFIG', 'BUILT_IN', '内置电池', 'Built-in Battery', 2, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_CONFIG', 'PAIRED', '配套电池', 'Paired Battery', 3, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_CONFIG', 'PURE', '纯电池', 'Pure Battery', 4, true, NOW(), NOW())
ON CONFLICT (category, code) DO NOTHING;

-- Battery Type (电池类型)
INSERT INTO "Dictionary" (id, category, code, label, "labelEn", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'BATTERY_TYPE', 'LITHIUM_ION', '锂电池(锂离子电池)', 'Lithium-ion', 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_TYPE', 'LITHIUM_METAL', '锂电池(锂金属电池)', 'Lithium Metal', 2, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_TYPE', 'BUTTON', '纽扣电池', 'Button Cell', 3, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_TYPE', 'LEAD_ACID', '铅酸电池', 'Lead-acid', 4, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_TYPE', 'DRY', '干电池', 'Dry Cell', 5, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_TYPE', 'NIMH', '镍氢电池', 'NiMH', 6, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'BATTERY_TYPE', 'OTHER', '其他', 'Other', 7, true, NOW(), NOW())
ON CONFLICT (category, code) DO NOTHING;

-- Exception Type (异常类型)
INSERT INTO "Dictionary" (id, category, code, label, "labelEn", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'EXCEPTION_TYPE', 'SHORT_PICK', '拣货短缺', 'Short Pick', 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_TYPE', 'DAMAGE', '货物破损', 'Damage', 2, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_TYPE', 'QUANTITY_MISMATCH', '数量不符', 'Quantity Mismatch', 3, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_TYPE', 'WRONG_ITEM', '错误商品', 'Wrong Item', 4, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_TYPE', 'MISSING_ITEM', '缺少商品', 'Missing Item', 5, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_TYPE', 'EXPIRED', '过期商品', 'Expired', 6, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_TYPE', 'OTHER', '其他', 'Other', 7, true, NOW(), NOW())
ON CONFLICT (category, code) DO NOTHING;

-- Inventory Status (库存状态)
INSERT INTO "Dictionary" (id, category, code, label, "labelEn", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'INVENTORY_STATUS', 'PENDING_CHECK', '待检', 'Pending Check', 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'INVENTORY_STATUS', 'QUALIFIED', '合格', 'Qualified', 2, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'INVENTORY_STATUS', 'FROZEN', '冻结', 'Frozen', 3, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'INVENTORY_STATUS', 'DAMAGED', '残品', 'Damaged', 4, true, NOW(), NOW())
ON CONFLICT (category, code) DO NOTHING;

-- Dimension Unit (尺寸单位)
INSERT INTO "Dictionary" (id, category, code, label, "labelEn", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'DIMENSION_UNIT', 'cm', '厘米', 'Centimeter', 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'DIMENSION_UNIT', 'in', '英寸', 'Inch', 2, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'DIMENSION_UNIT', 'mm', '毫米', 'Millimeter', 3, true, NOW(), NOW())
ON CONFLICT (category, code) DO NOTHING;

-- Weight Unit (重量单位)
INSERT INTO "Dictionary" (id, category, code, label, "labelEn", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'WEIGHT_UNIT', 'kg', '千克', 'Kilogram', 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'WEIGHT_UNIT', 'lb', '磅', 'Pound', 2, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'WEIGHT_UNIT', 'g', '克', 'Gram', 3, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'WEIGHT_UNIT', 'oz', '盎司', 'Ounce', 4, true, NOW(), NOW())
ON CONFLICT (category, code) DO NOTHING;

-- Currency (币种)
INSERT INTO "Dictionary" (id, category, code, label, "labelEn", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'CURRENCY', 'USD', '美元', 'US Dollar', 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CURRENCY', 'CNY', '人民币', 'Chinese Yuan', 2, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CURRENCY', 'EUR', '欧元', 'Euro', 3, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CURRENCY', 'GBP', '英镑', 'British Pound', 4, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CURRENCY', 'JPY', '日元', 'Japanese Yen', 5, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CURRENCY', 'CAD', '加元', 'Canadian Dollar', 6, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'CURRENCY', 'AUD', '澳元', 'Australian Dollar', 7, true, NOW(), NOW())
ON CONFLICT (category, code) DO NOTHING;

-- Exception Severity (异常严重程度)
INSERT INTO "Dictionary" (id, category, code, label, "labelEn", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'EXCEPTION_SEVERITY', 'LOW', '低', 'Low', 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_SEVERITY', 'MEDIUM', '中', 'Medium', 2, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_SEVERITY', 'HIGH', '高', 'High', 3, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'EXCEPTION_SEVERITY', 'CRITICAL', '紧急', 'Critical', 4, true, NOW(), NOW())
ON CONFLICT (category, code) DO NOTHING;
