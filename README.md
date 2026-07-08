# IOU — shared cost tracker

A mobile-first web app for splitting shared expenses in a small group (family /
close friends), across multiple currencies, with proportional tax, per-person
discounts, and one-tap settle-up.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Out of the box it runs in **single-device mode** (data in your browser's
localStorage) — great for trying it out. To share a group across everyone's
phones, enable **cloud mode** with Supabase (below).

## Enable cloud sharing (Supabase)

1. Create a free project at <https://supabase.com>.
2. In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy `.env.local.example` to `.env.local` and fill in your project URL and
   anon public key (Project Settings → API).
4. Restart `npm run dev`. The app auto-detects the keys and switches to cloud
   mode — anyone with the group's 6-character code sees the same data, refreshed
   every few seconds and on window focus.

### Security model (locked down)

Tables have Row Level Security enabled with **no** permissive policies, so the
public anon key **cannot** read or write them directly — you can't enumerate or
open other people's groups. Every operation goes through a `SECURITY DEFINER`
database function that requires the group's `share_code` (see the functions in
`schema.sql`). Know a group's code → full access to that group only; don't →
you see nothing. There are no passwords, by design, so treat the invite code
like a key: anyone you give it to can view and edit that group.

## Deploy (Netlify)

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import from Git**, pick the repo. Netlify
   auto-detects Next.js (config is in [`netlify.toml`](netlify.toml)); no build
   settings to change.
3. **Site settings → Environment variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Share the site URL + a group's invite code with your group.

> Redeploy (or "Clear cache and deploy") after adding the env vars so they're
> baked into the client build. Vercel works the same way if you prefer it.

## How the money math works

All calculations live in [`src/lib/split.ts`](src/lib/split.ts) and
[`src/lib/currency.ts`](src/lib/currency.ts), and are covered by tests:

- **Split** equally, or **itemized** (assign items to people; unassigned items
  are shared equally).
- **Tax** is a percentage on the bill, allocated proportionally to each person's
  share. Gross shares use the largest-remainder method so they sum exactly to
  the bill total (no lost cents), correct for 0-, 2-, and 3-decimal currencies.
- **Discount**: the payer can drop any person to e.g. 50% of their share; the
  payer absorbs the remainder. It only changes what that person owes the payer —
  the merchant total is unchanged.
- **Multi-currency**: each expense is entered in its own currency and converted
  to the group's home currency (rate auto-fetched from `open.er-api.com`, editable
  per expense) for balances.
- **Settle-up**: net balances are reduced to the minimum set of "A pays B"
  transfers via greedy debt simplification.

## Scripts

```bash
npm run dev      # dev server
npm test         # run the Vitest suite (money math + store lifecycle)
npm run build    # production build
```

## Project layout

```
src/lib/          split math, currency helpers, FX, storage adapters, types
src/components/   GroupApp + the add-expense / settle-up / members sheets
src/app/          landing page, /g/[code] group page, /api/fx route
supabase/         schema.sql — tables + code-gated access functions
netlify.toml      deploy config
```
