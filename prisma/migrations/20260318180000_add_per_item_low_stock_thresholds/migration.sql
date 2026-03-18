-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "SupplierCustomProduct"
ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;
