# Club Zero Website

Express + EJS ecommerce app for Club Zero with products, cart, checkout, orders, affiliate tracking, and contact forms.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
copy .env.example .env
```

3. Fill in the required values in `.env`:

- `DATABASE_URL`
- `SESSION_SECRET`

4. Start the app:

```bash
npm run dev
```

## Environment Variables

### Required

- `DATABASE_URL`: PostgreSQL connection string used by Prisma and the session store.
- `SESSION_SECRET`: Strong secret used to sign sessions. This must be at least 24 characters and cannot be `dev-secret`.

### Common Optional

- `NODE_ENV`: Use `production` in production.
- `PORT`: HTTP port. Defaults to `3000`.
- `DB_SCHEMA`: PostgreSQL schema for Prisma and session storage. Defaults to `clubzero_setup`.
- `TRUST_PROXY`: Set this when running behind a reverse proxy or platform load balancer so secure cookies and client IPs behave correctly.
- `SESSION_COOKIE_NAME`: Session cookie name. Defaults to `clubzero.sid`.
- `UPLOAD_DIR`: Override local upload storage path.
- `ADMIN_EMAIL`: Email address treated as admin during login.
- `PUBLIC_BASE_URL`: Base URL used for building absolute links in emails (like password resets).

### Contact Email

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `CONTACT_TO_EMAIL`
- `CONTACT_FROM_EMAIL`
- `ORDER_NOTIFICATION_EMAIL`: Optional internal recipient for new order emails (defaults to `CONTACT_TO_EMAIL` or `ADMIN_EMAIL`).

If SMTP is not configured, contact messages are still saved to the database but notification emails are skipped.

### Alerts

- `ALERT_WEBHOOK_URL`: Optional webhook endpoint for critical error alerts.

## Paystack Setup Checklist

1. Create a Paystack account and get your API keys.
2. Add these to `.env`:
   - `PAYSTACK_SECRET_KEY=sk_test_...` (use `sk_live_...` in production)
   - `PAYSTACK_PUBLIC_KEY=pk_test_...` (optional, for future inline checkout)
   - `PAYSTACK_CALLBACK_URL=https://your-domain.com/auth/checkout/paystack` (optional)
3. Configure the Paystack dashboard:
   - **Webhook URL**: `https://your-domain.com/webhooks/paystack`
   - **Callback URL** (optional): `https://your-domain.com/auth/checkout/paystack`
4. For local testing, use a public tunnel (ngrok or Cloudflare Tunnel) so Paystack can reach your webhook.

Notes:
- Orders start in `PENDING_PAYMENT` and become `PAID` after Paystack confirms.
- Invoices are created and emailed after payment succeeds.

## Production Notes

### Security

- The app will refuse to boot if `DATABASE_URL` or `SESSION_SECRET` is missing.
- The app will refuse to boot if `SESSION_SECRET` is weak or still set to `dev-secret`.
- Sessions are stored in PostgreSQL, not in process memory.
- Session cookies use `httpOnly` and `sameSite=lax`, and `secure` is enabled automatically when `NODE_ENV=production`.
- CSRF protection is enforced for all non-GET requests.
- Rate limits are applied to login, signup, checkout, and contact form submission.
- `helmet` is enabled for baseline security headers.

### Reverse Proxy

If you deploy behind Nginx, Fly, Render, Railway, or another proxy, set:

```env
NODE_ENV=production
TRUST_PROXY=true
```

Without `TRUST_PROXY`, secure cookies may not behave correctly behind HTTPS termination.

### Logging And Alerts

- Requests are logged in structured JSON.
- Request failures, unhandled promise rejections, and uncaught exceptions are logged as structured errors.
- If `ALERT_WEBHOOK_URL` is configured, critical failures are posted to that webhook.

## Verification

Basic syntax checks used after the security changes:

```bash
node --check app.js
node --check middleware/security.js
node --check lib/pgSessionStore.js
node --check controllers/contactController.js
```
