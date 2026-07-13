// Jednorazowy generator drzewa tras (routeTree.gen.ts) poza dev/build.
// Używa tego samego @tanstack/router-generator, co plugin Vite, a następnie
// dokleja blok augmentacji typów TanStack Start (który normalnie dodaje plugin
// Start, a nie bazowy generator - bez tego `Register` nie wiąże się z routerem).
import { readFileSync, writeFileSync } from "node:fs";
import { Generator, getConfig } from "@tanstack/router-generator";

const OUT = new URL("../src/routeTree.gen.ts", import.meta.url);
const START_REGISTER = `
import type { getRouter } from './router.tsx'
import type { startInstance } from './start.ts'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}
`;

const config = getConfig({ target: "react" }, process.cwd());
const generator = new Generator({ config, root: process.cwd() });
await generator.run();

let out = readFileSync(OUT, "utf-8");
if (!out.includes("declare module '@tanstack/react-start'")) {
  out = `${out.trimEnd()}\n${START_REGISTER}`;
  writeFileSync(OUT, out);
}
console.log("routeTree.gen.ts regenerated");
