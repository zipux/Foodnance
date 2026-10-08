# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Foodnance — a business-management app for food/product businesses (products, suppliers, recipes, finished products, inventory, invoices, staff certifications). Runs on **Cloudflare Pages + Workers** with a **Hono** edge API, **D1** (SQLite) for structured data, and **R2** for file storage (invoice PDFs, certificates). Being built to sell commercially, so favor robust/professional choices over quick hacks.

## Commands

```bash
npm run dev              # Vite dev server (Hono via @hono/vite-dev-server)
npm run build            # Build to dist/ (bundles worker + copies public/ via vite plugin)
npm run deploy           # ⚠️ LIVE — build + deploy to production (real customers)
npm run deploy:staging   # same build to staging.webapp-g5y.pages.dev (staging data)
npm run dev:sandbox      # wrangler pages dev against dist/, local D1, port 3000

# Database (D1) — migrations live in migrations/, numbered NNNN_name.sql
npm run db:migrate:local   # apply migrations to local SQLite
npm run db:migrate:staging # apply to the staging D1 — rehearse here first
npm run db:migrate:prod    # ⚠️ DO NOT RUN — see "Production migration state" below
npm run db:reset           # wipe local D1 and re-apply all migrations
npm run db:wipe:local      # run wipe-data.sql (clears data, keeps schema) — local
npm run db:wipe:staging    # same against staging — safe, it holds no real data
npm run db:wipe:prod       # ⚠️ same against LIVE customer data

npm run cf-typegen       # regenerate Cloudflare binding types
```

### Environments — production and staging (set up 2026-08-06)

| | Production | Staging |
|---|---|---|
| URL | `webapp-g5y.pages.dev` | `staging.webapp-g5y.pages.dev` |
| Deploy | `npm run deploy` | `npm run deploy:staging` |
| D1 | `invoicedb-production` | `invoicedb-staging` |
| R2 | `invoicedb-files` | `invoicedb-files-staging` |
| Data | **real customers** | throwaway |

Cloudflare Pages has exactly two environments, **production** and **preview**.
`deploy:staging` passes `--branch staging`, which makes it a *preview*
deployment, and preview deployments pick up the `env.preview` bindings in
`wrangler.jsonc`. The binding **names are identical on both sides** (`DB`,
`FILES`) — `src/index.ts` never learns which environment it is in, so there is
no branch in the code that could be wrong.

**Every per-deploy URL is live.** `https://<hash>.webapp-g5y.pages.dev` is
different *code* wired to the *same live database*, so "just checking what the
old version did" could void a real customer's invoice. When comparing behaviour,
use staging, never an old hash URL.

**A `Preview` label does not mean staging data.** Pages snapshots bindings at
deploy time, so a preview built *before* `7181423` (2026-08-06, the commit that
added `env.preview`) carries the top-level **production** bindings despite the
label. Three such deployments were found and deleted 2026-08-08
(`fix/product-form-and-costing-bugs`, `pos-sales-import`,
`paused-account-write-gating`). Only previews built after that commit are safe.

**The staging site wears a banner.** `public/static/env-banner.js` (loaded by
every page, including `login.html`, so it works before sign-in) asks
`GET /api/env` and paints a hazard-striped bar plus a `[STAGING]` tab title when
the answer is `staging`. The answer comes from the `APP_ENV` var in
`wrangler.jsonc`, set per environment. **Anything other than the literal
`'staging'` means production**, so a missing or misspelt var hides the banner on
staging (harmless — you stay careful) rather than promising "nothing here is
real" over live customer data. Bump the `?v=` when editing it, like any static
JS: the CDN caches by full URL and will happily keep serving the old copy.

**Staging has one super-admin (`staging-admin@doughmeter.test`) and zero
organizations** (2026-08-08). A super-admin has no org, so it lands on the admin
screen and every org-scoped feature — invoice upload, products, P&L — has nothing
to file against. Create an org + owner there before treating staging as a test of
anything but the schema and the admin screens.

Staging D1 lives under `env.preview`, so direct `wrangler d1` commands against
it need `--env preview` or wrangler cannot find the database:

```bash
npx wrangler d1 execute invoicedb-staging --env preview --remote --command "SELECT ..."
```

**Rehearse migrations here.** `npm run db:migrate:staging` works normally — the
staging database was built by applying `0001`→`0046` to an empty D1, all 46
cleanly, which is the first end-to-end proof that the migration files produce a
working schema, and the dress rehearsal production has never had.

### Secrets — per environment, bound at deploy time

Secrets are per environment and **none are copied over**. Staging's
`SESSION_SECRET` is deliberately different, so a staging cookie can never be a
credential against production. Staging has had its own `ANTHROPIC_API_KEY` since
2026-08-08, verified end-to-end with a live `parse-recipe` call — so parses there
spend real money (~$0.15 an invoice).

Each environment should hold `ANTHROPIC_API_KEY` + `SESSION_SECRET` (plus `RESEND_API_KEY` once email is set up)
(preview also carries `APP_ENV`, managed from `wrangler.jsonc`). **Editing a
dashboard row renames it**, so adding a key by editing the existing row replaces
`SESSION_SECRET` instead of adding beside it — that happened on 2026-08-08 and
would have locked everyone out of staging at the next deploy, invisibly, because
the live deployment kept serving the secrets it was built with. After any secret
change, `secret list` and check the whole set, not just the one you touched.

**Email (Resend) — optional, added 2026-09-21.** `RESEND_API_KEY` is a third,
*optional* secret. It sends two messages today: the owner-invite email from
**Add a restaurant** (`sendOwnerInviteEmail`) and the password-reset link
(`sendPasswordResetEmail`, below). Sender is `MAIL_FROM` (default
`Foodnance <hello@foodnance.com>`; the domain must be verified in Resend), links use
`PUBLIC_URL` (production var, so they never point at pages.dev; unset on staging so
staging links stay on staging; add `PUBLIC_URL=http://localhost:3000` to `.dev.vars`
for local runs). **With no key nothing breaks**: the organization and invite are
still created and the API returns `invite_url` for the operator to send by hand —
the link comes back **only** when the email failed. Like every Pages secret it binds
at deploy time, so redeploy after `wrangler pages secret put RESEND_API_KEY`.

**Pages binds secrets at DEPLOY time, not runtime** — setting one does nothing to
already-live deployments; ship a new deployment after. This has caused two
outages. Dashboard route: Workers & Pages → webapp → Settings → Variables and
Secrets, environment selector set correctly, type **Secret** — plaintext vars do
not show in `secret list` and have not reached direct-upload deploys. Or:

```bash
npx wrangler pages secret put  ANTHROPIC_API_KEY --project-name webapp [--env preview]
npx wrangler pages secret list --project-name webapp [--env preview]   # a put has silently failed before
```

After deploying, the alias (`staging.webapp-g5y.pages.dev`) can serve the *previous*
build for a minute — check `https://<new-hash>.webapp-g5y.pages.dev` to test the
deploy you just shipped. A rotated `SESSION_SECRET` makes the switchover obvious:
existing cookies start returning "Not signed in".

**`ANTHROPIC_API_KEY` has been revoked three times** (2026-07-19, 08-07, 08-08),
twice mid-session, each surfacing as "API key is invalid" on invoice upload. Since
2026-10-04 the customer no longer sees Anthropic's text: `aiUnavailable()` answers 503 with
plain words and a reference (**AI-401** = key rejected, AI-429/529 = busy, **AI-0** = no key
on that deployment); the real message goes to the worker log only. Never return 502 from a
route: on foodnance.com Cloudflare replaces it with its own "Bad gateway" page.
`.dev.vars` is gitignored and untracked, so the leak is not git. Diagnose with a
raw `curl` to `api.anthropic.com/v1/messages/count_tokens`, outside the app, to
separate a dead key from a code bug. `/api/ai/status` only checks the key
**exists**, so it reports "AI ready" throughout an outage — a real health check
is still TODO. Production should hold exactly two secrets, `ANTHROPIC_API_KEY`
and `SESSION_SECRET`; a stray misspelled `WebApp ANTROPHIC` was deleted
2026-08-08.

### ✅ Old deployment URLs — DELETED 2026-08-09

**Closed.** 306 deployments existed (the CLI lists only 25; the API pages
25-at-a-time to the real total). **285 were deleted**, leaving **21**: the 12 most
recent production builds as rollback targets, and the 9 staging previews built
after `7181423`. All 285 deletes returned 200; a 25-deployment random sample of
the deleted set now returns `404`.

What this closed: **250 of them predated authentication entirely** — built before
2026-07-27, when there was no login screen — and each was publicly reachable at
`https://<hash>.webapp-g5y.pages.dev` wired to the **current live D1 and R2**.
Re-proved immediately before deletion, anonymous and cookieless, against the 6
April build `d8f782f1`: `GET /api/tables/invoices` → `200` with 19 real rows
(vendor `YEN BROS`, total `1149.84`, `file_key` set). Two *previews* also went:
`ad12a023` and `f1f4f12f`, both commit `d4ef033` — built minutes before
`7181423`, so they wore a `staging` branch label while carrying **production**
bindings. That is the trap described under "Environments"; check the commit, not
the label.

**Residual, and it is not zero.** `d8f782f1` still answers `200` on exactly the
**8 `/api/tables/*` paths probed during the audits** — `invoices`, `suppliers`,
`recipes`, `generic_products`, `stock_log`, `inventory`, `product_entries`,
`invoice_lines`. These are **stale Cloudflare edge-cache entries, not a live
deployment**: the control plane returns `404` for the deployment ID, and any
cache-key variation (`?x=1`, a trailing slash, a different case, any unprobed
path) returns `500` from the dead origin. So the snapshots are frozen at their
2026-08-08 contents, cannot refresh, and cannot be enumerated further. They
expire on Cloudflare's own TTL — **`pages.dev` is Cloudflare's zone, not ours, so
there is no purge API available to us.** Re-check before real customer data
lands; it should be long gone.

**Deletion was the only fix, and the custom domain would not have been one:**
Cloudflare keeps serving `pages.dev` alongside a custom domain
(`public/robots.txt` notes the missing 301), and no guard added today can reach
old worker code.

**Keep it closed.** Deploys accumulate — 306 built up in four months. Prune
periodically to ~12 production + current previews, and always check
`environment` *and* the commit hash before trusting a "preview" label.

### ⚠️ Production migration state — read before any prod DB work

**Never run `npm run db:migrate:prod`.** Production's `d1_migrations` table
records only up to **`0023_adjust_reasons_table.sql`** (29 rows), while the real
schema was at **0043** when verified against live D1 on 2026-07-31. Everything
from 0024 on — org scoping, plans, suspension, the invoice cap, POS sales import
— was applied **by hand and never recorded**, so the command would try to replay
0024 onward.

**`migrations/` now runs to `0063_stock_take_kind.sql`** (0061 applied to production by `--command` on 2026-10-06, unrecorded; 0058–0060 applied to production by `--command` on 2026-10-03, not recorded in `d1_migrations`; pre-change bookmark `000005b6-00000000-000050f9-0d0604a1c3a13f5c20f25018fe83498b`). Earlier it ran to `0052_invite_emails.sql` (0047–0051 landed after this note was written; 0052 is not on prod yet). It first ran to `0046_recurring_expense_dates.sql`: 0044–0046
landed after that audit: 0044 is recorded as applied on 2026-08-04, 0045 and 0046
are unconfirmed either way. Re-verify against live D1 — do not read the 0043
figure as current.

**Traced 2026-08-02 — the danger is real but not what it looks like.** The run
halts on the first error, and `0025_expense_invoices.sql` adds columns that
already exist (SQLite has no `ADD COLUMN IF NOT EXISTS`), so it dies well before
`0042_sales_monthly_per_org.sql` and its `DROP TABLE sales_monthly`. That
protection is **accidental** — the realistic failure is someone clearing errors
one by one until the run "works", walking into 0042 on the way. Even then 0042
would not lose rows (it `INSERT ... SELECT`s them into the rebuild table, and the
new shape is a superset). What it silently drops is **`revenue_source`**, missing
from the INSERT column list — every row reverts to `'auto'`, so any month whose
revenue was typed by hand flips to the imported figure in the P&L. Corruption,
not loss, and the quiet kind.

**Apply one file at a time instead**, and **back up any table a migration
rebuilds first** — 0042 was done this way, its three `sales_monthly` rows dumped
to JSON and verified after:
```bash
npx wrangler d1 execute invoicedb-production --remote --file=./migrations/0044_x.sql
```

**The fix, when there's time** (~15 min, deferred 2026-08-02): apply `0001`→the
highest migration on disk to a throwaway SQLite file, diff production against it
(read-only), fix the gaps, and *only then* insert the missing `d1_migrations`
rows from 0024 on. **The diff is the point, not the replay protection** — twenty
migrations were hand-applied and nobody has confirmed they landed completely.
Recording them without the diff would permanently hide a partially-applied
migration, exactly what had happened locally (0033 had its column but not its
index, 0035 was half-applied; neither noticed for weeks). Local has since been
repaired and `npm run db:migrate:local` works normally.

### Forgotten password (added 2026-09-21, migration `0051`)

Sign-in page → **Forgot password?** emails a single-use link to `/reset-password`;
the **fifth consecutive wrong password** emails one automatically
(`users.failed_logins`, reset by any successful login or reset). Both go through
`issuePasswordReset()`; three public endpoints (`forgot-password`, `reset-lookup`,
`reset-password`) are in `PUBLIC_API`. Read before touching it: every answer is
identical for known and unknown addresses (login too — the wrong-password and
unknown-address messages must stay word-for-word equal); links are capped at 3 per
user per hour and an *automatic* one only fires when none went out in the last hour,
so wrong passwords typed at someone else's address cost them at most one email an
hour and never lock them out; only the token's SHA-256 is stored and the link is
never returned by the API (no operator handoff, unlike invites); the email is sent
via `waitUntil` so a known address isn't slower. `noteFailedLogin` is fail-soft so a
missing column can never break sign-in — but **apply `0051` before deploying**.
`tests/password-reset.test.mjs` (static) + `npm run test:reset` (needs the sandbox).
Known limit: sessions are stateless signed cookies, so a reset does not sign out a
session already open on another device.

### Emailed teammate invites (added 2026-09-22, migration `0052`)

Settings → Team → **Invite someone** always **emails** the link — there is no link-only
mode (removed 2026-09-22: name and email are required anyway, so a bare link had no
use). The invite row is created first and kept if the send fails, so a refused or failed
email never loses the invite: the reply carries `emailed` + `email_error`, and only then
does the modal reveal the link as a fallback (it also stays in the pending list, with
Resend). **Name and email are both required** (the link is bound to that address when
accepted). `POST /api/team/invites/:id/resend` re-sends and restarts the 7 days.

**Duplicates are refused inside the organization only** (409, before anything is created or
an email slot is spent): an address already on the team (or deactivated — its `users.email`
is still taken, so an invite could never be accepted) or already holding a pending invite,
expired ones included (Resend is the way back). It must **never** ask whether an address has
an account *anywhere* — that would tell one customer who else is a customer; an address
belonging to another business goes through and is simply refused at accept time, as before.
Consequence for tests: reaching the email cap from one business now means invite → revoke →
invite again, which is exactly the loop the ledger exists for.

This makes the app email strangers on a customer's behalf from foodnance.com, so:
**10 emails per organization per hour and 3 per recipient address per day across every
organization**, counted in `invite_emails` — *not* on `invites`, because revoke
hard-deletes those and create → email → revoke would reset the count. The slot is
reserved by one `INSERT ... SELECT ... WHERE counts < limits` (two simultaneous requests
can't both squeeze under), **before** the send, so a failed send still spends it, and it
**fails closed**: unreadable ledger = nothing sent. The body is fixed text (no free-form
message), typed names go through `cleanLabel`, and the inviter's verified address is shown
beside their typed name. **Apply `0052` before deploying**, by file, never `db:migrate:prod`.
`tests/team-invite-email.test.mjs` (static) + `npm run test:invite-email` (needs the sandbox).
**Settings → Plan & usage** (`GET /api/account/plan`, org-scoped, deliberately not
plan-gated) shows the plan label (`planLabel`, so a commissary reads "Production"),
this month's invoice reads against the cap, the reset date and — on Essential — what Pro
adds, with an "Ask about Pro" mailto to `hello@` (no self-serve upgrade or billing exists
yet). It calls the very helpers the parse cap uses (`effectiveInvoiceCap`,
`monthlyInvoiceParses`), so the card can never disagree with the block; cap `0` = no limit.
The local sandbox has no `RESEND_API_KEY`, so it only proves the caps; a real send was checked on staging 2026-09-22 (staging *does* hold `RESEND_API_KEY`): the email arrived in the inbox, not spam, and the link resolved.

### Invoice lines carry their product id (added 2026-09-23, migration `0054`)

**Applied and deployed 2026-09-23** on both environments, neither recorded in
`d1_migrations`. **Production already had the column** (TEXT, plus an index
`idx_invoice_lines_generic_product_id`), hand-added at some point and holding one
correct link — so only 0054's three backfill `UPDATE`s were run there (74 + 26 lines;
all 101 now linked, every one to a product in the same org). Pre-change Time Travel
bookmark: `0000058c-00000000-000050ef-b065e42a46b84223cb325fdcf013da6b`. Staging got the
full file (it had no invoice lines). `--file` against remote fails with an auth error
(code 10000) from this machine; the statements were sent with `--command`. Any NEW
database built from the files must still apply 0054 before running this code — it
reads and writes `invoice_lines.generic_product_id`, and an earlier attempt that wrote
the column where it didn't exist 500'd every Merge for weeks.

Why: the spending breakdown and the P&L found a line's category by matching its **name**
against product names, so any drift (a supplier alias filing "Fingerling" under "Yellow
Fingerling Potato", a rename or merge whose name cascade missed the line) put real spend
under "Uncategorized". Now the id is read first and the name match is only a fallback for
lines without one. How it's kept: Confirm & Save gets the new line ids back from
`/api/invoice-lines/:id/replace` and passes each as `invoice_line_id` to
`/api/bulk/upsert-products`, which records the product the purchase was actually filed
under; Save Changes sends each line's id back (the route deletes and re-inserts every line,
so dropping it would unlink the invoice); `mergeInto` re-points it; a rename needs nothing.
The migration's backfill links only unambiguous lines (a read-only preview on 2026-09-23
linked all 101 production lines). Lines that can still be unlinked: one added by hand while
editing a saved invoice (it has no purchase record), or a save interrupted between writing
the lines and the product import. `tests/invoice-line-product.test.mjs` (static) +
`npm run test:line-product` (needs the sandbox and `db:migrate:local`).

### Rotating sideways invoice photos (added 2026-09-23, migration `0055`)

Images only (PDFs use the browser's own viewer). Rotate-left/right buttons on the invoice
screen (review and saved) and on each staged photo on the upload page. **Display only**:
the uploaded file is never changed — the turned page is drawn to a canvas and shown as a
new image, so the zoom/fit code sees an ordinary picture; Open / Download still serve the
original. The turn is remembered on `invoices.page_rotations`, a JSON object keyed by the
page's **file key** (not page number — review and saved mode list pages differently),
degrees clockwise; the upload page writes it with the new invoice. **Apply `0055` before
deploying** (the upload page sends `page_rotations` on every image invoice, so a missing
column fails the save); applied and deployed on staging and production 2026-09-23 (by `--command`, not recorded in
`d1_migrations`; pre-change production bookmark `00000590-00000000-000050ef-b3d29d3bb046edc239bafeb4b6e5521d`).
`tests/invoice-rotation.test.mjs`. Side note: the upload page's pre-existing auto-deskew
(`image-preproc.js`) can tilt a clean page a few degrees — seen on a synthetic test image.

### Account start date — "accept invoices from" (added 2026-10-03, migration `0058`)

A new account only takes invoices dated **on or after 7 days before its owner first
signed in**. A fixed line, not a rolling window: an account started Oct 1 accepts a
Sep 24 invoice on Oct 15, never a Sep 20 one. `markOrgStarted()` stamps
`organizations.started_at` once (invite accept, or first login on a legacy password
account) and sets `invoice_start_date` to 7 days earlier unless the operator already set
one. `/api/ai/parse-invoice` refuses older invoices with 422 `{ before_start_date }`
**after** the AI read (only the AI knows the date), so a refusal still counts toward the
cap; nothing is saved, and the upload page shows a panel with the date it read.
**Not checked:** undated invoices (accepted by decision), a page added to an invoice
already in the org (`invoice_id` form field, verified against the org), super-admins.
The upload page shows the date up front (`/api/account/plan` → `invoice_start_date`);
the admin screen's **Invoices from** column changes or clears it
(`POST /api/admin/organizations/:id/invoice-start-date`). Accounts that already had a
user were backfilled `started_at = created_at` with **no** date limit. Known quirk:
clearing the date *before* the owner's first sign-in doesn't stick — the first sign-in
fills it. `started_at` is also where the planned "first month of operator checking"
will count from. **Apply `0058` before deploying** (by file, never `db:migrate:prod`).
`npm run test:start-date` (needs the sandbox; `TEST_AI=1` adds 3 real reads to prove
the refusal).

### The server owns invoice status (added 2026-10-03, migration `0059`)

Invoices are written through the generic table routes, so until now `status` was
whatever the browser sent. `guardInvoiceWrite()` (called from the generic
POST/PUT/PATCH/DELETE when `table === 'invoices'`) now enforces: **create** is always
`'Action Required'`; the only status **move** is Action Required → Closed (approving,
not on a voided invoice), and resending the current status is fine; a **Closed** invoice
can't be deleted (void it); `voided_at`/`void_reason` are stripped, so only
`/api/invoices/:id/void|restore` touch them. The invoice screen's status dropdown is gone
(a read-only badge now), and Save Changes no longer sends a status. The
`/api/ensure-invoice` stub is now **`'Manual Entry'`** (was `'In Processing'`, which
nothing ever advanced; production had none). This is the foundation for the planned
operator-check **Processing** state: the server can now decide a new invoice's status
and refuse the customer moving it. Tests that need a Closed invoice must create it and
then PATCH it to Closed, like Confirm & Save. **Apply `0059` before deploying.**
`npm run test:invoice-status` (needs the sandbox).

### Operator check — the "Processing" status (added 2026-10-03, migration `0060`)

A new account's uploads go to **`'Processing'`** first. The customer sees them (blue "Our
team is checking your invoice" banner, headline + photo only), can delete one or turn its
photo, and nothing else; the server refuses any other change (`guardInvoiceWrite`). The
operator opens it while **viewing as** and gets the normal review screen with **Release to
customer** in place of Confirm & Save: `POST /api/admin/invoices/:id/release` writes the
working copy back into `parsed_data` (`workingCopyToParsed()`), copies vendor / number / date /
total onto the row, marks it checked (`reviewed_by/at`) and moves it to Action Required. The
customer then approves it as before. **Who gets it:** `organizations.review_mode`, set from the
admin **Check first** column (`POST /api/admin/organizations/:id/review-mode`): NULL/`auto` =
the `FIRST_MONTH_DAYS` (30) after the owner's first sign-in (`started_at`, 0058; not signed in
yet counts as the first month), `processing` = always, `direct` = never. `reviewsInvoices()`
decides for both the upload and the admin screen's `reviewing_now`, so they can't disagree.
**48-hour release:** Pages has no cron, so `releaseOverdueInvoices()` runs on every invoice
list/detail read (that org) and on the admin screen (all orgs, the one allowlisted unscoped
statement in `tests/org-scoping.test.mjs`): overdue Processing → Action Required with
`auto_released_at`, `reviewed_at` left NULL so it stays in the "not checked" queue. Admin
Waiting column shows **"N to release · auto in Nh"** on top. **No customer emails** by
decision; they look at the Invoices page. Everything fails soft to the old behaviour
(Action Required) if `0060` isn't applied, except the admin list, which selects
`review_mode` — **apply `0060` before deploying**. Tests that create accounts and need
ordinary invoices set them to `direct` first. `npm run test:processing` (needs the sandbox).

### Terms acceptance record (added 2026-10-06, migration `0061`)

Who agreed to the Terms and Privacy Policy, which version, and when:
`users.terms_version` + `users.terms_accepted_at`, per person (owner and every teammate).
**New accounts:** `accept-invite.html` has a required tick box and
`POST /api/auth/accept-invite` refuses without `agree: true` (400) before anything is
written — tests that accept an invite must send it. **Accounts from before:** `/api/auth/me`
adds `terms_due`, and `renderTermsGate()` in `utils.js` covers the app with a one-time
"I agree" panel; `POST /api/auth/accept-terms` records it, keeps the first record, and is in
`SUSPEND_EXEMPT` so a paused account isn't stuck behind the panel. Asked **once**: `TERMS_VERSION`
(`src/index.ts`) must equal the "Last updated" date on `terms.html`
(`tests/terms-acceptance.test.mjs` fails if they drift), but bumping it does not ask anyone
again — Terms §17 covers changes by notice. Super-admins are never asked, so neither is an
operator viewing as a customer. The panel is presentation only (like plan gating): the API
keeps answering behind it; what is guaranteed is the record. `terms_due` is read in its own
fail-soft query, **not** in `SESSION_USER_COLUMNS`, so a database without the columns can't
break sign-in — but sign-up and the admin list (the Owner cell shows "Terms agreed <date>")
do need them: **apply `0061` before deploying** (applied to staging and production 2026-10-06 by `--command`, not recorded in `d1_migrations`; pre-change production bookmark `000005e0-00000000-000050fb-926265df95b6de1ab06a88092e1ac12b`). Times are UTC. `npm run test:terms` (needs
the sandbox).

### Duplicate-invoice block: number + supplier (2026-10-03)

The upload page blocks a duplicate via `POST /api/invoices/duplicate-check`: same
invoice number (exact, voided invoices count, own org only — as before) **and** the same
supplier, where "same" is `classifyNameMatch`'s `'auto'` tier only (Sysco / SYSCO, Sysco
Foods / Sysco Food — *not* the looser "Did you mean" tier, so two different suppliers are
never confused). A blank supplier name on either side still blocks. Before this, the
number alone blocked, so two suppliers both numbering from #1001 collided. Still
browser-side only (the server doesn't re-check on save), unchanged by decision.
`npm run test:duplicate`.

### Merging or grouping products converts the stock (2026-10-06)

`mergeInto()` used to pool two bins with `quantity = quantity + ?`: 10 lb of mozzarella
merged into a bin counted in kg became 10 kg. `mergedStockIn()` now converts the absorbed
bin into the survivor's unit (`convertQty`, trying the survivor's weight / sub-unit facts
first, then the absorbed product's) and the survivor gets one `stock_log` line
(`reason='Merged product'`, `reason_code='correction'`) so "Stock after" still adds up.
When nothing bridges the units the merge is **refused with 409** (`MergeRefused`) before
any write; an empty bin merges freely. Group checks every bin up front, because the group
as a whole is not one transaction and must not stop half-way with the survivor renamed.
A merge also re-points **past count lines** (`stock_take_items`) to the survivor: a count is
valued at read time from the purchases of the product each line points at, so a line left on
the absorbed product was worth $0 once its purchases had moved (a $6,197 count read $6,145).
The line keeps its own unit and quantity. Not retroactive: lines orphaned by a merge made
before this still point at the archived product. `npm run test:merge`.

### A supplier's pack-size change is flagged, not overwritten (2026-10-06)

Every approved line is remembered per supplier (`product_mappings`, pack size included), and
`applyProductMappings()` on the upload page used to put the remembered pack over whatever
was just read: spaghetti printed as 10 kg arrived as 5 kg with no warning (half the stock,
double the price per kg). Now the remembered pack only fills a gap. When both exist and
differ (`packSizeDiffers`: spacing, case and "5.0" vs "5" are not a difference) the printed
pack stays, the old one travels with the line as `parsed_data.items[].pack_was`, and the
review screen highlights the line: "Pack size changed? Last time 5 kg, this invoice says
10 kg", **Keep** / **Use** (`keepPrintedPack` / `useRememberedPack` in `invoices.js`).
Saving is not blocked; ignoring the flag keeps the printed pack. The cost, accepted by the
user: a pack the AI misreads every time (bottled drinks) is no longer corrected silently, it
is flagged each time and takes one click. `tests/pack-size-change.test.mjs`.

### Tests

```bash
npm test               # unit — auto-discovers every tests/*.test.mjs
npm run test:pos       # POS sales import  — needs `npm run dev:sandbox` running
npm run test:isolation # tenant isolation  — needs the sandbox; the pre-launch gate
npm run test:lifecycle # account lifecycle — needs the sandbox
npm run test:merge     # product merge/group — needs the sandbox
npm run test:reset     # forgotten-password flow — needs the sandbox
npm run test:invite-email # emailed invite caps — needs the sandbox (and `db:migrate:local` for 0052)
npm run test:purge     # account purge: leaves nothing behind, touches no other customer — needs the sandbox
npm run test:start-date # account start date / invoice date line — needs the sandbox (TEST_AI=1 for the refusal)
npm run test:invoice-status # server-owned invoice status — needs the sandbox
npm run test:processing     # operator check / Processing / release / 48h — needs the sandbox
npm run test:duplicate      # duplicate-invoice block (number + supplier) — needs the sandbox
npm run test:terms          # Terms acceptance record — needs the sandbox (0061 applied locally)
npm run test:sub-unit-stock # case/can/weight stock: stock-take value + sales import — needs the sandbox
npm run test:count-date     # stock count's local day + drinks sales split — needs the sandbox (0062 applied locally)
npm run test:history        # past stock counts: list, sheet, note, isolation — needs the sandbox
npm run test:waste          # Record waste + Recount, recount kept out of the P&L — needs the sandbox (0063 applied locally)
npm run test:stock-log      # stock movement log: server filters, Stock after, links, history kept — needs the sandbox
```

**The account purge** (`DELETE /api/admin/organizations/:id`, admin-screen button) is
the only path that hard-deletes customer data, and the Privacy Policy draft's
"permanently deleted" rests on it. `PURGE_TABLES` must hold every tenant table and
list **children before parents** wherever a foreign key doesn't cascade — an
alphabetical list 500'd half-way through (`certification_types` before the
`staff_certifications` pointing at it) and the `ai_*` log tables were missing, which
blocked the final org delete. `tests/purge-coverage.test.mjs` enforces both from the
migrations; the row deletes run in one `DB.batch()` so a failure rolls back
instead of leaving an account half-erased. Nothing triggers it automatically —
it is a manual operator action.

Plain Node, no framework, no dependencies. `tests/helpers/browser-module.mjs`
evaluates `public/static/*.js` so unit tests exercise the *shipped* frontend
source rather than a copy. Two unit tests are static audits that fail `npm test`
on their own: `org-scoping.test.mjs` parses every `DB.prepare()` in `src/index.ts`
and rejects any tenant-table statement missing `org_id`; `dom-ids.test.mjs`
cross-checks each page's `getElementById` calls against the ids in its HTML.
There is **no linter and no typecheck script** — `tsc` is in tsconfig but not
wired up (and not installed), so type errors only surface at runtime. Verify
changes by running the app.

**Nothing runs the tests for you.** `npm run build` is bare `vite build`, and
`deploy` is `build && wrangler pages deploy` — neither touches `tests/`. A
failing suite will not stop a deploy, so run `npm test` yourself first.

Local dev uses a local SQLite file under `.wrangler/state/v3/d1/`. The `ecosystem.config.cjs` pm2 file has a stale `cwd` (`/home/user/webapp`) from another machine — prefer `npm run dev` / `npm run dev:sandbox` locally.

## Architecture

**Backend is a single file: `src/index.ts` (~5,300 lines).** One Hono app, `export default app`. Bindings (`src/index.ts` top): `DB` (D1), `FILES` (R2), `ANTHROPIC_API_KEY` (secret via `.dev.vars` locally / `wrangler secret` in prod).

**Frontend is static, not part of the worker bundle.** `public/*.html` are standalone pages; `public/static/*.js` are matching vanilla-JS controllers (e.g. `invoices.html` ↔ `static/invoices.js`); styling is TailwindCSS via CDN + FontAwesome. `public/_routes.json` sets `include: ["/api/*"]`, so Cloudflare Pages routes **only** `/api/*` to the Hono worker and serves everything else as static assets. The frontend talks to the backend purely through `fetch` against `/api/*`. `public/static/utils.js` holds shared client helpers.

**Public vs. app pages.** `public/index.html` is the **public marketing landing page** (standalone, no controller, does not load `static/style.css`); `public/login.html` is the **real sign-in screen** — it posts to `/api/auth/login`, and on load asks `/api/auth/me` so an existing session skips the form. Where it sends you is decided by `destinationFor()`: an explicit `?next=` (same-origin only — a `//host` value is rejected), else the admin screen for a super-admin (they have no org, so the upload screen has nothing to file against), else a handheld-aware default. Auth is enforced server-side in the `/api/*` middleware chokepoint described under "Plan tiers"; static pages cannot be gated, since `_routes.json` sends only `/api/*` to the worker. The Products app page is `public/products.html` ↔ `static/products.js` (it was `index.html` until the landing page took the root URL — link to it as `/products.html`). Every app page carries `<meta name="robots" content="noindex, nofollow">`; `index.html` is the only page intended to be indexable, and it is *also* noindex until the launch is announced (see `public/robots.txt`, which documents the launch checklist). **`public/food-cost-calculator.html`** is the third marketing page (free tool for SEO/AEO, same `noindex` until launch — remove all three together): pure client-side, `static/food-cost-calculator.js` + `tests/food-cost-calculator*.test.mjs`. Its promise is "nothing typed is saved or sent", enforced by a test that bans `fetch`/storage/`innerHTML` in the script; its FAQ markup must match the visible FAQ word for word. **`public/food-cost-calculator-excel.html`** (added 2026-10-08, for "food cost calculator excel" searches) is the fourth: it hands out `public/downloads/food-cost-calculator.xlsx`, built by hand with `tools/build-excel-template.py` (needs openpyxl; not part of the build). The page quotes the file's cells (H12–H19) and prints the calculator's worked example; `tests/food-cost-excel-page.test.mjs` fails if page, builder and calculator drift apart. **`public/menu-pricing-calculator.html`** ↔ `static/menu-pricing-calculator.js` (added 2026-10-08, the best search target found: "menu pricing calculator") is the fifth: the food cost calculator turned round, cost in and menu price out, by target food cost %, markup or profit per plate, for one dish or a list. Prices round **up** (never short of the target), worked in cents. Same "nothing typed is saved or sent" promise and the same test bans; every number printed on the page is checked against the script in `tests/menu-pricing-calculator.test.mjs`. It reuses the ids `loadExample` and `resTotal` on purpose, so `analytics.js` counts its example and result with no change. Cloudflare Pages strips `.html` and 308-redirects, so `/products.html` → `/products` in production; internal nav keeps the `.html` suffix so links also resolve under `npm run dev`.

### Generic table CRUD
Most data access goes through one generic REST layer: `/api/tables/:table` (+ `/:id`) supporting GET/POST/PUT/PATCH/DELETE. Tables must be in the `ALLOWED_TABLES` allowlist (defense against SQL injection via the `:table` param — column/table names are interpolated, values are always bound). Primary keys: string `uid()` is generated on insert **unless** the table is in `INTEGER_PK_TABLES` (`units` and `categories`), which use autoincrement.

### Route ordering matters
Specific routes that **override** the generic CRUD must be declared **before** the generic `/api/tables/:table/*` handlers, because Hono matches in registration order. Examples already doing this: `DELETE /api/tables/generic_products/:id` (soft-delete override) and `PUT /api/generic_products/:id` (rename cascade). Add new overrides in the same position.

### Soft-delete / void, never hard-delete history
This is a core invariant for anything with financial or stock history:
- **Products** archive via `generic_products.deleted_at`; active lists filter `deleted_at IS NULL`. Delete clears live state (`inventory`, `product_aliases`) but keeps `product_entries`, `recipe_items`, `stock_log`.
- **Invoices** void via `invoices.voided_at` (+ `void_reason`), excluded from P&L/spending; `product_entries` created by the invoice get their own `voided_at` so they stop counting toward pricing. Restore reverses it. Only drafts use plain DELETE.
- When adding features that consume this data, filter out voided/archived rows (`voided_at IS NULL`, `deleted_at IS NULL`).

### Denormalized names cascade on rename
Product names are copied into `product_entries`, `invoice_lines`, `product_mappings`, `inventory`, `recipe_items`, `stock_log` (some features join by name, not id). `PUT /api/generic_products/:id` cascades a name change to all of these. If you add another place a product name is stored, add it to that cascade. `invoice_lines` also carries `generic_product_id` (migration `0054`) — anything that needs a line's product should use that, not the name.

### AI invoice/recipe parsing
`/api/ai/parse-invoice` and `/api/ai/parse-recipe` call the Anthropic API directly (`fetch` to `api.anthropic.com/v1/messages`, model `claude-opus-4-8`) — there is no SDK dependency. They return JSON matching an inline schema. Supplier dedup (`classifySupplierMatch` + Levenshtein) and `parsePackSize`/`inferCategory` heuristics in `src/index.ts` clean up extracted data before it hits the DB. Outages come from the key, not the code — see "Secrets" above.

**Monthly parse cap (migration `0041`).** Invoice parsing is metered per organization per calendar month; recipe parsing is deliberately not (it's a one-time onboarding cost). `PLAN_INVOICE_CAPS` sets the plan defaults (Essential 150, Pro uncapped) and `organizations.invoice_cap` overrides it per account — **NULL** = plan default, **0** = uncapped, **N** = capped at N. `effectiveInvoiceCap()` resolves the two. The check runs at the top of `/api/ai/parse-invoice` *before* the Anthropic call, so a blocked parse costs nothing; it returns 403 `{ upgrade_required: true, cap, used }`, which `callClaudeParse` in `public/static/invoice.js` turns into an amber `showCapBlocker` panel rather than a red error.

Usage is counted from **`ai_parse_log`** (one row per API call, written server-side), *not* from `invoices.ai_cost` — the latter is accumulated client-side and saved only when the invoice is saved, so abandoned parses would be invisible and multi-page invoices would count once. `invoices.ai_cost` remains the per-invoice figure shown on the invoice screen. Refusals are logged to `ai_cap_blocks`, because a hard block hides the demand it blocks and that demand is the evidence for whether paid overage is worth building. Both tables are org-scoped and covered by `tests/org-scoping.test.mjs`.

### Plan tiers (Essential / Pro)
`organizations.plan` (migration `0039`) is enforced in the **same `/api/*` middleware chokepoint** as auth and suspension. `PRO_FEATURES` lists what Pro adds (`inventory_tools`, `stock_takes`, `storage_layout`, `staff`, `true_cogs`); `featureForPath()` maps a request to a feature, `PRO_ONLY_TABLES` does the same for the generic table routes. The map lists **only what Pro adds**, so an unlisted/new endpoint is open by default — a missing gate costs a little revenue, a wrong gate breaks a customer's shift. Refusals are 403 `{ upgrade_required: true, feature, plan }`. Super-admins are exempt, as with suspension.

**`inventory` and `stock_log` are deliberately NOT gated.** Essential tracks stock silently — packing a Finished Product writes both — and `recipes.js`, `finished-products.js` and `products.js` all *read* `inventory` to cost and convert. Gating those tables would break Essential features and turn an upgrade into a data backfill instead of a column flip. What *is* gated on inventory is the Pro action: `POST /api/inventory/:id/adjust`.

Client side, `publicUser()` returns `plan` + `features`, and `applyPlanGating()` in `public/static/utils.js` hides nav links and swaps a gated page's `.container` for an upgrade panel (`PLAN_GATED_PAGES` — keep in step with `featureForPath`). This is presentation only: `_routes.json` sends only `/api/*` to the worker, so static pages cannot be gated server-side. The server's guarantee is that Pro **actions** are refused, not that Pro **pages** are unreachable. True COGS is gated inside `/api/pnl`, which returns `cogs.reason = 'upgrade_required'` so the UI can offer an upgrade instead of "go do a stock take" they can't do.

### Account type gating (restaurant / commissary)
`organizations.account_type` reaches the browser as `window.__accountType`
(alongside `__accountPlan`) and `applyBatchWorkflowGating()` in
`public/static/utils.js` hides the controls it makes no sense to offer:

|                    | How is this made? | Produce Batch | Pack Run |
|--------------------|-------------------|---------------|----------|
| restaurant · Essential | hidden        | hidden        | hidden   |
| restaurant · Pro       | hidden        | **shown**     | hidden   |
| commissary · any       | shown         | shown         | shown    |

The dropdown goes for **every** restaurant because Produce Batch now records the
answer itself and a stale answer self-corrects — see the fall-through note under
POS sales import. That is what makes hiding it safe; doing it earlier would have
stranded every recipe migration `0043` backfilled to `batched`. Produce Batch
survives on Pro because it is the only way to see prep mid-week and forgetting it
now costs nothing; on Essential nothing would ever draw the bin down. A
commissary keeps everything — pressing those buttons by hand *is* their stock
workflow, and the dropdown is their only way to set a recipe back to `on_demand`.

Unknown account type shows everything: the session bootstrap is async, and
showing a control that is then hidden is recoverable where the reverse is not.
Presentation only, with the same limit as plan gating.
`tests/account-type-gating.test.mjs` pins the whole matrix.

**Nav tabs are hidden before first paint, from a remembered list** (`static/nav-gate.js`,
loaded synchronously in every app page's `<head>`). Each page is its own document with
the full nav in its HTML, and the plan is only learnt from `/api/auth/me` — so without
this an Essential customer saw the Pro tabs flash on every click. `utils.js` writes the
feature list to `localStorage['dm_nav_features']` after each `/me` (login.html seeds it
too, sign-out clears it); the head script injects a `<style>` hiding the matching links;
`applyPlanGating()` removes that style when the server answers, so the server always
wins. It **fails open** (nothing remembered or unreadable = every tab shows). Its list of
gated paths must equal `PLAN_GATED_PAGES` in utils.js (`tests/nav-gate.test.mjs`). Nav
links only: a gated page reached by URL still swaps in its upgrade panel after `/me`.
Adding a nav page means adding the `<script>` line to its `<head>` (the test checks).

**The nav must not move when the account chip arrives.** `renderSessionChip()` inserts the
chip only after `/me` answers, and the tabs are pushed right by the room it leaves
(`.nav-links{margin-left:auto}`). The chip *also* had `margin-left:auto`, so the two split the
free space and the tabs jumped ~300px on every page load. Now the chip takes no auto margin
when it follows the tabs, `.navbar:not(.has-chip)::after` reserves a box of `--dm-chip-w`
until utils.js adds `.has-chip`, and nav-gate.js sets that width from `localStorage['dm_chip_w']`
(measured last load, per layout, cleared at sign-out). Measured in a browser: 0px movement.
Fallbacks are 240px desktop / 107px phone (first visit only).

**The account chip is drawn from memory too, so it doesn't pop in late.** It used to be built
only after `/me` answered — the right-hand end of the bar (business name, gear, Sign
out) flashed in on every page. utils.js now calls `drawSessionChipFromMemory()` the moment it
loads (the nav is already parsed), from `localStorage['dm_chip_id']` = `{label, sa}` — the
business name (or "Admin") only, **never the email**, and nothing at all for someone whose
label would be their email. The chip carries `data-draft`; `renderSessionChip()` (timing of the
server call deliberately unchanged — pages register listeners around it) confirms or corrects it
**in place** (same element, so no flicker), removes it and forgets everything if `/me` says
signed out, and keeps it if the request merely failed. `buildSessionChip` / `updateSessionChip`
are the pieces. Pinned by `tests/nav-gate.test.mjs`.

### Product categories
Categories are **free-text** on `generic_products.category`. The managed master list is the **`categories` table** (migration `0018`, same shape as `units`: `id`/`name`/`sort_order`, integer PK), edited through the **Manage Categories** modal (`public/static/utils.js`, mirrors Manage Units) and picked in the product form, with "+ New category…" for inline adds. Deleting one only removes it from the picker — products keep their label (the DELETE is usage-checked, `?force=true` to override).

**A new product's category is chosen by Claude, not by keywords.**
`aiCategorizeProducts()` runs from `POST /api/bulk/upsert-products` for products
being created for the **first time** — a repeat purchase matches an existing
`generic_product` and keeps whatever category it has, so a hand correction is
permanent and the model never gets a second vote. That is also what makes it
affordable: one batched call per invoice that introduces new products (measured
$0.0044 for four), never a per-invoice tax. It is logged to `ai_parse_log` as
`kind='category'`, which keeps it **out** of the monthly invoice cap
(`monthlyInvoiceParses` filters `kind='invoice'`) while still counting in the
admin spend totals.

The model may answer **only** with one of the org's own categories: the prompt
lists them and the answer is re-checked against the `categories` table on the way
back, because a prompt is a request and a whitelist is a guarantee. An invented
category would have no `type` and no `.cat-<slug>` badge, so it would land money
in no P&L bucket at all. It runs **after** every write and fails soft in every
direction — no key, HTTP error, truncation, bad JSON, off-list answer — leaving
`inferCategory()`'s keyword guess in place. A dead Anthropic key must never block
a customer from saving an invoice. A category the user picked in the review
screen is an instruction, not a gap, and is never overruled.

`inferCategory()` is the **fallback**. Its keywords match on **word boundaries**
(`keywordHit`), not substrings: matching raw substrings filed "Extra Vir**gin**
White Truffle Oil" as Alcohol and "Aspa**rag**us" as Linen & Uniforms, which are
typed `beverage` and `supplies` — so both left food COGS silently. The `(e?s)`
tail in that regex is load-bearing: without it `tomato` stops matching
"Tomatoes with Basil". `tests/infer-category.test.mjs` pins both halves, and its
boundary cases are deliberately chosen to match *no* legitimate keyword, because
several obvious-looking pins pass even with the bug restored.

The built-in taxonomy (grouped food-COGS / beverage / operating-supplies) is seeded by `0018` and **duplicated in four places that must stay in sync**: `DEFAULT_CATEGORIES` in `public/static/utils.js` (frontend fallback + seed reference), `DEFAULT_CATEGORIES` in `src/index.ts` (seeded into every new org at creation, with its `type`), the stat-chip/badge CSS in `public/static/style.css` (`.cat-<slug>` + `.cat-chip.cat-<slug>`, slug via `slugify`), and the `inferCategory` keyword rules in `src/index.ts` (auto-classifies invoice imports; unmatched → `Other`). The live picker reads the `categories` table at runtime, not `DEFAULT_CATEGORIES`. `Ingredients` is a retired legacy value kept for back-compat.

Category names are unique **per organization** via the expression index `idx_categories_org_name` on `COALESCE(org_id, '')` + `name` (migration `0038`) — deliberately not a plain `UNIQUE(org_id, name)`, since SQLite treats NULLs as distinct and the NULL-org demo account would collect duplicates. `0040` does the same for `units` (`idx_units_org_name`, also over `LOWER(name)`, since `normalizeUnit` lower-cases everything except `L`); it only *records* a fix production already had by hand, after prod's `units` lost its global `UNIQUE` in the 2026-07-29 seeding work — without it any database rebuilt from these files fails on its second account creation.

**New organizations are seeded** with both master lists (`DEFAULT_UNITS` and `DEFAULT_CATEGORIES`) in the same `DB.batch()` as the org and owner row, in `POST /api/admin/organizations`. Without this a new account's pickers read "No units defined yet", which first bites during invoice import. `storage_sections`, `certification_types` and `vendor_fee_templates` are still not seeded.

### POS sales import & inventory backflush
Sales are imported from a POS CSV export (Square first) and deduct ingredients
from stock. `public/sales.html` ↔ `static/sales.js`, parser in
`static/pos-parse.js`, schema in migrations `0042`/`0043`. **Pro only**
(`pos_sales`), gated by the `/api/pos-` prefix in `featureForPath`.

Flow mirrors invoices exactly: parse in the browser → save a draft
(`pos_imports.status='Action Required'`, whole payload in `parsed_data`) → review
and map each POS item to a **finished product** → commit, which clears
`parsed_data` and writes `pos_sale_lines`. Learned mappings live in
`pos_item_map`, keyed `lower(item)|lower(price point)`; a key ending in `|` is
the "any size" fallback. `target_type='ignore'` is how gift cards and bottled
drinks stop lighting the unmapped warning.

**A sale maps to a finished product only — never straight to a recipe.** A POS
line is a thing sold over the counter, which is what a finished product models;
the recipes behind it are reached through `finished_product_items` when the sale
is exploded. `target_type` is therefore `finished_product` or `ignore`, enforced
in three places: the picker in `sales.js` loads only `finished_products`,
`sanitizePosTargets()` scrubs anything else off whatever the review screen posts
to `/preview` and `/commit`, and `explodeSale` has no top-level recipe branch.
Legacy `target_type='recipe'` rows are **not** migrated — they fail the `nameOf`
lookup at draft creation and demote to unmapped (`match_source='stale'`), so the
reviewer re-links them once and the upsert overwrites the old rule. Committed
`pos_sale_lines` are history, left alone.

**The two-level BOM limit is load-bearing.** `finished_product_items` may
reference a recipe or a product, but `recipe_items` has no `item_type` — a recipe
holds only products. `explodeSale`/`explodeRecipe` in `src/index.ts` rely on that;
if `recipe_items` ever gains an `item_type`, the depth guard turns a silent
infinite loop into a loud error. `explodeRecipe` is still very much in use — it is
how a finished product made of recipes reaches its raw materials.

**`recipes.production_mode` prevents double-counting** and must not be bypassed.
It is read where a finished product's line references a recipe: `on_demand`
(default) explodes that line into raw materials; `batched` deducts the recipe's
`batch` bin instead and leaves Produce Batch to refill it. Doing both would count
the same flour twice. Migration `0043` backfills `batched` for any recipe already
holding batch stock.

**A `batched` line falls through to raw materials when the bin can't cover it**
(`takeFromBatch`). Press Produce Batch and the ingredients leave at prep time and
the sale draws the bin down; skip it and the bin is empty, so the sale takes the
ingredients instead. Either way **every ingredient is charged exactly once**,
which is what makes Produce Batch optional — the old always-deduct-the-bin
behaviour meant a kitchen that forgot the button never moved its ingredients at
all, and food cost read better than reality, silently.

Three things this depends on. `ctx.batchRemaining` is a **running balance** that
`takeFromBatch` spends down — a per-sale re-read of the same opening figure would
let a 6 kg tub satisfy ten 1 kg sales. `planPosDepletion` therefore iterates
**oldest sale first**, or file order decides which day a tub ran dry. And when the
two units can't be bridged the whole line stays on the bin (pre-existing
behaviour) rather than guessing a split — a bad comparison must never manufacture
a raw-material deduction. The split is surfaced as `fell_through` on `/preview`
and `/commit`, and `sales.js` explains it, because a bin **and** its ingredients
both moving looks exactly like the double-count it isn't.

**Idempotency is three layers**: `pos_imports.content_hash` (same file re-uploaded
→ 409, overridable with `force`), the partial unique index on
`pos_sale_lines.external_ref` (the real guard — overlapping date ranges), and the
`status='Action Required'` gate on commit. The commit route **pre-queries**
existing refs and skips those lines; letting the index throw would roll back the
whole `DB.batch()`.

`planPosDepletion()` is shared by `/preview` and `/commit`, so the panel a user
approves is produced by the code that writes. Movements aggregate per ingredient
**per business day** (per import above `POS_MAX_MOVEMENTS`), write
`stock_log.reason_code='usage'` and carry `pos_import_id` — which is what lets
`/void` reverse exactly its own movements. Inventory updates are **relative**
(`quantity = ROUND(quantity - ?, 6)`), never absolute, so they don't race a
concurrent Produce Batch. A unit that won't convert drops that one deduction and
warns; it never aborts the import. Negative stock is allowed and reported.

P&L revenue is **derived**, never written into `sales_monthly`: `/api/pnl` returns
`sales.by_month` from `pos_sale_lines`, and `sales_monthly.revenue_source`
(`'auto'`|`'manual'`) decides which figure `pnl.js` shows. Voiding an import flips
the month back to the typed figure on its own.

Known gap: a recipe left on `on_demand` can still be sent through Produce Batch,
creating batch stock nothing draws down.

**Two bugs found by the first realistic week of sales (2026-10-06), both invisible to
every earlier test.** (1) *Any file of 100+ lines 500'd on Confirm & Import:* the duplicate
pre-query put 200 refs in one `IN (…)` and D1 allows 100 bound values per statement
("too many SQL variables"); local SQLite allows 32,766, and every test file had under 100
lines. Lists are now cut with `D1_IN_CHUNK` (90) — use it for any `IN` built from a list.
(2) *A product used in two units on the same day was under-deducted:* `planPosDepletion`
tried to convert the second unit onto the first with no product facts (so can ↔ kg always
failed) and stored the failure with `agg.set(...)`, each later amount replacing the one
before. Deductions are now totalled per ingredient, day **and unit**, converted into the
bin's unit with the product's sub-unit and can weight, then folded into one movement per
ingredient per day. `tests/sub-unit-stock.test.mjs` pins both; the sandbox test sells one
product by the can and twice by weight on the same day.

### Costing is derived, never stored
Cost flows one way — `product_entries` → product → recipe → finished product —
and every level is computed **at read time** from current invoice prices.
`buildLiveCostIndex()` in `public/static/utils.js` does the whole pass in one
call; `recipes.js`, `finished-products.js` and `inventory.js` all display from it.
A supplier price rise therefore moves menu costs **on its own**: the FIFO layer
follows what's left in the bin (`fifoActiveEntryIn`), so when the cheap stock runs
out the price rolls over with no staff action.

**Costing basis (`plan` argument to `buildLiveCostIndex`).** FIFO only means
anything when the app knows how much has been used — it picks the price layer by
comparing purchases against stock on hand. With no consumption ever recorded those
are equal, so FIFO pins every cost to the **first invoice ever uploaded** and it
never moves again, however many deliveries arrive. Two rules: **Essential** always
prices from the latest invoice (stock tracking isn't in the plan); **Pro** uses
FIFO but falls back per-product when that product has no consumption recorded. The
Pro fallback matters most just after an upgrade — a plain plan check would swap a
working latest-invoice cost for a FIFO one anchored months back, right after the
customer paid more. It switches itself off when real usage lands.
`fifoActiveEntryWithBasis()` returns which basis was used; `costBasisNote()`
surfaces it in the detail modals, only for the fallback.

The plan reaches the browser via `publicUser()` → `window.__accountPlan`, and that
bootstrap **races the pages' own catalogue loads**. `utils.js` dispatches
`dm:plan-known` when it lands and both pages rebuild + repaint on it — listeners
registered *before* their `Promise.all`, or an event firing during the loads is
missed. An unknown plan behaves like Pro, so the worst case is a repaint rather
than a silently wrong basis for a paying account.

`recipes.total_cost` and `finished_products.total_cost` still exist and are still
*written* on save, but **nothing reads them for display**. Treat them as a
last-known value, not the truth — they freeze at the last Save and go stale the
moment a price moves. Anything new that needs a cost must go through
`buildLiveCostIndex()`, never these columns.

**Voided invoice lines must never price anything.** Voiding sets `voided_at` on
the `product_entries` the invoice created, so every catalogue that derives a price
filters `!e.voided_at`. Leaving them in is doubly wrong: a cancelled invoice can
become the active layer, *and* it inflates the purchased total, which shifts FIFO
onto the wrong layer even when the voided row isn't the one picked.
`tests/voided-entries.test.mjs` is a static audit that fails the build if a
costing page reintroduces an unfiltered filter. The one deliberate exception is
`renderEntriesTable()` in `products.js` — the entries table inside the product
modal still lists voided rows so they can be seen and restored.

Pack facts come from `entryPackFacts()` (also `utils.js`): `product_entries`
stores `pack_qty` + `pack_unit` as columns and has **no `pack_size`** — parsing
that non-existent field gave every product a pack unit of `'unit'`. Note `cost` is
the **line total**, so unit price is `cost ÷ (pack_qty × qty_ordered)`;
`cost_per_unit` is stored and wins when present. A line whose units can't be
bridged is **uncostable (null)**, never `0` — a silent zero reads as a free
ingredient and understates every margin above it.

### Stock for a product bought by the pack (added 2026-10-06, no migration)

A case of 6 cans, 0.8 kg a can. Costing has bridged this since `subUnitWeightRate()`;
**stock** did not, and each path failed differently: Produce Batch stopped, the sales import
skipped the ingredient, the stock take valued 12 cans as 12 cases, and Pack Run took the bare
number (20 cans left the shelf as 20 cases, silently). Now `invSubUnitFactor()` (`utils.js`)
and its twin `subUnitFactor()` (`src/index.ts`, **keep in sync** —
`tests/sub-unit-stock.test.mjs` compares them pair by pair) bridge three kinds of unit for a
product with `sub_unit_name` + `sub_unit_qty`: the sub-unit; a **weight**, through
`avg_weight_per_unit` read as the weight of ONE sub-unit; and a **pack**, which is *any*
unit that is not a measure, not "each" and not the sub-unit — case, box and carton all mean
"units per pack" pieces (the user's decision; wrong only if two suppliers' packs differ).
Volume stays out. It is the **last** branch of `invConvertQty` / `invConvertUnitCost` /
`convertQty` / `convertUnitCost` and runs only when the caller passes the product's sub-unit
(`invSubOf(product)` / `subUnitOf(row)`), so nothing that converted before changes and
recipe costing (`liveProductLineCost`) is untouched. Callers that pass it: `upsertInventory`
(every browser stock movement), `_reconcileInventoryUnit` (so the stocking unit can be
changed case → can and the quantity follows), the FIFO layer (`opts.sub`), the Inventory
page's bin value, `planPosDepletion`, and `valueTake`'s `priceInto`. A weight with no can
weight is refused with "add the weight of one can". **Pack Run** now computes every line
through `prLineDeduction()` (preview and run share it) and writes nothing if any line can't
be converted — the old `?? 1` fallback is gone. **Produce Batch** does the same: it builds
one list of movements (ingredients out, batch in), runs `invHelpers.planInventoryMove()` on
all of them — the no-write first half of `upsertInventory`, so the check and the write can't
disagree — and only then marks the recipe made-ahead and writes; before, a line that
couldn't convert stopped it *after* the ingredients above it had left the shelf. Known and
left alone: the rule assumes one pack = `sub_unit_qty` pieces, which costing only
agrees with when the purchase's `pack_qty` is 1. `npm run test:sub-unit-stock` (needs the
sandbox). `npm run test:integration` has skipped since sign-in was added (it never logs in).

### A stock count's day, and which till sales are drinks (added 2026-10-06, migration `0062`)

Both found running a full October on Pro Test Account. **Count day:** `/api/pnl` chose the
opening and closing takes by `date(submitted_at)`, a UTC day — so a count made in Vancouver
on the 30th at 9 pm (already the 1st in UTC) opened no month, and true COGS either vanished
or used the wrong take. The Stock Take page now sends `count_date`, the day on the device's
own clock; `localCountDate()` keeps it only if it is a real date within one day of the
server's (a wrong clock or a hand-made request is dropped), and the P&L uses
`COALESCE(count_date, date(submitted_at))`. Takes from before `0062` have only the UTC day.
**Apply `0062` before deploying** — the submit `UPDATE` and the P&L queries name the column. (Applied to staging and production 2026-10-06 by `--command`, unrecorded; pre-change production bookmark `000005e8-00000000-000050fb-e7d657780aba4abe8c781de9e71804b9`.)
**Drinks:** imported sales split food/drinks by joining the till's category to the account's
own category names, so "Drinks", "Beer" and "Wine" all counted as food. `isDrinkSale()` now
keeps that match when there is one (the category's own type wins, drink or not) and otherwise
reads the name for a whole drink word (`DRINK_WORDS`; the list is the user's, a guess by
design). It moves money between the two sales lines only; the total cannot change.
`tests/count-date-and-drinks.test.mjs` + `npm run test:count-date` (needs the sandbox).

### Past stock counts are read only (added 2026-10-06, no migration)

The Stock Take page lists every submitted count under the start panel (date, items counted,
short/over, stock value); opening one shows each line (expected, counted, difference, reason),
what the differences were worth, and a **note** box. That note is the only thing that can be
written on a past count (`stock_takes.note`, a column that existed since `0015` and was never
used). It is reached from the **Past Counts** button on the Inventory page
(`/stock-take.html?history=1`, which shows the list even while a count is in progress); the
only other link there, Start Stock Take, opens a count, so without the button nobody could
find the list. There is deliberately **no re-open, edit or delete**: submitting a count set the shelf,
and every movement since and each month's true COGS were built on it. A wrong count is put
right on the Inventory page or by the next count. Routes: `GET /api/stock-take/history`,
`GET /api/stock-take/history/:id`, `POST /api/stock-take/history/:id/note` (list declared
before `:id`). Values come from **`stockValuer(db, org)`**, the valuation lifted out of
`/api/pnl` so the history and the P&L share one copy (`valueTake` for a whole count,
`valueRows` for any list of quantities — the differences). Counts are dated by
`STOCK_TAKE_DAY` (0062). Known limits: who submitted a count is not recorded; and "read only"
is the screen's and these routes' promise — the generic `/api/tables/stock_takes` routes can
still PATCH a count (the integration tests backdate takes that way).
**A reason for a difference is optional** (the user's decision, same day): the page used to
refuse to submit until every line that differed had one, which on a real sheet is nearly every
line. An unexplained difference is logged by the server as `'Stock take'` / `stock_take`.
`tests/stock-take-history.test.mjs` + `npm run test:history` (needs the sandbox).

### Record waste and Recount replace Adjust Stock (added 2026-10-06, migration `0063`)

On a **restaurant** account each Inventory row has two buttons, **Record waste** and **Recount**,
instead of the three-way Adjust Stock window. The old window let a restaurant add stock by hand
("Received / delivery" raises the shelf with no invoice behind it, so the P&L never sees the
purchase and food cost reads low), remove "Kitchen usage" that a sales import had already taken,
and type an exact amount that overwrote the bin and left no record. Now:

- **Record waste** — `POST /api/inventory/:id/waste { qty, reason_code, note }`. Remove only,
  and **relative** (`quantity = ROUND(quantity - ?, 6)`), so it cannot overwrite a sales import
  landing at the same moment. Only the reasons in `WASTE_REASONS` (server) =
  `WASTE_REASON_CODES` (`utils.js`): spillage, breakage, staff meal, sample/comp, **menu
  testing** (the user's addition: a test dish has no sale behind it), theft/loss, other.
  `tests/waste-recount.test.mjs` fails if the two lists drift. The page refuses waste larger
  than the shelf and points at Recount, so a wrong shelf number is never filed as waste.
- **Recount** — `POST /api/inventory/:id/recount { counted_qty, reason_code?, note?, count_date? }`.
  Sets one bin to what was counted (0 allowed) and saves it as a one-item count:
  `stock_takes.kind = 'recount'` (0063), which shows in Past Counts with a "Recount" tag, the
  item's name and no stock value. **Only `kind = 'full'` counts bracket a period in `/api/pnl`**
  or drive the Inventory page's counted marks — otherwise recounting one cheese on the 20th
  would close the month on a shelf of one cheese. **Apply `0063` before deploying.** (Applied to staging and
  production 2026-10-06 by `--command`, unrecorded; pre-change production bookmark
  `000005ee-00000000-000050fc-caae2647afa67bef6bff5a1c371537e4`.)

One modal, three modes (`adjustMode` in `inventory.js`). A **commissary keeps the old Adjust
Stock** (`/adjust`) by decision — moving stock by hand is their workflow, and there are no
commissary customers to ask yet; `stockButtonsHtml()` picks by `window.__accountType`, drawing
an unknown type as a restaurant and redrawing on `dm:plan-known`. `/adjust` itself is unchanged
and still trusts the browser's total. `npm run test:waste` (needs the sandbox).

**The P&L shows where it went** (`wasteReport()`, returned as `waste` on `/api/pnl`, Pro only,
fail-soft). Two blocks under the cost lines, each opening to its entries: **Waste** — every
stock-log line with a waste reason, by reason, from Record waste, a recount, or a full-count
line where a reason was picked; and **Missing at the count, no reason given** — lines of a
submitted count that came up short with an empty reason. Both are priced through
`stockValuer().valueRows` at the price current on the day. A count's lines are dated by the
count's own day (`count_date`, else its `submitted_at`), the day the P&L files the count under. **They explain the cost and are
never added to it**: lost stock is already inside true COGS because the closing count found
less, so gross profit is untouched (`tests/waste-recount.test.mjs` pins that). Known limits: a
count line given a non-waste reason (kitchen usage, correction, transfer — the count sheet
still offers those) appears in neither block; lines counted *over* are not netted off; a
hand-recorded waste entry is dated by its UTC timestamp, while a count's lines use the count's
own day (0062).

### The stock movement log (redone 2026-10-06, no migration)

Inventory → **Stock Log**, and the clock icon on each row opens it on that one item. It reads
`GET /api/stock-log` (`from`/`to` as instants, `inventory_id`, `q`, `kind`, `offset`; 200 a
page, `has_more`), which **filters on the server** — the old window loaded the latest 500
lines and filtered those in the browser, so an older date range answered "No movements found"
for movements that existed. Opens on the last 30 days; the one button under the table loads
more lines inside the dates shown, or else the 30 days before. `kind` is derived per line by
`STOCK_LOG_KIND_SQL` (sales, waste, count, production, delivery, other; a count line with a
waste reason is *waste*, so the filter matches the P&L's waste block). A line links to its
invoice (`?open=`, resolved from the number in "Invoice stock-in: N" only when that number is
one invoice's alone), its count (`/stock-take.html?history=1&open=<id>`) or the Sales page.

**"Stock after" is not stored.** It is the bin's quantity now less every change **recorded**
after the line (a window `SUM` per `inventory_id` ordered by `rowid`, computed before the
filters so a filtered line keeps its true figure). **Recording order, never `moved_at`:** a
sales import is dated by the day of the sale but takes its stock off the day it is uploaded,
often after that week's deliveries and counts. The first version walked back by date and, on
production, put Tuesday's sales before a count that had already absorbed them and showed a
shelf of −1.4 kg. The list is in the same order, so the column reads as one story; the Date
column says which day a line is about, and so can look out of order. NULL when the bin is
gone.
It is only as true as the log is complete: a quantity changed with no log line (the generic
`PATCH` on `inventory`) shifts every figure before it, and lines from before a bin's unit was
changed are shown in today's unit.

**The log is history: add, never change or delete.** The P&L's waste totals, undoing a sales
import and "Stock after" are all read back from it. So "Clear All Log" is gone, removing an
item from inventory keeps its lines, and the generic table routes refuse `PUT`/`PATCH`/`DELETE`
on `stock_log` (`stockLogIsHistory`, 409). `POST` stays open — the pages write lines through
it. Gone by decision: the "Lot #" column (nothing ever filled it; maybe for commissaries
later) and any dollar value on a line. `tests/stock-log.test.mjs` + `npm run test:stock-log`
(needs the sandbox).

### Stock-take valuation (true COGS)
`valueTake()` inside `/api/pnl` prices a submitted stock take. Two things about it
are easy to get wrong:

**The count and the price are in different units.** `stock_take_items.counted_qty`
is in the *bin's* unit; `product_entries.cost_per_unit` is per the *pack* unit the
product was invoiced in. They must be reconciled with `convertUnitCost()` before
multiplying — potatoes invoiced at $1.65/lb and counted as 50 kg are worth
$181.88, not $82.50. This error does **not** cancel between the opening and
closing takes (it scales with stock on hand), unlike the prepped-stock gap below.
A pair that can't be bridged keeps the unconverted figure rather than dropping to
zero, which would understate closing stock and overstate COGS.

**Counted prep is valued by what went into it.** Batch and finished-product counts
used to be collected and then priced at zero — the price lookup matches against
`product_entries`, and nobody ever invoiced a tub of sauce — so prep and packed
stock were invisible to COGS. `explodeToRawMaterials()` now breaks those lines
down and `priceInto()` values the result by the same rules as a counted raw
material.

`explodeToRawMaterials` is deliberately **not** `explodeSale`. That one answers
*where should stock come from*, so it honours `production_mode` and takes a
batched recipe out of its bin; this answers *what is physically inside this*,
which has one answer however the kitchen made it. Counting a packed product AND
the batch behind it is not double counting — two shelves, two real things.

Valuation is computed at **read time and never stored**, so this re-valued every
historical period the moment it landed. Accepted deliberately (2026-08-03): every
account holding stock takes was a test account. If real customers ever need
reported months frozen, store the valuation at submit time — do not add a cutoff
date to `valueTake`.

**Job B, closed 2026-10-04: prep nobody recorded can be counted.** The count sheet
was built from `inventory` rows alone, so a restaurant that cooked a tub without
pressing Produce Batch was never offered it, and its raw materials read as a
phantom shortfall. `POST /api/stock-take/start` now also adds a line for every
recipe that has no batch bin: `item_type='batch'`, expected 0, the recipe's yield
unit, and **an empty `inventory_id`** (that is how the page and submit tell them
apart). Counted above zero, submit creates the bin (or adjusts one produced since
the sheet was made), logs it with `reason_code='production'`, and sets the recipe
to `batched` so sales draw the tub first, exactly as after Produce Batch. Left
blank or counted zero, nothing is created. On the page these lines are optional:
they stay out of the progress count and the "not counted" warning unless counted
(`isUnrecordedPrep` / `countableItems` in `stock-take.js`). `npm run test:prep`
(needs the sandbox).

**A Pro restaurant's recipes are taken to be made ahead** (`prepStockAssumed()` in
`utils.js`). The recipe form saves `batched` for them, and offers one box, "Made to
order — never kept in stock", which saves **`to_order`**: a third `production_mode`
value that sells exactly like `on_demand` (anything not `batched`/`ignore` explodes
to raw materials) and is the only thing left OFF the count sheet. Legacy
`on_demand` recipes are still listed. Safe because of the fall-through: `batched`
with no tub takes raw materials. Side effect handled in `sales.js`: with every
recipe `batched`, the "prep was used that had never been recorded" note would list
the whole menu on each import, so for these accounts it shows real splits only (a
tub that ran short). Essential restaurants and commissaries are unchanged.
Known limit: a super-admin *viewing as* an account gets their own plan and type in
the browser, so the box does not show for them and a recipe they save keeps the
dropdown's value.

### Data model (two-level product design)
`generic_products` (the abstract item) + `product_entries` (per-supplier purchase records with FIFO pricing) is the central pattern. `recipes`/`recipe_items` cost from products; `finished_products`/`finished_product_items` cost from recipes; producing/packing deducts `inventory` and writes `stock_log`. Stock takes (`stock_takes`/`stock_take_items`) reconcile counted vs system stock.
