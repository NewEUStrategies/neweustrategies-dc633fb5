// P0.5: atrybucja długich zadań głównego wątku z próbek profilera V8 w śladzie Lighthouse
// (gather z --additional-trace-categories=disabled-by-default-v8.cpu_profiler) + mapy źródeł (build z
// sourcemap:'hidden') + React Performance Tracks (build profilujący: console.timeStamp → zdarzenia TimeStamp).
// Użycie: node profattr.mjs <artifactsDir> <assetsDir z *.js.map> [--min 12] [--top 25] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '/home/user/neweustrategies-dc633fb5/node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs';
const a = process.argv.slice(2);
const [dir, assets] = a;
const min = a.includes('--min') ? Number(a[a.indexOf('--min') + 1]) : 12;
const topN = a.includes('--top') ? Number(a[a.indexOf('--top') + 1]) : 25;
const jsonOut = a.includes('--json') ? a[a.indexOf('--json') + 1] : null;
// --mapmatch plik.json: nazwa pliku ze śladu (W0) -> nazwa w buildzie z mapami (kod identyczny, inny hash)
const mm = a.includes('--mapmatch') ? JSON.parse(fs.readFileSync(a[a.indexOf('--mapmatch') + 1], 'utf8')) : {};
const fromTs = a.includes('--from') ? Number(a[a.indexOf('--from') + 1]) : -1e9;
const stackRx = a.includes('--stack') ? new RegExp(a[a.indexOf('--stack') + 1]) : null;
const toTs = a.includes('--to') ? Number(a[a.indexOf('--to') + 1]) : 1e9;
const tr = JSON.parse(fs.readFileSync(path.join(dir, 'trace.json'), 'utf8'));
const ev = tr.traceEvents || tr;
const nav = ev.find((e) => e.name === 'navigationStart' && e.args?.data?.isLoadingMainFrame);
const t0 = nav.ts, pid = nav.pid, tid = nav.tid;
// --- profil V8 (Profile + ProfileChunk) wątku głównego
const profiles = new Map();
for (const e of ev) {
  if (e.name === 'Profile') profiles.set(`${e.pid}:${e.id}`, { pid: e.pid, tid: e.tid, start: e.args.data.startTime, nodes: new Map(), samples: [], times: [] });
}
for (const e of ev) {
  if (e.name !== 'ProfileChunk') continue;
  const p = profiles.get(`${e.pid}:${e.id}`); if (!p) continue;
  const cp = e.args.data.cpuProfile || {};
  for (const n of cp.nodes || []) p.nodes.set(n.id, n);
  let t = p.times.length ? p.times[p.times.length - 1] : p.start;
  const td = e.args.data.timeDeltas || [];
  (cp.samples || []).forEach((s, i) => { t += td[i] || 0; p.samples.push(s); p.times.push(t); });
}
let prof = [...profiles.values()].filter((p) => p.pid === pid && p.tid === tid).sort((x, y) => y.samples.length - x.samples.length)[0]
  || [...profiles.values()].sort((x, y) => y.samples.length - x.samples.length)[0];
if (!prof) { console.log('brak próbek profilera w śladzie'); process.exit(1); }
for (const n of prof.nodes.values()) if (n.parent === undefined) for (const c of n.children || []) { const k = prof.nodes.get(c); if (k) k.parent = n.id; }
// --- mapy źródeł
const maps = new Map();
function mapFor(url) {
  const file = (url || '').replace(/^https?:\/\/[^/]+\/assets\//, '');
  if (!file || !file.endsWith('.js')) return null;
  if (maps.has(file)) return maps.get(file);
  let m = null;
  const p = path.join(assets, (mm[file] || file) + '.map');
  if (fs.existsSync(p)) { try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); m = j.mappings ? new TraceMap(j) : null; } catch { m = null; } }
  maps.set(file, m); return m;
}
const shortSrc = (s) => (s || '').replace(/^.*?\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '');
const cfKey = new Map();
function resolveFrame(cf) {
  const k = `${cf.url}|${cf.lineNumber}|${cf.columnNumber}|${cf.functionName}`;
  if (cfKey.has(k)) return cfKey.get(k);
  const chunk = (cf.url || '').replace(/^https?:\/\/[^/]+\/assets\//, '').replace(/-[A-Za-z0-9_-]{8}\.js$/, '');
  let label = `${cf.functionName || '(anon)'} ${chunk || cf.url || '(native)'}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
  let src = null;
  const m = mapFor(cf.url);
  if (m && cf.lineNumber >= 0) {
    const o = originalPositionFor(m, { line: cf.lineNumber + 1, column: Math.max(0, cf.columnNumber) });
    if (o.source) { src = `${shortSrc(o.source)}:${o.line}`; label = `${o.name || cf.functionName || '(anon)'} ${src}`; }
  }
  const r = { label, src, chunk, fn: cf.functionName };
  cfKey.set(k, r); return r;
}
// --- zadania głównego wątku
const tasks = ev.filter((e) => e.pid === pid && e.tid === tid && e.name === 'RunTask' && e.ph === 'X' && e.dur >= min * 1000 && (e.ts - t0) / 1000 >= fromTs && (e.ts - t0) / 1000 <= toTs).sort((x, y) => x.ts - y.ts);
// React Performance Tracks
const stamps = ev.filter((e) => e.name === 'TimeStamp' && e.args?.data);
const mainKids = ev.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && e.name !== 'RunTask');
const result = [];
let si = 0;
for (const task of tasks) {
  const s = task.ts, en = task.ts + task.dur;
  const self = new Map(), incl = new Map(); const stacks = new Map();
  let n = 0;
  while (si < prof.times.length && prof.times[si] < s) si++;
  let j = si;
  const dt = 1; // próbki ważone odstępem do następnej próbki
  for (; j < prof.times.length && prof.times[j] < en; j++) {
    const w = ((prof.times[j + 1] ?? prof.times[j]) - prof.times[j]) / 1000;
    const wt = Math.min(w, 5);
    let node = prof.nodes.get(prof.samples[j]); if (!node) continue; n++;
    const f0 = resolveFrame(node.callFrame);
    if (stackRx && stackRx.test(f0.label)) {
      const chain = []; let q = node; while (q && chain.length < 14) { const cf = q.callFrame; if (cf && cf.functionName !== '(root)') chain.push(resolveFrame(cf).label); q = q.parent !== undefined ? prof.nodes.get(q.parent) : null; }
      const key = chain.join(' < '); stacks.set(key, (stacks.get(key) || 0) + wt);
    }
    self.set(f0.label, (self.get(f0.label) || 0) + wt);
    const seen = new Set();
    while (node) {
      const cf = node.callFrame;
      if (cf && cf.functionName !== '(root)' && cf.functionName !== '(program)' && cf.functionName !== '(idle)') {
        const f = resolveFrame(cf);
        if (!seen.has(f.label)) { seen.add(f.label); incl.set(f.label, (incl.get(f.label) || 0) + wt); }
      }
      node = node.parent !== undefined ? prof.nodes.get(node.parent) : null;
    }
  }
  const kids = mainKids.filter((k) => k.ts >= s && k.ts < en);
  const byFile = new Map();
  for (const [lab, v] of self) { const m2 = lab.match(/ ((?:src|node_modules)\/[^:]+):\d+$/); const k = m2 ? m2[1].replace(/^node_modules\/(@[^/]+\/[^/]+|[^/]+).*/, 'node_modules/$1') : lab.replace(/^\S+ /, '').replace(/:\d+:\d+$/, ''); byFile.set(k, (byFile.get(k) || 0) + v); }
  const names = {};
  for (const k of kids) { const d = (k.dur || 0) / 1000; if (d >= 1) names[k.name] = (names[k.name] || 0) + d; }
  const rs = stamps.filter((e) => { const st = e.args.data.start ?? e.ts; return e.ts >= s && e.ts <= en + 200000; });
  const comp = new Map();
  for (const e of stamps) {
    const d = e.args.data; if (d.track !== 'Components ⚛') continue;
    const st = typeof d.start === 'number' ? d.start : null, ed = typeof d.end === 'number' ? d.end : null;
    if (st === null || ed === null) continue;
    // start/end w ms czasu performance.now(); konwersja: ts (µs) zdarzenia ~ czas emisji = koniec komponentu
    comp.set(e, { name: d.message || d.name, st, ed, ts: e.ts });
  }
  result.push({ obsStart: +((s - t0) / 1000).toFixed(1), obsDur: +(task.dur / 1000).toFixed(1), samples: n,
    children: Object.entries(names).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => `${k}=${v.toFixed(1)}`),
    self: [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, topN).map(([k, v]) => [k, +v.toFixed(1)]),
    stacks: [...stacks.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => [k, +v.toFixed(1)]),
    byFile: [...byFile.entries()].sort((x, y) => y[1] - x[1]).slice(0, topN).map(([k, v]) => [k, +v.toFixed(1)]),
    incl: [...incl.entries()].sort((x, y) => y[1] - x[1]).slice(0, topN).map(([k, v]) => [k, +v.toFixed(1)]) });
}
for (const r of result) {
  console.log(`\n=== zadanie obs ${r.obsStart} ms, ${r.obsDur} ms, próbek ${r.samples}; ${r.children.join(' ')}`);
  console.log('  inkluzywnie:'); for (const [k, v] of r.incl) console.log(`    ${String(v).padStart(6)}  ${k}`);
  console.log('  własny:'); for (const [k, v] of r.self.slice(0, 12)) console.log(`    ${String(v).padStart(6)}  ${k}`);
  for (const [k, v] of r.stacks) console.log(`  STOS ${v} ms: ${k}`);
  console.log('  własny wg pliku:'); for (const [k, v] of r.byFile.slice(0, 12)) console.log(`    ${String(v).padStart(6)}  ${k}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1));
