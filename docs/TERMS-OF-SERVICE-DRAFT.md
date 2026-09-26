# Foodnance — Terms of Service (WORKING DRAFT)

> **Status: draft, 2026-08-09. Not legal advice. Not signed, not published, not
> enforceable.** This exists so the app can be built against a known set of
> promises. A lawyer qualified in the governing province must review and rewrite
> this before a single paying customer sees it. Clauses in `[BRACKETS]` are
> decisions only the business can make.
>
> Modelled on what MarginEdge and MarketMan actually publish (researched
> 2026-08-09): disclaim accuracy, cap liability, keep the human-review workflow
> out of the contract entirely. Neither competitor's terms mention invoice review
> or approval at all — describing a service you perform creates a duty to perform
> it.

---

## Part 1 — The draft terms

### 1. Who these terms are between

These Terms of Service ("Terms") are between **Simone Isonni**, a sole
proprietor resident in Japan, doing business as **Foodnance** ("we", "us"), and
the business that subscribes to Foodnance ("Customer", "you").

Foodnance is business software sold to businesses. It is **not** a consumer
product, and you confirm you are subscribing for business purposes. Individuals
who use the Service on your behalf ("Users") do so under your account and under
these Terms; you are responsible for their acts and omissions.

By creating an organization, accepting an invitation, or using the Service, you
agree to these Terms. If you do not agree, do not use the Service.

### 2. What the Service is

Foodnance is a hosted back-office application for food businesses. Depending on
your plan it may include: supplier and product records, automated extraction of
data from invoice documents, recipe and finished-product costing, inventory
tracking, stock takes, import of point-of-sale sales data, profit-and-loss
reporting, staff records and certification tracking, and file storage.

The Service is a **record-keeping and estimation tool**. It is not an accounting
system, a system of record for tax purposes, a payment system, a food-safety
compliance system, or a substitute for professional advice. See section 8.

### 3. Accounts, organizations and roles

Your data lives in an organization. Access is by role, and roles carry different
powers — including, where enabled, the power to approve invoices and thereby
commit purchase data to your records. **You are responsible for deciding which of
your Users hold which role**, and for the consequences of that decision.

You must keep credentials confidential and tell us promptly of any suspected
unauthorized access. You are responsible for all activity under your account.

We may maintain administrative accounts with access to your organization for
support, billing, and operating the Service. See section 6.

### 4. Plans, fees and billing

Plans, included features and usage limits are as described at the time you
subscribe. Feature availability differs by plan; we may change what a plan
includes on **30 days'** notice, but will not remove a materially
significant feature from your current paid term without notice.

**Usage limits.** Some features are metered — for example, automated invoice
extraction is limited per organization per calendar month on lower plans.
Reaching a limit blocks further use of that feature until the next period; it
does not affect data you have already saved.

Fees are billed **monthly, in advance**, in Canadian dollars (CAD). Applicable taxes (e.g. GST/HST
for Canadian customers) are calculated and added at checkout, not included in
the listed price. Late payment may result in suspension under section 12.

**Reseller.** Our order process is conducted by our online reseller
Paddle.com. Paddle.com is the Merchant of Record for all our orders, and it
handles payment, invoicing and sales tax.

**Free trial.** A new subscription starts with a **14-day free trial**. A payment
card is required to start it, but nothing is charged during the trial. If you
cancel before the trial ends you are not charged. If you do not, the first
monthly fee is charged when the trial ends.

**First payment.** If you ask at `billing@foodnance.com` within **7 days** of the
first charge after your trial, and no invoices have been uploaded to your
organization since the trial ended, we will refund that payment in full and close
the account.

**Refunds.** Apart from the first payment as above, fees already paid are
non-refundable. Cancelling stops future billing; it does not unwind the period
you are currently in — you keep full access through the end of it (section 12).
We do not offer refunds for dissatisfaction, non-use, or a decision to switch
products.

**Billing errors are not refund requests.** If we charge you the wrong amount,
charge you twice for the same period, or charge you after a cancellation should
already have taken effect, that is our mistake to fix, not a claim you have to
argue for. Tell us at `billing@foodnance.com` and we will correct the charge —
refund the erroneous amount to the original payment method — within **7
business days**. This is a correction, not an exception to the no-refund rule
above, and it does not require you to show the Service was unsatisfactory.

**Downgrades.** A plan downgrade takes effect at your next billing date; we do
not refund the difference for the period already billed at the higher rate.

> **Updated 2026-09-26:** 14-day trial (card up front) and the first-payment
> refund added, matching the live `public/refund-policy.html`. The Paddle
> wording is Paddle's own suggested text: confirm it against Paddle's current
> guidance when the account is set up.
>
> **Resolved 2026-09-23.** This follows MarginEdge, MarketMan and Meez, who all
> land on the same position: no refund for the period paid, access continues to
> its end, cancellation is forward-only. (WISK is the outlier — a 60-day
> money-back guarantee — but WISK doesn't offer month-to-month billing at all;
> the guarantee substitutes for the cancel-anytime flexibility we already give
> by not locking customers into a quarterly/annual term. Given cancel-anytime,
> a customer's exposure is already capped at one month's fee, so a
> satisfaction-guarantee refund isn't solving a problem this pricing model
> creates.) Monthly billing only, no annual option. Billing-error correction:
> `billing@foodnance.com`, 7 business days.

### 5. Your data, and who is responsible for it

**"Customer Data"** means everything you or your Users put into the Service or
that the Service derives from it: uploaded documents and images, supplier and
product records, prices, quantities, recipes, counts, sales imports, staff
records, and all figures computed from them.

Customer Data is yours. You grant us a licence to host, process, transmit,
display and back it up solely to provide, secure and support the Service, and to
produce aggregated, de-identified statistics that do not identify you or any
individual.

**The content and accuracy of Customer Data are your sole responsibility.** This
applies however the data entered the Service — typed by hand, extracted
automatically from a document, imported from a point-of-sale export, or produced
by any automated feature. **It is solely your responsibility to ensure that data
in the Service is accurate and complete before you rely on it**, including before
you approve an invoice, submit a stock take, price a menu, place an order, pay a
supplier, or file anything with any authority.

You confirm you have the right to upload everything you upload, including
supplier documents and any personal information about your staff, and that you
have any consents required for us to process it.

### 6. Automated processing, and third parties

**Automated extraction is inherently imperfect.** The Service uses artificial
intelligence, optical character recognition and heuristic matching to read
documents and classify data. These technologies **inherently make errors** —
misreading figures, quantities, units, pack sizes, dates and vendor names;
assigning a product to the wrong category; matching a line to the wrong product;
or omitting data entirely. Some errors are arithmetically self-consistent and
will not be flagged by any check the Service performs. **Output of automated
processing is a suggestion for you to verify, never a verified result.**

**Third-party processors.** To provide the Service we send Customer Data to
third-party providers, including Cloudflare (hosting and storage) and
**Anthropic**, an artificial-intelligence provider in the United States to which
the images and text of the invoices and recipes you upload are transmitted so
they can be read. Anything written on those documents, including any personal
information such as a supplier contact's name, is sent with them. We select these
providers with reasonable care and remain responsible for our own obligations,
but we do not control them and give no warranty on their behalf. The current
list of providers is in our Privacy Policy.

**Point-of-sale and other imports.** Where you import data from a third-party
system, the accuracy and completeness of that export is that provider's and your
responsibility, not ours.

### 7. Review features — a convenience, not a verification

> **Kept, 2026-09-26 (Simone): to be discussed further.** Note that no review
> service or auto-approval exists in the app today (checked 2026-09-26), and the
> marketing site says the customer checks the lines themselves.
>
> **⚠️ This is the clause to argue about with the lawyer.** MarginEdge and
> MarketMan say *nothing* on this subject in their terms; they sell human review
> in marketing and help documentation, where it creates no contractual duty. The
> case for including a clause here is that we intend to market a checking step,
> and an explicit disclaimer beats silence next to a marketing claim. The case
> against is that it acknowledges the service exists at all. **A lawyer decides.
> The industry default is to say nothing.**

The Service may present data for review before it is committed to your records,
and may offer a step in which we, or a User you designate, examine extracted data
before approval.

Any such review is a **convenience feature**. It is not an audit, an
verification, an assurance engagement, or a professional opinion. It does not
check that prices charged are correct, that goods were delivered, that a document
is genuine, that an amount is owed, or that you should pay it. **No review we
perform transfers responsibility for the accuracy of Customer Data to us**, and
nothing in these Terms obliges us to review any particular document or to do so
within any period of time. Any turnaround time we describe is a target, not a
commitment.

**Automatic approval.** If you enable automatic approval, documents meeting the
conditions you configure are committed to your records **without review by you or
by us**. You choose those conditions and you accept the consequences of data
committed under them. We may exclude categories of document from automatic
approval at our discretion; we are under no obligation to detect any particular
class of error.

### 8. Estimates, reports, and no professional advice

Costs, margins, valuations and profit-and-loss figures produced by the Service
are **management estimates derived from Customer Data**, calculated by
documented methods with known simplifying assumptions.

You acknowledge in particular that:

- Costs are **computed when displayed, from data current at that moment.** They
  are not frozen at a point in time. Correcting an old invoice, voiding a
  document, or adding new purchase history **can change figures for a period you
  have already reviewed, reported, or acted on.**
- Where units of measure cannot be reconciled, or required data is missing, a
  figure may be shown as unavailable or may exclude the affected item.
- Figures depend on your operational discipline — counts performed, production
  recorded, sales imported. Incomplete operational data produces figures that are
  wrong in ways the Service cannot detect and will not warn you about.

**The Service does not provide accounting, bookkeeping, tax, legal, financial,
employment, or food-safety advice.** Its output is not a financial statement and
is not prepared to any accounting or assurance standard. Do not use it as the
basis of a tax filing, a statutory return, a regulatory submission, or a
financing decision without independent professional verification. Certification
and staff-record features are a reminder aid; **you remain solely responsible for
your regulatory and employment compliance.**

### 9. Acceptable use

You will not: use the Service unlawfully; upload malicious code, or content you
have no right to upload; attempt to access another customer's data; probe,
scan or test the security of the Service other than under a written
authorization from us; reverse engineer or attempt to derive source code, except
to the extent that restriction is unenforceable by law; resell or provide the
Service to a third party except your own affiliated locations; use the Service to
build a competing product; or use automated means to extract data at a volume
that degrades the Service for others.

### 10. Availability

We aim to keep the Service available and will make commercially reasonable
efforts to do so, but the Service is provided without any uptime commitment
unless we have agreed one in writing. It may be unavailable for maintenance,
for reasons attributable to a third-party provider, or for reasons beyond our
reasonable control.

We may modify, add or remove features. We will not knowingly make a change that
destroys Customer Data without notice and a means to export it.

### 11. Security, privacy and retention

We apply commercially reasonable technical and organizational measures to protect
Customer Data, including tenant separation, access controls and encryption in
transit. **No system is perfectly secure and we do not warrant that Customer Data
cannot be accessed by unauthorized means.**

Our handling of personal information is described in our Privacy Policy
(foodnance.com/privacy), which forms part of these Terms. Personal
information about your staff is processed on your instructions and for your
purposes.

**Export and retention.** While your account is active you may ask us for a copy
of your Customer Data by emailing hello@foodnance.com. On termination we retain
Customer Data for **30 days** so you can obtain a copy, after which we may permanently delete
it. Backups may persist for a further period before rotation removes them. We
may retain data longer where the law requires it.

### 12. Suspension, termination and account states

You may cancel at any time, effective at the end of your current billing
period. See section 4 for the refund position.

We may **suspend** your account, restricting it to read-only access, for
non-payment or for breach of section 9. Suspension is reversible; your data is
retained and remains visible to you.

We may **terminate** the relationship for material breach that is not remedied
within **30 days** of notice, for repeated or serious breach of section 9, or if
you become insolvent. On termination access to the Service ends and section 11
retention applies.

We may terminate for convenience on **14 days'** notice with a **full refund of
your most recent monthly payment** — not prorated to the days remaining. Your
data is retained for 30 days after termination so you can obtain a copy
(section 11).

### 13. Intellectual property

We own the Service, its software, design and documentation, and all improvements
to it. You own Customer Data. Feedback you give us may be used freely and without
obligation.

### 14. Warranty disclaimer

**THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE". TO THE MAXIMUM EXTENT
PERMITTED BY LAW WE DISCLAIM ALL WARRANTIES, EXPRESS, IMPLIED, STATUTORY OR
OTHERWISE, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ANY WARRANTY OF ACCURACY, RELIABILITY,
COMPLETENESS OR UNINTERRUPTED OPERATION. WE DO NOT WARRANT THAT THE SERVICE, ITS
REPORTS OR ITS EXTRACTED DATA ARE COMPLETE OR ERROR-FREE.**

Some jurisdictions do not allow the exclusion of certain warranties; to that
extent this section applies only as far as the law permits.

### 15. Limitation of liability

To the maximum extent permitted by law:

Neither party is liable for indirect, incidental, special, consequential or
punitive damages, or for lost profits, lost revenue, lost savings, loss of
goodwill, spoiled or wasted inventory, overpayment to a supplier, mispriced menu
items, or business interruption — **even if advised of the possibility.**

**Our total aggregate liability for all claims arising out of or related to these
Terms or the Service will not exceed one hundred Canadian dollars (CAD $100).**

> **Decided 2026-09-26 (Simone): flat $100.** Flag for the lawyer: the note
> below is why a flat cap is the riskiest choice for enforceability. A
> middle ground, if the lawyer agrees, is "the greater of $100 or the fees paid
> in the preceding 12 months".
>
> **Original note.** MarginEdge caps at a flat **$100**; MarketMan at
> **12 months of fees**. The 12-month formula is the industry standard and far
> more defensible in Canada than a flat $100 against a small vendor. A flat cap
> that is trivially small relative to the fee is the kind of term a court is most
> willing to strike — and if the cap is struck, there is no cap at all.

These limits do not apply to: your obligation to pay fees; either party's
liability for fraud, fraudulent misrepresentation, death or personal injury
caused by negligence; or anything else that cannot be limited by law.

**These limits are a fundamental basis of the bargain** and reflect the price of
the Service. Without them the Service would not be offered at this price.

### 16. Indemnity

You will defend and indemnify us against third-party claims arising from Customer
Data, from your use of the Service in breach of these Terms, or from your
reliance on Service output in dealings with a supplier, employee, customer or
authority.

### 17. Changes to these Terms

We may change these Terms. For material changes we will give at least **30**
days' notice by email or in-app notice. Continuing to use the Service after the
change takes effect means you accept it; if you do not, you may cancel and
receive a full refund of your most recent monthly payment.

### 18. General

**Governing law / courts:** `[OPEN — deferred 2026-09-26 by Simone; pages may go live with this bracketed, lawyer to settle before relying on the Terms. — bigger than a bracket now. The operator is
a Japan resident selling worldwide, starting with Canada. Picking Japanese law
is natural for the seller but unfamiliar and harder to enforce for a Canadian
restaurant customer; picking a Canadian province's law is the opposite trade —
familiar to the customer, but means the sole proprietor is submitting to a
foreign court over their own home law. Neither is free of cross-border
wrinkles, and this is a genuinely different question from the domestic-Canada
version this draft assumed until 2026-09-23. Needs a lawyer who can speak to
both sides, not just a Canadian one.]`
`[Arbitration: worth reconsidering now — unlike the pure-Canada case, a neutral
arbitration seat (e.g. Singapore, or online arbitration) is a common way
solo cross-border sellers avoid asking every customer to sue them in Japan or
asking themselves to be sued in every customer's home country. Still probably
overkill pre-revenue; revisit once sales exist outside Canada.]`

Entire agreement; no assignment by you without consent; we may assign on a sale
of the business; severability; no waiver by delay; notices by email to the
address on the account.

---

## Part 2 — What this draft commits the app to build

This is the reason for drafting now. Each clause above implies something the
software must do, and roughly half of it does not exist today.

| Clause | What the app must actually do | Status today |
|---|---|---|
| §1 acceptance | Record **who** accepted **which version** and **when**, at signup and at each material change | ❌ nothing |
| §3 roles | Roles must genuinely gate approval and destructive actions server-side | ⚠️ roles exist; approval doesn't |
| §4 metering | Usage limits must block cleanly and say so, never fail silently | ✅ invoice cap works this way |
| §5 accuracy is yours | The approval screen must state plainly what is and is not being checked | ❌ |
| §6 AI errors | Disclose that documents are sent to a third-party AI provider — **before** the first upload, not buried | ❌ nothing says this anywhere. **Decided 2026-09-26 (Simone): no upload-screen notice; disclosure goes in the Terms + Privacy Policy, accepted before signup** (the acceptance record, §1, becomes the thing that carries it) |
| §6 processors | Maintain a public sub-processor list | ❌ |
| §7 review | Auto-approval must genuinely bypass both parties, and the rules must be the customer's own configuration, recorded | ❌ designed, unbuilt |
| §7 no duty | Never state a turnaround time in the product that we cannot keep | — |
| §8 estimates | Any figure shown must be able to say what it is derived from; unavailable must never render as `0` | ⚠️ partly — the null-not-zero rule holds |
| §8 retroactivity | **Disclose that historical periods can be re-valued.** Today they silently are | ❌ |
| §11 export | A real data export the customer can run themselves | ❌ does not exist |
| §11 retention | A defined, implemented purge after the retention period | ❌ archive keeps data forever |
| §12 suspend | Read-only suspension, reversible, data visible | ✅ built (`suspended_at`, 402) |
| §12 terminate | Sign-in refused, data retained, then purged | ⚠️ `archived_at` built; purge isn't |
| §14/§15 | The terms must be **linked and readable** before signup completes | ❌ no page, no link |

**Three of these are launch blockers regardless of what the lawyer says:**

1. **Acceptance record.** Terms nobody demonstrably accepted are hard to rely on.
   A `terms_version` + `accepted_at` on the user is a small change and has to
   exist before the first paying customer.
2. **Third-party AI disclosure.** Invoice images leave for an external provider.
   Not saying so is a privacy problem, not a contract problem, and it does not
   wait for a lawyer.
3. **Data export.** §11 promises it and there is no way to do it. Never promise
   an export that isn't built.

**One product change this draft argues for:** §8's retroactive-revaluation
disclosure. The app re-values historical stock takes and costs whenever
underlying data changes. That was accepted deliberately while every account was a
test account. Disclosing it in the terms is honest; the better answer for real
customers is to freeze a valuation when a period is reported.

---

## Part 3 — Decisions only you can make

1. **Legal entity — name answered 2026-09-26: Simone Isonni, doing business as
   Foodnance (no registered trade name).** Earlier, 2026-09-23: Sole proprietorship, operator resident in Japan, selling worldwide
   starting with Canada. Not a Canadian entity at all — §1 updated to say so,
   but §18 (governing law/courts) is now an open cross-border question, not a
   fill-in-the-bracket one. Still need: the trade/registered name to put in
   §1, and whether GST/HST needs collecting (Canada requires non-resident
   vendors of digital services to register once sales to Canadian customers
   cross ~$30,000 CAD over 12 months — below that, nothing to collect yet).
2. **The liability cap — decided 2026-09-26: flat CAD $100** (the draft had recommended 12 months of fees; lawyer to confirm).
3. **Whether §7 exists at all — kept for now (2026-09-26), to discuss.** Include the review disclaimer, or follow the
   industry and say nothing? Lawyer's call, and it depends on how strongly the
   marketing site promises a human check.
4. **Retention period after termination.** Recommend 30 days, then purge.
5. **Refunds — answered 2026-09-23, drafted in §4.** Monthly billing only, tax
   added at checkout, no refund for the period paid, billing errors corrected
   within 7 business days to `billing@foodnance.com`, full refund of the most
   recent payment (not prorated) if Foodnance ends the relationship for
   convenience or changes these Terms in a way you don't accept.
6. **Billing model.** Monthly billing with a 14-day trial, card up front. Processor:
   Paddle, as Merchant of Record (chosen 2026-09-26, not built). As Merchant of
   Record, Paddle collects GST/HST, which likely settles most of #1's tax question;
   confirm the Japanese side with an accountant.

## Part 4 — What a lawyer must fix, not you

- **New as of 2026-09-23 — this is now a cross-border contract, not a domestic
  Canadian one.** The seller is a Japan-resident sole proprietor; customers
  start in Canada and the business intends to sell worldwide. Needs someone
  who can speak to both Japanese and Canadian (and eventually other) law, not
  a Canada-only lawyer:
  - Which country's law and courts govern (§18) — and whether that choice is
    even enforceable against a customer in a different country.
  - Whether Canada's simplified GST/HST regime for non-resident digital-service
    vendors applies once Canadian sales cross the registration threshold, and
    what the Japanese tax/invoicing obligations are for a kojin jigyo selling
    services abroad.
  - Whether selling to consumers vs. businesses matters here — §1 already
    says business-only, but a solo restaurant owner signing up personally is
    exactly the edge case Canadian consumer-protection law tends to worry
    about, now combined with the seller being outside the country entirely.
- Whether the chosen court will enforce §14 and §15 at all, and against whom.
  These are US-style clauses lifted from US competitors.
- Whether any consumer-protection statute (Canadian or Japanese) reaches a
  small restaurant customer despite §1's business-purpose statement.
- Privacy law compliance — PIPEDA and any provincial equivalent, **plus
  Japan's APPI** now that the operator and infrastructure decisions sit with a
  Japan resident — for staff personal information and for cross-border
  transfer to the AI provider.
- Whether §7 creates a duty of care despite saying it doesn't.
- A Privacy Policy. This document assumes one exists; none does.

---

*Draft prepared 2026-08-09. Competitor terms reviewed the same day:
[MarginEdge](https://www.marginedge.com/terms) ·
[MarketMan](https://www.marketman.com/saas-subscription-agreement).
Refund policy (§4) added 2026-09-23 after re-checking
[MarginEdge](https://www.marginedge.com/terms),
[MarketMan](https://www.marketman.com/saas-subscription-agreement),
[Meez](https://www.getmeez.com/terms-of-use) and
[WISK](https://www.wisk.ai/price)'s live pricing/refund pages.*
