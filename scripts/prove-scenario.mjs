import { runProveScenarios } from '../evals/prove-scenario.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const scIdx = args.indexOf('--scenario');
const scenario = scIdx >= 0 ? args[scIdx + 1] || '' : '';

const summary = await runProveScenarios({ scenario });

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const r of summary.results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.ms}ms)${r.error ? ` — ${r.error}` : ''}`);
  }
  console.log(`\nScenarios: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`);
}

process.exit(summary.failed === 0 ? 0 : 1);
