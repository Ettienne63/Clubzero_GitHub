# Sanzo E-commerce

**Quick Start**

1. Install and open Docker Desktop.
2. Create your local env file:
   `Copy-Item .env.example .env`
3. Edit `.env` and set real secrets:
   - `SESSION_SECRET` should be unique per developer.
   - `POSTGRES_PASSWORD` should be unique.
4. Start everything:
   `docker compose up -d --build`
5. Run Prisma migration:
   `npx prisma migrate dev`
6. Open the app:
   `http://localhost:9000`

**Notes**

- `.env.example` is a template. The app reads only `.env`.
- The backend connects to PostgreSQL at host `db` on port `5432` using `DATABASE_URL`.
- Database schema is managed by Prisma migrations in `prisma/migrations`.
- You do not need to rebuild for README changes. Rebuild only when code, dependencies, or the Dockerfile changes.

**Connect With psql / DB GUI**
Use these values when connecting:

- Host: `localhost`
- Port: `5432`
- Username: `POSTGRES_USER` from `.env`
- Password: `POSTGRES_PASSWORD` from `.env`
- Database: `POSTGRES_DB` from `.env`
