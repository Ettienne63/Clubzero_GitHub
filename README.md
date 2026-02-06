# Sanzo E-commerce

**Quick Start**

1. Install and open Docker Desktop.
2. Create your local env file:
   `Copy-Item .env.example .env`
3. Edit `.env` and set real secrets:
   - `SESSION_SECRET` should be unique per developer.
   - `DB_PASSWORD` should be unique`.
4. Start everything:
   `docker compose up -d --build`
5. Open the app:
   `http://localhost:9000`

**Notes**

- `.env.example` is a template. The app reads only `.env`.
- The backend connects to SQL Server at host `db` on port `1433`.
- If the database does not exist yet, create it by running `db/setup.sql` against the `db` service.
- You do not need to rebuild for README changes. Rebuild only when code, dependencies, or the Dockerfile changes.

**Connect With SSMS / Azure Data Studio**
Use these values when connecting:

- Server name: `localhost,14330`
- Authentication: `SQL Server Authentication`
- Username/Login: `sa`
- Password: your `DB_PASSWORD` from `.env`
- Database name: leave blank (or `SanzoDB` after it exists)
- Encryption: set to Optional/Off and enable “Trust server certificate”
