# Foodnance — Production Cost, Inventory & Staff Certification Manager

## Project Overview
- **Name**: Foodnance
- **Goal**: Full-featured business management platform for food/product businesses
- **Backend**: Hono + Cloudflare Workers (edge API)
- **Storage**: Cloudflare D1 (SQLite database) + Cloudflare R2 (file storage)
- **Frontend**: Vanilla JS + TailwindCSS (CDN) + FontAwesome

---

## 🌐 Public URL
- **Local Dev**: http://localhost:3000
- **Production**: Deploy with `npm run deploy` (requires Cloudflare account)

---

## ✅ Completed Features

### 📦 Products (`/`)
- Two-level product model: Generic Product + Supplier Entries
- Category management: food (COGS) groups — Produce, Meat & Poultry, Seafood, Dairy & Eggs, Dry Goods & Pantry, Bakery, Frozen, Oils/Sauces/Condiments, Spices & Seasonings — plus beverage and operating-supply categories, with inline "+ New category" for custom ones
- Sub-unit breakdown (e.g. 1 Dozen = 12 Eggs)
- Supplier entries with FIFO pricing, variance column
- Auto "Add to Inventory" prompt after saving entries

### 🚚 Suppliers (`/suppliers`)
- Full CRUD for vendor list (Name, Contact, Email, Notes)

### 🍳 Recipes (`/recipes`)
- Recipe builder with yield and servings
- FIFO ingredient costing with unit conversion
- Produce Batch → deducts inventory

### 🏷️ Finished Products (`/finished-products`)
- Finished product builder with cost/profit/margin calculator
- Pack Run → deducts batch + packaging inventory

### 🏭 Inventory (`/inventory`)
- Raw Materials / Batches / Finished Products tabs
- Adjust Stock modal with reason tracking
- Full stock movement log with date filters

### 📄 Invoices (`/invoices`)
- Invoice list with status, vendor, date, total filters
- Upload PDF/CSV/image → auto-extract products
- Invoice status management (In Processing / Action Required / Closed)
- **Cloud file storage**: Invoice files stored in Cloudflare R2

### 👥 Staff (`/staff`) — NEW
- Staff directory with role, department, hire date, status
- Per-staff certification summary (valid/expiring/expired badges)
- Quick view of all certifications per staff member

### 🏆 Certifications (`/certifications`) — NEW
- Track staff certifications with issue/expiry dates
- **Cloud file upload**: Upload certificate documents (PDF/PNG/JPG) to R2
- Auto-expiry calculation from certification type validity period
- Status views: All / Expiring Soon / Expired
- Certification Types management (name, validity months, mandatory flag)
- Full stats dashboard

---

## 🔌 API Endpoints

### Generic CRUD (all tables)
```
GET    /api/tables/:table          → list rows
GET    /api/tables/:table/:id      → get one
POST   /api/tables/:table          → create
PUT    /api/tables/:table/:id      → replace
PATCH  /api/tables/:table/:id      → partial update
DELETE /api/tables/:table/:id      → delete
```

### Supported Tables
`suppliers`, `generic_products`, `product_entries`, `recipes`, `recipe_items`,
`finished_products`, `finished_product_items`, `inventory`, `stock_log`,
`invoices`, `staff`, `certification_types`, `staff_certifications`

### File Storage
```
POST /api/upload                   → upload file to R2, returns { key, url, name }
GET  /api/files/:key               → download/view file from R2
```

---

## 🗄️ Data Architecture

### Storage Services
- **Cloudflare D1**: All structured data (SQLite-based, globally distributed)
- **Cloudflare R2**: File storage for invoice documents and staff certificates

### Key Tables
| Table | Purpose |
|---|---|
| `generic_products` + `product_entries` | Two-level product/supplier model |
| `suppliers` | Vendor directory |
| `recipes` + `recipe_items` | Recipe costing |
| `finished_products` + `finished_product_items` | Finished product costing |
| `inventory` + `stock_log` | Stock tracking with movement history |
| `invoices` | Invoice records with R2 file links |
| `staff` | Staff directory |
| `certification_types` | Configurable cert types with validity periods |
| `staff_certifications` | Per-staff certifications with R2 file links |

---

## 🚀 Development Commands

```bash
npm run build              # Build for production
npm run db:migrate:local   # Apply DB migrations (local SQLite)
npm run db:reset           # Reset and re-apply migrations
pm2 start ecosystem.config.cjs  # Start dev server
pm2 restart invoicedb      # Restart dev server
pm2 logs invoicedb --nostream   # Check logs
```

## 📦 Deploy to Cloudflare Pages

```bash
# 1. Create D1 database
npx wrangler d1 create invoicedb-production
# (copy database_id to wrangler.jsonc)

# 2. Create R2 bucket
npx wrangler r2 bucket create invoicedb-files

# 3. Apply migrations to production
npm run db:migrate:prod

# 4. Deploy
npm run deploy
```

---

## 🔮 Recommended Next Steps

1. **Authentication**: Add login/password protection (Cloudflare Access or custom JWT)
2. **Email Alerts**: Send expiry reminders via SendGrid/Resend when certs expire soon
3. **CSV Export**: Export certifications, staff lists, inventory reports
4. **Bulk Upload**: Import staff list from CSV
5. **Mandatory Cert Compliance**: Dashboard showing which staff are missing mandatory certs
6. **Invoice OCR**: Connect OpenAI Vision API for better invoice parsing
7. **Low-stock Alerts**: Configurable minimum stock thresholds per item
