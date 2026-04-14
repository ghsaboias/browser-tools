#!/usr/bin/env node
import { stop } from './lib/client.js';
await stop();
console.log('Daemon stopped');
process.exit(0);
