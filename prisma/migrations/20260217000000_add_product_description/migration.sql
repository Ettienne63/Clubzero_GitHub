-- Add optional description field for product details page and admin form
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "description" TEXT;
