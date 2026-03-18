-- Add stockist request tracking
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StockistStatus') THEN
    CREATE TYPE "StockistStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "StockistRequest" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "message" TEXT,
  "status" "StockistStatus" NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockistRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockistRequest_status_idx" ON "StockistRequest"("status");
CREATE INDEX IF NOT EXISTS "StockistRequest_createdAt_idx" ON "StockistRequest"("createdAt");
