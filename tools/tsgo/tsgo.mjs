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
//
// DOMYŚLNE `--checkers 2` (zmierzone 2026-10-16, pełny projekt, bez tsbuildinfo, 16 GB RAM).
// Każdy równoległy checker buduje WŁASNĄ kopię typów drzewa tras (~400 tras, Register
// routera i Start), więc pamięć rośnie liniowo z ich liczbą: przy domyślnych 4 checkerach
// proces przekraczał 14 GB i ginął od OOM-killera (exit 137, zero diagnostyk), przy 2 -
// 7,2 GB żywej sterty, szczyt 9,2 GB, 53 s, ten sam wynik. Jawne `--checkers N` albo
// `--singleThreaded` w wywołaniu wygrywa z tym domyślnym.
//
// DOMYŚLNY `GOMEMLIMIT` (60% RAM maszyny, gdy nie ustawiono). Bez niego GC Go dopuszcza
// stertę do ~2x danych żywych (`GOGC=100`), więc szczyt bywa o połowę wyższy niż potrzeba.
// Miękki limit sprawia, że na mniejszej maszynie kompilator zwalnia (częstszy GC) zamiast
// zostać zabity bez słowa - to samo dotyczy podglądu Lovable z limitem czasu.
import { createRequire } from "node:module";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const explicitParallelism = args.some(
  (arg) => arg === "--singleThreaded" || arg === "--checkers" || arg.startsWith("--checkers="),
);
if (!explicitParallelism) process.argv.push("--checkers", "2");
process.env.GOMEMLIMIT ??= `${Math.floor((totalmem() * 0.6) / 2 ** 20)}MiB`;

const require = createRequire(import.meta.url);
const tsDir = dirname(require.resolve("typescript/package.json"));
await import(pathToFileURL(join(tsDir, "lib", "tsc.js")).href);
