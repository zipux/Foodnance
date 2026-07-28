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
npm run db:migrate:prod  # apply migrations to production D1
npm run db:reset         # wipe local D1 and re-apply all migrations
npm run db:wipe:local    # run wipe-data.sql (clears data, keeps schema) — local
npm run db:wipe:prod     # same against remote D1

npm run cf-typegen       # regenerate Cloudflare binding types
```

There is **no test suite, linter, or typecheck script** — `tsc` is available via tsconfig but not wired to a script. Verify changes by running the app.

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

### Product categories
Categories are stored as **free-text** on `generic_products.category`. The managed master list is the **`categories` table** (migration `0018`, same shape as `units`: `id`/`name`/`sort_order`, integer PK). It's edited through the **Manage Categories** modal (`public/static/utils.js` — mirrors Manage Units) and picked in the product form; users can also add one inline via the "+ New category…" option. Deleting a category from the master list only removes it from the picker — products keep their label (the DELETE is usage-checked, `?force=true` to override; see `DELETE /api/categories/:id`).

The built-in taxonomy (grouped food-COGS / beverage / operating-supplies) is seeded by migration `0018` and **duplicated in four places that must stay in sync** when the built-in list changes: `DEFAULT_CATEGORIES` in `public/static/utils.js` (frontend fallback + seed reference), `DEFAULT_CATEGORIES` in `src/index.ts` (seeded into every new organization at account creation, with its `type`), the stat-chip/badge CSS in `public/static/style.css` (`.cat-<slug>` + `.cat-chip.cat-<slug>`, slug via `slugify`), and the backend `inferCategory` keyword rules in `src/index.ts` (auto-classifies invoice imports; unmatched → `Other`). The live picker reads from the `categories` table at runtime, not from `DEFAULT_CATEGORIES` (which is only the fallback). `Ingredients` is a retired legacy value kept for back-compat.

Category names are unique **per organization**, enforced by the expression index `idx_categories_org_name` on `COALESCE(org_id, '')` + `name` (migration `0038`). It is deliberately not a plain `UNIQUE(org_id, name)` — SQLite treats NULLs as distinct, which would let the NULL-org demo account collect duplicates. `units` has no uniqueness constraint at all.

**New organizations are seeded** with both master lists (`DEFAULT_UNITS` and `DEFAULT_CATEGORIES`) in the same `DB.batch()` as the org and owner row, in `POST /api/admin/organizations`. Without this a new account's pickers read "No units defined yet", which first bites during invoice import. `storage_sections`, `certification_types` and `vendor_fee_templates` are still not seeded.

### Data model (two-level product design)
`generic_products` (the abstract item) + `product_entries` (per-supplier purchase records with FIFO pricing) is the central pattern. `recipes`/`recipe_items` cost from products; `finished_products`/`finished_product_items` cost from recipes; producing/packing deducts `inventory` and writes `stock_log`. Stock takes (`stock_takes`/`stock_take_items`) reconcile counted vs system stock.
