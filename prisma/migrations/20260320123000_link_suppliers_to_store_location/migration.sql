ALTER TABLE "Supplier"
ADD COLUMN "storeLocationId" TEXT;

CREATE UNIQUE INDEX "Supplier_storeLocationId_key" ON "Supplier"("storeLocationId");
