// P0.5: księga TBT per zadanie (Lantern) z SZCZEGÓŁAMI zadania - rozszerzenie phase1/ledger/tbt-tasks.mjs.
// Blokowanie każdego symulowanego węzła CPU: 0,5 optymistyczny + 0,5 pesymistyczny, każdy w swoim oknie
// [FCP, TTI] (dokładnie jak LanternTotalBlockingTime); suma = audyt TBT. Dla zadań >= 50 ms sym. (w którymkolwiek
// grafie) albo z blokowaniem > 0 drukuje skład dzieci: FunctionCall (url:linia:kolumna), RunMicrotasks,
// UpdateLayoutTree (elementy, stos wymuszenia), Layout (stos), ParseHTML, kompozytor (UpdateLayer/Layerize/IO), GC.
// Użycie: node ledger.mjs <artifactsDir> [--json out.json] [--detail] [--cpu N]
const LHC = '/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/tools/node_modules/lighthouse/core';
const { loadArtifacts } = await import(`${LHC}/lib/asset-saver.js`);
const { LoadSimulator } = await import(`${LHC}/computed/load-simulator.js`);
const { LanternTotalBlockingTime } = await import(`${LHC}/computed/metrics/lantern-total-blocking-time.js`);
const { LanternFirstContentfulPaint } = await import(`${LHC}/computed/metrics/lantern-first-contentful-paint.js`);
const { LanternInteractive } = await import(`${LHC}/computed/metrics/lantern-interactive.js`);
import fs from 'node:fs';
const args = process.argv.slice(2);
const dir = args[0];
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const detail = args.includes('--detail');
const cpuArg = args.includes('--cpu') ? Number(args[args.indexOf('--cpu') + 1]) : null;
const art = await loadArtifacts(dir);
const settings = art.settings;
if (cpuArg) settings.throttling.cpuSlowdownMultiplier = cpuArg;
const context = { computedCache: new Map(), settings };
const trace = art.Trace || art.traces?.defaultPass;
const devtoolsLog = art.DevtoolsLog || art.devtoolsLogs?.defaultPass;
const simulator = await LoadSimulator.request({ devtoolsLog, settings }, context);
const data = { trace, devtoolsLog, gatherContext: art.GatherContext, settings, simulator, URL: art.URL, SourceMaps: art.SourceMaps || [], HostDPR: art.HostDPR };
const fcp = await LanternFirstContentfulPaint.request(data, context);
const tti = await LanternInteractive.request(data, context);
const tbt = await LanternTotalBlockingTime.request(data, context);
const nav = trace.traceEvents.find((e) => e.name === 'navigationStart' && e.args?.data?.isLoadingMainFrame);
const t0 = nav.ts;
function impact(t, s, e) { if (t.duration < 50 || t.endTime < s || t.startTime > e) return 0; const cs = Math.max(t.startTime, s), ce = Math.min(t.endTime, e); const d = ce - cs; return d < 50 ? 0 : d - 50; }
const wOpt = [fcp.pessimisticEstimate.timeInMs, tti.optimisticEstimate.timeInMs];
const wPes = [fcp.optimisticEstimate.timeInMs, tti.pessimisticEstimate.timeInMs];
const short = (u) => (u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/assets\//, '').replace(/-[A-Za-z0-9_-]{8}\.js.*/, '');
const frame = (f) => f ? `${f.functionName || '(anon)'}@${short(f.url)}:${f.lineNumber ?? f.line ?? '?'}:${f.columnNumber ?? f.column ?? '?'}` : '';
function classify(names) {
  if (names.has('ScriptCatchup') && !names.has('FunctionCall') && !names.has('RunMicrotasks')) return 'ScriptCatchup';
  if (names.has('ParseHTML') && !names.has('FunctionCall')) return 'ParseHTML-doc';
  if (names.has('ParseAuthorStyleSheet') && !names.has('FunctionCall')) return 'ParseCSS';
  if (names.has('TimerFire')) return 'Timer';
  if ((names.has('MajorGC') || names.has('MinorGC')) && !names.has('FunctionCall') && !names.has('RunMicrotasks')) return 'GC';
  if (names.has('v8.evaluateModule')) return 'ModuleEval';
  if (names.has('FunctionCall') || names.has('EvaluateScript') || names.has('RunMicrotasks') || names.has('EventDispatch')) return 'Script';
  if (names.has('UpdateLayoutTree') || names.has('Layout')) return names.has('Paint') || names.has('PrePaint') ? 'Frame' : 'Style';
  if (names.has('UpdateLayer') || names.has('Layerize') || names.has('Commit')) return 'Compositor';
  return 'Other';
}
function summarize(node) {
  const kids = node.childEvents || [];
  const names = new Set(kids.map((k) => k.name));
  const agg = {};
  for (const k of kids) { const d = (k.dur || 0) / 1000; const a = (agg[k.name] ||= { n: 0, ms: 0 }); a.n++; a.ms += d; }
  const fcalls = kids.filter((k) => k.name === 'FunctionCall' || k.name === 'EvaluateScript' || k.name === 'v8.evaluateModule' || k.name === 'TimerFire' || k.name === 'EventDispatch' || k.name === 'FireAnimationFrame' || k.name === 'RunMicrotasks' || k.name === 'v8.callFunction')
    .map((k) => ({ name: k.name, ms: (k.dur || 0) / 1000, obs: (k.ts - t0) / 1000, fn: k.args?.data?.functionName, url: short(k.args?.data?.url), line: k.args?.data?.lineNumber, col: k.args?.data?.columnNumber, type: k.args?.data?.type }))
    .filter((x) => x.ms >= 0.5);
  const ult = kids.filter((k) => k.name === 'UpdateLayoutTree').map((k) => ({ ms: (k.dur || 0) / 1000, obs: (k.ts - t0) / 1000, el: k.args?.elementCount ?? k.args?.data?.elementCount ?? k.args?.endData?.elementCount, stack: (k.args?.beginData?.stackTrace || []).slice(0, 4).map(frame) })).filter((x) => x.ms >= 0.5);
  const lay = kids.filter((k) => k.name === 'Layout').map((k) => ({ ms: (k.dur || 0) / 1000, obs: (k.ts - t0) / 1000, dirty: k.args?.beginData?.dirtyObjects, total: k.args?.beginData?.totalObjects, partial: k.args?.beginData?.partialLayout, stack: (k.args?.beginData?.stackTrace || []).slice(0, 4).map(frame) })).filter((x) => x.ms >= 0.3);
  const parse = kids.filter((k) => k.name === 'ParseHTML').map((k) => ({ ms: (k.dur || 0) / 1000, obs: (k.ts - t0) / 1000, url: short(k.args?.beginData?.url), line: k.args?.beginData?.startLine, end: k.args?.endData?.endLine })).filter((x) => x.ms >= 0.5);
  const urls = new Map();
  for (const k of kids) { const u = k.args?.data?.url || k.args?.data?.stackTrace?.[0]?.url; if (u && /\.(js|mjs)/.test(u)) { const s = short(u); urls.set(s, (urls.get(s) || 0) + 1); } }
  return { cls: classify(names), layout: names.has('Layout'), agg, fcalls, ult, lay, parse, urls: [...urls.keys()].slice(0, 6) };
}
const rows = new Map();
for (const [which, est, w] of [['opt', tbt.optimisticEstimate, wOpt], ['pes', tbt.pessimisticEstimate, wPes]]) {
  for (const [node, t] of est.nodeTimings.entries()) {
    if (node.type !== 'cpu') continue;
    const b = impact(t, w[0], w[1]);
    const r = rows.get(node.id) || { id: node.id, obsStart: (node.event.ts - t0) / 1000, obsDur: node.duration / 1000, node };
    r[which] = b; r[`${which}SimStart`] = t.startTime; r[`${which}SimDur`] = t.duration;
    rows.set(node.id, r);
  }
}
const list = [...rows.values()].map((r) => ({ ...r, b: 0.5 * (r.opt || 0) + 0.5 * (r.pes || 0) }))
  .filter((r) => r.b > 0 || Math.max(r.optSimDur || 0, r.pesSimDur || 0) >= 50).sort((a, b) => a.obsStart - b.obsStart);
const audit = Math.round(tbt.timing);
console.log(`# ${dir}`);
console.log(`# TBT(audit Lantern)=${audit} FCPsim opt/pes=${Math.round(fcp.optimisticEstimate.timeInMs)}/${Math.round(fcp.pessimisticEstimate.timeInMs)} TTIsim opt/pes=${Math.round(tti.optimisticEstimate.timeInMs)}/${Math.round(tti.pessimisticEstimate.timeInMs)} cpuMult=${settings.throttling.cpuSlowdownMultiplier} okna opt=[${wOpt.map(Math.round)}] pes=[${wPes.map(Math.round)}]`);
console.log('obsStart obsDur  simStart(o/p)  simDur(o/p)  L  class          block opt/pes/avg  urls');
let sum = 0; const out = [];
for (const r of list) {
  const s = summarize(r.node);
  sum += r.b;
  const rec = { obsStart: +r.obsStart.toFixed(1), obsDur: +r.obsDur.toFixed(1), optSimStart: Math.round(r.optSimStart), pesSimStart: Math.round(r.pesSimStart), optSimDur: Math.round(r.optSimDur), pesSimDur: Math.round(r.pesSimDur), layout: s.layout, cls: s.cls, opt: Math.round(r.opt || 0), pes: Math.round(r.pes || 0), avg: +r.b.toFixed(1), urls: s.urls, agg: s.agg, fcalls: s.fcalls, ult: s.ult, lay: s.lay, parse: s.parse };
  out.push(rec);
  console.log(`${r.obsStart.toFixed(0).padStart(7)} ${r.obsDur.toFixed(1).padStart(6)} ${String(Math.round(r.optSimStart)).padStart(6)}/${String(Math.round(r.pesSimStart)).padEnd(6)} ${String(Math.round(r.optSimDur)).padStart(4)}/${String(Math.round(r.pesSimDur)).padEnd(4)}  ${s.layout ? 'L' : ' '}  ${s.cls.padEnd(13)} ${String(Math.round(r.opt || 0)).padStart(5)}/${String(Math.round(r.pes || 0)).padStart(5)}/${r.b.toFixed(0).padStart(5)}  ${s.urls.join(',')}`);
  if (detail && (r.b > 0 || Math.max(r.optSimDur, r.pesSimDur) >= 50)) {
    const top = Object.entries(s.agg).filter(([, v]) => v.ms >= 1).sort((a, b) => b[1].ms - a[1].ms).slice(0, 12).map(([k, v]) => `${k}x${v.n}=${v.ms.toFixed(1)}`).join(' ');
    console.log(`          dzieci: ${top}`);
    for (const f of s.fcalls.filter((f) => f.ms >= 2).slice(0, 8)) console.log(`          ${f.name} ${f.ms.toFixed(1)}ms @${f.obs.toFixed(0)} ${f.fn || ''} ${f.url || ''}:${f.line ?? ''}:${f.col ?? ''} ${f.type || ''}`);
    for (const u of s.ult.filter((u) => u.ms >= 2)) console.log(`          UpdateLayoutTree ${u.ms.toFixed(1)}ms el=${u.el} @${u.obs.toFixed(0)} ${u.stack.join(' < ')}`);
    for (const l of s.lay.filter((l) => l.ms >= 1)) console.log(`          Layout ${l.ms.toFixed(1)}ms dirty=${l.dirty}/${l.total} @${l.obs.toFixed(0)} ${l.stack.join(' < ')}`);
    for (const p of s.parse.filter((p) => p.ms >= 2)) console.log(`          ParseHTML ${p.ms.toFixed(1)}ms @${p.obs.toFixed(0)} ${p.url || '(innerHTML/fragment)'} linie ${p.line}-${p.end}`);
  }
}
console.log(`# suma księgi = ${sum.toFixed(1)} ; audyt = ${audit} ; różnica = ${(sum - tbt.timing).toFixed(2)} ms`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ dir, audit, tbtExact: tbt.timing, fcp: { opt: fcp.optimisticEstimate.timeInMs, pes: fcp.pessimisticEstimate.timeInMs }, tti: { opt: tti.optimisticEstimate.timeInMs, pes: tti.pessimisticEstimate.timeInMs }, cpu: settings.throttling.cpuSlowdownMultiplier, sum, tasks: out }, null, 1));
