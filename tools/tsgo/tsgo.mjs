#!/usr/bin/env node
// `tsgo` = natywny kompilator TypeScript 7 (typescript@7.0.2).
//
// PO CO SHIM. Stabilne wydanie TS 7 wystawia wyłącznie bin `tsc` i nie ma JS API, a główny
// `typescript` w package.json MUSI zostać wydaniem JS (5.x): typescript-eslint (peer `<6.1`)
// i bramki `src/lib/ci/*` (`import ts from "typescript"`) potrzebują jego API. Dwa pakiety
// z binem `tsc` w jednym drzewie bun linkuje niedeterministycznie (wygrywa kolejność nazw),
// dlatego TS 7 żyje zagnieżdżony pod tym pakietem, a na zewnątrz wychodzi tylko `tsgo`.
// Komenda zostaje ta sama co z `@typescript/native-preview` (AGENTS.md: `tsgo --noEmit`),
// którego ostatni build (2026-07-07) wyczerpywał >14 GB pamięci na typach TanStack 1.169.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const tsDir = dirname(require.resolve("typescript/package.json"));
await import(pathToFileURL(join(tsDir, "lib", "tsc.js")).href);
