# Test report — pizzeria on an Essential plan

**Date:** 5 August 2026
**Account tested:** "Napoli Test Pizzeria" — Essential plan, restaurant type, local dev only (nothing was written to production)
**What I was checking:** that recipes and finished products cost correctly, especially when an ingredient is bought in one unit and used in another.

---

## Short version

**The maths is right.** I built 20 ingredients, 4 recipes and 9 menu items, worked out every
figure by hand first with a calculator, then compared. Every single one matched, including
all the awkward unit conversions. I also raised two supplier prices halfway through and the
new prices flowed all the way up to the menu items on their own, correctly.

**But I found three real bugs on the way in.** None of them are in the costing maths — they
are all in the *product entry form*, and two of them quietly put the wrong number into the
database. That is the dangerous kind, because everything downstream then looks perfectly
consistent and is simply wrong.

---

## The bugs

> **Update, same day: all five bugs below are now FIXED and verified.**
> See "What was fixed" at the bottom.

### 1. Typing the pack size before choosing the unit silently changes your number

**Severity: high. — FIXED**

What happens:

1. Open **Add Product**. The pack unit box starts on **kg**.
2. Type `5` in the pack size (you mean 5 lb). The form reads "Total: 5 kg".
3. Now change the unit to **lb**.
4. Your `5` has silently become **11.023113**.

So a 5 lb bag of mozzarella at $18.00 gets stored as 11.02 lb, and the price per pound comes
out as **$1.63 instead of $3.60**. That ingredient is then costed at less than half what it
really costs, in every recipe and every menu item above it.

Why it happens: the form treats a unit change as "same amount, expressed differently" — 5 kg
really is 11.02 lb. That is the right behaviour when you are *editing* an existing entry.
It is the wrong behaviour on a brand-new blank entry, where the number you typed was never
"kg" in the first place — you just hadn't got to the unit box yet.

Worth knowing: typing the number *after* choosing the unit is fine. And oddly, changing the
unit with the keyboard (arrow keys) doesn't trigger it, only the mouse. So two people doing
what looks like the same thing get different results.

**Suggested fix:** don't convert when the entry is new and unsaved. Only convert when
changing the unit on an entry that has already been saved.

---

### 2. A new product inherits the previous product's stocking unit

**Severity: high. — FIXED**

When you add several products one after another, the **Add Product** form does not reset the
pack unit — it keeps whatever the last product used. If your next product uses a unit that
can't be converted from that leftover (e.g. last one was `each`, this one is `L`), you get
this popup:

> "Cannot convert **each** to **L** automatically. Keep the same price with the new unit?"

on a **brand-new product that has no entries at all** — there is nothing to convert, so the
question is meaningless. And until you answer it, the product's stocking unit never updates.
Save still works, so the product is stored with the *previous* product's unit.

Out of my 20 products, **5 were stored with the wrong stocking unit**:

| Product | Bought in | Stored as | Which is the unit of… |
|---|---|---|---|
| Extra Virgin Olive Oil | 5 L | lb | the previous product (Basil) |
| Fine Sea Salt | 1 kg | L | the previous product (Olive Oil) |
| Eggs | 30 each | kg | the previous product (Pecorino) |
| Mascarpone | 1 kg | each | the previous product (Eggs) |
| Coca-Cola 330ml | 24 each | kg | the previous product (Caster Sugar) |

The other 15 were only right because the unit happened to match the one before it.

I checked carefully that this was not my automation going too fast — I redid it with
one-and-a-half second pauses between every step and got the same result.

**Suggested fix:** two things. Reset the pack unit when the Add Product form opens, and
don't ask the "cannot convert" question at all when the product is new and has no entries.

---

### 3. Editing a menu item shows an out-of-date cost

**Severity: medium-high. — FIXED**

The finished products *list* correctly shows live costs. The *edit form* for the same item
does not. I saw both numbers on screen at the same time:

- The card on the right: **Pizza Margherita — Cost: $1.92**
- The edit form on the left: **Total Cost $1.84**

Same product, same screen, 8 cents apart. The $1.92 is correct.

The gap is exactly the flour price rise I had just entered. The list works out the recipe
cost fresh from current prices; the edit form uses the recipe's *last saved* cost instead,
which was from before the price went up.

Two consequences. A customer opening a menu item to tweak it sees a lower food cost than the
list showed them a second ago, and won't know which to believe. And if they then press Save,
the stale figure gets written into the product.

**Suggested fix:** have the edit form work out recipe costs the same way the list does,
rather than reading the recipe's saved total.

---

### 4. Recipe cost per gram always shows "$0.00"

**Severity: low, but it looks broken. — FIXED**

Any recipe with a yield in grams shows its unit cost as **$0.00 / g**, because the real
figure is fractions of a cent and it's rounded to two decimal places.

| Recipe | Total | Shows as |
|---|---|---|
| Pizza Dough | $3.21 | $0.00 / g |
| Tomato Sauce | $5.71 | $0.00 / g |

It reads as "this is free". Same on the menu-item screen, where ingredient lines show
"$0.00 / g". **Suggested fix:** show more decimal places for small figures, or show the cost
per 100 g / per kg instead.

---

### 5. "Add to Inventory?" prompt appears on a plan with no inventory

**Severity: low. — FIXED**

After saving a supplier entry, an "Add to Inventory?" box pops up — but
this is an Essential restaurant, where the Inventory page is a "please upgrade" panel. It is
offering something the customer can't use. (I gather this one is already on your list.)

---

## What I checked, and what was correct

Every number below I worked out by hand first, then compared with the app. **All matched.**

### Ingredient prices — the unit conversions

| Ingredient | Bought as | Works out at | App showed |
|---|---|---|---|
| Mozzarella | 5 lb for $18.00 | $3.60 / lb | $3.60 / lb ✓ |
| Fresh Basil | 1 lb for $12.00 | $12.00 / lb | $12.00 / lb ✓ |
| Guanciale | 16 oz for $9.60 | $0.60 / oz | $0.60 / oz ✓ |
| Olive Oil | 5 L for $46.00 | $9.20 / L | $9.20 / L ✓ |
| Espresso Beans | 2 lb for $15.00 | $7.50 / lb | $7.50 / lb ✓ |
| Eggs | 30 for $9.00 | $0.30 each | $0.30 each ✓ |

### Recipes — bought in one unit, used in another

| Recipe | My calculation | App | What it tests |
|---|---|---|---|
| Pizza Dough | $2.4060 | $2.41 ✓ | oil bought in L, used in ml |
| Tomato Sauce | $5.7097 | $5.71 ✓ | basil bought in lb, used in g |
| Carbonara Sauce | $15.6658 | $15.67 ✓ | guanciale bought in oz, used in g |
| Tiramisu Base | $12.5581 | $12.56 ✓ | coffee bought in lb, used in g |

Line by line inside Carbonara Sauce — all exact:
Pecorino 200 g = $4.80, Eggs 8 = $2.40, Guanciale 400 g = **$8.47** (my figure $8.4658).

### Menu items

| Menu item | My calculation | App |
|---|---|---|
| Pizza Margherita | $1.4451 | $1.45 ✓ |
| Pizza Pepperoni | $2.3054 | $2.31 ✓ |
| Spaghetti Carbonara | $3.2938 | $3.29 ✓ |
| Spaghetti Pomodoro | $0.9499 | $0.95 ✓ |
| Tiramisu Slice | $1.6078 | $1.61 ✓ |
| Espresso | $0.1323 | $0.13 ✓ |
| Coca-Cola 330ml | $0.6000 | $0.60 ✓ |
| Still Water 500ml | $0.4000 | $0.40 ✓ |
| Peroni 330ml | $1.4000 | $1.40 ✓ |

Drinks are worth calling out separately: they go straight from ingredient to menu item with
no recipe in between, which is a different path through the code. All three were correct.

### Prices moving on their own

I raised two supplier prices partway through, as a real delivery would:

- **Mozzarella** $18.00 → $27.00 per 5 lb. Margherita went $1.45 → **$1.84**, Pepperoni
  $2.31 → **$2.74**. Both exactly what I calculated.
- **Flour** $32.50 → $45.50 per 25 kg — this one sits *inside* a recipe. Pizza Dough went
  $2.41 → **$3.21**, Margherita → **$1.92**, Pepperoni → **$2.82**. All exact.

So a price rise reaches the menu on its own, through two levels, with nobody touching
anything. That is the part I most expected to find broken, and it is solid.

---

## Two notes on how I ran the test

- **I left water out of the pizza dough.** Water would be a $0 ingredient, and a zero cost
  looks identical to "couldn't work this out" — it would have muddied the very thing I was
  testing. Worth thinking about separately: a real dough recipe is about 60% water, and
  right now there is no sensible way to record it.
- **I corrected those 5 wrong stocking units by hand** before testing the recipes, so bug 2
  wouldn't contaminate the costing results. The costing figures above are all from correct
  data.

---

## What was fixed

Bugs 1 and 2 are done. Both changes are in `public/static/products.js`.

**The Add Product form now resets the pack unit.** It never used to, which is why each new
product inherited the last one's unit. (The Add *Supplier Entry* form already did this — this
form was simply missing it.)

**Changing the unit no longer rewrites a pack size that was only just typed.** The old code
treated every unit change as "same amount, different unit". That is correct when you are
editing an entry that has already been saved — 35 lb really is 15.876 kg — but wrong on a
number typed seconds ago before you reached the unit box. It now converts only when editing
a saved entry.

That second change also clears the nonsense popup from bug 2: with nothing to convert on a
brand-new product, the "cannot convert each to L" question is never asked, so it can no
longer block the stocking unit from updating.

**Deliberately left alone:** when you change the unit on a product that already has supplier
entries, all of those entries still get converted so they stay in one unit. Only the pack
size you are actively typing is protected.

### How it was checked

**Automated** — `tests/pack-unit-change.test.mjs`, 20 checks against the real shipped file.
Run with `npm test`. Confirmed the tests genuinely catch the bugs by running them against the
old code first: 12 failed, including "got 11.023113" and the exact pattern of products
inheriting the wrong unit. Whole suite: 19 files, all passing.

**By hand in the local app** — repeated the two failing sequences:

| Check | Before | After |
|---|---|---|
| Type `5`, then pick lb | 11.023113 lb, $1.63/lb | **5 lb, $3.60/lb** |
| Six products in a row, mixed units | 5 of 20 stored under the wrong unit | **all 6 correct** |
| Edit a saved 1 lb entry, change to kg | 0.453592 kg, $26.46/kg | **unchanged — still converts** |

That last row matters as much as the others: it confirms the fix didn't go too far and break
the case where converting is the right thing to do.

---

## What was fixed — bugs 3, 4 and 5

**Bug 3 — the edit form now costs recipes the same way the list does.** The list has always
worked costs out fresh from today's prices. The form was reading the recipe's last-saved
total, which is why one screen showed two different numbers. Both now say $1.92.

The saved total is kept as a fallback for one case only: a recipe the app hasn't finished
loading yet. Falling back to a slightly old number beats showing $0.00 while the page loads.

**Bug 4 — small prices are now quoted in a bigger unit.** Grams are priced per kg,
millilitres per litre. Pizza Dough reads **$1.28 / kg** instead of "$0.00 / g". Your yields
and quantities are untouched — only the price label changes.

Done for *every* gram recipe, not just the ones that would round to zero. A cut-off would
have quoted Pizza Dough per kg and Carbonara Sauce per gram in neighbouring rows of the same
list — two numbers a thousandfold apart in a column that looks like it holds one kind of
figure. Worse than the original problem.

**Bug 5 — the "Add to Inventory?" prompt no longer appears on Essential.** It still appears
on Pro, where the stock screens actually exist.

Worth saying why it's hidden rather than "recorded quietly in the background", which was the
tempting alternative: on an Essential restaurant **nothing ever takes stock away** — no sales
import, no stock take, and Produce Batch is hidden too. A stock count there could only ever
grow. If that customer later upgraded, they'd inherit a badly overstated count they'd have to
unpick by hand. Starting from empty is kinder.

### How these were checked

**Automated** — two new test files plus additions to an existing one:

- `tests/fp-form-live-cost.test.mjs` — 6 checks. Run against the old code first: 4 failed.
- `tests/unit-cost-display.test.mjs` — 23 checks, including that every gram recipe ends up in
  the same unit, and that the label never says "per g" over a per-kg number.
- `tests/account-type-gating.test.mjs` — 5 more checks pinning who sees the inventory prompt.

Whole suite: **21 files, all passing.**

**By hand in the local app:**

| Check | Before | After |
|---|---|---|
| Recipe list | Pizza Dough "$0.00 / g" | **"$1.28 / kg"** |
| Menu item ingredient lines | "$0.01 / ml", "$0.03 / g" | **"$9.20 / L", "$26.46 / kg"** |
| Margherita: card vs edit form | $1.92 vs **$1.84** | **$1.92 vs $1.92** |
| Save a supplier entry (Essential) | "Add to Inventory?" pops up | **no prompt** |
| Same on Pro | prompt appears | **prompt still appears** |

That last row matters for the same reason as the saved-entry check in bugs 1–2: it proves
the fix didn't go too far and remove something Pro customers need.

---

## What's left

1. **Water in recipes** — not a bug, but there's currently no sensible way to record an
   ingredient that costs nothing, and a dough recipe is mostly water.
2. **Check your live data.** All five fixes stop new damage. They don't repair products
   already saved wrong by bugs 1 and 2 before the fix existed. Worth a read-only look at the
   live database before assuming everything is clean.
