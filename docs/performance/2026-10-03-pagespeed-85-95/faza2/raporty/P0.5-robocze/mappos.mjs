// Mapuje pozycje <plikW0>:<linia>:<kolumna> (1-based linia, 0-based lub 1-based kolumna jak w śladzie) na źródło przez mapy buildu A'.
// Użycie: node mappos.mjs index-6qtijEpj.js:422:14022 [...]
import fs from 'node:fs';
import { TraceMap, originalPositionFor } from '/home/user/neweustrategies-dc633fb5/node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs';
const P = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05';
const mm = JSON.parse(fs.readFileSync(`${P}/mapmatch-w0.json`, 'utf8'));
const A = `${P}/build-maps/.output/public/assets`;
const cache = new Map();
for (const arg of process.argv.slice(2)) {
  let [file, line, col] = arg.split(':');
  if (!file.endsWith('.js')) { const c = Object.keys(mm).filter((k) => k.startsWith(file + '-')); file = c[0]; }
  const f2 = mm[file] || file;
  if (!cache.has(f2)) cache.set(f2, new TraceMap(JSON.parse(fs.readFileSync(`${A}/${f2}.map`, 'utf8'))));
  const m = cache.get(f2);
  const o = originalPositionFor(m, { line: Number(line), column: Number(col) });
  const o2 = originalPositionFor(m, { line: Number(line), column: Math.max(0, Number(col) - 1) });
  console.log(`${arg} -> ${(o.source || '?').replace(/^.*?\/(src|node_modules)\//, '$1/')}:${o.line}:${o.column} ${o.name || ''} | (kol-1) ${(o2.source || '?').replace(/^.*?\/(src|node_modules)\//, '$1/')}:${o2.line} ${o2.name || ''}`);
}
