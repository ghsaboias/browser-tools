#!/usr/bin/env node
import { findTarget, closeTab, shortId } from './lib/client.js';

const args = process.argv.slice(2);
// Require an explicit target — closing the default "last tab" implicitly is
// too easy to do by accident.
const query = args.find(a => a.startsWith('-t='))?.slice(3)
  || args.find(a => !a.startsWith('-'))
  || null;

if (!query) {
  console.log('Usage: browser-close.js <-t=tab | id/url/title substring>');
  process.exit(1);
}

const target = await findTarget(query);
await closeTab(target.targetId);
console.log(`closed [${shortId(target)}]  ${target.title || target.url || ''}`);
process.exit(0);
