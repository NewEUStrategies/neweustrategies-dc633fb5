// Wtyczka pomiarowa: zrzuca skład chunków bundla (moduł -> chunk -> bajty).
//
// PO CO. Komentarze w `scripts/check-bundle-size.ts` od miesięcy odsyłają do
// "realnej redukcji" (split locale'i PL/EN, odchudzenie chrome, @tanstack poza
// entry) jako osobnej pracy - a ta praca nie miała żadnego przyrządu. Po
// minifikacji chunk jest nieczytelny, więc jedyne, co dotąd było mierzalne, to
// SUMA kilobajtów; odpowiedź na pytanie "co konkretnie siedzi w entry" zawsze
// wymagała zgadywania. Rollup zna ten podział dokładnie (`chunk.modules`) -
// wystarczy go zapisać.
//
// Wtyczka jest BEZWARUNKOWO WYŁĄCZONA, dopóki nie ustawisz `BUNDLE_INVENTORY=1`,
// więc zwykły `bun run build` (i CI) nie płaci za nią niczym i nie produkuje
// artefaktów. Raport czyta `scripts/chunk-inventory.ts`.
//
// Usage: BUNDLE_INVENTORY=1 bun run build && bun run report:chunk-inventory
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Plugin } from "vite";

export interface ChunkInventoryModule {
  /** Ścieżka modułu (id z Rollupa), znormalizowana do repo/pakietu. */
  readonly id: string;
  /** Bajty PO transformacjach, przed minifikacją całego chunku. */
  readonly bytes: number;
}

export interface ChunkInventoryChunk {
  readonly file: string;
  readonly isEntry: boolean;
  readonly isDynamicEntry: boolean;
  /** Statyczne importy chunku (nazwy plików). */
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly bytes: number;
  readonly modules: readonly ChunkInventoryModule[];
}

export interface ChunkInventory {
  /** Katalog wyjściowy builda - rozróżnia środowisko klienta i serwera. */
  readonly outDir: string;
  readonly chunks: readonly ChunkInventoryChunk[];
}

const OUTPUT_PATH = "reports/chunk-inventory.json";

export function chunkInventoryPlugin(): Plugin {
  return {
    name: "nes:chunk-inventory",
    apply: "build",
    generateBundle(options, bundle) {
      if (process.env["BUNDLE_INVENTORY"] !== "1") return;
      const outDir = options.dir ?? "";
      // Interesuje nas wyłącznie bundel przeglądarki; artefakt workera składa
      // Nitro własnym rollupem i jego skład niczego tu nie tłumaczy.
      if (!/client|public/.test(outDir)) return;

      const chunks: ChunkInventoryChunk[] = [];
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") continue;
        const modules: ChunkInventoryModule[] = Object.entries(output.modules)
          .map(([id, info]) => ({ id, bytes: info.renderedLength }))
          .filter((m) => m.bytes > 0)
          .sort((a, b) => b.bytes - a.bytes);
        chunks.push({
          file,
          isEntry: output.isEntry,
          isDynamicEntry: output.isDynamicEntry,
          imports: [...output.imports],
          dynamicImports: [...output.dynamicImports],
          bytes: modules.reduce((sum, m) => sum + m.bytes, 0),
          modules,
        });
      }

      const inventory: ChunkInventory = {
        outDir,
        chunks: chunks.sort((a, b) => b.bytes - a.bytes),
      };
      mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
      writeFileSync(OUTPUT_PATH, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
      this.warn(`[chunk-inventory] zapisano ${OUTPUT_PATH} (${chunks.length} chunkow)`);
    },
  };
}
