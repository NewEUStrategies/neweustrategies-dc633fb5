// Bramka CI: ŻADEN klucz i18n w całym `src` nie może istnieć wyłącznie w kodzie.
//
// CZEGO NIE ŁAPIE PARYTET. Parytet PL/EN porównuje słowniki ze sobą, więc klucz
// nieobecny w OBU jest dla niego niewidzialny. Do tego `defaultValue` przy
// wywołaniu sprawia, że taki brak nie daje ani błędu typów, ani gołego klucza
// na ekranie - tylko tekst z kodu, w jednym języku, w interfejsie drugiego.
// Dokładnie ten wzorzec siedział w `SiteSettingsHistoryDialog.tsx`: dziewięć
// kluczy `admin.themeOptions.history.*`, polskie napisy wpisane w kod jako
// POZYCYJNY `defaultValue`, angielski panel renderujący polszczyznę.
//
// DLACZEGO REPO-WIDE, A NIE PER MODUŁ. Bramki modułowe (kluby, sieć) powstały
// po incydentach w tych modułach i są ostrzejsze - kluby dopuszczają ZERO
// `defaultValue`, a kanarki wymieniają po nazwie każdą gałąź dynamiczną. Ale
// bramka istniejąca tylko tam, gdzie już się przewróciło, nie chroni miejsca,
// które się jeszcze nie przewróciło. Ta bramka jest podłogą dla całego repo.
//
// PROGIEM JEST ZERO, NIE RATCHET. Kandydatem był licznik, który może tylko
// maleć - i został odrzucony po POMIARZE: po naprawach w tym PR skaner widzi
// 10 905 wywołań `t()` i zero rozjazdów. Ratchet przy zerowym długu to sama
// ceremonia: dopuszczałby regresję do „poziomu z zeszłego tygodnia".
//
// CO Z 1 263 POZOSTAŁYMI `defaultValue`. Wszystkie są ZBĘDNE - ich klucze są
// w obu słownikach, co ta bramka udowadnia przy każdym uruchomieniu. To zmienia
// ich status: dopóki bramka jest zielona, `defaultValue` nie ma czego ukryć,
// bo zniknięcie klucza (zmiana nazwy, usunięcie ze słownika) natychmiast oblewa
// jako `masked`. Dlatego NIE kasujemy ich hurtem - 1 263 zmiany bez zmiany
// zachowania to diff, którego nikt nie przeczyta, a ryzyko zdejmuje bramka,
// nie usuwanie linii.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import { type ResourceTree } from "@/lib/ci/i18nParity";
import {
  auditKeyUsage,
  keyUsageFailed,
  renderKeyUsageReport,
  scanTranslationCalls,
  type KeyUsage,
} from "@/lib/ci/i18nKeyUsage";

/**
 * Katalogi wyjęte ze skanu wraz z powodem. Każdy wyjątek jest decyzją do
 * review - lista bez uzasadnień zamienia się z czasem w listę wymówek.
 */
const EXCLUDED = [
  // Fixture'y samego skanera deklarują klucze-atrapy (`network.ghost`), których
  // celowo nie ma w słowniku - to one dowodzą, że bramka umie oblać.
  "src/lib/ci/",
] as const;

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base: ResourceTree, overlay: ResourceTree): ResourceTree {
  const out: ResourceTree = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    out[key] = isTree(value) && isTree(existing) ? deepMerge(existing, value) : value;
  }
  return out;
}

/**
 * Nakładki `i18n-*.ts` rejestrują zasoby efektem ubocznym importu, a produkcja
 * ładuje je leniwie (`ensureXI18n()`). Bramka musi mieć je WSZYSTKIE naraz,
 * inaczej „brakujący" klucz oznaczałby tylko nieimportowaną nakładkę.
 *
 * GLOB STOI NA POZIOMIE MODUŁU I TO NIE JEST KOSMETYKA. Pierwsza wersja tej
 * bramki wołała `Object.keys(import.meta.glob(...)).length` jako WYRAŻENIE
 * wewnątrz funkcji - Vite nie zamienił tego na statyczne importy, więc nakładki
 * nigdy się nie wykonały i `addResourceBundle` nie miało jak zarejestrować
 * niczego. Skutek: słownik miał 19 kluczy najwyższego poziomu zamiast 114,
 * a bramka zgłaszała 756 „braków", z których żaden nie był brakiem.
 * Ten sam błąd w drugą stronę byłby GROŹNIEJSZY: bramka porównująca kod
 * z samym rdzeniem słownika przechodzi na zielono wszędzie tam, gdzie klucz
 * i tak jest w rdzeniu - czyli jest zielona i ślepa naraz. Stąd kanarek
 * `OVERLAY_ONLY_KEY` niżej: klucz, którego w rdzeniu NIE MA.
 */
const OVERLAY_MODULES = import.meta.glob("/src/lib/i18n-*.ts", { eager: true });

function loadOverlays(): number {
  return Object.keys(OVERLAY_MODULES).length;
}

/**
 * Klucz żyjący WYŁĄCZNIE w nakładce (`i18n-admin-extras.ts`), nigdy w
 * `locale/pl.ts`. Jeśli scalone drzewo go nie widzi, nakładki nie weszły -
 * i cała reszta bramki jest bez wartości dowodowej.
 */
const OVERLAY_ONLY_KEY = ["admin", "autosave", "saving"] as const;

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

function scannedFiles(): string[] {
  return sourceFiles("src").filter((path) => !EXCLUDED.some((dir) => path.startsWith(dir)));
}

/**
 * Wyłącznie wywołania `t()`. Skan gołych literałów w kształcie klucza
 * (`scanKeyReferences`) zostaje w bramkach modułowych, gdzie da się podać
 * korzenie: repo-wide łapałby ścieżki importów i nazwy pól bazy, a bramka
 * z szumem to bramka, którą się wycisza.
 */
function collectUsage(files: readonly string[]): KeyUsage[] {
  return files.flatMap((file) => scanTranslationCalls(file, readFileSync(file, "utf8")));
}

function bundle(lang: "pl" | "en", core: ResourceTree): ResourceTree {
  const registered = i18n.getResourceBundle(lang, "translation");
  return deepMerge(core, isTree(registered) ? registered : {});
}

describe("bramka rozjazdu kod <-> słownik dla całego `src`", () => {
  const files = scannedFiles();
  const usage = collectUsage(files);

  it("nakładki i18n są realnie scalone - kanarek wartości dowodowej", () => {
    // Ta asercja stoi PRZED bramką właściwą, bo bez niej zielone „zero
    // rozjazdów" nie znaczy nic: porównywalibyśmy kod z samym rdzeniem.
    expect(loadOverlays()).toBeGreaterThan(20);
    for (const lang of ["pl", "en"] as const) {
      const tree = bundle(lang, (lang === "pl" ? corePl : coreEn) as ResourceTree);
      const value = OVERLAY_ONLY_KEY.reduce<unknown>(
        (node, segment) => (isTree(node) ? node[segment] : undefined),
        tree,
      );
      expect(
        typeof value,
        `[${lang}] klucz ${OVERLAY_ONLY_KEY.join(".")} żyje tylko w nakładce - jego brak znaczy, że nakładki nie weszły`,
      ).toBe("string");
    }
  });

  it("każdy klucz wołany przez t() istnieje w PL i w EN", () => {
    loadOverlays();
    const pl = bundle("pl", corePl as ResourceTree);
    const en = bundle("en", coreEn as ResourceTree);
    const audit = auditKeyUsage(usage, { pl, en });
    expect(keyUsageFailed(audit), renderKeyUsageReport(audit)).toBe(false);
  });

  it("skan pokrywa całe repo - kanarek zasięgu", () => {
    // Bez tego bramka po zmianie konwencji (`useTranslation` na inny hak,
    // przeniesienie tras) robi się pusta i zielona, a zielone zero brzmi
    // identycznie jak zielone „przeskanowano 10 tysięcy wywołań".
    expect(files.length).toBeGreaterThan(900);
    expect(usage.length).toBeGreaterThan(9000);
    // Powierzchnie o różnym stylu wywołań: trasa publiczna, panel, komponent
    // produktowy. Gdyby skaner przestał widzieć którąkolwiek, liczby wyżej
    // nadal by przechodziły.
    for (const marker of ["src/routes/", "src/components/admin/", "src/components/"]) {
      expect(
        usage.some((u) => u.file.startsWith(marker)),
        `skan nie widzi ani jednego wywołania w ${marker}`,
      ).toBe(true);
    }
  });

  it("skaner widzi POZYCYJNY defaultValue, nie tylko opcję w obiekcie", () => {
    // To nie jest test skanera (ten jest w `src/lib/ci/__tests__`), a asercja
    // o TEJ bramce: gdyby forma pozycyjna znów wypadła z rozpoznawania, klasa
    // „klucz nieobecny, tekst w kodzie" wróciłaby do raportowania jako zwykły
    // brak - a to ona przechodzi przez review niezauważona.
    const probe = scanTranslationCalls("probe.tsx", 't("a.b", "Tekst zapasowy")');
    expect(probe.map((u) => u.defaultValue)).toEqual(["Tekst zapasowy"]);
  });
});
