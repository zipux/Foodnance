# Test report — the invoice upload screen, multipage

**Date:** 5–6 August 2026
**Where:** local dev only, "Napoli Test Pizzeria" (Essential restaurant). Nothing touched production.
**What I was asked to look at:** how invoices are shown *before* pressing Upload & Save, especially multipage ones.

**I did not press Upload & Save at any point.** The account still has **zero** invoices,
nothing was uploaded to storage, and no AI parsing was paid for.

---

## First, something worth knowing about that button

I checked what "Upload & Save" actually does, because it matters for what "before pressing
it" means. **Everything happens on that one press:** the files go to storage, Claude reads
them, and the draft invoice is created. There is no in-between screen.

So the only thing a user sees before committing is the **list of staged pages**. That list is
therefore the whole of their chance to catch a mistake — which makes the issues below more
important than they'd otherwise be.

The good news: the image quality check runs *first*, before anything is uploaded or paid for.
A batch rejected for blurry photos costs nothing but the click.

---

> **Update, 6 August:** all three problems are now **FIXED and verified** — see
> "What was fixed" at the bottom.

## Short version

The staging screen is **mostly very good**. Page numbering, reordering, removing pages, and
the mixed-file-type guard all behave properly. Three real problems, though, and the first one
is the big one.

---

## Problem 1 — a multipage PDF is treated as a single page

**This is the one to fix. — FIXED**

If your supplier sends **one PDF containing 3 pages** — which is the normal way invoices
arrive by email — the screen says:

> ✓ **1 PDF ready — single page**

and labels it **Page 1**.

It is not a single page. I checked with the app's own PDF reader, on the same screen, at the
same moment: it reports **3 pages**, and the document's own text says "Page 1 of 3". So the
app already has the true number and doesn't use it.

I tried a 12-page invoice too. Same thing: **"1 PDF ready — single page."**

**Why it matters, beyond the wrong label.** That count is carried forward, and after you press
the button it produces a warning that is simply false:

> ⚠ "Invoice shows page 1 of 12 but only 1 page uploaded — possible missing page."

All twelve pages *are* there. They're inside the one file. So the customer is told to go
hunting for pages that were never missing. If they see that warning often enough they'll
learn to ignore it — and then it won't work on the day a page really is missing.

**Correction to an earlier draft of this report.** I originally wrote that only page 1 would
be viewable later. That was wrong, and I checked it properly afterwards: a PDF is shown in an
embedded viewer, so all its pages are there to scroll through. The damage was the wrong label
and the false warning — not lost pages.

**Suggested fix:** read the real page count when the file is staged (the app already loads
the PDF reader on this screen), show "1 PDF — 3 pages", and use that number for the
missing-page check rather than the number of files.

---

## Problem 2 — the same file can be added twice, silently — FIXED

Add the same PDF twice and you get:

| | |
|---|---|
| Page 1 | invoice-INV-8842-page1.pdf |
| Page 2 | invoice-INV-8842-page3.pdf |
| Page 3 | **invoice-INV-8842-page1.pdf** ← the same file again |

with a cheerful "✓ 3 PDFs ready — 3 pages will be merged into one invoice". No warning of
any kind.

This is easy to do when you're picking several pages from a folder, which is exactly the
multipage workflow. The consequence is that Claude reads page 1 twice, so its line items are
likely counted twice — the invoice ends up overstated — and you pay for the extra page.

**Suggested fix:** when a file with the same name and size is already in the batch, either
skip it or flag the row. The mixed-file-type warning already on this screen is a good model
for how to say it.

---

## Problem 3 — the "different invoices" safety net doesn't work for photos — FIXED (different approach)

There's a nice check that catches you mixing pages from two different invoices. It shows
which page belongs to which:

> **Different Invoices Detected**
> Page 1: INV-8842 · Page 2: INV-7777 · Page 3: INV-8842
> [Go Back & Fix] [Proceed Anyway]

That works properly — for **PDFs**.

For **photos it never fires at all.** Photo batches go to Claude in a single call, so only one
invoice number ever comes back, and the check needs at least two to compare anything. I
confirmed this: with a photo batch it proceeds silently every time.

Which is the wrong way round. PDFs usually have filenames that make a mix-up obvious. Photos
are `IMG_4471.jpg` — you genuinely cannot tell by looking, and photographing pages off a
counter is exactly when two invoices get shuffled together.

**Suggested fix:** for photo batches, compare the invoice numbers Claude reports per page
(it already reads each page), or ask it to return one number per page.

---

## Smaller things

**You're told a page is "ready" when it will be rejected.** I staged four photos and the bar
said "✓ 4 images ready". All four would have been rejected on submit — three as too blurry,
one as too low resolution. The rejection messages themselves are excellent and tell you
exactly what to do:

> "Resolution too low (64×80px — shortest side 64px, minimum 900px). Please re-scan or
> re-photograph at a higher resolution."

But you only see that *after* pressing the button. The check is fast and runs entirely in the
browser, so it could run as each photo is added and mark the bad ones in the list straight
away. Nothing is wasted today — the check happens before any upload — it's just a slower way
to find out.

**PDF pages all look identical.** Every PDF row shows the same generic red icon, so with 8
pages staged you're relying entirely on filenames to confirm the order. Photos show real
thumbnails and are much easier to check. Rendering page 1 of each PDF as its thumbnail would
make the order verifiable at a glance — which is the point of the screen.

**Small files show "0 KB".** A 167-byte file displays as `0 KB`, which reads like something
went wrong. Worth showing bytes below 1 KB.

---

## What works well

Genuinely — most of it:

- **Page numbering** is by position, and renumbers correctly. Remove the middle of three and
  the third becomes "Page 2" as it should.
- **Reordering works.** I verified the logic by moving row 1 to row 3: pages came out 1, 2, 3
  correctly renumbered. (I could not test dragging with a real mouse — my tools can't
  simulate it — so that specific interaction is unverified rather than working or broken.)
- **Mixed file types are refused clearly**, with the reason and a way out: *"Mixed file types
  are not allowed. Your batch already contains PDF files. Please add only PDF files, or clear
  the batch and start fresh."* The existing batch is left intact.
- **The summary line is good English** — "3 pages will be merged into one invoice" tells you
  exactly what's about to happen, and correctly says "single page" for one file.
- **The quality gate is well judged** — it runs before spending anything, and its messages
  tell you what to do rather than just that something failed.
- **The cross-invoice check** (for PDFs) is a genuinely thoughtful safety net.

---

---

## What was fixed — problems 1 and 2

Both changes are in `public/static/invoice.js`.

**The screen now counts pages, not files.** When a PDF is added, the app reads how many pages
are actually inside it — using the PDF reader already loaded on that page — and shows it:

| | Before | After |
|---|---|---|
| Row label | Page 1 | **Pages 1–3** |
| Row detail | 3 KB | **3 KB · 3 pages** |
| Summary line | 1 PDF ready — single page | **1 PDF ready — 3 pages will be merged into one invoice** |

Page numbers now run across the whole batch, so a 3-page PDF followed by a single-page one
reads "Pages 1–3" then "Page 4".

That real count also feeds the missing-page check, so the false alarm is gone. The check still
fires when a page really is absent — I tested 2 of 3 pages and it correctly said *"only 2
pages uploaded — possible missing page."*

If a PDF can't be read for a page count it quietly counts as 1 and the upload proceeds.
Claude can sometimes read a file the previewer can't, and a labelling detail shouldn't block
an upload.

**The same file can no longer be staged twice.** Add it again and you get:

> "invoice-INV-8842-3pages-in-one-file.pdf" is already in this batch — not added again.

A file counts as the same only if its **name, size and modified-time all match** — which is
what you get picking the same file off disk twice. Deliberately strict: a looser rule risks
silently dropping a page the customer meant to include, and a dropped page is invisible,
whereas a duplicated one shows up as doubled line items and a totals mismatch. I checked that
three genuinely different pages sharing a byte size all still stage.

**Also fixed while in there:** files under 1 KB showed as "0 KB"; they now show bytes.

### How it was checked

**Automated** — `tests/invoice-page-count.test.mjs`, 20 checks against the shipped source,
covering the page arithmetic, the label rule, the summary wording, the missing-page threshold
in both directions, and the duplicate rule including the cases that must NOT be treated as
duplicates. Whole suite: 22 files, all passing.

**By hand in the local app** — re-ran the original failing cases: the 3-page PDF, a 3-page
plus 1-page batch, an exact duplicate, three distinct same-size pages, and a genuinely
missing page. Nothing was uploaded and **Upload & Save was never pressed** — the account still
has zero invoices.

---

---

## What was fixed — problem 3

Not by making photos work like PDFs. By using something the app was already being told and
throwing away.

Most invoices print "Page 1 of 2" on them, and the AI already reads it and reports it. The app
used that for exactly one thing: warning when you uploaded **fewer** pages than the invoice
claims. It never asked the opposite question — **did you upload more pages than this invoice
says it has?**

That question catches the case that actually happens here: two separate one-page dockets
photographed together and merged into one invoice.

| What happened | Invoice says | Uploaded | Result |
|---|---|---|---|
| Two separate dockets photographed together | 1 page | 2 | ⚠️ warns |
| A real 2-page invoice, done properly | 2 pages | 2 | silent |
| A real 2-page invoice plus a stray page | 2 pages | 3 | ⚠️ warns |
| One ordinary single-page invoice | 1 page | 1 | silent |

The wording tells the reviewer what is actually at stake:

> ⚠ Invoice shows page 1 of 1 but 2 pages were uploaded. They are merged into ONE invoice —
> check these are all pages of the same invoice, not two different ones.

**Why this rather than asking the AI for a page-by-page invoice number.** That would catch
more, but it means changing what the AI is asked to return, and it can't be trusted without
spending real money on real invoices to prove it — and if the model attributes a number to the
wrong photo it manufactures false alarms rather than removing them. The page-count check needs
no AI change at all, costs nothing per upload, and works for photos and PDFs alike. If people
ever start routinely photographing four- and five-page invoices, the fuller version is worth
revisiting.

**What it does not catch:** invoices that print no page count, which plenty don't. Silent then,
exactly as before. It's a net that catches a good share, not all. And it warns rather than
blocks — an invoice photographed with its delivery note attached is a legitimate reason to hold
more pages than the count admits.

### How it was checked

This is the part of the app you said you can't afford to get wrong, so it was tested harder
than the rest.

**Automated** — `tests/invoice-page-warnings.test.mjs`, **92 checks**, weighted deliberately
towards the cases that must stay **silent**. A page warning that fires on correct input is how
the earlier bug in this area did its damage: people learn to click past warnings, and then the
real one doesn't work either. So the file pins:

- every combination of claimed pages (1–5) against uploaded pages (1–6);
- that the two warnings can never both fire;
- that no page count printed on the invoice means silence, for six kinds of missing value;
- that a genuinely missing page still warns, in every direction it used to;
- the fallback that reads "page 1 of N" out of the text layer;
- odd inputs — no parse result, zero pages, a 250-page batch, a page count with no page number;
- that the money checks are undisturbed.

Run against the code **without** the fix, 16 of those fail and 76 still pass — the 76 being the
silent and missing-page cases, which is the proof the suite isn't simply "everything warns".

Whole suite: **23 files, all passing.**

**In the browser** — the warning was carried through a real draft invoice and opened in the
actual review screen, where it appears in amber above the parsed data, before Confirm & Save.
The "Add missing page" button is correctly **not** offered, since adding a page is the wrong
remedy for this warning. The test draft was deleted afterwards; the account has zero invoices.

**One honest limit.** I could not run a genuine end-to-end upload on this machine: there's no
Anthropic key in local config, and `npm run dev` has no file-storage binding, so pressing
Upload & Save stops at *"Image Upload Failed — Nothing Saved"* (which is itself correct, and
saved nothing). The parts I could not exercise as one continuous run are the storage upload and
the live AI call — neither of which this change touches. Everything between them was tested
directly.

---

## What I'd do next

The smaller items, of which running the image quality check at staging time is the most
useful — you currently get a green "ready" for photos that will be rejected.

---

## How I tested

Built fixtures by hand so I knew the right answer in advance: a 3-page PDF in one file, the
same invoice split across three single-page PDFs, a 12-page PDF, a page from a different
invoice, three page photos, and one deliberately tiny image. Uploaded them in various
combinations and read what the screen said.

For behaviour that only happens after the button, I called the app's own functions directly
from the browser console with realistic inputs — validation, the invoice-number check, the
image quality gate. That shows what *would* happen without triggering any upload, any parse,
or any save.
