// Podział chunków vendorowych wg OSIĄGALNOŚCI PRZY BOOCIE (klient).
//
// PO CO. `vendor-radix` (38 KB gzip) jechał w domknięciu bootu każdej strony
// publicznej, bo JEDEN moduł wejściowy (`components/ui/button.tsx`) importuje
// `@radix-ui/react-slot`; `vendor-lucide` (32 KB gzip) woził KAŻDĄ ikonę użytą
// gdziekolwiek w aplikacji, choć chrome potrzebuje ~60% z nich. Rollup zna
// graf statyczny dokładnie - wystarczy zapytać, co jest osiągalne z modułu
// wejściowego bez `import()`, i rozciąć te pakiety na część bootową
// (`vendor-*-boot`) i resztę (ładowaną z leniwymi trasami).
//
// ZASADA DOMKNIĘCIA (incydent 2026-07-20, martwa hydratacja): chunk bootowy
// NIE MOŻE importować z chunku niebootowego tego samego pakietu - inaczej
// entry -> vendor-x-boot -> vendor-x, a vendor-x -> vendor-x-boot = cykl.
// Zbiór „boot" liczony jako domknięcie przechodnie po STATYCZNYCH krawędziach
// z modułu wejściowego jest z definicji zamknięte na zależności: każda
// statyczna zależność modułu bootowego też jest bootowa. Krawędzie między
// nowymi chunkami biegną więc wyłącznie w kierunku niebootowy -> bootowy.
// Bramka po buildzie: `bun run check:chunks` (cykle) + boot-test smoke.
//
// PUŁAPKA BARREL (lucide-react): `lucide-react/dist/esm/lucide-react.js`
// re-eksportuje WSZYSTKIE ~1700 ikon (`export { default as X } from
// './icons/x.js'`). W grafie Rollupa każda ikona ma więc statycznego importera
// bootowego (barrel), choć tree-shaking zostawia w bundlu tylko użyte. Czysta
// osiągalność po krawędziach oznaczyłaby jako boot KAŻDĄ ikonę i podział nic
// by nie dał. Dla lucide liczymy więc osiągalność PO NAZWACH: które nazwy
// bootowe moduły aplikacji importują z `lucide-react` (po kodzie
// z `ModuleInfo.code`, czyli już po transformacjach - bez typów i komentarzy)
// -> `exportedBindings` barrela mapuje nazwę na plik ikony -> domknięcie
// wewnątrz pakietu (createLucideIcon, Icon, utils). Ikony NIEbootowe importują
// `createLucideIcon` (boot), nigdy odwrotnie - kierunek krawędzi zachowany.
// Gdy detekcja nie jest jednoznaczna (import przestrzeni nazw, `icons`,
// brak kodu), seedem staje się cały moduł pakietu - czyli zachowanie
// IDENTYCZNE z dotychczasowym jednym chunkiem, tylko pod nazwą `-boot`.
//
// WALIDACJA PO BUILDZIE (nie da się jej zrobić w teście jednostkowym, w dev
// nie ma chunków): `BUNDLE_INVENTORY=1 bun run build && bun run check:chunks`;
// w `reports/chunk-inventory.json` `vendor-radix-boot` ma zawierać wyłącznie
// react-slot + react-compose-refs, a `index-*.js` nie może już importować
// `vendor-radix-*` ani `vendor-lucide-*` innych niż `-boot`.
//
// WKLEJANIE DO WEJŚCIA (incydent 2026-10-10): domknięcie statyczne nie widzi
// łączenia małych chunków (`experimentalMinChunkSize`), które Rollup robi PO
// `manualChunks`. Mały moduł współdzielony przez dwie leniwe trasy trafia
// wtedy do `index-*`, a jego importy lucide stają się importami wejścia. Gdy
// klasyfikacja uznała te ikony za niebootowe, wejście importuje cały
// `vendor-lucide`. Takie moduły wymienia `ENTRY_MERGED_LUCIDE_IMPORTERS`:
// ich nazwane importy lucide liczą się jako bootowe. Dotyczy to wyłącznie
// lucide (chunki nazwane), więc graf chunków automatycznych się nie zmienia.
//
// Współdzielony przez vite.config.ts i vite.smoke.config.ts (parytet podziału
// pilnuje src/lib/ci/__tests__/viteChunkParity.test.ts).
import { posix } from "node:path";

/** Podzbiór `Rollup.ModuleInfo` potrzebny do klasyfikacji (testy podają atrapy). */
export interface BootGraphModule {
  readonly isEntry: boolean;
  readonly importedIds: readonly string[];
  readonly code: string | null;
  readonly exportedBindings: Record<string, string[]> | null;
}

/** Podzbiór `Rollup.ManualChunkMeta`. */
export interface BootGraphMeta {
  getModuleIds(): Iterable<string>;
  getModuleInfo(id: string): BootGraphModule | null;
}

// Rollup tworzy jeden obiekt `meta` na przebieg przypisywania chunków i woła
// `manualChunks` dla KAŻDEGO modułu - domknięcie liczymy raz, nie tysiące razy.
// Memoizacja po obiekcie `meta`: Rollup tworzy JEDEN obiekt manualChunksApi na
// przebieg assignManualChunks (zweryfikowane w rollup 4.60.2, node-entry.js
// ~21053). Gdyby przyszła wersja tworzyła go per moduł, WeakMap chybiałby i
// domknięcie liczyłoby się dla każdego modułu od nowa - nadal poprawnie, tylko
// wolno (O(n^2)); wtedy przenieść cache na klucz stabilny dla całego builda.
const bootCache = new WeakMap<BootGraphMeta, ReadonlySet<string>>();
const lucideCache = new WeakMap<BootGraphMeta, ReadonlySet<string>>();

const LUCIDE_DIR = "/node_modules/lucide-react/";

export const isLucideModule = (id: string): boolean => id.includes(LUCIDE_DIR);

/**
 * Domknięcie przechodnie po `importedIds` (statyczne; `import()` nie tworzy
 * krawędzi). Iteracyjnie z `seen` - graf modułów ma cykle, a id bywają
 * wirtualne (`\0...`) lub CSS - `getModuleInfo` może zwrócić null, wtedy węzeł
 * jest liściem.
 */
function staticClosure(
  seeds: Iterable<string>,
  meta: BootGraphMeta,
  within: (id: string) => boolean = () => true,
): Set<string> {
  const seen = new Set<string>();
  const pending = [...seeds];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id) || !within(id)) continue;
    seen.add(id);
    const info = meta.getModuleInfo(id);
    if (!info) continue;
    for (const dep of info.importedIds) if (!seen.has(dep)) pending.push(dep);
  }
  return seen;
}

/** Wszystkie moduły osiągalne statycznie z modułów wejściowych builda. */
export function bootModuleIds(meta: BootGraphMeta): ReadonlySet<string> {
  const cached = bootCache.get(meta);
  if (cached) return cached;
  const entries: string[] = [];
  for (const id of meta.getModuleIds()) if (meta.getModuleInfo(id)?.isEntry) entries.push(id);
  const closure = staticClosure(entries, meta);
  bootCache.set(meta, closure);
  return closure;
}

/** Moduł jest w domknięciu bootu (entry lub statycznie osiągalny z entry). */
export function isBootModule(id: string, meta: BootGraphMeta): boolean {
  return bootModuleIds(meta).has(id);
}

interface LucideImport {
  readonly specifier: string;
  /** null = import całego modułu (namespace / default / side-effect / `export *`). */
  readonly names: readonly string[] | null;
}

const LUCIDE_SPEC = /^lucide-react(?:\/|$)/;
// Formy statyczne. `import(` celowo pominięty - nie jest krawędzią
// inicjalizacji. Klauzula nazwana: opcjonalny import domyślny przed `{`.
const NAMED_RE =
  /\b(?:import|export)\s*(?:type\s+)?(?:([\w$]+)\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
// Cały moduł: `import * as X from`, `export * from`, `export * as X from`,
// `import X from`, `import "x"`.
const WHOLE_RE =
  /\b(?:import\s*\*\s*as\s+[\w$]+\s*from|export\s*\*\s*(?:as\s+[\w$]+\s*)?from|import\s+(?!type\b)[\w$]+\s*from|import)\s*["']([^"']+)["']/g;

/** Statyczne importy z pakietu lucide-react w już przetransformowanym kodzie. */
export function parseLucideImports(code: string): LucideImport[] {
  const out: LucideImport[] = [];
  for (const m of code.matchAll(NAMED_RE)) {
    const [, defaultName, list, specifier] = m;
    if (!LUCIDE_SPEC.test(specifier)) continue;
    if (defaultName) {
      out.push({ specifier, names: null });
      continue;
    }
    const names = list
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .split(",")
      .map(
        (part) =>
          part
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]
            ?.trim() ?? "",
      )
      .filter(Boolean);
    out.push({ specifier, names });
  }
  for (const m of code.matchAll(WHOLE_RE)) {
    const specifier = m[1];
    if (LUCIDE_SPEC.test(specifier)) out.push({ specifier, names: null });
  }
  return out;
}

/**
 * Nazwy eksportowane przez moduł -> moduły, które trzeba załadować. Eksport
 * własny (klucz ".") = sam moduł; re-eksport nazwany = moduł źródłowy;
 * re-eksport `export * from` przenosi nazwę bez zmiany, więc schodzimy
 * rekurencyjnie (do 8 poziomów). Moduł bez `exportedBindings` (brak info,
 * za głęboko) = sam moduł (konserwatywnie: lepiej zawyżyć boot niż stworzyć
 * brakującą krawędź). Nazwa NIEZNANA barrelowi niczego nie ładuje - to
 * najczęściej typ wymazany przez esbuild (test "ignoruje nazwy nieznane
 * barrelowi" przypina to zachowanie).
 */
function resolveExportedNames(
  moduleId: string,
  names: readonly string[],
  meta: BootGraphMeta,
  seeds: Set<string>,
  depth = 0,
): void {
  const info = meta.getModuleInfo(moduleId);
  const bindings = info?.exportedBindings;
  if (!info || !bindings || depth > 8) {
    seeds.add(moduleId);
    return;
  }
  const own = new Set(bindings["."] ?? []);
  const bySource = new Map<string, string>();
  const stars: string[] = [];
  for (const [source, exported] of Object.entries(bindings)) {
    if (source === ".") continue;
    for (const name of exported) {
      if (name === "*") stars.push(source);
      else bySource.set(name, source);
    }
  }
  const resolveSource = (source: string): string | null => {
    const joined = posix.join(posix.dirname(moduleId), source);
    if (meta.getModuleInfo(joined)) return joined;
    const suffix = source.replace(/^\.\.?\//, "/");
    return info.importedIds.find((dep) => dep.endsWith(suffix)) ?? null;
  };
  for (const name of names) {
    if (own.has(name)) {
      seeds.add(moduleId);
      continue;
    }
    const source = bySource.get(name);
    if (source) {
      const resolved = resolveSource(source);
      if (resolved) seeds.add(resolved);
      else seeds.add(moduleId);
      continue;
    }
    if (stars.length > 0) {
      for (const star of stars) {
        const resolved = resolveSource(star);
        if (resolved) resolveExportedNames(resolved, [name], meta, seeds, depth + 1);
        else seeds.add(moduleId);
      }
      continue;
    }
    // Nazwa nieznana modułowi (typ? literówka?) - nic nie ładuje, ignorujemy.
  }
}

/**
 * Moduły aplikacji (sufiksy id), które łączenie małych chunków wkleja do chunku
 * wejściowego, choć statycznie nie są z niego osiągalne (patrz nagłówek).
 * Lista jest pomiarem, nie przewidywaniem. Wpis, który przestał się wklejać,
 * kosztuje tylko kilkaset bajtów ikon w `vendor-lucide-boot`. Nowy przypadek
 * wykrywa bramka `check:entry-purity` (`vendor-lucide` w domknięciu bootu),
 * a skład wejścia pokazuje `report:chunk-inventory index`.
 *
 * - `ClubHubAccessBadge` (~0,5 KB): wspólny atom nagłówka huba klubów i
 *   katalogu elementów w panelu. Jego ikony `KeyRound` i `MailCheck` ciągnęły
 *   `vendor-lucide` (~63 KB po minifikacji, ~18 KB gzip) do bootu każdej
 *   strony. Nazwany chunk atomu nie wystarczał: Rollup dokłada do nazwanego
 *   chunku nienazwane zależności (`cn`, `cva`, `clsx`, `Badge`), z których
 *   wejście też korzysta, a ich wydzielenie przetasowało ~100 chunków
 *   współdzielonych (+8 KB gzip łącznie, zmierzone na buildzie).
 * - `ListHydrationNotice` (~1 KB): komunikat list profilu (zakładki,
 *   obserwowani), też w `index-*`. Jego `RotateCcw` jest dziś bootowy tylko
 *   dlatego, że importuje go również `lucide-shim` - wpis zamyka ten sam dług,
 *   zanim zmiana shimu go otworzy.
 */
export const ENTRY_MERGED_LUCIDE_IMPORTERS: readonly string[] = [
  "/src/components/clubs/atoms/ClubHubAccessBadge.tsx",
  "/src/components/profile/atoms/ListHydrationNotice.tsx",
];

/**
 * Moduły lucide-react potrzebne przy boocie: ikony importowane PO NAZWIE przez
 * bootowe moduły aplikacji (oraz moduły wklejane do wejścia) + ich domknięcie
 * wewnątrz pakietu.
 */
export function lucideBootIds(meta: BootGraphMeta): ReadonlySet<string> {
  const cached = lucideCache.get(meta);
  if (cached) return cached;
  const importers = new Set(bootModuleIds(meta));
  for (const id of meta.getModuleIds()) {
    if (ENTRY_MERGED_LUCIDE_IMPORTERS.some((suffix) => id.endsWith(suffix))) importers.add(id);
  }
  const seeds = new Set<string>();
  for (const importer of importers) {
    if (isLucideModule(importer)) continue;
    const info = meta.getModuleInfo(importer);
    if (!info) continue;
    const lucideDeps = info.importedIds.filter(isLucideModule);
    if (lucideDeps.length === 0) continue;
    const imports = info.code === null ? [] : parseLucideImports(info.code);
    if (imports.length === 0) {
      // Krawędź jest, a składni nie rozpoznaliśmy - zakładamy cały moduł.
      for (const dep of lucideDeps) seeds.add(dep);
      continue;
    }
    for (const { specifier, names } of imports) {
      // Specyfikator -> id: jednoznacznie przy jednej zależności lucide; dla
      // gołego "lucide-react" po pliku głównym pakietu; inaczej wszystkie.
      const target =
        lucideDeps.length === 1
          ? lucideDeps[0]
          : specifier === "lucide-react"
            ? lucideDeps.find((dep) => /\/lucide-react\.(m?js)$/.test(dep))
            : undefined;
      const targets = target ? [target] : lucideDeps;
      for (const id of targets) {
        if (names === null) seeds.add(id);
        else resolveExportedNames(id, names, meta, seeds);
      }
    }
  }
  const closure = staticClosure(seeds, meta, isLucideModule);
  lucideCache.set(meta, closure);
  return closure;
}

/** Ikona/runtime lucide potrzebne przy boocie (po nazwach, patrz nagłówek). */
export function isBootLucideModule(id: string, meta: BootGraphMeta): boolean {
  return lucideBootIds(meta).has(id);
}
