-- Add abandoned cart tracking fields to User
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "lastCartActivityAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastAbandonedCartEmailAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "abandonedCartEmailCount" INTEGER NOT NULL DEFAULT 0;
