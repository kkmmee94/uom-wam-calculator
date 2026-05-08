// Node entry point for the test suite. Run with: node js/run-tests-node.js
import { runTests, summarize } from './tests.js';
const results = runTests();
const s = summarize(results);
for (const r of results) {
  if (r.ok) {
    console.log(`  ok   ${r.name}`);
  } else {
    console.log(`  FAIL ${r.name}`);
    console.log(`       -> ${r.error}`);
  }
}
console.log('');
console.log(`${s.passed}/${s.total} passed${s.failed ? `, ${s.failed} failed` : ''}`);
process.exit(s.failed ? 1 : 0);
