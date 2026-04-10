-- CreateTable
CREATE TABLE "SupplierCustomProduct" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCustomProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCustomProduct_supplierId_name_key" ON "SupplierCustomProduct"("supplierId", "name");

-- CreateIndex
CREATE INDEX "SupplierCustomProduct_supplierId_idx" ON "SupplierCustomProduct"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierCustomProduct" ADD CONSTRAINT "SupplierCustomProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
