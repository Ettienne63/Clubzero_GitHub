ALTER TABLE "Order"
ADD COLUMN "productsSubtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "deliveryDistanceKm" DOUBLE PRECISION;

UPDATE "Order"
SET "productsSubtotal" = COALESCE("total", 0),
    "deliveryFee" = 0
WHERE "productsSubtotal" = 0;
