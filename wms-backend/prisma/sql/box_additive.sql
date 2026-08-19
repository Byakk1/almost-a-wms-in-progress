-- Box (carton) — additive DDL.
--
-- Applied with:  npx prisma db execute --file prisma/sql/box_additive.sql
-- (Prisma 7 reads the datasource URL from prisma.config.ts; there is no --schema flag.)
--
-- This project runs on hand-applied additive DDL, NOT `prisma migrate` — the
-- migrations history is stale (2 dirs vs 27 models) and `migrate dev` would offer
-- to reset the database, which has no known backup (self-hosted Supabase at
-- supabase.opentrust.net, not Supabase Cloud, so no managed PITR to fall back on).
-- Keep this file idempotent so a re-run is a no-op rather than an error.
--
-- Mirrors `model Box` in schema.prisma; follows Prisma's own DDL naming
-- conventions (_pkey / _key / _idx / _fkey) so a future baseline diff comes out empty.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Box" (
    "id" TEXT NOT NULL,
    "boxNo" TEXT NOT NULL,
    "transitOrderId" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL DEFAULT 0,
    "length" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "actualWeight" DOUBLE PRECISION,
    "volWeight" DOUBLE PRECISION,
    "chargeWeight" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "destination" TEXT,
    "courier" TEXT,
    "trackingNo" TEXT,
    "measuredAt" TIMESTAMP(3),
    "signedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Box_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Box_boxNo_key" ON "Box"("boxNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Box_transitOrderId_idx" ON "Box"("transitOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Box_status_idx" ON "Box"("status");

-- AddForeignKey
-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so swallow the duplicate on re-run.
DO $$
BEGIN
    ALTER TABLE "Box" ADD CONSTRAINT "Box_transitOrderId_fkey"
        FOREIGN KEY ("transitOrderId") REFERENCES "TransitOrder"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;
