-- Alter User to store profile phone
ALTER TABLE "User"
ADD COLUMN "phone" TEXT;

-- Address book entries per user
CREATE TABLE "AddressBookEntry" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "label" TEXT,
  "recipientName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AddressBookEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AddressBookEntry_userId_idx" ON "AddressBookEntry"("userId");

ALTER TABLE "AddressBookEntry"
ADD CONSTRAINT "AddressBookEntry_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
