-- Seed for Auth / Customers / Products (idempotent)

-- 1) Admin user
-- passwordHash is a bcrypt digest (cost 10) of the dev password "123456".
-- It must NOT be stored in cleartext: AuthService compares with bcrypt.compare and
-- has no plaintext fallback, so a literal password here would simply fail to log in.
-- To rotate: node -e "console.log(require('bcrypt').hashSync('<new>',10))"
INSERT INTO "User" ("id", "email", "passwordHash", "name", "role", "warehouseId", "createdAt", "updatedAt")
VALUES (
  'seed_user_admin',
  'admin@convex-wms.local',
  '$2b$10$PvwHUWg5cgRUQ/InRhnVq.zTD.J1NOyPWYKdhzqeNlSEKxAn7kCQW',
  'System Admin',
  'SUPER_ADMIN'::"Role",
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT ("email") DO UPDATE SET
  "passwordHash" = EXCLUDED."passwordHash",
  "name" = EXCLUDED."name",
  "role" = EXCLUDED."role",
  "updatedAt" = NOW();

-- 2) Customers
INSERT INTO "Customer" (
  "id", "code", "name", "contactName", "phone", "email",
  "settlementType", "creditLimit", "balance", "status", "createdAt", "updatedAt"
)
VALUES
(
  'seed_customer_001',
  'CUST001',
  'Shenzhen Alpha Trading',
  'Alice',
  '13800000001',
  'alice@alpha.com',
  'credit',
  50000,
  12000,
  'ACTIVE'::"CustomerStatus",
  NOW(),
  NOW()
),
(
  'seed_customer_002',
  'CUST002',
  'Guangzhou Beta E-commerce',
  'Bob',
  '13800000002',
  'bob@beta.com',
  'prepaid',
  20000,
  5000,
  'ACTIVE'::"CustomerStatus",
  NOW(),
  NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "contactName" = EXCLUDED."contactName",
  "phone" = EXCLUDED."phone",
  "email" = EXCLUDED."email",
  "settlementType" = EXCLUDED."settlementType",
  "creditLimit" = EXCLUDED."creditLimit",
  "balance" = EXCLUDED."balance",
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();

-- 3) Products
INSERT INTO "Product" (
  "id", "sku", "name", "customerId", "unit", "createdAt", "updatedAt"
)
VALUES
(
  'seed_product_001',
  'SKU-ALPHA-001',
  'Wireless Mouse',
  (SELECT "id" FROM "Customer" WHERE "code" = 'CUST001'),
  'pcs',
  NOW(),
  NOW()
),
(
  'seed_product_002',
  'SKU-BETA-001',
  'USB-C Cable',
  (SELECT "id" FROM "Customer" WHERE "code" = 'CUST002'),
  'pcs',
  NOW(),
  NOW()
)
ON CONFLICT ("sku") DO UPDATE SET
  "name" = EXCLUDED."name",
  "customerId" = EXCLUDED."customerId",
  "unit" = EXCLUDED."unit",
  "updatedAt" = NOW();