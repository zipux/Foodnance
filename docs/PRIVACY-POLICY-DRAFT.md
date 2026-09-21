# Foodnance — Privacy Policy (WORKING DRAFT)

> **Status: draft, 2026-09-21. Not legal advice. Not published, not linked from
> anywhere.** Written for Canada only (PIPEDA and the BC *Personal Information
> Protection Act*), as decided. Clauses in `[BRACKETS]` are facts only the business
> can supply or facts that must be verified before publishing. **Do not publish
> until Part 2 is worked through** — several sentences below describe things the
> app does not do yet.
>
> Every statement about what Foodnance does was checked against the code on
> 2026-09-21. Competitor policies (MarginEdge, Restaurant365, xtraCHEF, Nory,
> MarketMan) were read the same day; what we took and left is in Part 3.

---

## Part 1 — The policy text

# Privacy Policy

**Effective date:** `[DATE]`
**Last updated:** `[DATE]`

Foodnance ("**Foodnance**", "**we**", "**us**") is operated by `[LEGAL ENTITY NAME]`,
a `[corporation / sole proprietorship]` in `[PROVINCE]`, Canada, at `[ADDRESS]`.

Foodnance is back-office software for food businesses: it reads supplier invoices,
tracks products, recipes and stock, and reports costs and profit. It is sold to
businesses, not to individuals.

This policy explains what personal information we collect, why, who we share it
with, and what your choices are. **It covers two different situations**, and the
difference matters:

1. **Your own information** — when you visit foodnance.com, contact us, or have a
   Foodnance account (your name, work email, sign-in details). Here we decide why
   and how the information is used, and this policy is our commitment to you.
   (Section 2.)
2. **Information a business puts into Foodnance** — invoices, supplier and product
   records, recipes, sales, and records about the business's own staff. Here the
   *business* decides what goes in and why. We only process it for them, on their
   instructions. (Section 3.)

If you are an employee of a Foodnance customer, see section 3.4.

## 1. Summary

- We collect only what we need to run the service: your name, work email, a
  password we store only as a salted hash, and the business data you choose to put in.
- **We do not sell personal information, and we do not use advertising or
  behavioural-tracking cookies.** We have no analytics or advertising trackers on
  foodnance.com or in the app.
- **Invoice images and text are sent to a third-party AI provider (Anthropic) so
  they can be read.** Section 5 explains this in full. Please don't upload
  documents containing information you don't want processed this way.
- Your data is stored with Cloudflare, and some of it is processed in the United
  States. Section 7.
- You can ask to see, correct or delete your information at any time:
  `privacy@foodnance.com`.

## 2. Your own information (account holders, visitors and people who contact us)

### 2.1 What we collect

**You give it to us:**

| What | When |
|---|---|
| Name and work email address | Your account is created, or you're invited to a team |
| Password | You set one. We store only a salted, one-way hash (PBKDF2-SHA256), never the password itself |
| Business name and type | Your organization is set up |
| Messages and details you send us | You email or otherwise contact us |
| Billing details | `[NOT BUILT — see Part 2. When payments exist: name the processor and say that card numbers are handled by it and never reach our servers.]` |

**Created by using the service:**

| What | Why |
|---|---|
| Your role in the organization (owner, member) and when you last signed in | Access control and account administration |
| A count of failed sign-in attempts | Security — five wrong passwords in a row triggers a password-reset email to the account holder |
| Password-reset and invitation records (we store only a hash of each reset token) | So links work once and expire |
| A log of how many invoices your organization has read with AI, their token counts and cost, and any request refused for being over your plan's limit | Metering your plan limit, billing accuracy and our own costs. It does not contain the documents |

**Collected automatically:** the app itself does not record your IP address,
device or browser details, and has no analytics. Our hosting provider, Cloudflare,
does process IP addresses and request metadata to deliver the site and defend it
against abuse, under its own policy. Your browser also contacts Google Fonts
(Google) and jsDelivr (a content-delivery network) to load fonts and code
libraries, which reveals your IP address to those providers.

### 2.2 Why we use it

- To create and run your account, sign you in, and keep it secure.
- To send **service emails**: invitations, password-reset links, and notices about
  your account. We send these through Resend. They are not marketing.
- To provide support, and to fix and improve the service.
- To bill you `[once billing exists]`.
- To meet legal obligations and to protect our rights.

**We do not send marketing email.** `[If that changes: we will ask for your
express consent first, as Canada's Anti-Spam Legislation (CASL) requires, and
every message will have a working unsubscribe.]`

### 2.3 Your consent

By creating an account, accepting an invitation, or using the service you consent
to the collection, use and disclosure described here. You can withdraw consent at
any time by contacting us, though we may then be unable to provide the service.
Where the law allows us to process information without consent (for example to
comply with a legal demand), we may do so.

### 2.4 Cookies and similar technologies

We use **one essential cookie**, `dm_session`, which keeps you signed in. It is
`HttpOnly` (scripts on the page cannot read it), `Secure` on the live site, and
`SameSite=Lax`, and it lasts 14 days unless you sign out. Foodnance staff who are
authorized to help a customer may also carry a second, internal support cookie
that only applies to their own signed-in session.

The app also keeps one display preference (your chosen profit-and-loss cost
basis) in your browser's local storage.

We use **no analytics, advertising or cross-site tracking cookies**. Because
nothing here tracks you across sites, there's nothing to switch off, and browser
"Do Not Track" settings have no effect on what we do.

## 3. Information a business puts into Foodnance ("Customer Data")

### 3.1 What it is

Whatever a customer or its users upload or type: invoice images and PDFs; supplier,
product and price records; recipes; inventory and stock counts; point-of-sale
sales files; profit-and-loss inputs; and **staff records** — names, roles,
emails, phone numbers, hire dates, and certificates (with uploaded copies).

Most of this is business information. Some is personal information: a supplier
contact's name on an invoice, a delivery driver's signature, a staff member's
phone number or food-safety certificate.

### 3.2 Who is responsible for it

**The customer is responsible for Customer Data and decides what goes in.** We
process it on the customer's behalf, only to provide, secure and support the
service, and to produce aggregated statistics that do not identify any customer
or individual. We do not sell it, use it for advertising, or use it to build
profiles.

Customers are responsible for having the right to upload what they upload,
including any consent or notice their own staff and suppliers are owed.

### 3.3 Access by our staff

Customer Data is separated by organization at every level of the application and
one customer cannot see another's. A small number of authorized Foodnance
operators can access an organization's data to provide support, investigate a
problem, or run the service. `[Say here, once true, that access is logged.]`

### 3.4 If you are an employee or supplier contact of a customer

If your information is in Foodnance because your employer or a business you work
with put it there, **that business, not Foodnance, decides why it is held.**
Please make access, correction and deletion requests to them. If you write to us
instead, we will pass your request to the business and tell you we've done so,
unless the law requires us to answer directly.

## 4. Who we share information with

We do not sell personal information. We share it only with the service providers
below, who may use it only to provide their service to us, and where the law
requires or permits.

| Provider | What for | What they receive | Where |
|---|---|---|---|
| **Cloudflare, Inc.** | Hosting, database and file storage, network delivery and security | All information in the service, including uploaded files | `[VERIFY where D1/R2 data sits — see Part 2]`; requests are handled at edge locations worldwide |
| **Anthropic, PBC** | Reading invoices and recipes, sorting new products into categories (section 5) | Invoice and recipe images and text; product names | United States |
| **Resend** | Delivering service emails | Recipient name and email, and the message (e.g. a reset link) | `[VERIFY]` |
| **Google (Fonts)**, **jsDelivr** | Loading fonts and code libraries in your browser | Your IP address and browser details, from your browser directly | Various |
| `[Payment processor]` | `[Billing — once built]` | | |

We may also disclose information: (a) to comply with a law, court order or lawful
request; (b) to protect the rights, property or safety of Foodnance, our
customers or others; (c) in a merger, acquisition, financing or sale of the
business, subject to confidentiality; and (d) with your consent.

`[Maintain this table as a live sub-processor list. Adding a provider means
updating it and, for material additions, giving customers notice — Terms §6.]`

## 5. Artificial intelligence and your invoices

To turn an uploaded invoice or recipe into structured data, we send its **image
or text** to Anthropic through its API. To suggest a category for a newly
created product, we send the **product names** (not the invoice). That is the
only AI processing we do.

Please know:

- **Invoices can contain personal information** — a contact's name, a signature,
  an address, a phone number. It goes to Anthropic along with everything else on
  the page.
- Under Anthropic's commercial API terms, inputs and outputs are not used to train
  its models `[VERIFY the current wording of Anthropic's commercial terms and its
  API data-retention period on the day this is published, and name the retention
  period here]`.
- We do not use your documents to train any model of our own.
- **AI makes mistakes.** Extracted data is a suggestion for you to check, not a
  verified result — see our Terms of Service. No decision about a person is made
  by AI; it reads figures and text from business documents.

## 6. How long we keep information

- **While your account is active** we keep your account information and Customer
  Data so you can use the service.
- **Invoices, products, stock and recipes are voided or archived, not erased,**
  when you remove them, so your history and reports stay consistent. They remain
  in your account until it closes.
- **When an account closes** we keep its data for **30 days** so it can be
  exported, and then permanently delete it. Copies in backups are removed as the
  backups rotate out `[VERIFY period, e.g. up to 35 days after]`.
- **Password-reset and invitation links** are single-use and expire; used and
  expired records are deleted `[VERIFY — see Part 2]`.
- We may keep information longer where the law requires — for example financial
  records `[VERIFY: 6 years is the CRA baseline for business records]` — or to
  resolve a dispute.
- Emails you send us are kept `[VERIFY: e.g. 2 years]`.

## 7. Where your information is stored, and transfers outside Canada

Foodnance's providers include companies based in the **United States**, and
Cloudflare operates globally. Your information may therefore be **stored or
processed outside Canada — including in the United States — and while there it
may be accessible to courts, law enforcement and national-security authorities of
that country under its laws.** We use contracts with our providers that require
them to protect it and to use it only for our purposes, but we cannot promise that
foreign law will not apply to it. `[If a Canadian storage region is confirmed for
the database and file storage, say so here — see Part 2.]`

## 8. Security

We protect information with measures appropriate to how sensitive it is,
including: encryption of data in transit; one-way hashing of passwords with a
unique salt; sign-in cookies that scripts cannot read; separation of each
customer's data; access controls by role; and single-use, expiring reset and
invitation links.

**No system is perfectly secure**, and we cannot guarantee that information will
never be accessed without authorization. Please choose a strong, unique password
and tell us straight away at `privacy@foodnance.com` if you think your account
has been compromised.

**If a breach of security safeguards creates a real risk of significant harm** to
someone, we will report it to the Office of the Privacy Commissioner of Canada
(and, where applicable, the provincial commissioner), notify affected people, and
notify affected customers, as the law requires. We keep a record of every breach.

## 9. Your rights

Under Canadian privacy law you may ask us to:

- **tell you** what personal information we hold about you, how we use it, and
  who we've shared it with;
- **give you a copy** of it;
- **correct** anything inaccurate;
- **delete** it, where we no longer need it or the law doesn't require us to keep
  it; and
- **withdraw your consent**, subject to legal and contractual limits.

Write to **`privacy@foodnance.com`**. We may need to confirm who you are first. We
respond within **30 days** and will explain if we can't do what you ask (for
instance, because it would reveal someone else's information). Access is free
unless the request is unreasonable, and we'll tell you any cost beforehand.

Your organization's **owner** can also correct team-member details and remove
users from the account inside Foodnance. `[Say "and export Customer Data" once an
export exists — see Part 2.]`

If you're unhappy with our answer, you can complain to us first, and then to the
**Office of the Privacy Commissioner of Canada** (priv.gc.ca)
`[or the Office of the Information and Privacy Commissioner for British Columbia
(oipc.bc.ca), depending on the entity's province — see Part 4]`.

## 10. Children

Foodnance is business software and is **not intended for anyone under 18**. We
don't knowingly collect information from minors. If you think we have, contact us
and we'll delete it.

## 11. Changes to this policy

We'll post any change here and update the "last updated" date. For a **material
change** — a new category of information, a new kind of sharing, or a new
sub-processor that handles Customer Data — we'll notify account owners by email
or in the app at least `[30]` days before it takes effect.

## 12. Contact

**Privacy Officer** — `[NAME OR TITLE]`
`privacy@foodnance.com`
`[LEGAL ENTITY NAME], [ADDRESS], [PROVINCE], Canada`

---

## Part 2 — What has to be true before this is published

Same purpose as Part 2 of the Terms draft: each promise above is a piece of work.
**A privacy policy that describes something the app doesn't do is worse than none**
— it is a representation, and in Canada a misleading one can be a complaint.

| Statement | What must be true | Status today |
|---|---|---|
| §1/§5 AI disclosure | The same disclosure must appear **in the app**, on the upload screen, before the first invoice is sent — not only here. (Terms draft launch blocker #2) | ❌ nothing in the app says it |
| §5 "not used to train" | Confirm the current Anthropic commercial API terms, and the API log retention period, and that we're on those terms rather than a consumer product | ⚠️ unverified — do this on publication day |
| §2.3 consent | Terms + this policy linked from signup and from the owner-invite and accept-invite pages; record who accepted which version and when | ❌ no pages, no links, no acceptance record |
| §2.4 "no analytics" | True today (nothing found in `public/` or `src/`). **Stays true only if nobody adds a tracker** — re-check before every publish of this page | ✅ verified 2026-09-21 |
| §2.1 "no IP logging" | True of application code and D1 tables. Cloudflare logs at its own layer | ✅ |
| §2.4 second cookie | Wording covers the operator "view as organization" cookie. Confirm it's never set for customers | ⚠️ read `VIEW_ORG_COOKIE` path once more |
| §3.3 staff access | "Access is logged" would be good to say and **is not built** — there is no operator-access audit log. Left as a bracket, not a claim | ❌ |
| §6 30-day purge | **Corrected 2026-09-21:** a manual purge *did* exist (`DELETE /api/admin/organizations/:id`, with an admin-screen button) — but it was broken. It 500'd for any org that had ever parsed an invoice or had a staff certificate, leaving the account half-deleted and unretryable. **Fixed and proven** (`npm run test:purge`, `tests/purge-coverage.test.mjs`): atomic, complete, leaves other customers untouched. **Still open:** nothing *triggers* it at 30 days — it's a manual routine. Either keep a habit/reminder of purging closed accounts inside 30 days, or build the scheduled job. The policy sentence stays true only if someone does this | ⚠️ manual — works, needs a routine |
| §6 expired tokens | Nothing deletes used/expired `password_resets` or `invites` rows | ❌ small job |
| §6 "voided, not erased" | True by design. Note it also means a deleted staff member or supplier contact stays in history — see Part 4 | ✅ |
| §7 data location | Find out where D1 and R2 physically live. D1 can be pinned to a location hint; an unpinned database sits wherever Cloudflare picked at creation. If a Canadian option is viable, choosing it is a real selling point to Canadian restaurants | ⚠️ unknown |
| §9 export | "Give you a copy" is promised. **No customer data export exists.** (Terms draft launch blocker #3) | ❌ |
| §9 30-day response | Someone has to actually watch `privacy@foodnance.com` | ❌ mailbox doesn't exist yet |
| §8 breach record | Canadian law requires a breach log kept 24 months. Needs a place to keep it (a doc is enough) | ❌ |
| §4 sub-processors | Publish the table; treat changes as a release step. A silent new provider (e.g. Stripe, an analytics tool) makes this page wrong | ⚠️ |
| Passwords | PBKDF2 at 100,000 iterations is below current guidance (OWASP: 600,000 for SHA-256). The policy names the algorithm but not the count — deliberate, and the iteration count is stored per row so it can be raised | ⚠️ separate job |
| Sessions | A password reset doesn't sign out other devices (stateless cookies). Not a policy claim, but "we keep accounts secure" sits next to it | ⚠️ known limit |

**One thing is a hard blocker for publishing:** the in-app AI notice. The purge
now works but is manual (see the §6 row). Everything else can be a bracket.

## Part 3 — What competitors say, and what we did with it

| | MarginEdge | Restaurant365 | xtraCHEF | Nory | MarketMan |
|---|---|---|---|---|---|
| Last updated | **March 2018** | current | **April 2020** | current | current |
| Mentions AI/OCR on invoices | ❌ | ❌ (despite marketing "R365 AI") | ❌ (mentions invoice scans) | ❌ on training | not confirmed¹ |
| Separates website data from customer data | ❌ | ❌ | ❌ | ✅ (controller/processor) | not confirmed¹ |
| Retention | "while active" | "as long as necessary" | **none stated** | **12 months** after deactivation | 12 mo analytics, 7 yr mailing list |
| Data location / transfers | not mentioned | not mentioned | "may be transferred" | mostly EU; DTAs | EU adequacy / contracts |
| Security detail | none | generic + "cannot promise" | generic | encryption + MFA named | not confirmed¹ |
| Trackers | Google Analytics, social buttons | cookies, ad partners | GA, DoubleClick, Facebook | Google, Facebook SDKs | analytics + advertising |
| Sells data | no | no (marketing consent) | not clear | not clear | not confirmed¹ |
| Breach notice | none | ✅ | ✅ | none | not confirmed¹ |
| Named rights | access/cancel | delete request | modify/delete, "may not be able" | full GDPR set | not confirmed¹ |
| Contact | support@ | legal@ | privacy@ | privacy@ | not confirmed¹ |

¹ The MarketMan page (`marketman.com/privacy`) was blocked to my fetch tool; the
column is from a search snippet only. **Read it yourself before relying on this
column.** All others were read in full on 2026-09-21.

**What this tells you.** The category's policies are old, generic, and mostly
silent on the two things a food-business customer would most want to know: that
invoices go to an AI provider, and how long data survives after they leave. **None of
the four I could read discloses AI processing of invoices.** Foodnance saying so
plainly is a differentiator, and it is the honest position. It is also the first
thing a privacy complaint would point at if it were missing, since invoices do
leave for a third party.

**Taken from them:**
- Nory's controller/processor split — the most modern and the only one that
  matches how the product actually works, since customers upload their staff's data.
- Nory's stated retention (12 months) — but we chose 30 days to match the Terms
  draft, which is the stronger claim and therefore needs the purge job.
- Restaurant365's honest "no one can guarantee perfect security" and its
  refer-employee-requests-to-the-employer clause (§3.4).
- Restaurant365 and Nory on named contact + a breach commitment.
- A privacy@ mailbox (Craftable, Nory, xtraCHEF all have one).

**Deliberately left out:**
- MarginEdge's "by using the site you consent to everything" as the only legal
  basis — thin under PIPEDA, which needs consent that's meaningful and specific
  about disclosures. We say what we share, and with whom.
- The ad-tech language (DoubleClick, Facebook, DAA opt-outs, cross-device
  linking). We have none of it, and being able to say so is a feature.
- xtraCHEF's "we may monitor, record and store User Content".
- Any "we may not be able to delete your information in all circumstances" without
  saying *when*. Ours says: legal retention, and voided history.
- GDPR terms (legal bases, DPO, SCCs) — Canada only, as decided.

## Part 4 — What a lawyer must confirm

1. **Which province.** The Terms draft guesses BC. If the entity is in BC, the BC
   PIPA applies to employee and customer information in the province and the BC
   commissioner is named; if in Ontario, PIPEDA alone. Section 9 has a bracket for it.
2. **Quebec.** Law 25 (Québec's private-sector privacy law) applies to any Quebec
   customer's or user's information, wherever we are, and is stricter: a
   privacy-impact assessment before sending data outside Quebec, a named person
   in charge, and opt-in for tracking. Confirm whether Quebec restaurants will be
   customers before launch. Not written for.
3. **Is Foodnance a processor or an organization under PIPEDA** for staff data?
   Section 3 assumes processor, matching Nory. The lawyer confirms the customer
   contract needs a data-processing clause to match, and whether Terms §5/§11
   already provide one.
4. **Voided-not-deleted history.** A deleted staff member, or a supplier contact
   named on a voided invoice, stays in historical records by design. Is that a
   permitted retention, and does the policy need to say so more directly than §6?
5. **The cross-border wording in §7.** Regulator guidance is to say plainly that
   foreign authorities may access the data; confirm this phrasing.
6. **Whether Terms §11 and this policy agree** on retention, export and purge.

---

*Draft prepared 2026-09-21. Competitor policies read the same day:
[MarginEdge](https://www.marginedge.com/privacy-policy) ·
[Restaurant365](https://www.restaurant365.com/privacy-policy/) ·
[xtraCHEF](https://xtrachef.com/privacy-policy/) ·
[Nory](https://www.nory.ai/legal/customer-privacy-notice) ·
[MarketMan](https://www.marketman.com/privacy) (not read in full).*
