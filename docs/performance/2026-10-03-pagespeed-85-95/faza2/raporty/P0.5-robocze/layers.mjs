// P0.5: lista warstw kompozytora i ich przyczyn (CDP LayerTree.compositingReasons) na artefakcie,
// w emulacji Lighthouse mobile (412x823 @1.75, CPU x4) albo desktop (1350x940 @1).
// Migawki: pierwsza zmiana drzewa po FCP, stan przy `load` i po 3 s. Element -> klasa/atrybuty (DOM.describeNode).
// Użycie: node layers.mjs --root <katalog z .output> --form mobile|desktop [--out plik.json] [--transform plik.mjs]
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const WT = "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/wt/P0.5";
const { freePort, startArtifact, startFront, warmDocument, DEFAULT_ACCEPT_LANGUAGE } = await import(`${WT}/scripts/performance/artifactServer.ts`);
const { chromium } = await import("/home/user/neweustrategies-dc633fb5/node_modules/playwright-core/index.mjs");
const { values: o } = parseArgs({ options: { root: { type: "string" }, form: { type: "string", default: "mobile" }, out: { type: "string" }, transform: { type: "string" } } });
const up = await freePort();
const artifact = await startArtifact({ root: resolve(o.root), port: up, fixture: true });
const transformHtml = o.transform ? (await import(resolve(o.transform))).default : undefined;
const front = await startFront({ transport: "h2", upstreamPort: up, listenPort: await freePort(), transformHtml });
const mobile = o.form === "mobile";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-proxy-server", ...front.chromeFlags.map((f) => f.replace(/'/g, ""))],
});
const ctx = await browser.newContext({
  viewport: mobile ? { width: 412, height: 823 } : { width: 1350, height: 940 },
  deviceScaleFactor: mobile ? 1.75 : 1,
  isMobile: mobile, hasTouch: mobile,
  userAgent: mobile
    ? "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
    : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  extraHTTPHeaders: { "Accept-Language": DEFAULT_ACCEPT_LANGUAGE },
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: mobile ? 4 : 1 });
await cdp.send("DOM.enable");
await cdp.send("LayerTree.enable");
let latest = null; const changes = [];
const t0 = Date.now();
cdp.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) { latest = e.layers; changes.push({ t: Date.now() - t0, n: e.layers.length }); } });
async function snapshot(label) {
  const layers = latest || [];
  const rows = [];
  for (const l of layers) {
    let reasons = [];
    try { const r = await cdp.send("LayerTree.compositingReasons", { layerId: l.layerId }); reasons = r.compositingReasonIds || r.compositingReasons || []; } catch {}
    let node = null;
    if (l.backendNodeId) {
      try {
        const d = await cdp.send("DOM.describeNode", { backendNodeId: l.backendNodeId, depth: 0 });
        const attrs = d.node.attributes || []; const a = {};
        for (let i = 0; i < attrs.length; i += 2) a[attrs[i]] = attrs[i + 1];
        node = { name: d.node.nodeName, cls: (a.class || "").slice(0, 160), id: a.id, data: Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k, String(v).slice(0, 60)])) };
      } catch {}
    }
    rows.push({ id: l.layerId, parent: l.parentLayerId, w: Math.round(l.width), h: Math.round(l.height), drawsContent: l.drawsContent, paintCount: l.paintCount, reasons, node });
  }
  return { label, t: Date.now() - t0, count: rows.length, rows };
}
const doc = await warmDocument(artifact.origin, "/");
const snaps = [];
page.on("domcontentloaded", () => {});
await page.goto(`${front.baseUrl}/`, { waitUntil: "load", timeout: 120000 });
snaps.push(await snapshot("load"));
await page.waitForTimeout(3000);
snaps.push(await snapshot("load+3s"));
const anims = await page.evaluate(() => document.getAnimations().map((a) => ({ name: a.animationName || a.transitionProperty || a.constructor.name, state: a.playState, el: a.effect?.target ? `${a.effect.target.tagName}.${String(a.effect.target.className?.baseVal ?? a.effect.target.className).slice(0, 80)}` : null })));
// Skan DOM wyzwalaczy warstw kompozytora (przybliżenie przyczyn, gdy LayerTree w headless nie zwraca drzewa).
const triggers = await page.evaluate(() => {
  const out = {};
  const add = (k, el) => { const key = k + " | " + el.tagName.toLowerCase() + "." + String(el.className?.baseVal ?? el.className ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join("."); out[key] = (out[key] || 0) + 1; };
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.willChange && cs.willChange !== "auto") add("will-change:" + cs.willChange, el);
    if (cs.backdropFilter && cs.backdropFilter !== "none") add("backdrop-filter", el);
    if (cs.position === "fixed") add("position:fixed", el);
    if (cs.position === "sticky") add("position:sticky", el);
    if (/matrix3d|translateZ|translate3d/.test(cs.transform)) add("transform-3d", el);
    if (cs.contentVisibility && cs.contentVisibility !== "visible") add("content-visibility:" + cs.contentVisibility, el);
    if (/^(VIDEO|CANVAS|IFRAME)$/.test(el.tagName)) add("element:" + el.tagName, el);
    if (cs.animationName && cs.animationName !== "none") add("animation:" + cs.animationName + " " + cs.animationDuration + " " + cs.animationIterationCount, el);
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
});
const res = { form: o.form, cache: doc.headers.get("x-nes-cache"), changes, snaps, animations: anims, triggers };
if (o.out) writeFileSync(o.out, JSON.stringify(res, null, 1));
for (const s of snaps) {
  console.log(`== ${s.label} t=${s.t}ms warstw=${s.count}`);
  for (const r of s.rows) if (r.reasons.length && !(r.reasons.length === 1 && r.reasons[0] === "root")) console.log(`  ${r.w}x${r.h} draws=${r.drawsContent} paints=${r.paintCount} [${r.reasons.join(",")}] ${r.node ? r.node.name + "." + r.node.cls.slice(0, 110) : "(brak węzła)"}`);
}
console.log("animacje:", JSON.stringify(anims).slice(0, 3000));
for (const [k, n] of triggers) console.log(`  wyzwalacz x${n}: ${k}`);
await browser.close(); await front.stop(); await artifact.stop();
