// Serwerowa mapa zestawu bootu (P2.1), PODMIENIANA W BUILDZIE.
//
// Ten plik jest w źródłach po to, żeby nie było modułu wirtualnego w grafie testów i deva - ten
// sam wzorzec co `src/lib/seo/localeChunks.ts`. Wartość `null` jest JAWNYM fallbackiem: vitest,
// `bun run dev` i build bez wtyczki widzą „brak mapy", więc serwer nie składa zestawu bootu
// (w `<head>` nie ma `#nes-boot-set`), a dokument startuje tak jak dotąd - przez `<Scripts>`
// frameworka (manifest bez przepisania niesie wtedy skrypt wejścia).
//
// W buildzie, w środowisku SERWERA (`ssr`), wtyczka `nes:boot-after-lcp`
// (`scripts/lib/bootAfterLcpPlugin.ts`) zamienia deklarację niżej na reeksport
// `nesBootManifest` z przepisanego modułu `tanstack-start-manifest:v`: wejście klienta, preloady
// korzenia i preloady każdej trasy. Bundel przeglądarki tego pliku nie zna - czyta go wyłącznie
// `bootSet.server.ts`.
//
// PRELOADY TO PEŁNE STATYCZNE DOMKNIĘCIE. Od `@tanstack/start-plugin-core` 1.171.53 manifest Start
// liczy preloady chunku z CAŁEGO domknięcia jego statycznych importów (`getStaticImportClosure`,
// `start-manifest-plugin/manifestBuilder.js:162-204`; wcześniej wyłącznie bezpośrednie importy,
// jeden poziom). Przy `hoistTransitiveImports: false` (`vite.config.ts`) lista w `#nes-boot-set`
// i nagłówek `Link` dokumentu `now` są więc dłuższe niż przed podbiciem - kolejność to kolejność
// manifestu (chunk, potem domknięcie w głąb).
//
// NIE ZMIENIAJ KSZTAŁTU DEKLARACJI bez zmiany wtyczki: podmiana dopasowuje
// `export const BOOT_MANIFEST = null` (po transpilacji TS) i przerywa build, gdy go nie znajdzie.

/** Serwerowa mapa zestawu bootu (eksport `nesBootManifest` przepisanego manifestu Start). */
export interface BootManifest {
  /** Moduł wejściowy klienta (dawniej `<script type="module" async>` z `<Scripts>`). */
  readonly entry: string;
  /** Preloady korzenia: wejście + domknięcie jego statycznych importów (kolejność manifestu). */
  readonly rootPreloads: readonly string[];
  /** Preloady pozostałych tras: id trasy -> chunki trasy + domknięcie ich statycznych importów. */
  readonly routePreloads: Readonly<Record<string, readonly string[]>>;
}

export const BOOT_MANIFEST: BootManifest | null = null;
