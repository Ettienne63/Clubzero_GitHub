-- Goal tracker entries for bottle sales targets
CREATE TABLE "Goal" (
  "id" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "targetBottles" INTEGER NOT NULL,
  "createdByUserId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Goal_createdByUserId_idx" ON "Goal"("createdByUserId");

ALTER TABLE "Goal"
ADD CONSTRAINT "Goal_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
