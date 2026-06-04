-- Putaway rule seed data for WMS (Sprint 5 item 2: putaway strategy engine)
-- Run: npx prisma db execute --file prisma/seed-putaway-rules.sql
--
-- productCategory is matched (exact) against Product.itemType; '*' = catch-all (lowest priority).
-- `zone` must be an existing Location.zone in the target warehouse.
-- Idempotent via WHERE NOT EXISTS (PutawayRule has no natural unique key, so no ON CONFLICT).
-- NOTE: zones/categories below are tuned to the current DB (warehouse WH-E2E-01, zones A/B).
--       Adjust the literals when real warehouses/categories exist.

INSERT INTO "PutawayRule" (id, "warehouseId", zone, "productCategory", priority, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w.id, v.zone, v.cat, v.prio, true, NOW(), NOW()
FROM "Warehouse" w
CROSS JOIN (VALUES
  ('A'::text, '电子产品'::text, 100),   -- example category rule (fires once products carry itemType)
  ('B'::text, '*'::text,         0)     -- catch-all: everything else -> zone B
) AS v(zone, cat, prio)
WHERE w.code = 'WH-E2E-01'
  AND NOT EXISTS (
    SELECT 1 FROM "PutawayRule" pr
    WHERE pr."warehouseId" = w.id
      AND pr.zone = v.zone
      AND COALESCE(pr."productCategory", '') = COALESCE(v.cat, '')
  );
