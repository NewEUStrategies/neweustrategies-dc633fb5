import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

const resvg = await import('@resvg/resvg-wasm');
console.log('resvg imported', Object.keys(resvg));
