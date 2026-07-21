// Minimal test reporting — no framework, no dependencies.
// Each test file creates one suite, calls check()/section(), then done().

export function suite(title) {
  let pass = 0, fail = 0;
  const failures = [];

  return {
    section(name) {
      console.log(`\n${name}`);
    },
    check(label, ok, detail = '') {
      if (ok) {
        pass++;
        console.log(`  ok   ${label}`);
      } else {
        fail++;
        failures.push(label);
        console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
      }
      return ok;
    },
    // Floating-point compare — unit conversions never land on exact decimals.
    near(a, b, eps = 1e-6) {
      return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < eps;
    },
    done() {
      console.log(`\n${title}: ${pass} passed, ${fail} failed`);
      if (fail) {
        console.log(`Failed: ${failures.join(', ')}`);
        process.exit(1);
      }
      process.exit(0);
    },
  };
}
