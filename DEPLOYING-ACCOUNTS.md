# Deploying accounts (phases 1 + 2) to production

One-time runbook for putting login and per-restaurant data separation live.
Every step has a check. **Do not skip the checks** — several failure modes look
identical to "my data is gone" when the data is actually fine.

Run everything from `/Users/simone/Documents/webapp`, with:

```sh
export PATH="/opt/homebrew/bin:$PATH"
```

---

## Before you start — what will and won't change

- **Your existing data stays yours.** Migration `0035` only *adds* a column; it
  never edits, moves or deletes a row. Everything currently in production ends
  up marked as belonging to the super-admin — which is the account you log in
  as. Verified locally: super-admin sees every pre-accounts row, a customer sees
  none of them.
- **Old invoice photos stay readable to you.** Their file addresses have no
  owner stamped in them, which resolves to the super-admin.
- **The site gets a login.** After this, nothing is readable without one. That
  is the point, and it closes the hole where anyone could read every invoice
  with a single `curl`.

### The one thing that makes this safe to attempt

Steps 1–3 are **backwards compatible**. Adding tables and columns does nothing
to the code currently running, because it doesn't know they exist. So you can
apply the migrations, walk away, and the live site carries on exactly as now.

That means the risky window is only between step 5 (deploy) and step 7 (first
login) — a couple of minutes — and rolling back is redeploying the old code,
with no database changes to undo.

---

## Step 0 — Back up production

Non-negotiable. This is the only step that cannot be undone by redeploying.

```sh
npx wrangler d1 export invoicedb-production --remote \
  --output=backup-before-accounts-$(date +%Y%m%d).sql
```

**Check:** the file exists and is not tiny.

```sh
ls -lh backup-before-accounts-*.sql
head -5 backup-before-accounts-*.sql
```

Expect a few hundred KB and SQL statements at the top. If it's a few bytes,
stop and investigate — do not continue without a real backup.

---

## Step 1 — Apply migration 0034 (accounts tables)

Creates `organizations`, `users`, `invites`. Touches nothing existing.

```sh
npx wrangler d1 execute invoicedb-production --remote \
  --file=./migrations/0034_accounts_phase1.sql
```

**Check:**

```sh
npx wrangler d1 execute invoicedb-production --remote \
  --command="SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('organizations','users','invites');"
```

Expect `n = 3`.

---

## Step 2 — Apply migration 0035 (ownership column)

Adds `org_id` to all 27 data tables. Existing rows get `NULL`, meaning
"belongs to the super-admin".

```sh
npx wrangler d1 execute invoicedb-production --remote \
  --file=./migrations/0035_org_scoping.sql
```

**Check** — the column exists, and your data is tagged as yours:

```sh
npx wrangler d1 execute invoicedb-production --remote \
  --command="SELECT COUNT(*) AS mine FROM generic_products WHERE org_id IS NULL;"
```

Expect roughly **79** (your current product count) — i.e. everything, still
yours. If this returns 0, stop: something is wrong.

> If a statement fails with "duplicate column name", that part was already
> applied. The migration is one `ALTER TABLE` per table, so re-running it after
> a partial failure will error on the tables that already succeeded. Check which
> table it stopped at and apply the remainder by hand.

---

## Step 3 — Set the session secret

Signs the login cookies. **Without it every login fails** — deliberately, the
app refuses to serve data rather than risk serving it to the wrong person.

Generate a strong value and set it:

```sh
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Copy that output, then:

```sh
npx wrangler pages secret put SESSION_SECRET --project-name webapp
```

Paste the value when prompted.

**Check:**

```sh
npx wrangler pages secret list --project-name webapp
```

`SESSION_SECRET` should be listed alongside `ANTHROPIC_API_KEY`.

> Keep this value. Changing it later signs everyone out — which is also the
> emergency "log everybody out" lever if you ever need one.

---

## Step 4 — Merge the branch into main

The work is on `accounts-phase2`. `main` was deliberately left deployable.

```sh
git checkout main
git merge accounts-phase2
npm test                 # expect all 6 files passing
```

**Check:** `npm test` is green before you deploy anything.

---

## Step 5 — Deploy

```sh
npm run deploy
```

**Expect the site to be unusable for the next two minutes.** Everyone,
including you, gets "Not signed in" — because no account exists yet. This is
the step that looks like data loss and isn't.

**Check:**

```sh
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://webapp-g5y.pages.dev/api/tables/invoices"
```

Expect **401**. That is the hole closing. If you get 200, the deploy didn't
take — do not proceed, and re-check step 4.

---

## Step 6 — Create your super-admin account

One-time. The endpoint refuses to run once any account exists, so it cannot
become a back door.

Pick a real password (8+ characters) and:

```sh
curl -s -X POST "https://webapp-g5y.pages.dev/api/auth/bootstrap" \
  -H 'content-type: application/json' \
  -d '{"email":"simoneisonni@gmail.com","password":"YOUR-REAL-PASSWORD","name":"Simone"}'
```

**Check:** the reply contains `"role":"super_admin"`.

Then confirm it's sealed:

```sh
curl -s -X POST "https://webapp-g5y.pages.dev/api/auth/bootstrap" \
  -H 'content-type: application/json' \
  -d '{"email":"someone@else.com","password":"password123"}'
```

Expect **409 "Already set up"**. If this succeeds, stop — the endpoint is open
and anyone could create an admin.

---

## Step 7 — Log in and confirm your data is there

Open **https://webapp-g5y.pages.dev/login** and sign in with what you just set.

You should land on the admin screen. Then check the app itself:

- **Products** — expect ~79
- **Invoices** — expect ~10
- **Suppliers** — expect ~19
- Open an invoice and confirm the **photo still displays**
- **Price Movers** and **P&L** load without error

If products show but Price Movers is empty, that's worth investigating before
onboarding anyone — tell me and I'll look.

---

## Step 8 — Confirm a stranger sees nothing

In a private/incognito window, visit:

```
https://webapp-g5y.pages.dev/inventory
```

You should be bounced to the login page. And:

```sh
curl -s "https://webapp-g5y.pages.dev/api/tables/generic_products" | head -c 120
```

Expect `{"error":"Not signed in."}`.

---

## If something goes wrong

**The site is broken after deploying.** Roll back the code — the migrations do
not need undoing, because the old code ignores the new columns:

```sh
git checkout main~1
npm run deploy
git checkout main
```

Then tell me what the error was.

**Login always fails.** `SESSION_SECRET` is missing or wasn't picked up. Re-check
step 3, then redeploy (secrets apply to new deployments).

**A page 500s.** Note which one. Most likely a query that needs the ownership
filter in a code path the tests didn't reach — recoverable, and worth fixing
before any customer sees it.

---

## After it's live

You are **not** ready for customers yet. Remaining before onboarding anyone:

1. **Click through every page as a test restaurant in a browser.** Everything so
   far is verified by API calls, not by eye. Create a throwaway restaurant on
   the admin screen and use the app as them.
2. **Run the isolation suite against production** once, or repeat its key checks
   by hand with two test accounts.
3. **Delete the test restaurants** before real use.

Only then create a real customer account.
