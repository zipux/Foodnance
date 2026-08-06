# P&L test report — Canadian restaurant on an Essential plan

**Date:** 6 August 2026
**Account tested:** "Maple & Rye Bistro" — Essential plan, restaurant, local dev only
(nothing was written to production)
**What I was checking:** the P&L tab end to end. I filled in every box on the page, put six
months of invoices behind it, and typed in staff cost the way a Canadian restaurant actually
gets paid — **every two weeks**, so most pay runs land half in one month and half in the next.

---

## Short version

**The maths is right. All of it.**

I worked out every figure by hand first — six months, one at a time, then the six added up
together — and compared. **Every single number matched to the penny.** That includes the
awkward ones: pay runs split across a month end, a bill spread over six months, sales tax
that should be left out, a cancelled invoice that should not count, and an invoice still
sitting in review.

The page also explains itself unusually well. Where a number could mislead, it says so in
plain words rather than leaving you to work it out.

**I found four things worth changing.** None of them make a number wrong. The one I'd fix
first is that you can enter the same payroll twice and nothing warns you — and payroll is
the biggest cost on the page.

---

## What I set up

A realistic six months, March to August 2026:

- **Net sales** typed in month by month, $128,400 up to $181,200 as the summer picks up.
- **26 goods invoices** from four suppliers — food, drinks and non-food supplies — all with
  GST and PST on them, some with delivery and fuel charges, and the drinks ones with bottle
  deposits.
- **18 utility bills** uploaded as expense invoices — hydro, gas, phone.
- **Fixed monthly costs**: rent $8,500, insurance $625, bookkeeping $450, music licence $95.
- **Two bills covering a date range**: a patio licence (May–September) and a hood cleaning
  contract (mid-February to mid-August).
- **A one-off cost in every month** — menu printing, a dishwasher repair, patio furniture,
  and so on.
- **14 biweekly pay periods**, Sunday to Saturday, running from 22 February to 5 September.
  Seven of them straddle a month end. Amounts $18,600 to $24,950 per fortnight, which is
  gross wages plus the employer's CPP/EI and benefits — what the app asks for.

Three deliberate traps, to see whether the app handles them:

- a **cancelled (voided)** food invoice for $6,750 in June,
- an invoice for $4,816 in July **still sitting in review**, not yet closed,
- a line for $1,850 in May left in the **"Other"** category, so it isn't really classified.

---

## The numbers

Every figure below I worked out by hand first. **All matched.**

| Month | Net sales | Food | Drinks | Labour | Net profit — mine | App |
|---|---|---|---|---|---|---|
| March | $128,400.00 | $39,800.00 | $8,900.00 | $41,892.86 | $19,633.07 | ✓ |
| April | $135,900.00 | $42,100.00 | $9,400.00 | $41,878.57 | $24,217.24 | ✓ |
| May | $152,300.00 | $47,200.00 | $10,650.00 | $47,278.57 | $25,676.08 | ✓ |
| June | $168,750.00 | $52,300.00 | $11,800.00 | $49,107.14 | $37,098.08 | ✓ |
| July | $181,200.00 | $56,150.00 | $12,700.00 | $54,585.71 | $37,913.94 | ✓ |
| August | $174,600.00 | $54,100.00 | $12,200.00 | $52,578.57 | $35,754.20 | ✓ |
| **All six** | **$941,150.00** | **$291,650.00** | **$65,650.00** | **$287,321.43** | **$180,292.61** | ✓ |

### Biweekly pay — the part I most expected to break

This is the whole reason for testing with Canadian pay periods. A fortnight that runs from
22 March to 4 April belongs to two different months, and the app has to decide how much of
it goes where. It splits by days, and it got every one right:

| Pay period | Total | Goes to | And to |
|---|---|---|---|
| 22 Feb – 7 Mar | $18,600.00 | March $9,300.00 (7 of 14 days) | *(February)* |
| 22 Mar – 4 Apr | $19,100.00 | March $13,642.86 (10 days) | April $5,457.14 (4 days) |
| 19 Apr – 2 May | $19,800.00 | April $16,971.43 (12 days) | May $2,828.57 (2 days) |
| 31 May – 13 Jun | $22,400.00 | May $1,600.00 (1 day) | June $20,800.00 (13 days) |
| 26 Jul – 8 Aug | $24,600.00 | July $10,542.86 (6 days) | August $14,057.14 (8 days) |
| 23 Aug – 5 Sep | $22,900.00 | August $14,721.43 (9 days) | September $8,178.57 (5 days) |

It also **shows its working on screen** — every split row reads something like
"$14,057.14 of $24,600.00 · 8/14 days". You can check it without a calculator, which is
exactly what someone querying their own payroll needs.

And the total adds up: across all 14 pay runs I entered $304,800 of payroll. The six months
March–August claim $287,321.43 of it — the difference being the February and September ends
of the two pay runs that hang over the edges. Nothing lost, nothing counted twice.

### The bills spread over a date range

The hood cleaning contract is $3,600 covering 15 February to 14 August — 181 days. Each
month got its fair share by days, and the shares add back up to the right total:

| | Days in month | Share |
|---|---|---|
| March | 31 | $616.57 |
| April | 30 | $596.69 |
| May | 31 | $616.57 |
| June | 30 | $596.69 |
| July | 31 | $616.57 |
| August | 14 | $278.45 |

### The three traps

All three handled correctly, and two of them handled *better* than I expected:

- **The cancelled invoice was ignored.** June food came out at $52,300, not $59,050. Right.
- **The invoice still in review was left out of the costs — and the page said so.** It reads:
  *"1 invoice dated in this period is still in review, so its cost is not counted here yet
  (about $4,816.00). Your real profit is lower than the figure below."* That is the honest
  direction to be loud about. A missing cost makes you look more profitable than you are,
  and the page refuses to let that pass quietly.
- **The uncategorised $1,850 was counted as food, and explained.** *"$1,850.00 of this isn't
  categorised yet (it's in Other or blank), so it counts as food. Categorising it may move
  some cost into drinks or supplies."* With a link to go and fix it.

### Tax, deposits and delivery

- **GST and PST were left out entirely** — correct, they aren't a cost to the business.
- **Bottle deposits were left out** — correct, you get them back.
- **Delivery and fuel surcharges were counted**, $192.50 a month, on their own line. Correct,
  those are real money gone.

### Six months added together

Switching from one month to a six-month range does the sensible thing everywhere:

- Sales become **read-only** with "Total of 6 months · open a single month to edit". Good —
  it stops you typing a half-year figure into one month by accident.
- Fixed costs read **"$9,670.00 a month × 6 months = $58,020.00"** rather than just a big
  number. You can see where it came from.
- One-off costs are **listed with the month each belongs to**, and can't be edited from the
  range view.
- Spread bills show the whole-period share: the hood contract as **$3,321.55 of $3,600.00 ·
  167/181 days**.

### Everything else I tried

| Check | Result |
|---|---|
| Empty account, before anything is entered | Every section prompts you for what's missing. Genuinely good. |
| True COGS on Essential | Correctly greyed out, with "True COGS is part of Pro, which adds stock counting." |
| Pro-only nav links on Essential | Sales, Inventory and Staff are hidden. Correct. |
| Naming a cost "Wages" while pay periods exist | Warns: *"Staff cost is being counted twice — remove it from the lists below, or delete the pay periods here."* |
| Typing a negative sales figure | Refused, "Enter a valid sales amount." |
| Pay period ending before it starts | Refused, "End date must be on or after the start date." |
| "To" month before "From" month | Refused, with a clear message. |
| This Month / Last Month / This Quarter / Year to Date buttons | All correct. |
| The ‹ › arrows stepping month by month | Correct. |
| "Copy last month's one-offs" | Worked — "Copied 1 expense from last month." |
| The Home page profit tile | Matches the P&L exactly, to the penny. |

That last one matters more than it sounds. Two screens showing the same month's profit is
exactly the sort of thing that drifts apart, and it hasn't.

---

## What I'd change

### 1. You can enter the same payroll twice and nothing says a word

**This is the one I'd fix.**

I entered the fortnight of 9–22 August twice, by accident at first. Both were accepted. The
result:

| | Before | After the duplicate |
|---|---|---|
| August net profit | $35,754.20 | **$11,954.20** |
| Prime cost | 68% of sales | **82% of sales** |

Nothing on screen flagged it. No warning, no "you already have a pay period covering these
dates". The two rows sit in the list looking identical, and unless you count them you'd
never know. You'd just think August was a terrible month.

Entering payroll every two weeks is repetitive work — 26 times a year, always the same shape
— which is exactly the kind of task where people double-enter. And labour is the single
biggest number on the page, so a duplicate does more damage than a duplicate anywhere else.

What makes this stand out is that **the app already warns about the other way of
double-counting staff cost**. If you name a fixed cost "Wages" while pay periods exist, it
tells you plainly. So the idea is already there — it just doesn't check pay periods against
each other.

**What I'd suggest:** when saving a pay period, check whether its dates overlap one that's
already there. If they do, say so before saving. Overlapping isn't always wrong — someone
might genuinely split kitchen and front-of-house into two rows for the same fortnight — so
a warning you can proceed past is better than a block.

---

### 2. Fixed monthly costs are charged to months before the business existed

Rent, insurance and the rest apply to **every month, forever, including the past**.

So January 2026 — before any sales, any invoices, any staff in this account — shows:

> **Net profit — what you keep: −$9,670.00**

A clean loss, in a month where nothing happened.

This bleeds into the buttons people will actually press. **Year to Date** showed January to
August and quietly carried $28,918.45 of costs from January and February against no sales at
all. The six months I actually built showed $180,292.61 of profit; Year to Date showed
$151,374.16. Both are "right" by the app's own rules, but a customer would reasonably read
the second as the truth and wonder where $29,000 went.

Anyone who signs up mid-year hits this on day one, because their fixed costs get applied
backwards through a year they never used the app for.

**What I'd suggest:** two options, and the first is much cheaper.

- **Cheap:** don't show a month as a loss when it has no sales *and* no invoices — say
  "nothing recorded for this month yet" instead. And leave those months out of Year to Date.
- **Proper:** give fixed costs a start date (and optionally an end date). This also solves
  something you'll need anyway — rent going up, or an insurance policy that starts in June.

---

### 3. Hovering the greyed-out True COGS button gives the wrong reason

On this Essential account, the note under the button correctly says:

> True COGS is part of Pro, which adds stock counting.

But hovering over the button itself says:

> Needs bracketing stock takes

Two different reasons for the same greyed-out button, and the tooltip's one is wrong — doing
stock takes wouldn't help, because Essential can't do them. Small, but it's the kind of thing
that sends someone off trying to fix the wrong problem.

---

### 4. Deleting costs is inconsistent about asking

- Removing a **pay period** or a **spread bill** asks "are you sure?" first.
- Removing a **fixed monthly cost** or a **one-off** deletes straight away, on one click of a
  small × at the end of the row.

Deleting rent by misclicking is at least as annoying as deleting a pay period, and there's no
undo. I'd make them all ask.

**A related small thing:** clicking "Add fixed monthly cost" saves a blank row immediately. If
you click it and then change your mind, you're left with a nameless $0 row sitting in the
list until you notice and delete it. It doesn't affect any total, but it's untidy — better to
save the row once it has a name.

---

## One observation, not a complaint

**"This Quarter" means quarter-to-date.** Pressed on 6 August, it showed July–August, not the
full July–September quarter. That's the sensible reading — you can't report on a month that
hasn't happened — and the heading does say "2 months". Worth knowing rather than worth
changing.

---

## How I ran it

Driven through the real screens with Playwright against a local dev server — typing in the
boxes, choosing dates in the date pickers, pressing the buttons. Every figure was worked out
by hand before it was compared. The invoices behind the COGS numbers were entered directly
rather than uploaded, so that I knew the exact right answer for every food, drinks and
supplies total.

Nothing touched production. The test account is local only.

## What I'd do first

1. **The duplicate pay period warning.** Small change, biggest number on the page.
2. **Fixed costs in months that never happened** — at minimum, stop showing a loss in an
   empty month.
3. The tooltip, then the delete confirmations.

Nothing here needs fixing before the numbers can be trusted. The arithmetic is sound, and
that's the part that would have been expensive to get wrong.
