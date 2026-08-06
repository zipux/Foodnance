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

---
---

# Second test report — cocktail bar, mixed units and drinks

**Date:** 6 August 2026
**Account tested:** "Testa Bar & Kitchen" — Pro plan, restaurant type, local dev only
(nothing was written to production)
**What I was checking:** recipes and menu items again, but this time aimed squarely at
**mixing units of quantity** and at **drinks** — spirits bought by the case and poured by
the millilitre, mixers bought by the case and sold by the bottle, a syrup batch measured
in litres and used in tens of millilitres.

Built through the real screens: 22 ingredients, 6 recipes, 9 menu items. Every figure
worked out by hand first, then compared.

---

## Short version

**The costing maths is right again — 13 of 15 exact.** Spirits by the millilitre, mixers by
the bottle, a batch syrup priced per litre and drawn on in millilitres, fractional garnishes
(⅛ of a lemon), a recipe measured in portions inside a burger — all matched to the penny.
The price-rise flow still works: I raised gin and mint mid-test and the drinks followed on
their own, through two levels, with nobody re-saving anything.

**The two that failed both failed the same way, and it is a bad one.** When the recipe form
can't convert a unit, it refuses the switch and then **charges the quantity at 1×** instead
of marking the line uncostable. A latte with 180 ml of milk came out at **$898.70**. This is
not specific to gallons: a product bought by the **case** — a unit that ships in your own
picker — does the same thing, and I got a $6,000 napkin line out of it without touching the
invoice reader.

I also found that three of the fixes from the last round only landed on two screens out of
three. The **detail modal** — the pop-up you get from clicking a card — still shows the old
"$0.00 / g" behaviour and still drops the "can't cost this" warning.

---

## The bugs

### 1. A unit the recipe form can't convert is charged at 1× instead of refused

**Severity: critical.**

> **This is not "the app can't read gallons".** Not knowing `gal` is a missing row in a
> lookup table, and on its own it would be harmless — the app already has the right
> answer for a conversion it can't make: it marks the line **⚠ n/a** and warns before
> saving (it did exactly that for vanilla pods, below). The bug is what happens
> *instead*: the unit switch is refused, and then the quantity is charged at the pack
> unit, 1 for 1. **Gallons are just the case that multiplies by 3,785.** See "It isn't
> only gallons" at the end — `case` does the same thing, and `case` is in your picker.

What happens:

1. Add Whole Milk, bought as **2 gal for $9.98** ($4.99/gal — correct so far).
2. Put it in a recipe or a menu item. Pick the unit **ml** and type **180**.
3. The unit box refuses: *"Cannot convert gal to ml — unit reset."*
4. The box now reads **kg**.
5. The line is saved as **180 gal**, and charged at **$898.20**.

A latte of one shot and 180 ml of milk should cost **$0.74**. The app says **$898.70**, a
margin of **−19,871%**. An iced coffee base with 600 ml of milk should be **$2.47**; the app
says **$2,995.68**.

Three separate things are wrong here and each would be worth fixing alone:

- **The dropdown shows a unit the line is not costed in.** `gal` isn't in the unit list, so
  the box falls through to the first option — `kg` — while the line is actually being costed
  in `gal`. The screen and the database disagree, on screen, at the moment of saving.
- **The conversion is refused and then done anyway at a factor of 1.** Your code says in
  several places that an unbridgeable unit must be *uncostable*, never a silent number.
  Here it's neither: the switch is blocked, then 180 is charged as 180 gallons. That is the
  silent factor of 1 the comments warn against.
- **Nothing flags it.** No red line, no ⚠, no "can't convert". The recipe card, the detail
  modal, the edit form and the database all confidently agree on $898.70.

**It isn't only gallons — and it doesn't need an invoice.** I re-ran the same sequence with
two other pack units, on products with no sub-unit to rescue them. Both times I asked for
**200 each**:

| Product | Bought as | Dropdown showed | Costed in | Charged |
|---|---|---|---|---|
| Napkins | 1 **case** @ $30.00 | `case` | `case` | **$6,000.00** |
| Straws | 12 **ct** @ $18.00 | `gal` *(first item in the list)* | `ct` | **$300.00** |

**`case` is in your own picker.** No AI, no invoice import, no US supplier — a customer adds
"Napkins, 1 case, $30", puts 200 in a recipe, and gets a $6,000 line. That makes this an
everyday path, not an import edge case.

The two failures are separable, and worth treating as such:

- **Charging 1× for a refused conversion** hits *any* unit the two form-level tables don't
  know: `case`, `ct`, `cs`, `pk`, `gal`. This is the one that produces the wrong number.
- **The dropdown showing the wrong unit** only hits units missing from the *picker* list
  (`gal`, `ct`). The box shows whatever happens to sit first in the list — it read `kg` for
  milk, and `gal` for straws once I'd added `gal` to the list, which is the clearest proof
  it isn't reading the product at all. This is the one that stops anybody noticing.

Gallons combine both, which is why the latte landed at $898.70 with nothing on screen
looking wrong.

**Import makes it worse, not different.** `parsePackSize` in `src/index.ts` explicitly
matches `gal`, and the earlier invoice test (`Feedback/feedback.md`, 19 July) recorded the
reader keeping **"4/1 GAL"** for milk. Pattern 3 also passes any trailing text through as a
unit, so `CT`, `CS` and `PK` arrive the same way — created by the app, never chosen by anyone.

**The customer cannot get themselves out of it.** I tried the obvious thing: added `gal`
through Manage Units. That fixes the *display* — the box now honestly reads `gal` — but the
switch to `ml` is **still blocked**, so there is no way to express milk in millilitres from
the recipe screen at all. The only escape is going back to the Products page and re-typing
the pack unit the invoice actually said.

**Root cause, and it's one thing:** there are **five** hand-synced unit tables, not the three
`CLAUDE.md` names.

| Table | Knows `gal`? | Knows `case`? |
|---|---|---|
| `UNIT_FACTORS` — `src/index.ts` | yes | no |
| `_INV_UNIT_FACTORS` — `utils.js` | yes | no |
| `_VOLUME_ML` / `_WEIGHT_KG` — `recipes.js` | **no** | no |
| `_FP_VOLUME_ML` / `_FP_WEIGHT_KG` — `finished-products.js` | **no** | no |
| `DEFAULT_UNITS` — the picker | **no** | yes |

The two form-level copies are the ones that block the switch, and they're the two that don't
know `gal`. (They also carry `lb = 0.453592` where the other two carry `0.45359237` — too
small to show at two decimal places today, but it's drift in the same place.)

**Suggested fix, in the order that matters:**

1. **A refused conversion must make the line uncostable**, never charge it at 1×. You already
   have this behaviour and it works — vanilla pods showed **⚠ n/a** and warned before saving.
   It just isn't reached when the two units are flatly incompatible rather than missing a
   bridge. This alone turns every case above from a wrong number into a visible refusal.
2. **The dropdown must never display a unit other than the one being costed in.** If the
   product's pack unit isn't in the list, add it to the list rather than showing item one.
3. Delete the two form-level unit tables; have `recipes.js` and `finished-products.js` call
   `invConvertQty` / `invConvertUnitCost` from `utils.js`, which already knows `gal`. Add
   `gal` to `DEFAULT_UNITS` while you're there.

Note that 1 and 2 fix the damage; 3 is the tidy-up that stops it coming back. Doing only 3
would fix gallons and leave `case` charging $6,000.

**Worth a look at live data:** search `product_entries` for any `pack_unit` outside
`kg/g/lb/oz/ml/L/fl oz`, then check whether those products appear in `recipe_items` or
`finished_product_items` with a quantity that looks like it was meant to be a smaller unit.

---

### 2. The "priced from your most recent invoice" note fires on almost everything

**Severity: medium.**

Every drink containing tonic water showed the note:

> Priced from your most recent invoice. Record stock usage — import sales or complete a
> stock take — and costs will follow the batch you are actually using.

Tonic water has **exactly one** delivery on file. There's no batch to be ambiguous about,
and the note explicitly asks the customer to fix something that isn't broken.

Why: tonic is bought by the **case**, and `case` isn't a unit the converter knows. So
`fifoActiveEntryWithBasis` can't place the delivery on a common axis, finds nothing usable,
and falls back to "latest invoice". One such ingredient is enough to label the whole drink,
so the note spreads across the menu.

The function already handles the neighbouring case correctly — a single delivery reports as
FIFO precisely so it doesn't "raise a note about nothing" — but that check happens *after*
the no-usable-entries branch, so a single unconvertible delivery skips it.

This matters because the note is the app's honesty mechanism. If it appears on every drink
on the menu, customers learn to scroll past it, and then it can't do its job on the account
where FIFO genuinely is anchored to a stale invoice.

**Suggested fix:** when there's only one delivery, report FIFO regardless of whether it could
be converted — same reasoning as the existing shortcut, just checked earlier.

---

### 3. The detail modal never got the last round's fixes

**Severity: medium.**

Clicking a card opens a detail pop-up. It's the third screen showing the same numbers, and
it missed two of the five fixes from 5 August.

**Bug 4 is still live there.** The card and the edit form both quote small prices in a bigger
unit; the modal still divides raw:

| Recipe | Card | Edit form | **Detail modal** |
|---|---|---|---|
| Cocoa Base (90 g yield) | $4.83 / kg | Cost per kg $4.83 | **Cost per g $0.00** |
| Mojito Mix (500 ml yield) | $8.17 / L | Cost per L $8.17 | **Cost per ml $0.01** |
| Vanilla Cream (500 ml yield) | $3.49 / L | Cost per L $3.48 | **Cost per ml $0.00** |

Three screens, one recipe, one click apart. `renderRecipeDetail` prints
`fmt(totalCost / yieldQty)` with the raw yield label; the card uses `fmtUnitCost` and the
form uses `scalePriceUnit`. It just needs the same helper.

**The "can't be costed" ⚠ is dropped there too**, on both pages:

| Screen | Vanilla Cream (has an uncostable ingredient) | Affogato (uses that recipe) |
|---|---|---|
| List card | $1.74 **⚠** | $0.97 **⚠** |
| Detail modal | $1.74 | $0.97 |
| Edit form | $1.74 **⚠** | $0.97 |

Credit where it's due: inside the modal, the *ingredient line* itself reads **"⚠ n/a"**,
which is exactly right and clearer than anything else on the screen. It's only the total
that loses the flag.

The Affogato edit-form gap is a slightly different thing and worth its own line: a menu item
inherits its recipe's uncostable-ness. The list knows this (the shared cost index carries the
flag up); the finished-product form only looks at its own lines, sees a number come back
from the recipe, and reports a clean total.

---

### 4. Two screens round the same number differently

**Severity: cosmetic.**

Vanilla Cream's cost per litre is $3.485. The card says **$3.49**, the edit form says
**$3.48**. Same figure, two arithmetic paths, opposite rounding. Nobody loses money over it,
but it's the kind of penny gap that makes someone stop trusting the screen.

---

## What I checked, and what was correct

All worked out by hand first. **13 of 15 matched exactly.**

### Ingredient prices — the awkward buys

| Ingredient | Bought as | Works out at | App |
|---|---|---|---|
| London Dry Gin | 6 × 700 ml for $138.00 | $32.857143 / L | ✓ |
| Tonic Water | case of 24 × 200 ml for $21.60 | $0.90 / bottle | ✓ |
| Prosecco | 6 × 750 ml for $71.70 | $15.933333 / L | ✓ |
| Dark Rum | 3 × 1 L for $70.50 | $23.50 / L | ✓ |
| Butter | 5 lb for $16.50 | $7.28 / kg | ✓ |
| Cheddar | 2.27 kg for $18.16 | $8.00 / kg | ✓ |

The first four are the drinks pattern that matters: **the price on the invoice is a line
total for a case, not the price of one bottle.** Every one divided correctly by pack size ×
quantity ordered.

### Recipes — bought in one unit, used in another

| Recipe | My figure | App | What it tests |
|---|---|---|---|
| Simple Syrup (1.2 L) | $1.0000 | $1.00 ✓ | sugar bought in kg, used in g |
| Mojito Mix (500 ml) | $4.0875 | $4.09 ✓ | mint in g, lemons by the each, sugar kg→g |
| Vanilla Cream (500 ml) | $1.7425 | $1.74 ⚠ ✓ | cream L→ml, **plus one deliberately uncostable line** |
| Burger Patty Mix (8 each) | $10.7276 | $10.73 ✓ | mince in lb, butter lb→g, cheese kg→g |
| Cocoa Base (90 g) | $0.4350 | $0.43 ✓ | a recipe yielding grams |
| Iced Coffee Base (1 L) | $2.4709 | **$2995.68** ✗ | milk bought in gal — bug 1 |

Vanilla Cream is the one I'd single out as *correct behaviour worth keeping*. I put vanilla
pods (bought by the each, no average weight) into it measured in grams — a bridge the app
genuinely cannot make. It refused properly: the line reads **⚠ n/a**, the total carries ⚠,
and a toast said so before saving. That is exactly the right answer, and it's the behaviour
bug 1 fails to produce.

### Menu items

| Menu item | My figure | App | What it tests |
|---|---|---|---|
| Gin & Tonic | $2.7066 | $2.71 ✓ | gin L→ml, tonic by the bottle, ice kg→g, ⅛ lemon |
| Double Gin & Tonic | $4.4232 | $4.42 ✓ | same, doubled |
| Mojito | $1.9255 | $1.93 ✓ | a batch recipe by the ml + three products |
| Bitter Spritz | $2.9571 | $2.96 ✓ | three spirits L→ml + ⅛ orange |
| Bottled Cola 330ml | $0.8000 | $0.80 ✓ | product straight to menu, no recipe |
| Cheeseburger | $2.0109 | $2.01 ✓ | a recipe measured in **portions** + a bun + cheese |
| Affogato | $0.9733 | $0.97 ✓ | **two** recipes, one in ml and one in g |
| Espresso | $0.5040 | $0.50 ✓ | the simplest path |
| Latte | $0.7413 | **$898.70** ✗ | milk bought in gal — bug 1 |

Three drink paths worth naming separately, because they go through different code:

- **Sub-unit** (tonic): bought as a case, poured as a bottle. $21.60 ÷ 24 = $0.90. Correct.
- **Volume conversion** (gin, rum, prosecco, soda): bought in litres, poured in millilitres.
  Correct every time.
- **Fractional each** (⅛ lemon, ⅛ orange): $0.04375 handled properly, not rounded to zero.

### Prices moving on their own

Raised two prices mid-test, as a delivery would:

- **Gin** $138 → $186 per case ($32.86 → $44.29/L). Double G&T went $4.42 → **$5.57**.
- **Fresh Mint** $4.50 → $7.20 per 100 g — this one sits *inside* the Mojito Mix recipe.
  Mojito Mix went $4.09 → **$5.17**, and Mojito $1.93 → **$2.06**.

Both exact, both with nobody re-saving anything. Two levels, on its own.

### FIFO on a spirit

Then I recorded stock on hand: 8,400 ml of gin bought across two deliveries, 6,000 ml left,
so 2,400 ml poured. The app moved the price **back to the older, cheaper case** — Double G&T
returned to $4.42 — because that's the bottle actually being poured. Correct, and it's the
behaviour that makes the whole derived-cost design worth having.

*(This is also where bug 2 showed up: gin was correctly on FIFO by then, but the drink still
carried the "priced from your most recent invoice" note, because of the tonic.)*

---

## How I ran it

Playwright against `npm run dev`, driving the real forms — typing in the pickers, choosing
from the unit dropdowns, pressing Save — so the numbers above are what a person would see.
The 22 ingredients were seeded through the API rather than the Add Product form, since that
form was the subject of the last round and is now covered by `tests/pack-unit-change.test.mjs`.
Recipes and menu items were all built by hand through the UI.

Nothing was written to production. The test account is local only.

## What I'd do first

1. **Bug 1, step 1 only** — make a refused conversion uncostable instead of 1×. It is a small
   change, it is the one that stops wrong numbers reaching the database, and it covers `case`
   as well as `gal`. Everything else in bug 1 can follow at leisure.
2. **Check live data** for `product_entries` whose `pack_unit` the converter doesn't know.
3. **Bug 3** — the detail modal, since it's re-applying two fixes you've already written.
4. Bug 2, then bug 4.
