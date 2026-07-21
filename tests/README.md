# Tests

Plain Node, no framework, no dependencies — the repo has no test tooling and
this doesn't add any.

```bash
npm test                    # unit tests (fast, no server, no DB)
node tests/fifo.test.mjs    # a single file
npm run test:integration    # needs a running sandbox (see below)
```

`npm test` exits non-zero if anything fails.

## What's covered

| File | Guards |
|---|---|
| `conversion.test.mjs` | unit conversion of quantities and per-unit costs, including the cases it must **refuse** rather than guess |
| `fifo.test.mjs` | which past purchase the stock on hand is drawn from, with purchases converted to one unit before summing |
| `resolve-product.test.mjs` | matching an invoice line to a product: explicit link → exact name → supplier alias → global alias |
| `dom-ids.test.mjs` | every `getElementById('x')` in a page's controller has a matching `id="x"` in that page's HTML |

These target the logic where a wrong answer is *silent*: stock and costs drift
without any error, and you find out weeks later at a stock take. Note how many
assertions check that something is **rejected** — a conversion that quietly
falls back to a factor of 1 is the failure mode that caused this work.

## How the unit tests load the code

`public/static/*.js` are plain `<script>` files — no modules, no exports — and
they touch `document` when loaded. `helpers/browser-module.mjs` evaluates them
inside a `Function` with minimal DOM shims and returns the functions requested.

This is deliberate: the tests run the **shipped** source, not a copy. If a
function is renamed or removed, the test fails to load rather than passing
against a stale duplicate.

The trade-off is that only pure logic is testable this way — no rendering, no
event handlers. Anything visual still needs a browser.

## Integration tests

`tests/integration/` needs the local sandbox running and writes to the local D1:

```bash
npm run dev:sandbox        # terminal 1
npm run test:integration   # terminal 2
```

It skips with exit 0 if no server is reachable, so it's safe to run blind.
Override the target with `TEST_BASE_URL`.

It works on one fixed fixture product (`ITEST_CONV_PRODUCT`) and clears its
stock rows afterwards. Deleting a product through the API is a **soft** delete —
purchase history must survive — so the fixture row stays behind, archived. Each
run revives and reuses it, so nothing accumulates. It's hidden from the product
list unless you tick "Archived".

## Adding a test

Copy the shape of an existing file:

```js
import { suite } from './helpers/assert.mjs';
const t = suite('my-thing');
t.section('what this group is about');
t.check('what should be true', actual === expected, `got ${actual}`);
t.done();
```

`t.near(a, b)` compares floats — unit conversions rarely land on exact decimals.
Any `*.test.mjs` in `tests/` is picked up automatically.
