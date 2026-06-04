-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN     "containerNo" TEXT,
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "inboundDate" TIMESTAMP(3),
ADD COLUMN     "inventoryStatus" TEXT NOT NULL DEFAULT 'QUALIFIED',
ADD COLUMN     "serialNo" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "actualValue" DECIMAL(8,2),
ADD COLUMN     "batteryConfig" TEXT,
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "catalogue" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "declaredValue" DECIMAL(10,2),
ADD COLUMN     "dimensionUnit" TEXT NOT NULL DEFAULT 'cm',
ADD COLUMN     "hasSerialNumber" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasShippingBag" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hazardCode" TEXT,
ADD COLUMN     "hsCode" TEXT,
ADD COLUMN     "isFood" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isHazardous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isLotControlled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isRefrigerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "itemType" TEXT,
ADD COLUMN     "material" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "nameEn" TEXT,
ADD COLUMN     "nameZh" TEXT,
ADD COLUMN     "originCountry" TEXT,
ADD COLUMN     "otherAttrs" TEXT,
ADD COLUMN     "packagingAttr" TEXT,
ADD COLUMN     "prop65" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remark" TEXT,
ADD COLUMN     "salesUrl" TEXT,
ADD COLUMN     "supplier" TEXT,
ADD COLUMN     "usage" TEXT,
ADD COLUMN     "warehouseCodes" TEXT,
ADD COLUMN     "weightUnit" TEXT NOT NULL DEFAULT 'kg',
ALTER COLUMN "length" SET DATA TYPE DECIMAL(8,1),
ALTER COLUMN "width" SET DATA TYPE DECIMAL(8,1),
ALTER COLUMN "height" SET DATA TYPE DECIMAL(8,1),
ALTER COLUMN "weight" SET DATA TYPE DECIMAL(8,3);

-- CreateTable
CREATE TABLE "ProductBattery" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batteryType" TEXT,
    "cellOrPack" TEXT,
    "batteryModel" TEXT,
    "quantity" INTEGER,
    "weightGrams" DECIMAL(8,2),
    "capacityMah" DECIMAL(8,2),
    "voltageV" DECIMAL(8,2),
    "lithiumContentG" DECIMAL(8,2),
    "packageMaterial" TEXT,
    "packaging" TEXT,
    "chargeStatus" TEXT,
    "otherDesc" TEXT,
    "carryingLabel" TEXT,
    "unCode" TEXT,
    "msdsFileList" TEXT,

    CONSTRAINT "ProductBattery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionCase" (
    "id" TEXT NOT NULL,
    "caseNo" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityNo" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "warehouseId" TEXT,
    "customerId" TEXT,
    "productId" TEXT,
    "locationId" TEXT,
    "attachments" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExceptionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dictionary" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentCode" TEXT,
    "extra" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dictionary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductBattery_productId_key" ON "ProductBattery"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ExceptionCase_caseNo_key" ON "ExceptionCase"("caseNo");

-- CreateIndex
CREATE INDEX "ExceptionCase_entityType_entityId_idx" ON "ExceptionCase"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ExceptionCase_status_idx" ON "ExceptionCase"("status");

-- CreateIndex
CREATE INDEX "ExceptionCase_warehouseId_idx" ON "ExceptionCase"("warehouseId");

-- CreateIndex
CREATE INDEX "ExceptionCase_createdAt_idx" ON "ExceptionCase"("createdAt");

-- CreateIndex
CREATE INDEX "Dictionary_category_idx" ON "Dictionary"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Dictionary_category_code_key" ON "Dictionary"("category", "code");

-- CreateIndex
CREATE INDEX "Inventory_expiryDate_idx" ON "Inventory"("expiryDate");

-- CreateIndex
CREATE INDEX "Inventory_inboundDate_idx" ON "Inventory"("inboundDate");

-- AddForeignKey
ALTER TABLE "ProductBattery" ADD CONSTRAINT "ProductBattery_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
