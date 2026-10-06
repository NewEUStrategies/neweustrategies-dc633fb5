// Serwerowa mapa zestawu bootu (P2.1), PODMIENIANA W BUILDZIE.
//
// Ten plik jest w źródłach po to, żeby nie było modułu wirtualnego w grafie testów i deva - ten
// sam wzorzec co `src/lib/seo/localeChunks.ts`. Wartość `null` jest JAWNYM fallbackiem: vitest,
// `bun run dev` i build bez wtyczki widzą „brak mapy", więc serwer nie wstrzykuje zestawu bootu,
// a dokument startuje tak jak dotąd - przez `<Scripts>` frameworka (manifest bez przepisania
// niesie wtedy skrypt wejścia).
//
// W buildzie, w środowisku SERWERA (`ssr`), wtyczka `nes:boot-after-lcp`
// (`scripts/lib/bootAfterLcpPlugin.ts`) zamienia deklarację niżej na reeksport
// `nesBootManifest` z przepisanego modułu `tanstack-start-manifest:v`: wejście klienta, preloady
// korzenia (wejście + jego statyczne importy) i preloady każdej trasy. Bundel przeglądarki tego
// pliku nie zna - czyta go wyłącznie `bootSet.server.ts`.
//
// NIE ZMIENIAJ KSZTAŁTU DEKLARACJI bez zmiany wtyczki: podmiana dopasowuje
// `export const BOOT_MANIFEST = null` (po transpilacji TS) i przerywa build, gdy go nie znajdzie.

/** Serwerowa mapa zestawu bootu (eksport `nesBootManifest` przepisanego manifestu Start). */
export interface BootManifest {
  /** Moduł wejściowy klienta (dawniej `<script type="module" async>` z `<Scripts>`). */
  readonly entry: string;
  /** Preloady korzenia: wejście + jego statyczne importy (jeden poziom, kolejność manifestu). */
  readonly rootPreloads: readonly string[];
  /** Preloady pozostałych tras: id trasy -> chunki trasy + ich bezpośrednie importy. */
  readonly routePreloads: Readonly<Record<string, readonly string[]>>;
}

export const BOOT_MANIFEST: BootManifest | null = null;
