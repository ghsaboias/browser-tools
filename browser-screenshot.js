#!/usr/bin/env node
// Screenshot the viewport (default), the full page, or one element by ref/selector.
//   browser-screenshot.js [-t=<tab>] [--full | e12] [--out=/tmp/x.png]
import { run } from './lib/client.js';
import { parseArgs } from './lib/cli.js';

const { tab, flags, rest } = parseArgs();
const o = {};
if (flags.full) o.full = true;
if (rest[0]) o.ref = rest.join(' ');
try {
  const result = JSON.parse(await run(tab, 'shot', [typeof flags.out === 'string' ? flags.out : '', JSON.stringify(o)]));
  console.log(result.file);
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
