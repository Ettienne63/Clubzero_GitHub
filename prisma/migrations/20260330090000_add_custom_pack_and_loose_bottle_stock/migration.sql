-- Track bottle-level leftovers for each product so custom packs can reserve bottles.
ALTER TABLE "Product"
ADD COLUMN "looseBottleStock" INTEGER NOT NULL DEFAULT 0;

-- Allow custom pack rows in cart without a direct product relation.
ALTER TABLE "CartItem"
ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE "CartItem"
ADD COLUMN "isCustomPack" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "customPackConfig" JSONB;

-- Allow custom pack rows in order history/invoices without a direct product relation.
ALTER TABLE "OrderItem"
ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE "OrderItem"
ADD COLUMN "isCustomPack" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "customPackConfig" JSONB;
