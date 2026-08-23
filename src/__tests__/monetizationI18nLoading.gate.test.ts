// Bramka: leniwe słowniki monetyzacji (moduł 14) muszą naprawdę być leniwe,
// a każdy, kto woła ich klucze, musi je załadować.
//
// PO CO ONA ISTNIEJE. Moduł 14 ma SIEDEM słowników i dwa różne mechanizmy
// ładowania w jednym module. Pięć deklaruje się jako leniwe (eksportują funkcję
// `ensure*`), dwa są ładowane importem side-effect. Sam typ tego nie widzi,
// a każda z trzech możliwych pomyłek psuje panel po cichu:
//
//   1. WOŁA KLUCZ, NIE ŁADUJE SŁOWNIKA. Plik renderuje `t("adsAdmin.title")`,
//      ale nie woła `ensureI18n` z `i18n-ads-admin`. i18next nie ma klucza, więc
//      zwraca sam klucz - w panelu pojawia się napis „adsAdmin.title". Ani
//      bramka parytetu (porównuje słowniki MIĘDZY SOBĄ), ani bramka rozjazdu
//      kod<->słownik (ładuje wszystkie nakładki eagerly przez `import.meta.glob`,
//      więc u niej klucz zawsze istnieje) tego nie widzą. Widać to wyłącznie
//      w przeglądarce.
//   2. ZŁY ALIAS. Cztery słowniki tego modułu eksportują funkcję o tej samej
//      nazwie `ensureI18n` - jest to nazwa ogólnorepozytoryjna, używana przez
//      ~15 słowników. Konwencja `import { ensureI18n as ensureAdsAdminI18n }`
//      rozróżnia je NA POZIOMIE CZYTELNIKA, nie kompilatora: plik wołający
//      klucze `giftingAdmin.*`, który przez wklejenie zaimportował loader
//      `i18n-ads-admin`, kompiluje się bez jednego ostrzeżenia.
//   3. IMPORT SIDE-EFFECT NIWECZY LENIWOŚĆ. Jeden `import "@/lib/i18n-donate"`
//      wciąga słownik do grafu wejściowego, mimo że plik eksportuje `ensureI18n`
//      właśnie po to, żeby tam nie trafił. Mechanizm zostaje, efekt znika -
//      i nie ma czerwonego światła, bo nic się nie psuje FUNKCJONALNIE.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Parytet pl/en pilnuje
// `src/__tests__/i18nParity.gate.test.ts`; rozjazd kod<->słownik
// `i18nKeyDrift.gate.test.ts`; kompletność trzech map etykiet reklamowych
// `src/lib/ads/__tests__/adLabelKeys.gate.test.ts`. Wzorzec tej bramki to
// `src/components/admin/clubs/__tests__/adminClubsI18nLoading.gate.test.ts` -
// tutaj jest zawężony do modułu 14 i rozszerzony o punkty 2 i 3.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Slownik {
  /** Przestrzeń nazw pierwszego poziomu w `t("<ns>....")`. */
  ns: string;
  /** Ścieżka modułu słownika (bez rozszerzenia, w formie aliasu `@/lib/...`). */
  modul: string;
  /** Nazwa eksportowanej funkcji ładującej albo `null` dla słownika eager. */
  loader: string | null;
}

/**
 * Siedem słowników modułu 14. `loader: null` znaczy „słownik nigdy nie
 * zadeklarował leniwości" - taki jest ładowany importem side-effect i to jest
 * stan zastany, nie defekt tej bramki (odnotowany w raporcie jako dług).
 */
const SLOWNIKI: Slownik[] = [
  { ns: "adsAdmin", modul: "@/lib/i18n-ads-admin", loader: "ensureI18n" },
  { ns: "adminCoupons", modul: "@/lib/i18n-admin-coupons", loader: "ensureI18n" },
  { ns: "giftingAdmin", modul: "@/lib/i18n-gifting-admin", loader: "ensureI18n" },
  {
    ns: "adminDonations",
    modul: "@/lib/i18n-donations-admin",
    loader: "ensureDonationsAdminI18n",
  },
  { ns: "donate", modul: "@/lib/i18n-donate", loader: "ensureI18n" },
  { ns: "gifting", modul: "@/lib/i18n-gifting", loader: null },
  { ns: "donationsWidget", modul: "@/lib/i18n-donations-widget", loader: null },
];

const LENIWE = SLOWNIKI.filter((s) => s.loader !== null);

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

/** Pliki produkcyjne `src` bez samych słowników (te deklarują klucze). */
const FILES = sourceFiles("src")
  .filter((path) => !path.startsWith(join("src", "lib", "i18n-")))
  .map((path) => ({ path, src: readFileSync(path, "utf8") }));

/**
 * Klucze osiągane POŚREDNIO: `AdPlacementRow` renderuje
 * `t(AD_POSITION_LABEL_KEYS[...])`, więc potrzebuje słownika `adsAdmin`, choć
 * nie ma w sobie ani jednego literału `"adsAdmin."`. Bez tej mapy bramka
 * uznałaby taki plik za „ładujący słownik, którego nie używa".
 */
const MAPY_KLUCZY: Record<string, readonly string[]> = {
  adsAdmin: ["AD_POSITION_LABEL_KEYS", "AD_PAGE_TYPE_LABEL_KEYS", "AD_SLOT_KIND_LABEL_KEYS"],
};

/** Czy plik woła KTÓRYKOLWIEK klucz danej przestrzeni nazw - wprost lub przez mapę. */
function wolaNs(src: string, ns: string): boolean {
  // Klucz zawsze trafia do `t()` jako literał: "ns.x", 'ns.x' albo `ns.x`.
  if (new RegExp(String.raw`["'\x60]` + ns + String.raw`\.`).test(src)) return true;
  return (MAPY_KLUCZY[ns] ?? []).some((mapa) =>
    new RegExp(String.raw`\b` + mapa + String.raw`\b`).test(src),
  );
}

/**
 * Czy plik w ogóle ZDOBYWA tłumacza. Plik, który tylko DEKLARUJE nazwy kluczy
 * i nigdy ich nie renderuje (`src/lib/ads/types.ts` - trzy mapy etykiet), nie
 * może pokazać gołego klucza, więc nie ma powodu ładować słownika.
 * Kompletności tych nazw pilnuje osobna bramka:
 * `src/lib/ads/__tests__/adLabelKeys.gate.test.ts`.
 */
function maTlumacza(src: string): boolean {
  return /from\s+["']react-i18next["']/.test(src) || /\bi18n\.t\(/.test(src);
}

/** Czy plik importuje loader Z TEGO modułu (alias dowolny). */
function importujeLoader(src: string, s: Slownik): boolean {
  const rx = new RegExp(
    String.raw`import\s*\{[^}]*\b` +
      s.loader +
      String.raw`\b[^}]*\}\s*from\s*["']` +
      s.modul +
      String.raw`["']`,
    "s",
  );
  return rx.test(src);
}

/** Czy plik wciąga słownik importem side-effect (`import "@/lib/i18n-x"`). */
function importSideEffect(src: string, s: Slownik): boolean {
  return new RegExp(String.raw`import\s+["']` + s.modul + String.raw`["']`).test(src);
}

describe("bramka ładowania słowników monetyzacji (moduł 14)", () => {
  it.each(LENIWE)("każdy plik renderujący klucze $ns ŁADUJE słownik $modul", (s) => {
    // Twierdzenie najsłabsze i najważniejsze: słownik jest załadowany
    // JAKKOLWIEK. Którym mechanizmem - sprawdza następny test.
    const winni = FILES.filter(
      ({ src }) =>
        wolaNs(src, s.ns) &&
        maTlumacza(src) &&
        !importujeLoader(src, s) &&
        !importSideEffect(src, s),
    )
      .map(({ path }) => path)
      .sort();
    expect(winni).toEqual([]);
  });

  it.each(LENIWE.filter((s) => s.modul !== "@/lib/i18n-donate"))(
    "słownik $modul jest ładowany WYŁĄCZNIE loaderem, nigdy importem side-effect",
    (s) => {
      const sideEffect = FILES.filter(({ src }) => importSideEffect(src, s))
        .map(({ path }) => path)
        .sort();
      expect(sideEffect).toEqual([]);
    },
  );

  it.fails(
    "DEFEKT: `i18n-donate.ts` eksportuje `ensureI18n`, a dwa pliki wciągają go importem side-effect",
    () => {
      // OCZEKIWANE ZACHOWANIE: `DonationCta.tsx` i `DonationForm.tsx` wołają
      // `ensureI18n()` z `@/lib/i18n-donate` w ciele komponentu, tak jak robi to
      // `SchedulerHealthPanel.tsx` i pozostałe ~15 powierzchni w repozytorium -
      // zamiast `import "@/lib/i18n-donate"` w nagłówku pliku.
      //
      // DLACZEGO TO ZNACZY WIĘCEJ NIŻ 3,9 kB. Docblock nad `ensureI18n`
      // w `i18n-donate.ts` mówi WPROST: „No-op wołany w KOMPONENCIE trasy
      // (nie side-effectowym importem w pliku trasy)". Mechanizm jest, jest
      // udokumentowany, i jest zniweczony przez dwóch wołających. `DonationCta`
      // jest osiągalny z `DonationsWidgetView`, czyli z widgetu, który redakcja
      // wstawia w CMS na DOWOLNĄ stronę - w tym na stronę główną. Słownik
      // płatności ląduje więc w chunku, który ściąga anonimowy gość czytający
      // jeden artykuł.
      //
      // NIE NAPRAWIAM TEGO W TYM ZLECENIU: przeniesienie importu zmienia
      // moment rejestracji `addResourceBundle` względem pierwszego renderu,
      // a reguła 1 zlecenia zabrania zmian produkcyjnych pod zieloną bramkę.
      // Pozycja jest w raporcie.
      const sideEffect = FILES.filter(({ src }) =>
        /import\s+["']@\/lib\/i18n-donate["']/.test(src),
      ).map(({ path }) => path);
      expect(sideEffect).toEqual([]);
    },
  );

  it.each(LENIWE)("każdy plik importujący loader $modul naprawdę go WOŁA", (s) => {
    // `noUnusedLocals` w tsconfig łapie import zupełnie nieużyty, ale nie łapie
    // sytuacji, w której alias jest przekazany dalej albo tylko wspomniany
    // w typie. Kontraktem jest WYWOŁANIE - bez niego `addResourceBundle`
    // z modułu słownika nigdy nie wystartuje w tym chunku.
    const winni: string[] = [];
    for (const { path, src } of FILES) {
      if (!importujeLoader(src, s)) continue;
      const alias =
        new RegExp(String.raw`\b` + s.loader + String.raw`\s+as\s+(\w+)`).exec(src)?.[1] ??
        s.loader!;
      if (!new RegExp(String.raw`\b` + alias + String.raw`\s*\(`).test(src)) winni.push(path);
    }
    expect(winni.sort()).toEqual([]);
  });

  it.each(LENIWE.filter((s) => s.modul !== "@/lib/i18n-donate"))(
    "nikt nie ładuje loadera $modul, nie renderując jego kluczy",
    (s) => {
      // Podpis wklejonego, ZŁEGO aliasu: cztery słowniki tego modułu eksportują
      // funkcję o tej samej nazwie `ensureI18n`, więc plik może załadować nie ten
      // słownik, o który mu chodziło - i skompilować się bez ostrzeżenia.
      const winni = FILES.filter(({ src }) => importujeLoader(src, s) && !wolaNs(src, s.ns))
        .map(({ path }) => path)
        .sort();
      expect(winni).toEqual([]);
    },
  );

  it.fails(
    "DEFEKT: `/admin/donations` ładuje słownik publicznej wpłaty, z którego nie renderuje ANI JEDNEGO klucza",
    () => {
      // OCZEKIWANE ZACHOWANIE: `src/routes/admin.donations.tsx` nie woła
      // `ensureDonateI18n()`, bo nie renderuje żadnego klucza `donate.*`.
      //
      // STAN FAKTYCZNY (sprzed tego zlecenia - `git show 7fa0ebb^` pokazuje ten
      // sam import): trasa ładuje `i18n-donate.ts` (3,9 kB) do chunku panelu,
      // a przez cały czas życia pliku nie użyła z niego niczego. Nie psuje to
      // niczego widocznego - i dlatego stoi tu od dawna. Ten test jest jedynym
      // miejscem, które to nazywa.
      //
      // NIE USUWAM TEGO IMPORTU: to zmiana tego, co ląduje w chunku panelu,
      // czyli zmiana produkcyjna wykraczająca poza dwie dozwolone kategorie
      // tego zlecenia (przeniesienie literałów do słownika i ekstrakcja bez
      // zmiany zachowania).
      const src = readFileSync(join("src", "routes", "admin.donations.tsx"), "utf8");
      const laduje = /from\s+["']@\/lib\/i18n-donate["']/.test(src);
      const uzywa = /["'\x60]donate\./.test(src);
      expect({ laduje, uzywa }).toEqual({ laduje: false, uzywa: false });
    },
  );

  it("stan zastany: dwa słowniki modułu NIGDY nie zadeklarowały leniwości", () => {
    // To nie jest defekt tej bramki, a zapis stanu: `i18n-gifting.ts` (10,6 kB)
    // i `i18n-donations-widget.ts` (1,1 kB) nie mają `ensure*`, więc ich
    // wołający MUSZĄ używać importu side-effect. Asercja pilnuje, żeby nikt nie
    // dopisał im `ensure*` bez przestawienia wołających - wtedy słownik
    // wyglądałby na leniwy, a nadal jechałby w chunku wejściowym.
    for (const s of SLOWNIKI.filter((x) => x.loader === null)) {
      const plik = join("src", "lib", s.modul.replace("@/lib/", "") + ".ts");
      const src = readFileSync(plik, "utf8");
      expect(src, `${plik} dostał ensure* - przestaw wołających`).not.toMatch(
        /export function ensure\w*I18n/,
      );
      expect(src, `${plik} musi rejestrować oba języki`).toMatch(
        /addResourceBundle\(\s*["']pl["']/,
      );
      expect(src).toMatch(/addResourceBundle\(\s*["']en["']/);
    }
  });

  it.each(LENIWE)("słownik $modul rejestruje pl I en", (s) => {
    const plik = join("src", "lib", s.modul.replace("@/lib/", "") + ".ts");
    const src = readFileSync(plik, "utf8");
    expect(src).toMatch(/addResourceBundle\(\s*["']pl["']/);
    expect(src).toMatch(/addResourceBundle\(\s*["']en["']/);
    expect(src).toContain(`export function ${s.loader}(`);
  });

  it("kanarek zasięgu: skan widzi pliki i widzi wołających", () => {
    // Bez tej asercji bramka cicho przestaje działać, gdy ktoś przeniesie
    // katalogi modułu albo zmieni przestrzeń nazw - wszystkie `it.each`
    // zaliczyłyby się na zbiorach pustych.
    expect(FILES.length).toBeGreaterThan(500);
    for (const s of SLOWNIKI) {
      const n = FILES.filter(({ src }) => wolaNs(src, s.ns)).length;
      expect(n, `nikt nie woła ${s.ns} - przestrzeń nazw zniknęła?`).toBeGreaterThan(0);
    }
  });
});
