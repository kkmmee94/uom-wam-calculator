// jsc-compatible runner. jsc has `print` instead of `console.log` and no `process`.
import { runTests, summarize } from './tests.js';
const results = runTests();
const s = summarize(results);
for (const r of results) {
  if (r.ok) {
    print('  ok   ' + r.name);
  } else {
    print('  FAIL ' + r.name);
    print('       -> ' + r.error);
  }
}
print('');
print(s.passed + '/' + s.total + ' passed' + (s.failed ? (', ' + s.failed + ' failed') : ''));
if (s.failed) {
  // Force a non-zero exit. jsc returns 0 normally, but throwing gives a non-zero exit.
  throw new Error('TESTS_FAILED');
}
