import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";


const wasm = readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm");
await initWasm(wasm);

const ICONS: Record<string, { icon: string; color: string; size: number }> = {
  "hero-check": { icon: "CircleCheckBig", color: "#FA9346", size: 34 },
  "hero-handshake": { icon: "Handshake", color: "#FA9346", size: 34 },
  "hero-magic": { icon: "Sparkles", color: "#FA9346", size: 34 },
  "hero-key": { icon: "KeyRound", color: "#FA9346", size: 34 },
  "hero-mail": { icon: "MailCheck", color: "#FA9346", size: 34 },
  "hero-shield": { icon: "ShieldCheck", color: "#FA9346", size: 34 },
  "clock": { icon: "Clock", color: "#55575d", size: 16 },
  "lock": { icon: "Lock", color: "#55575d", size: 16 },
  "info": { icon: "Info", color: "#FA9346", size: 16 },
};

type Node = [string, Record<string, string | number>, Node[]?];

function toSvg(name: unknown, color: string, size: number) {
  const nodes: Node[] = name as unknown as Node[];
  const body = nodes
    .map(([tag, attrs]) =>
      `<${tag} ${Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 3}" height="${size * 3}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const nodes0Empty = (s: string) => s.includes("24 24\" fill=\"none\" stroke=\"" ) && s.endsWith("\"></svg>");
mkdirSync("/tmp/icons/out", { recursive: true });
const kebab = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
for (const [file, cfg] of Object.entries(ICONS)) {
  const mod = await import(`lucide-react/dist/esm/icons/${kebab(cfg.icon)}.js`);
  const svg = toSvg(mod.__iconNode, cfg.color, cfg.size);
  if (!svg.includes("<svg") || nodes0Empty(svg)) throw new Error(`empty icon ${cfg.icon}`);
  const png = new Resvg(svg).render().asPng();
  writeFileSync(`/tmp/icons/out/${file}.png`, png);
  console.log(file, png.length);
}
