# Prisma Migration Safety (No Data Loss)

Use this guide for local development on `clubzero` to avoid accidental data wipes.

## Golden Rule

- Do **not** run `npx prisma migrate reset` unless you intentionally want to wipe data.

## Standard Flow (When There Is No Drift)

1. Update Prisma schema:
```powershell
# edit prisma/schema.prisma
```

2. Create migration file only:
```powershell
npx prisma migrate dev --create-only
```

3. Apply migration to your DB:
```powershell
npx prisma migrate deploy
```

4. Regenerate Prisma client:
```powershell
npx prisma generate
```

## If Drift Is Reported (Safe Recovery)

If Prisma says drift detected and asks to reset, use this instead.

1. Back up database first (Docker container):
```powershell
docker exec -t clubzero-db pg_dump -U postgres -d clubzero -n clubzero_setup > clubzero_backup.sql
```

2. Apply the new migration SQL manually:
```powershell
npx prisma db execute --file prisma/migrations/<migration_name>/migration.sql
```

3. Mark migration as applied in Prisma history:
```powershell
npx prisma migrate resolve --applied <migration_name>
```

4. Regenerate Prisma client:
```powershell
npx prisma generate
```

5. Verify status:
```powershell
npx prisma migrate status
```

## Quick Verification Checks

- Confirm backup file exists and has size:
```powershell
Get-Item .\clubzero_backup.sql
```

- Confirm Prisma migration state:
```powershell
npx prisma migrate status
```

## Team Practice To Prevent Drift

- Avoid direct schema changes in DB tools.
- Keep all schema changes in `prisma/schema.prisma` + migrations.
- Commit migration files with code changes in the same PR/commit.

