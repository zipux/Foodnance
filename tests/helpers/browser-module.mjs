// Loads a browser script from public/static/ and returns the functions you ask
// for, so tests exercise the SHIPPED code rather than a copy of it.
//
// These files are plain <script> sources — no modules, no exports — and they
// touch `document` at load time. We evaluate them inside a Function with
// minimal DOM shims and append a `return` for the names we need.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'static');

// Enough of a DOM that top-level listener registration doesn't throw. Tests
// here cover pure logic; anything that really needs a DOM belongs in a browser.
function makeShims() {
  return {
    document: {
      addEventListener() {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: {},
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => { throw new Error('network access is not available in unit tests'); },
    location: { search: '', href: '', hash: '' },
    showToast: () => {},
  };
}

/**
 * @param {string[]} files    e.g. ['utils.js'] or ['utils.js', 'inventory.js']
 * @param {string[]} exports  names to pull out of the evaluated scope
 * @param {object}   overrides shim overrides (e.g. a real fetch)
 */
export function loadBrowserModule(files, exports, overrides = {}) {
  const src = files
    .map(f => readFileSync(join(STATIC_DIR, f), 'utf8'))
    .join('\n;\n');

  const shims = { ...makeShims(), ...overrides };
  const names = Object.keys(shims);
  const body  = `${src}\n;return { ${exports.join(', ')} };`;

  // console is passed through so the loaded code can warn without blowing up.
  const fn = new Function(...names, 'console', body);
  return fn(...names.map(n => shims[n]), console);
}
