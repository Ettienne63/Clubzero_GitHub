-- Affiliate application lifecycle and referral tracking
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "affiliateProgramStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "affiliateCode" TEXT,
ADD COLUMN IF NOT EXISTS "affiliateAppliedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "affiliateApprovedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "affiliateRejectedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "referredByAffiliateId" INTEGER;

ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS "affiliateReferrerUserId" INTEGER,
ADD COLUMN IF NOT EXISTS "affiliateReferrerCode" TEXT;

CREATE TABLE IF NOT EXISTS "AffiliateReferralClick" (
  "id" SERIAL NOT NULL,
  "affiliateUserId" INTEGER NOT NULL,
  "referralCode" TEXT NOT NULL,
  "sessionId" TEXT,
  "landingPath" TEXT,
  "referrerUrl" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateReferralClick_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_referredByAffiliateId_fkey'
  ) THEN
    ALTER TABLE "User"
    ADD CONSTRAINT "User_referredByAffiliateId_fkey"
    FOREIGN KEY ("referredByAffiliateId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_affiliateReferrerUserId_fkey'
  ) THEN
    ALTER TABLE "Order"
    ADD CONSTRAINT "Order_affiliateReferrerUserId_fkey"
    FOREIGN KEY ("affiliateReferrerUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferralClick_affiliateUserId_fkey'
  ) THEN
    ALTER TABLE "AffiliateReferralClick"
    ADD CONSTRAINT "AffiliateReferralClick_affiliateUserId_fkey"
    FOREIGN KEY ("affiliateUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "User_affiliateCode_key" ON "User"("affiliateCode");
CREATE INDEX IF NOT EXISTS "User_affiliateProgramStatus_idx" ON "User"("affiliateProgramStatus");
CREATE INDEX IF NOT EXISTS "User_referredByAffiliateId_idx" ON "User"("referredByAffiliateId");
CREATE INDEX IF NOT EXISTS "Order_affiliateReferrerUserId_idx" ON "Order"("affiliateReferrerUserId");
CREATE INDEX IF NOT EXISTS "Order_affiliateReferrerCode_idx" ON "Order"("affiliateReferrerCode");
CREATE INDEX IF NOT EXISTS "AffiliateReferralClick_affiliateUserId_createdAt_idx" ON "AffiliateReferralClick"("affiliateUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AffiliateReferralClick_referralCode_idx" ON "AffiliateReferralClick"("referralCode");
