-- CreateTable
CREATE TABLE "InventoryHistory" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "supplierName" TEXT,
    "previousQuantity" INTEGER,
    "changeQuantity" INTEGER,
    "newQuantity" INTEGER,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryHistory_scope_entityId_createdAt_idx" ON "InventoryHistory"("scope", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryHistory_createdAt_idx" ON "InventoryHistory"("createdAt");
