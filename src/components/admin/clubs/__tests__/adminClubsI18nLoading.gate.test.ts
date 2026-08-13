// Bramka: podział słownika klubów na część publiczną i adminową musi się trzymać.
//
// PO CO ONA ISTNIEJE. `i18n-club.ts` ważył 188 kB i lądował w chunku WEJŚCIOWYM -
// tym, który ściąga każdy anonimowy gość, żeby przeczytać jeden artykuł. Przyczyną
// nie były importy side-effect (tych nie ma, jest `ensureClubI18n()`), a HOISTOWANIE:
// Rollup przenosi moduł dzielony przez wiele chunków tras do chunku wspólnego,
// a `manualChunks` obejmuje w tym repo tylko `/node_modules/` i dla kodu aplikacji
// jest zabroniony (incydent h3-500, patrz komentarz w `vite.config.ts`).
//
// 35 z 41 sekcji `adminClubs` obsługuje wyłącznie panel, więc wyszły do
// `i18n-clubs-admin.ts`. Przestrzeń nazw się NIE zmieniła - `addResourceBundle`
// scala głęboko, więc `adminClubs.*` pochodzi z dwóch plików i żadne wywołanie
// `t()` nie wymagało zmiany.
//
// CENA I DOKŁADNIE PO CO TA BRAMKA. Plik panelu, który woła przeniesiony klucz,
// ale NIE importuje `ensureAdminClubsI18n`, renderuje GOŁY KLUCZ - a tego nie
// zobaczy ani bramka parytetu (porównuje słowniki ze sobą), ani bramka rozjazdu
// kod<->słownik (ładuje WSZYSTKIE nakładki eagerly przez `import.meta.glob`, więc
// u niej klucz zawsze istnieje). Ten defekt jest widoczny wyłącznie w przeglądarce.
// Dlatego sprawdzenie jest statyczne: kto woła, ten importuje.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC_DICT = "src/lib/i18n-club.ts";
const ADMIN_DICT = "src/lib/i18n-clubs-admin.ts";

/**
 * Sekcje `adminClubs.*`, które MUSZĄ zostać w słowniku publicznym, bo woła je
 * powierzchnia osiągalna z tras publicznych. Ustalone domknięciem importów
 * (nie położeniem w katalogu - `ClubElementsGallery` leży pod
 * `src/components/clubs/`, a jest osiągalny wyłącznie z panelu).
 */
const PUBLIC_SECTIONS = ["saved", "saveFailed", "specializations", "invitations", "layout"] as const;

/** Sekcje przeniesione do słownika panelu - wołający MUSI zawołać `ensure`. */
const ADMIN_SECTIONS = [
  "applications",
  "topics",
  "navLabel",
  "title",
  "subtitle",
  "newClub",
  "editClub",
  "openPublic",
  "noPermissionTitle",
  "noPermissionBody",
  "empty",
  "emptyFiltered",
  "loadError",
  "searchPlaceholder",
  "filterStatus",
  "filterVisibility",
  "filterAny",
  "slugTaken",
  "requiredFields",
  "columns",
  "tabs",
  "fields",
  "accessPreviewTitle",
  "accessPreviewTier",
  "accessPreviewNoTier",
  "accessWarning",
  "groups",
  "members",
  "permissions",
  "segment",
  "presentation",
  "layoutHint",
  "threads",
  "moderation",
  "stats",
] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Wszystkie pliki produkcyjne `src`, bez słowników i18n (te deklarują klucze). */
const FILES = sourceFiles("src")
  .filter((path) => !path.startsWith("src/lib/i18n-"))
  .map((path) => ({ path, src: readFileSync(path, "utf8") }));

function sectionsUsed(src: string): Set<string> {
  return new Set([...src.matchAll(/adminClubs\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
}

/** Nazwy sekcji na pierwszym poziomie bloku `adminClubs` w danym słowniku. */
function declaredSections(dictPath: string): Set<string> {
  const src = readFileSync(dictPath, "utf8");
  const out = new Set<string>();
  for (const block of src.matchAll(/^ {2}adminClubs:\s*\{/gm)) {
    let depth = 0;
    let i = src.indexOf("{", block.index);
    const start = i;
    while (i < src.length) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    for (const m of src.slice(start, i).matchAll(/^ {4}([A-Za-z_]\w*):/gm)) out.add(m[1]);
  }
  return out;
}

describe("podział słownika klubów: publiczny vs panel", () => {
  it("każdy plik wołający sekcję PANELU importuje `ensureAdminClubsI18n`", () => {
    const admin = new Set<string>(ADMIN_SECTIONS);
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      const used = [...sectionsUsed(src)].filter((s) => admin.has(s));
      if (used.length === 0) continue;
      if (!src.includes("ensureAdminClubsI18n")) {
        offenders.push(`${path} (sekcje: ${used.sort().slice(0, 4).join(", ")})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("skan realnie coś znajduje - kanarek zasięgu", () => {
    // Bramka bez tej asercji cicho przestaje działać, gdy ktoś przeniesie pliki
    // panelu albo zmieni nazwę przestrzeni nazw.
    const withEnsure = FILES.filter(({ src }) => src.includes("ensureAdminClubsI18n"));
    expect(withEnsure.length).toBeGreaterThanOrEqual(20);
  });

  it("słownik PUBLICZNY nie odzyskał sekcji panelu", () => {
    // Regresja idzie w tę stronę: ktoś dopisuje klucz panelu do `i18n-club.ts`,
    // bo „tam już są inne adminClubs", i 45 kB wraca do chunku wejściowego.
    const declared = declaredSections(PUBLIC_DICT);
    const leaked = ADMIN_SECTIONS.filter((s) => declared.has(s));
    expect(leaked).toEqual([]);
  });

  it("słownik PANELU nie przejął sekcji publicznych", () => {
    // Druga strona: przeniesienie `invitations` zepsułoby `/club/join/$token`,
    // która renderuje `adminClubs.invitations.error.*` bez `ensure`.
    const declared = declaredSections(ADMIN_DICT);
    const stolen = PUBLIC_SECTIONS.filter((s) => declared.has(s));
    expect(stolen).toEqual([]);
  });

  it("słownik panelu ma `ensureAdminClubsI18n` i ZERO importów side-effect", () => {
    const src = readFileSync(ADMIN_DICT, "utf8");
    expect(src).toContain("export function ensureAdminClubsI18n()");
    // `import "@/lib/i18n-clubs-admin"` wciągnąłby słownik w graf wejściowy -
    // czyli dokładnie z powrotem tam, skąd go wyprowadziliśmy.
    const sideEffect = FILES.filter(({ src: s }) => s.includes('import "@/lib/i18n-clubs-admin"'));
    expect(sideEffect.map((f) => f.path)).toEqual([]);
  });
});
