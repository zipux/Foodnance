# Invoice Reading — Feedback

*Tested: 19 July 2026 · Live site: webapp-g5y.pages.dev/upload-invoice*

## What I did

I acted as a real user and uploaded invoices through the Upload Invoice page,
then checked what the AI actually read back against invoices I made myself (so I
knew the correct answer for every field). I used three different invoices on
purpose, so the test wasn't just one lucky layout:

1. A UK food wholesaler (clean PDF) — tricky pack sizes, a per-kg meat line, a
   discount, and mixed 0% / 20% VAT.
2. A US distributor (dollars, different look) — a brand column, a bottle
   deposit, a fuel surcharge, sales tax, and a damaged-goods return/credit.
3. A UK caterer spread over **two pages** — to see if it handles multi-page
   invoices.

That's 20 line items in total across the three.

## The headline

**The reading is genuinely very good.** Once the AI key was working again, it got
essentially everything right that matters:

- Supplier name, invoice number, date, and the final total — correct every time.
- Every quantity, price, and line total — correct on all 20 items.
- Every product code and brand — correct.
- All three invoices added up to the exact penny.

Some things it did better than I expected:

- **US dates didn't trip it up.** It read `07/16/2026` as 16 July, not the other
  way around — a mistake that's easy to make and expensive to get wrong.
- **It was smart about the damaged-goods return.** Instead of adding a fake
  "-£12.40 product" to the list, it correctly treated it as a credit. That's
  exactly what a person would do.
- **Two-page invoice: no problem.** It knew it was "page 2 of 2", pulled the
  items off both pages, and didn't warn about a missing page.
- **Deposits, surcharges and tax** were each put in the right box.

## The one thing worth fixing

**Pack sizes lose the "case count".**

When an invoice says something like "6 x 1 litre" or "24 x 330ml", the system
often stores just the inner size — "1L" or "330ml" — and drops the "how many in
the case" part. And it's inconsistent: on the same invoice it kept "4/1 GAL" for
milk but dropped the "6 x" from "6 x 2.5kg" chickpeas.

Why this matters for *this* app specifically: your costing and inventory are
built around pack size. If a case of 6 one-litre bottles of olive oil costs
£41.94, but the system stores the size as just "1 litre", it can look like one
litre of olive oil costs £41.94 instead of about £7. The full "6 x 1 litre" text
*is* still saved in the background, so nothing is truly lost — but the tidy field
a person reviews doesn't show it, so they'd have to fix it by hand.

This isn't the AI misreading anything — it's doing what the instructions tell it
to. It's a decision about what to keep, and I'd suggest changing it so the full
"6 x 1L" is always kept.

## A smaller thing for later

The tax fields are named for Canada (GST / PST). It all still adds up correctly,
but the US invoice's "sales tax" ended up in the box labelled "PST", which reads
oddly. If you plan to sell this to businesses in different countries, renaming
those to something neutral (e.g. "Tax 1" / "Tax 2") would avoid confusion.

## Bottom line

The invoice reader is accurate and trustworthy on the core numbers — I'd be
comfortable relying on it. Two things to tidy up: (1) keep the full pack size
including the case count, and (2) rename the tax fields before selling abroad.

---

### Footnote: the outage I found first

On the first attempt every upload failed with "API key is invalid" — the live
site's AI key had expired, so invoice reading was completely down. That's since
been fixed (key rotated and redeployed) and everything above was tested on the
working site. Two related suggestions came out of it:

- The green **"AI ready"** badge only checks that a key *exists*, not that it
  *works* — so it showed "ready" while reading was actually broken. A real
  check would be more honest.
- When reading fails, the error is a small message that disappears on its own.
  For a total failure it'd be better to show a message that stays put and
  explains what to do.
