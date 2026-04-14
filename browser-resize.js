#!/usr/bin/env node
import { run } from './lib/client.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const rest = args.filter(a => !a.startsWith('-t='));

const presets = {
  mobile: [375, 812], tablet: [768, 1024],
  desktop: [1280, 800], wide: [1920, 1080],
};

let width, height;
if (rest[0] && presets[rest[0]]) {
  [width, height] = presets[rest[0]];
} else {
  width = parseInt(rest[0]) || 1280;
  height = parseInt(rest[1]) || 800;
}

console.log(await run(target, 'resize', [width, height]));
process.exit(0);
