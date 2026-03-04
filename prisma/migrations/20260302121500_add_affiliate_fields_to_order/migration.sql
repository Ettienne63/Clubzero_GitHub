ALTER TABLE "Order"
ADD COLUMN "affiliateStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "affiliateApprovedAt" TIMESTAMP(3),
ADD COLUMN "affiliatePaidAt" TIMESTAMP(3);

CREATE INDEX "Order_affiliateStatus_idx" ON "Order"("affiliateStatus");

UPDATE "Order"
SET
  "affiliateStatus" = 'APPROVED',
  "affiliateApprovedAt" = COALESCE("affiliateApprovedAt", "createdAt")
WHERE "status" = 'AFFILIATE_APPROVED';

UPDATE "Order"
SET
  "affiliateStatus" = 'PAID',
  "affiliateApprovedAt" = COALESCE("affiliateApprovedAt", "createdAt"),
  "affiliatePaidAt" = COALESCE("affiliatePaidAt", "createdAt")
WHERE "status" = 'AFFILIATE_PAID';
