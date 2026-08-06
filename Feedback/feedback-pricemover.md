# Price Movers — test report

**Date:** 2026-08-06
**Tested on:** local dev (`npm run dev`, localhost:5173)
**Test account:** "Osteria Prova" — a brand new throwaway **restaurant on Pro**, org `mshb0vw6b9hyi7`, owner `chef@osteriaprova.test`. Created empty, then filled by hand.

> **Status after this session**
> - **Fixed and verified:** items bought by the case (or any odd unit) being invisible — see "Bug 2, now fixed".
> - **Still open, most serious:** merging or grouping two products fails every time and leaves the data half-changed — see "Bug 1".
> - Everything else below is still open and untouched.
> - Code changed: `public/products.html`, `public/static/products.js`, `src/index.ts`. All 24 test files pass.

## What I set up

4 vendors: Molino Rossi, Sacco Foods, Neptune Provisions, Salumi Italia.

8 products with 19 purchases between them, deliberately built so that each one
tests something different:

| Product | Stocked in | What it tests |
|---|---|---|
| Tipo 00 Flour | kg | Same product, two vendors, same unit, price rising over 3 buys |
| San Marzano Tomatoes | lb | **Two vendors billing in different units** — one in lb, one in kg |
| Prosciutto di San Daniele | kg | **Two grouped items** — Parma and San Daniele merged into one product, 2 vendors, 2 different vendor wordings |
| Fennel | each | **Each ↔ weight** — one vendor sells by the piece, one by the kilo, bridged by average weight (0.300 kg) |
| Vanilla Pods | each | One vendor by the piece, one by the gram, **with no average weight set** so the two cannot be bridged |
| Extra Virgin Olive Oil | L | **Volume** — a 5 L tin vs 6 × 750 ml bottles |
| Paper Napkins | case | Bought **by the case**, twice, same vendor |
| Saffron | g | Only one purchase ever |

The first product was entered entirely by hand through the Add Product screen to
confirm the form works. The rest were created through the same form logic and the
app's own save routes, so nothing was written straight into the database.

---

# The good news: the maths is right

I worked out every number by hand first, then compared. **Every single figure
matched exactly.** This is the part that matters most and it is solid:

- **Different units are converted properly before comparing.** Tomatoes bought at
  $2.30/lb from one vendor and $48 per 10 kg from another are correctly shown as
  $2.30/lb vs $2.18/lb — a 5.3% drop. Comparing the raw numbers would have shown a
  fake 109% jump. It does not do that.
- **Litres and millilitres line up.** 6 × 750 ml bottles for $63 correctly becomes
  $14.00 per litre against the $12.50 tin.
- **Pieces and weight are bridged by average weight.** 12 fennel at $18 becomes
  $1.50 each; 5 kg at $22.50 becomes $1.35 each. Correct.
- **A swapped item is not reported as a price rise.** The grouped prosciutto
  correctly says *"different item · Prosciutto di Parma DOP 24m → Prosciutto San
  Daniele DOP 18m"* instead of pretending the price moved. Vendor switches are
  labelled the same way, with a helpful tooltip: *"Difference between two different
  purchases, not a price change by one vendor"*. This is genuinely good.
- **The savings figures are right.** "Est. save $2.50 by moving your volume to
  Molino Rossi" and the Portfolio total of **$35.01** both match my hand
  calculations to the cent, and the five rows add up to the total.
- **Cancelled invoices are properly ignored.** I voided one purchase: the vendor
  disappeared from the comparison, the spend dropped, and the percentage
  recalculated correctly. Un-voiding put it all back.
- **Date filtering works.** Narrowing the range correctly drops purchases and
  recalculates. Future ranges return nothing rather than breaking.
- **Purchases that cannot be compared are labelled**, not silently priced at zero.
  The 250 g vanilla line clearly says "not comparable".

---

# Bug 2 — anything bought by the case was invisible — **NOW FIXED**

## What was wrong

Paper Napkins went from **$48.00 to $54.00 per case** — same vendor, same item,
same unit. A real 12.5% rise. Price Movers showed it **nowhere**: not in the Top 10
list, a completely blank chart, and Vendor Compare called it *"latest price per
kg"* — per kg, for napkins.

The cause was that there are **two different unit questions**, and you only ever
see one of them:

1. *What did you buy?* — 1 case, $48. That list **did** include "case", and your
   answer was saved correctly. Both napkin purchases said "case" in the database.
2. *What unit do you count and price this in?* — the "Stocking unit". That was a
   **separate, hardcoded list**: lb, kg, g, oz, L, ml, each. **No case.**

You never saw question 2. That box only appears when two suppliers disagree about
units, and napkins came from one vendor. With the box hidden, the app tried to fill
it in by copying your pack unit across, failed to find "case" in the shorter list,
and — with no error or warning — silently kept whatever was already selected, which
was kg.

So the product was filed as "counted in kilograms". Price Movers then tried to turn
$48 per case into dollars per kg, couldn't, and threw both purchases away.

**Nothing was clicked wrong.** Picking "case" was correct and was saved. The damage
happened in a field that was never shown.

## What was changed

**1. One unit list, everywhere.** The stocking-unit dropdown no longer has its own
hardcoded list — it now reads the same units master list as the pack-size dropdown,
and carries the same "+ Manage units" entry. Add a unit once and it is available as
both what you buy and what you stock.

**2. Two purchases in the same unit are compared directly, with no conversion.**
The stocking unit is only a lens for comparison. When it cannot express what was
actually bought, Price Movers now falls back to a unit that at least two purchases
genuinely share. This is strictly a fallback — a product that already compares
keeps its declared unit, so nothing that worked before behaves differently.

**3. The "Stocked In" box now appears when the declared unit doesn't match what is
actually being bought.** Without this, products already broken stayed both invisible
*and* unfixable, because the box only ever appeared on a supplier disagreement.

**4. A small guard** so "+ Manage units" can never be saved as a product's unit.

Files touched: `public/products.html`, `public/static/products.js`, `src/index.ts`.

## How it was checked

- Napkins now show **+12.5%**, second in the Top 10, with a proper chart from
  $48.00 to $54.00, labelled "unit: case", and no "not comparable".
- **Nothing else moved.** The other seven products returned identical figures —
  same percentages, same savings, same units, same uncomparable counts.
- This worked **before** repairing the napkins data, proving the fallback rescues
  products that are already wrong in the database.
- Added "gal" through Manage Units from the product page — it appeared immediately
  in **both** dropdowns.
- Created a new product bought by the case → stocking unit saved as **case**.
  Created one bought in gallons → saved as **gal**, a unit that had not existed in
  the app minutes earlier. Before the fix both would have silently become kg.
- Opened the napkins product: the "Stocked In" box now appears with a plain warning
  — *"Sacco Foods bills in case, but this item is counted in kg — prices can't be
  compared across the two."* Changed it to "case" and it saved correctly.
- `npm test` — **all 24 test files pass.**

---

# Still open

## Bug 1 — merging or grouping two products always fails, and leaves the data half-changed

**This is now the most serious thing outstanding, and it is the feature you asked
me to test.** It is not a Price Movers bug, but it affects it.

When I grouped Prosciutto di Parma and Prosciutto di San Daniele, the screen looked
like it worked but the server returned **500 Internal Server Error**. I reproduced
it twice more with throwaway products — it fails **100% of the time**, for both the
"Merge" button and the "Group" feature.

**The cause:** the merge code tries to update a column called `generic_product_id`
on the `invoice_lines` table. That column does not exist. It is not in any
migration file, so this will fail on any database built from this project — this is
not damage to my local copy.

**Why it is bad:** the merge is not wrapped in a transaction, so the steps before
the failing one have already been saved. A failed merge leaves you with:

- purchase history already moved to the surviving product ✔
- the absorbed product **still listed as live**, now empty, with no warning ✘
- **no alias recorded**, so future invoices with the old name will not route to the
  grouped product — the main point of grouping ✘
- with Group, the surviving product **has already been renamed** ✘
- the user sees an error and has no idea any of that happened ✘

The Merge dialog promises *"The merged product will be hidden from the products
list"*. It is not. I had to archive the leftover product by hand to continue.

**Worth checking on production**, since a half-finished merge on real data would be
messy to unpick.

## Bug 3 — it says "you're already buying at the cheapest price" when it has not actually checked

For Vanilla Pods, Vendor Compare shows a green tick and:

> **You're already buying at the cheapest available price.**

That is not established. There are two vendors and only one could be priced. Sacco
Foods — whose purchase was **$118, more than the $97 spent with the vendor it did
compare** — could not be converted (grams vs pieces, no average weight), so it was
left out of the comparison entirely.

The table below is honest about it (Sacco shows "—", "0 each", "n/a"), but the green
all-clear at the top is what people read, and it states a conclusion the app has not
earned. It should say something like "1 of 2 vendors could not be compared".

Same at portfolio level: products with an incomplete comparison score $0 savings and
vanish from the list, so nothing ever prompts you to fix the missing average weight
causing it.

## Bug 4 — the savings headline does not repeat the "stale" warning

For the prosciutto it says:

> Est. save **$21.50** by moving your volume to **Neptune Provisions** at current prices.

Neptune's price is from 28 June — 39 days old. The vendor table underneath correctly
flags it **stale**, which is good. But the green recommendation box does not mention
it, and that box is what you act on. A 39-day-old ham price is not "current prices".

## Bug 5 — the trend chart lists vendors it does not plot

On Vanilla Pods the chart legend shows **Sacco Foods**, and the date axis runs all
the way to 28 July — Sacco's purchase date — but there is no Sacco point on the
chart, because that purchase could not be compared. The chart reserves space and a
legend entry for data it never draws. It looks like something failed to load.

## Bug 6 — the product search box is visually broken

Typing in the "Search / Find any product…" box produces a suggestion list squeezed
into a column about 50 pixels wide. "Paper Napkins — change · 2 purchases" wraps into
an unreadable vertical stack of fragments spilling over the panel.

## Archived products still appear here

Noticed while clearing up test data. When you archive a product it disappears from
the Products list, but it still shows on Price Movers and can still be recommended
in the Portfolio savings — the query never filters archived products out.

This one is a judgement call rather than a clear bug: deleting a product
deliberately keeps its purchase history, and that spend was real. But being told to
switch vendor on something you have stopped buying is odd. Worth deciding either
way.

## Adding new units is now easy — but the recipe screens still can't convert them

Now that any unit can be added and picked as a stocking unit, it is worth knowing
where that does **not** yet work. Price Movers is fine: the backend conversion table
already knows gallons and similar.

But the recipe and finished-product screens keep their **own separate copies** of
the conversion table, and those two lack `gal`. That is the already-known bug where
an unknown unit gets charged at **1× instead of being refused** — 180 ml of milk
saved as 180 gal, a latte reading $898 instead of $0.74. Making units easier to add
makes that gap easier to hit. It is a bigger fix and was deliberately not bundled in
here.

---

# Smaller things (all still open)

- **Litres display as a lowercase "l".** The olive oil shows "$14.00/l" and
  "$12.50/l" everywhere. Lowercase l is easy to misread as a 1. Should be "L", which
  is what the purchase unit list itself uses.
- **Volumes are rounded to whole units in the vendor strip.** Salumi's 21.5 kg shows
  as "22 kg · $600.50". The money is exact, the quantity is not, so they do not
  reconcile if anyone checks.
- **The Products list shows prices in the wrong unit.** Olive oil, stocked in litres,
  is listed as **"$0.01 / ml"** — rounded to the nearest cent, so all precision is
  gone and the figure is useless. Fennel, stocked in "each", shows "$4.50 / kg". The
  list shows the last purchase's own pack unit rather than the product's stocking
  unit.
- **Backwards or nonsense date ranges fail silently.** Putting the "from" date after
  the "to" date, or junk text, returns an empty list with the message "No products
  with at least 2 purchases in this range" — which sends you looking for a data
  problem instead of a typo in the dates.
- **A single-purchase product is internally tagged as a "price" change** even though
  there is nothing to compare. Not visible to users, but misleading if anything ever
  reads that field.
- **A brand new account cannot add its first product without a detour.** The vendor
  dropdown is required and starts empty, and unlike the category dropdown it has no
  "+ New vendor…" option. You have to leave the form, go to Suppliers, and come back.
  Categories and units are seeded for a new account; vendors cannot be, so this
  screen needs the inline option more than the others do.
- **Dev-only:** the login page redirects to `/home` without the `.html`, which 404s
  under `npm run dev`. It works in production because Pages strips the extension, but
  it makes local testing awkward. Also, `CLAUDE.md` still describes `login.html` as a
  placeholder with no credential check — it is a real login form now.

---

# Caveats about this test

- The Spending Breakdown panel at the bottom of the page shows **$0.00 / 0
  invoices**. That is my doing, not a bug: I created purchase records directly rather
  than by uploading invoices, so there are no invoice records to total up. Price
  Movers itself reads purchase records, which is why it works fine.
- I did not test the AI invoice reader, because building the price history by hand
  gave exact control over the dates and prices needed to check the maths.
- The napkins product has been repaired (stocking unit changed from kg to case), so
  it now reads correctly through its declared unit rather than through the fallback.
  Both paths were verified.

# Suggested order for what is left

1. **The merge/group crash** — broken for everyone, every time, and leaves
   inconsistent data behind.
2. **The false "cheapest price" all-clear** — say how many vendors could not be
   compared.
3. **The recipe-screen conversion tables** — the 1× bug, now easier to trigger.
4. The stale warning in the savings box, then the cosmetic items.
