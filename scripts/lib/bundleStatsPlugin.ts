/**
 * Zrzut składu chunków klienta - włączany zmienną `BUNDLE_STATS=1`.
 *
 * PO CO: historia progów w `scripts/check-bundle-size.ts` to ciąg wpisów
 * „ślad urósł o X KB, nie wiadomo przez co, podnosimy floor". Bramka mówi ILE,
 * nigdy PRZEZ CO - a bez tej drugiej odpowiedzi jedyną dostępną reakcją jest
 * re-floor, czyli utrwalenie regresu. Ten plugin zapisuje mapę
 * moduł -> chunk -> rozmiar po renderze, więc „co siedzi w entry" jest
 * pytaniem z odpowiedzią w 10 sekund (`bun run analyze:bundle`).
 *
 * BEZPIECZEŃSTWO ARTEFAKTU: bez zmiennej środowiskowej plugin nie robi NIC -
 * nie ma hooka, który by się wykonał, więc build produkcyjny jest bit-w-bit
 * taki sam. Zrzut trafia do `reports/` (katalog w .gitignore).
 *
 * i18n: brak treści dla użytkownika - narzędzie deweloperskie.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const BUNDLE_STATS_PATH = "reports/bundle-modules.json";

/** Jeden moduł wejściowy wewnątrz chunku. */
export interface BundleStatsModule {
  /** Ścieżka modułu, znormalizowana do repo albo `node_modules/<pakiet>/...`. */
  id: string;
  /** Rozmiar PO transformacjach i minifikacji, w bajtach. */
  renderedLength: number;
}

export interface BundleStatsChunk {
  fileName: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  /** Rozmiar surowy (przed gzipem) w bajtach. */
  rawLength: number;
  /** Statyczne importy chunk -> chunk (krawędzie inicjalizacyjne). */
  imports: string[];
  dynamicImports: string[];
  modules: BundleStatsModule[];
}

export interface BundleStats {
  environment: string;
  chunks: BundleStatsChunk[];
}

/** Skraca bezwzględne ścieżki do postaci czytelnej i porównywalnej między hostami. */
export function normalizeModuleId(id: string, cwd: string): string {
  let out = id.split("\\").join("/");
  const nm = out.lastIndexOf("/node_modules/");
  if (nm !== -1) return out.slice(nm + 1);
  const root = cwd.split("\\").join("/");
  if (out.startsWith(`${root}/`)) out = out.slice(root.length + 1);
  // Vite dokleja sufiksy transformacji (`?tss-serverfn-split`, `?raw`) - do
  // analizy wagi liczy się plik, nie wariant transformacji.
  const query = out.indexOf("?");
  return query === -1 ? out : out.slice(0, query);
}

/**
 * Vite plugin. Zwraca `false`, gdy zrzut jest wyłączony - Vite pomija takie
 * wpisy, więc nie ma nawet pustego pluginu w łańcuchu.
 */
export function bundleStatsPlugin(cwd: string = process.cwd()) {
  if (!process.env.BUNDLE_STATS) return false as const;
  return {
    name: "nes:bundle-stats",
    apply: "build" as const,
    generateBundle(this: unknown, _options: unknown, bundle: Record<string, unknown>) {
      const self = this as { environment?: { name?: string } };
      const environment = self.environment?.name ?? "unknown";
      // Zrzucamy WYŁĄCZNIE bundel przeglądarki - chunki workera składa Nitro
      // własnym rollupem i ich waga nie dotyczy czytelnika.
      if (environment !== "client") return;

      const chunks: BundleStatsChunk[] = [];
      for (const output of Object.values(bundle)) {
        const chunk = output as {
          type: string;
          fileName: string;
          code?: string;
          isEntry?: boolean;
          isDynamicEntry?: boolean;
          imports?: string[];
          dynamicImports?: string[];
          modules?: Record<string, { renderedLength: number }>;
        };
        if (chunk.type !== "chunk") continue;
        chunks.push({
          fileName: chunk.fileName,
          isEntry: !!chunk.isEntry,
          isDynamicEntry: !!chunk.isDynamicEntry,
          rawLength: chunk.code?.length ?? 0,
          imports: chunk.imports ?? [],
          dynamicImports: chunk.dynamicImports ?? [],
          modules: Object.entries(chunk.modules ?? {})
            .map(([id, mod]) => ({
              id: normalizeModuleId(id, cwd),
              renderedLength: mod.renderedLength,
            }))
            .filter((m) => m.renderedLength > 0)
            .sort((a, b) => b.renderedLength - a.renderedLength),
        });
      }
      chunks.sort((a, b) => b.rawLength - a.rawLength);

      const stats: BundleStats = { environment, chunks };
      mkdirSync(dirname(BUNDLE_STATS_PATH), { recursive: true });
      writeFileSync(BUNDLE_STATS_PATH, JSON.stringify(stats, null, 2));
      console.log(`[bundle-stats] ${chunks.length} chunków -> ${BUNDLE_STATS_PATH}`);
    },
  };
}
