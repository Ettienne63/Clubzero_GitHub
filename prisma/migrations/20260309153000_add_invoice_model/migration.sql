CREATE TABLE "Invoice" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "recipientName" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "subtotal" DOUBLE PRECISION NOT NULL,
  "total" DOUBLE PRECISION NOT NULL,
  "notes" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),

  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Invoice" (
  "orderId",
  "invoiceNumber",
  "status",
  "currency",
  "recipientName",
  "recipientEmail",
  "subtotal",
  "total",
  "notes",
  "issuedAt",
  "dueAt"
)
SELECT
  o."id",
  CONCAT('CZ-', TO_CHAR(o."createdAt", 'YYYY'), '-', LPAD(o."id"::TEXT, 6, '0')),
  CASE WHEN UPPER(COALESCE(o."status", '')) = 'PAID' THEN 'PAID' ELSE 'DRAFT' END,
  'ZAR',
  o."deliveryName",
  u."email",
  o."total",
  o."total",
  'Please use your invoice number as the payment reference.',
  o."createdAt",
  o."createdAt" + INTERVAL '7 days'
FROM "Order" o
JOIN "User" u ON u."id" = o."userId"
LEFT JOIN "Invoice" i ON i."orderId" = o."id"
WHERE i."id" IS NULL;
