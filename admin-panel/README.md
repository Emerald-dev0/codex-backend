# Buildrs.HQ Admin Panel

The platform admin frontend: a Next.js 15 (pages router) app. It talks to the
root Express backend through `/api/admin/*`. All authorization happens on the
server. This app never holds provider keys.

## Run locally

```bash
# 1. Backend (repo root). Needs MongoDB and the usual .env.
npm install --ignore-scripts
npm run dev            # http://localhost:3000

# 2. Make someone a platform admin (the first admin must be created this way)
node scripts/grant-platform-admin.js you@company.com super_admin
#   roles: admin | super_admin     revoke: --revoke you@company.com

# 3. Admin panel
cd admin-panel
npm install
npm run dev            # http://localhost:3002
```

`next.config.js` proxies `/api` and `/uploads` to `API_ORIGIN` (default
`http://127.0.0.1:3000`), so the browser only uses same-origin relative URLs.
Set `API_ORIGIN` at build time when the backend lives somewhere else.

## Roles

| Capability | admin | super_admin |
| --- | --- | --- |
| View every screen, reply to and resolve disputes, suspend/reinstate users | ✓ | ✓ |
| Refunds, withdrawals, platform settings (General / Security) | – | ✓ |

The server enforces every rule (`middleware/platformAdmin.js`). The UI only
mirrors them by disabling controls. Money and settings actions are written to
`AdminAudit`.

## Sign-in and sessions

- Email + password, then a second factor: an email code, or an authenticator
  app once set up in **Settings → Security**. If **Enforce admin 2FA** is on,
  every admin has to pass the second step.
- Admin tokens last 12 hours, are tied to an `AdminSession` and expire after
  the idle timeout set in Security settings. The token lives in
  `sessionStorage`.
- Changing your password signs you out everywhere, including the current tab.

## Payment gateways and payouts

Gateway credentials are server-side env vars (see `.env.example`):
`STRIPE_SECRET_KEY`, `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`.
"Connect gateway" in Finance explains which variable to set. PayPal is shown,
but it isn't integrated with the billing backend yet.

By default, **Withdraw** records a *withdrawal request* (status `requested`).
Finance then completes it in the provider dashboard, and no money moves from
the panel. To let the panel start real payouts, set `ADMIN_PAYOUTS_ENABLED=true`
and configure the payout destination variables listed in `.env.example`.

## Data sources

- Payments, refunds and revenue come from the `Payment` ledger. Verified
  billing webhooks write it (`utils/paymentLedger.js`).
- Disputes reuse `SupportTicket`. Plans and prices are read-only and come from
  the subscription config shared with checkout (`models/Subscription.js`).
- Insights engagement and retention come from `UserActivityDay` (one upsert
  per active user per day).
