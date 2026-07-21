// Test runner — no framework, no dependencies.
// Runs every *.test.mjs in this directory (not integration/) and aggregates.
//
//   npm test                  all unit tests
//   node tests/fifo.test.mjs  one file, on its own
//
// Integration tests live in tests/integration/ and need a running sandbox, so
// they are NOT part of `npm test`. See tests/README.md.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE  = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE).filter(f => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const f of files) {
  console.log(`\n${'─'.repeat(60)}\n${f}\n${'─'.repeat(60)}`);
  const r = spawnSync(process.execPath, [join(HERE, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(`\n${'═'.repeat(60)}`);
if (failed) {
  console.log(`${failed} of ${files.length} test file(s) FAILED`);
  process.exit(1);
}
console.log(`all ${files.length} test files passed`);
