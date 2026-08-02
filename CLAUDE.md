# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DoughMeter — a business-management app for food/product businesses (products, suppliers, recipes, finished products, inventory, invoices, staff certifications). Runs on **Cloudflare Pages + Workers** with a **Hono** edge API, **D1** (SQLite) for structured data, and **R2** for file storage (invoice PDFs, certificates). Being built to sell commercially, so favor robust/professional choices over quick hacks.

## Commands

```bash
npm run dev              # Vite dev server (Hono via @hono/vite-dev-server)
npm run build            # Build to dist/ (bundles worker + copies public/ via vite plugin)
npm run deploy           # build + wrangler pages deploy dist --project-name webapp
npm run dev:sandbox      # wrangler pages dev against dist/, local D1, port 3000

# Database (D1) — migrations live in migrations/, numbered NNNN_name.sql
npm run db:migrate:local # apply migrations to local SQLite
npm run db:migrate:prod  # ⚠️ DO NOT RUN — see "Production migration state" below
npm run db:reset         # wipe local D1 and re-apply all migrations
npm run db:wipe:local    # run wipe-data.sql (clears data, keeps schema) — local
npm run db:wipe:prod     # same against remote D1

npm run cf-typegen       # regenerate Cloudflare binding types
```

### ⚠️ Production migration state — read before any prod DB work

**Never run `npm run db:migrate:prod`.** Production's `d1_migrations` table
records only up to **`0023_adjust_reasons_table.sql`** (29 rows), while the real
schema is at **0043**. Everything from 0024 on — org scoping, plans, suspension,
the invoice cap, POS sales import — was applied **by hand and never recorded**
(verified against live D1 on 2026-07-31).

So that command would try to replay 0024–0043.

**Traced properly on 2026-08-02 — the danger is real but not what it looks like.**
The run halts on the first error, and `0025_expense_invoices.sql` adds columns
that already exist (SQLite has no `ADD COLUMN IF NOT EXISTS`), so it dies well
before `0042_sales_monthly_per_org.sql` and its `DROP TABLE sales_monthly`. That
protection is **accidental, not designed** — the realistic failure is someone
hitting the error and clearing failures one by one until the run "works", walking
into 0042 on the way. And 0042 would not lose the rows even then: it
`INSERT ... SELECT`s them into the rebuild table, and the new shape is a superset
so the SELECT still resolves. What it silently drops is **`revenue_source`**,
which is missing from the INSERT column list — every row reverts to `'auto'`, so
any month whose revenue was typed in by hand flips to the imported figure in the
P&L. Corruption, not loss, and the quiet kind.

**Apply to production one file at a time instead:**
```bash
npx wrangler d1 execute invoicedb-production --remote --file=./migrations/0044_x.sql
```
And **back up any table a migration rebuilds before running it** — 0042 was
applied this way: the three `sales_monthly` rows were dumped to JSON first and
verified after.

**The fix, when there's time** (~15 min, deferred by the user on 2026-08-02):
build a pristine schema by applying `0001`→`0043` to a throwaway SQLite file,
diff production against it (read-only), fix whatever gaps turn up, and *only
then* insert `d1_migrations` rows for 0024–0043. **The diff is the point, not the
replay protection**: twenty migrations were hand-applied to production and nobody
has ever confirmed they landed completely. Recording them without the diff would
permanently hide a partially-applied migration — exactly what had happened
locally, where 0033 had its column but not its index and 0035 was half-applied.
Neither was noticed for weeks. The local database has since been repaired and
`npm run db:migrate:local` works normally.

There **is** a test suite now (it predates this note being written, which said there wasn't one):

```bash
npm test               # unit — auto-discovers every tests/*.test.mjs
npm run test:pos       # POS sales import  — needs `npm run dev:sandbox` running
npm run test:isolation # tenant isolation  — needs the sandbox; the pre-launch gate
npm run test:lifecycle # account lifecycle — needs the sandbox
```

Plain Node, no framework, no dependencies. `tests/helpers/browser-module.mjs`
evaluates `public/static/*.js` so unit tests exercise the *shipped* frontend
source rather than a copy. Two of the unit tests are static audits that will fail
the build on their own: `org-scoping.test.mjs` parses every `DB.prepare()` in
`src/index.ts` and rejects any tenant-table statement missing `org_id`, and
`dom-ids.test.mjs` cross-checks each page's `getElementById` calls against the
ids in its HTML. There is still **no linter, and no typecheck script** — `tsc`
is in tsconfig but not wired up (and not installed), so type errors only surface
at runtime. Verify changes by running the app.

Local dev uses a local SQLite file under `.wrangler/state/v3/d1/`. The `ecosystem.config.cjs` pm2 file has a stale `cwd` (`/home/user/webapp`) from another machine — prefer `npm run dev` / `npm run dev:sandbox` locally.

## Architecture

**Backend is a single file: `src/index.ts` (~1700 lines).** One Hono app, `export default app`. Bindings (`src/index.ts` top): `DB` (D1), `FILES` (R2), `ANTHROPIC_API_KEY` (secret via `.dev.vars` locally / `wrangler secret` in prod).

**Frontend is static, not part of the worker bundle.** `public/*.html` are standalone pages; `public/static/*.js` are matching vanilla-JS controllers (e.g. `invoices.html` ↔ `static/invoices.js`); styling is TailwindCSS via CDN + FontAwesome. `public/_routes.json` sets `include: ["/api/*"]`, so Cloudflare Pages routes **only** `/api/*` to the Hono worker and serves everything else as static assets. The frontend talks to the backend purely through `fetch` against `/api/*`. `public/static/utils.js` holds shared client helpers.

**Public vs. app pages.** `public/index.html` is the **public marketing landing page** (standalone, no controller, does not load `static/style.css`) and `public/login.html` is a **placeholder gate** — it forwards to `/home` with no credential check, because auth does not exist yet. The Products app page is `public/products.html` ↔ `static/products.js` (it was `index.html` until the landing page took the root URL — link to it as `/products.html`). Every app page carries `<meta name="robots" content="noindex, nofollow">`; `index.html` is the only page intended to be indexable, and it is *also* noindex until a real domain is live (see `public/robots.txt`, which documents the launch checklist). Cloudflare Pages strips `.html` and 308-redirects, so `/products.html` → `/products` in production; internal nav keeps the `.html` suffix so links also resolve under `npm run dev`.

### Generic table CRUD
Most data access goes through one generic REST layer: `/api/tables/:table` (+ `/:id`) supporting GET/POST/PUT/PATCH/DELETE. Tables must be in the `ALLOWED_TABLES` allowlist (defense against SQL injection via the `:table` param — column/table names are interpolated, values are always bound). Primary keys: string `uid()` is generated on insert **unless** the table is in `INTEGER_PK_TABLES` (currently just `units`), which use autoincrement.

### Route ordering matters
Specific routes that **override** the generic CRUD must be declared **before** the generic `/api/tables/:table/*` handlers, because Hono matches in registration order. Examples already doing this: `DELETE /api/tables/generic_products/:id` (soft-delete override) and `PUT /api/generic_products/:id` (rename cascade). Add new overrides in the same position.

### Soft-delete / void, never hard-delete history
This is a core invariant for anything with financial or stock history:
- **Products** archive via `generic_products.deleted_at`; active lists filter `deleted_at IS NULL`. Delete clears live state (`inventory`, `product_aliases`) but keeps `product_entries`, `recipe_items`, `stock_log`.
- **Invoices** void via `invoices.voided_at` (+ `void_reason`), excluded from P&L/spending; `product_entries` created by the invoice get their own `voided_at` so they stop counting toward pricing. Restore reverses it. Only drafts use plain DELETE.
- When adding features that consume this data, filter out voided/archived rows (`voided_at IS NULL`, `deleted_at IS NULL`).

### Denormalized names cascade on rename
Product names are copied into `product_entries`, `invoice_lines`, `product_mappings`, `inventory`, `recipe_items`, `stock_log` (some features join by name, not id). `PUT /api/generic_products/:id` cascades a name change to all of these. If you add another place a product name is stored, add it to that cascade.

### AI invoice/recipe parsing
`/api/ai/parse-invoice` and `/api/ai/parse-recipe` call the Anthropic API directly (`fetch` to `api.anthropic.com/v1/messages`, model `claude-opus-4-8`) — there is no SDK dependency. They return JSON matching an inline schema. Supplier dedup (`classifySupplierMatch` + Levenshtein) and `parsePackSize`/`inferCategory` heuristics in `src/index.ts` clean up extracted data before it hits the DB.

**Monthly parse cap (migration `0041`).** Invoice parsing is metered per organization per calendar month; recipe parsing is deliberately not (it's a one-time onboarding cost). `PLAN_INVOICE_CAPS` sets the plan defaults (Essential 150, Pro uncapped) and `organizations.invoice_cap` overrides it per account — **NULL** = plan default, **0** = uncapped, **N** = capped at N. `effectiveInvoiceCap()` resolves the two. The check runs at the top of `/api/ai/parse-invoice` *before* the Anthropic call, so a blocked parse costs nothing; it returns 403 `{ upgrade_required: true, cap, used }`, which `callClaudeParse` in `public/static/invoice.js` turns into an amber `showCapBlocker` panel rather than a red error.

Usage is counted from **`ai_parse_log`** (one row per API call, written server-side), *not* from `invoices.ai_cost` — the latter is accumulated client-side and saved only when the invoice is saved, so abandoned parses would be invisible and multi-page invoices would count once. `invoices.ai_cost` remains the per-invoice figure shown on the invoice screen. Refusals are logged to `ai_cap_blocks`, because a hard block hides the demand it blocks and that demand is the evidence for whether paid overage is worth building. Both tables are org-scoped and covered by `tests/org-scoping.test.mjs`.

### Plan tiers (Essential / Pro)
`organizations.plan` (migration `0039`) is enforced in the **same `/api/*` middleware chokepoint** as auth and suspension. `PRO_FEATURES` lists what Pro adds (`inventory_tools`, `stock_takes`, `storage_layout`, `staff`, `true_cogs`); `featureForPath()` maps a request to a feature, `PRO_ONLY_TABLES` does the same for the generic table routes. The map lists **only what Pro adds**, so an unlisted/new endpoint is open by default — a missing gate costs a little revenue, a wrong gate breaks a customer's shift. Refusals are 403 `{ upgrade_required: true, feature, plan }`. Super-admins are exempt, as with suspension.

**`inventory` and `stock_log` are deliberately NOT gated.** Essential tracks stock silently — packing a Finished Product writes both — and `recipes.js`, `finished-products.js` and `products.js` all *read* `inventory` to cost and convert. Gating those tables would break Essential features and would turn an upgrade into a data backfill instead of a column flip. What *is* gated on inventory is the Pro action: `POST /api/inventory/:id/adjust`.

Client side, `publicUser()` returns `plan` + `features`, and `applyPlanGating()` in `public/static/utils.js` hides nav links and swaps a gated page's `.container` for an upgrade panel (`PLAN_GATED_PAGES` — keep in step with `featureForPath`). This is presentation only: `public/_routes.json` sends only `/api/*` to the worker, so the static pages themselves cannot be gated server-side. The server's guarantee is that Pro **actions** are refused, not that Pro **pages** are unreachable. True COGS is gated inside `/api/pnl`, which returns `cogs.reason = 'upgrade_required'` so the UI can offer an upgrade instead of "go do a stock take" they can't do.

### Product categories
Categories are stored as **free-text** on `generic_products.category`. The managed master list is the **`categories` table** (migration `0018`, same shape as `units`: `id`/`name`/`sort_order`, integer PK). It's edited through the **Manage Categories** modal (`public/static/utils.js` — mirrors Manage Units) and picked in the product form; users can also add one inline via the "+ New category…" option. Deleting a category from the master list only removes it from the picker — products keep their label (the DELETE is usage-checked, `?force=true` to override; see `DELETE /api/categories/:id`).

The built-in taxonomy (grouped food-COGS / beverage / operating-supplies) is seeded by migration `0018` and **duplicated in four places that must stay in sync** when the built-in list changes: `DEFAULT_CATEGORIES` in `public/static/utils.js` (frontend fallback + seed reference), `DEFAULT_CATEGORIES` in `src/index.ts` (seeded into every new organization at account creation, with its `type`), the stat-chip/badge CSS in `public/static/style.css` (`.cat-<slug>` + `.cat-chip.cat-<slug>`, slug via `slugify`), and the backend `inferCategory` keyword rules in `src/index.ts` (auto-classifies invoice imports; unmatched → `Other`). The live picker reads from the `categories` table at runtime, not from `DEFAULT_CATEGORIES` (which is only the fallback). `Ingredients` is a retired legacy value kept for back-compat.

Category names are unique **per organization**, enforced by the expression index `idx_categories_org_name` on `COALESCE(org_id, '')` + `name` (migration `0038`). It is deliberately not a plain `UNIQUE(org_id, name)` — SQLite treats NULLs as distinct, which would let the NULL-org demo account collect duplicates. Migration `0040` does the same for `units` (`idx_units_org_name`, additionally over `LOWER(name)` since `normalizeUnit` lower-cases everything except `L`). Note `0040` only *records* a fix production already had applied by hand — prod's `units` lost its global `UNIQUE` during the 2026-07-29 seeding work, so without the migration any database rebuilt from these files fails on its second account creation.

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
the recipes behind it are still reached through `finished_product_items` when the
sale is exploded. `target_type` is therefore `finished_product` or `ignore`.
Enforced in three places: the picker in `sales.js` loads only
`finished_products`, `sanitizePosTargets()` scrubs anything else off whatever the
review screen posts to `/preview` and `/commit`, and `explodeSale` has no
top-level recipe branch. Legacy `pos_item_map` rows with `target_type='recipe'`
are **not** migrated — they fail the `nameOf` lookup at draft creation and demote
to unmapped (`match_source='stale'`), so the reviewer re-links them once against
a finished product and the upsert overwrites the old rule. Committed
`pos_sale_lines` are history and are left alone.

**The two-level BOM limit is load-bearing.** `finished_product_items` may
reference a recipe or a product, but `recipe_items` has no `item_type` — a recipe
holds only products. `explodeSale`/`explodeRecipe` in `src/index.ts` rely on
that; if `recipe_items` ever gains an `item_type`, the depth guard turns a silent
infinite loop into a loud error. `explodeRecipe` is still very much in use — it
is how a finished product made of recipes reaches its raw materials.

**`recipes.production_mode` prevents double-counting** and must not be bypassed.
It is read where a finished product's line references a recipe: `on_demand`
(default) explodes that line into raw materials; `batched` deducts the recipe's
`batch` bin instead and leaves Produce Batch to refill it. Doing both would count
the same flour twice. Migration `0043` backfills `batched` for any recipe already
holding batch stock.

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

P&L revenue is **derived**, never written into `sales_monthly`: `/api/pnl`
returns `sales.by_month` from `pos_sale_lines`, and `sales_monthly.revenue_source`
(`'auto'`|`'manual'`) decides which figure `pnl.js` shows. Voiding an import
flips the month back to the typed figure on its own.

Known gap: a recipe left on `on_demand` can still be sent through Produce Batch,
creating batch stock nothing draws down.

### Costing is derived, never stored
Cost flows one way — `product_entries` → product → recipe → finished product —
and every level is computed **at read time** from current invoice prices.
`buildLiveCostIndex()` in `public/static/utils.js` does the whole pass in one
call; `recipes.js`, `finished-products.js` and `inventory.js` all display from
it. A supplier price rise therefore moves menu costs **on its own**: the FIFO
layer follows what's left in the bin (`fifoActiveEntryIn`), so when the cheap
stock runs out the price rolls over with no staff action.

**Costing basis (`plan` argument to `buildLiveCostIndex`).** FIFO only means
anything when the app knows how much has been used — it picks the price layer by
comparing purchases against stock on hand. With no consumption ever recorded
those are equal, so FIFO pins every cost to the **first invoice ever uploaded**
and it never moves again, however many deliveries arrive. Two rules:
**Essential** always prices from the latest invoice (stock tracking isn't in the
plan); **Pro** uses FIFO but falls back per-product when that product has no
consumption recorded. The Pro fallback matters most just after an upgrade — a
plain plan check would swap a working latest-invoice cost for a FIFO one anchored
months back, right after the customer paid more. It switches itself off when real
usage lands. `fifoActiveEntryWithBasis()` returns which basis was used;
`costBasisNote()` surfaces it in the detail modals, only for the fallback.

The plan reaches the browser via `publicUser()` → `window.__accountPlan`, and
that bootstrap **races the pages' own catalogue loads**. `utils.js` dispatches
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
the `product_entries` the invoice created, so every catalogue that derives a
price filters `!e.voided_at`. Leaving them in is doubly wrong: a cancelled
invoice can become the active layer, *and* it inflates the purchased total,
which shifts FIFO onto the wrong layer even when the voided row isn't the one
picked. `tests/voided-entries.test.mjs` is a static audit that fails the build if
a costing page reintroduces an unfiltered filter. The one deliberate exception is
`renderEntriesTable()` in `products.js` — the entries table inside the product
modal still lists voided rows so they can be seen and restored.

Pack facts come from `entryPackFacts()` (also `utils.js`): `product_entries`
stores `pack_qty` + `pack_unit` as columns and has **no `pack_size`** — parsing
that non-existent field gave every product a pack unit of `'unit'`. Note `cost`
is the **line total**, so unit price is `cost ÷ (pack_qty × qty_ordered)`;
`cost_per_unit` is stored and wins when present. A line whose units can't be
bridged is **uncostable (null)**, never `0` — a silent zero reads as a free
ingredient and understates every margin above it.

### Stock-take valuation (true COGS)
`valueTake()` inside `/api/pnl` prices a submitted stock take. Two things about
it are easy to get wrong:

**The count and the price are in different units.** `stock_take_items.counted_qty`
is in the *bin's* unit; `product_entries.cost_per_unit` is per the *pack* unit
the product was invoiced in. They must be reconciled with `convertUnitCost()`
before multiplying — potatoes invoiced at $1.65/lb and counted as 50 kg are
worth $181.88, not $82.50. This error does **not** cancel between the opening
and closing takes (it scales with stock on hand), unlike the prepped-stock gap
below. A pair that can't be bridged keeps the unconverted figure rather than
dropping to zero, which would understate closing stock and overstate COGS.

**Only `raw_material` lines are valued.** Batch and finished-product counts are
collected (the count sheet snapshots every inventory type) but priced at zero —
the price lookup matches against `product_entries`, and a recipe has no
invoices. So prep and packed stock are invisible to COGS. That error *does*
largely cancel: the distortion is `prep_closing − prep_opening`, i.e. only the
change in prepped stock across the period. Fixing it properly means exploding
counted batch/FP lines to raw materials via `buildExplodeCtx`/`explodeRecipe`
(reusing the POS backflush machinery rather than porting the browser's cost
index) — not done yet.

### Data model (two-level product design)
`generic_products` (the abstract item) + `product_entries` (per-supplier purchase records with FIFO pricing) is the central pattern. `recipes`/`recipe_items` cost from products; `finished_products`/`finished_product_items` cost from recipes; producing/packing deducts `inventory` and writes `stock_log`. Stock takes (`stock_takes`/`stock_take_items`) reconcile counted vs system stock.
