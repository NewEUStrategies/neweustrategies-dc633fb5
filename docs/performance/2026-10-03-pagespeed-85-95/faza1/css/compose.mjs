import { createRequire } from "node:module";
import fs from "node:fs";
import zlib from "node:zlib";
const P = process.env.P;
const require = createRequire(P + "/package.json");
const postcss = require("postcss");
const file = process.argv[2];
const css = fs.readFileSync(file, "utf8");
const root = postcss.parse(css);
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length;
// walk: emit leaf "units" = rule or keyframes or font-face, with context (layer, at-rule chain)
const units = [];
function walk(node, ctx) {
  for (const n of node.nodes || []) {
    if (n.type === "atrule") {
      if (n.name === "layer" && n.nodes) walk(n, { ...ctx, layer: n.params });
      else if (n.name === "keyframes" || n.name === "font-face" || n.name === "property" || n.name === "-webkit-keyframes")
        units.push({ kind: n.name, sel: n.params, ctx, text: n.toString() });
      else if (n.nodes) walk(n, { ...ctx, at: [...(ctx.at || []), `@${n.name} ${n.params}`.slice(0, 60)] });
      else units.push({ kind: "at", sel: n.name, ctx, text: n.toString() });
    } else if (n.type === "rule") {
      units.push({ kind: "rule", sel: n.selector, ctx, text: n.toString() });
    }
  }
}
walk(root, { layer: "(unlayered)", at: [] });
const total = units.reduce((a, u) => a + u.text.length, 0);
console.error("file bytes", css.length, "units bytes", total, "units", units.length, "gzip", gz(css));
fs.writeFileSync(process.argv[3], JSON.stringify(units.map(u => ({ kind: u.kind, sel: u.sel, layer: u.ctx.layer, at: u.ctx.at, bytes: u.text.length }))));
const by = {};
for (const u of units) { const k = u.ctx.layer + " / " + u.kind; by[k] = (by[k] || 0) + u.text.length; }
console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}\t${k}`).join("\n"));
const supports = units.filter(u => (u.ctx.at||[]).some(a => a.startsWith("@supports"))).reduce((a,u)=>a+u.text.length,0);
const media = units.filter(u => (u.ctx.at||[]).some(a => a.startsWith("@media"))).reduce((a,u)=>a+u.text.length,0);
console.log("in @supports:", supports, " in @media:", media);
