// CO DOWODZI TEN PLIK
// Kanoniczna mapa linków stopki (`src/lib/seo/footerNavigation.ts`) - do
// 22.08.2026 ZERO wykonanych linii. Mapa jest DANĄ UTRZYMYWANĄ RĘCZNIE, a
// czytają ją trzy niezależne powierzchnie: JSON-LD `SiteNavigationElement`
// na stronie głównej (`src/routes/index.tsx`), pasek prawny
// (`src/components/footer/CopyrightBar.tsx`) i raport kliknięć w stopce
// (`src/lib/analytics/footerTracking.ts`). Zły wpis dopisany ręcznie nie
// wywala żadnego builda - po prostu wypuszcza do Google nawigację z pustą
// nazwą, zdublowanym adresem albo linkiem poza serwisem.
//
// Dlatego plik dowodzi dwóch rzeczy:
//   1. ZACHOWANIA OBU FUNKCJI: `footerLinksByGroup` zawęża do żądanej grupy,
//      zwraca ZA KAŻDYM RAZEM nową tablicę (konsument nie może zmutować
//      kanonicznej mapy), a pięć grup to rozbicie mapy BEZ RESZTY i BEZ
//      NAKŁADEK - więc gałąź „grupa bez linków" jest nieosiągalna z
//      konstrukcji, a nie tylko nieprzetestowana. `labelFor` sprawdzone dla
//      OBU języków na KAŻDYM z 21 linków, przeciwko tabeli wpisanej w tym
//      pliku RĘCZNIE (a nie odczytanej z produkcji - inaczej test
//      potwierdzałby sam siebie).
//   2. CZTERECH INWARIANTÓW MAPY, których nie sprawdza żaden inny test w
//      repo: każdy `href` jest ścieżką wewnętrzną zaczynającą się od `/`,
//      ZERO duplikatów `href`, każdy link ma NIEPUSTĄ etykietę w OBU
//      językach, każda z pięciu grup ma co najmniej jeden link.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   - `src/lib/seo/jsonld.ts` (`siteNavigationJsonLd`) - GENERATOR grafu:
//     kształt `ItemList`, numeracja `position`, prefiksowanie originem. Tutaj
//     mierzę wyłącznie DANE, którymi ten generator jest karmiony; ani jedna
//     asercja poniżej nie buduje JSON-LD.
//   - `src/components/footer/CopyrightBar.tsx` i `src/components/Footer.tsx` -
//     render, kolejność w DOM i ARIA paska stopki to testy komponentów.
//   - `src/lib/analytics/footerTracking.ts` - mapowanie grupy na nazwę
//     zdarzenia (`footer_legal_click` / `footer_newsletter_click`) ma własną
//     powierzchnię; tu grupa jest tylko polem danej.
//   - `e2e/seo.spec.ts` - jedyny styk to test „HTML sitemap /sitemap renders
//     navigable page", który klika po ŻYWYM SSR i liczy linki w DOM. Ten plik
//     nie startuje serwera, nie renderuje ani jednego komponentu i nie
//     wykonuje żądań HTTP: wejściem jest stała tablica, wyjściem jej
//     właściwości. Kontrakt `<head>` z tamtego pliku (testy „head contract on
//     …") nie dotyka nawigacji stopki ani razu.
import { describe, expect, it } from "vitest";
import {
  FOOTER_LINKS,
  footerLinksByGroup,
  labelFor,
  type FooterLink,
  type FooterLinkGroup,
} from "@/lib/seo/footerNavigation";

/**
 * Oczekiwane liczności grup wpisane RĘCZNIE. `Record<FooterLinkGroup, number>`
 * wymusza kompletność w czasie kompilacji: dopisanie szóstej grupy do unii
 * `FooterLinkGroup` zepsuje ten plik, więc nowa grupa nie może wjechać do
 * produkcji bez świadomej decyzji o jej pokryciu.
 */
const EXPECTED_GROUP_SIZES: Record<FooterLinkGroup, number> = {
  editorial: 4,
  topics: 4,
  community: 4,
  institute: 4,
  legal: 5,
};

/** Kolejność grup taka, jak w mega-stopce - używana do iteracji po testach. */
const FOOTER_GROUPS = [
  "editorial",
  "topics",
  "community",
  "institute",
  "legal",
] as const satisfies readonly FooterLinkGroup[];

/**
 * STRAŻNIK runtime, nie rzutowanie: sprawdza, czy zapisana w danej wartość
 * grupy naprawdę należy do zbioru obsługiwanego przez UI. Dopisanie w mapie
 * grupy „newsletter" przeszłoby kompilację tylko wtedy, gdyby ktoś rozszerzył
 * unię - ale rozszerzenie unii BEZ dodania kolumny w stopce daje linki, których
 * nikt nie renderuje. Ten strażnik to wyłapuje.
 */
const isKnownGroup = (value: FooterLinkGroup): boolean => FOOTER_GROUPS.includes(value);

/**
 * Etykiety PL/EN wpisane RĘCZNIE, kluczowane adresem. Ta tabela jest sensem
 * pliku: gdyby powstała z `FOOTER_LINKS.map(...)`, test przechodziłby także po
 * podmianie etykiety na pustą albo po przestawieniu PL z EN.
 */
const EXPECTED_LABELS: Record<string, { pl: string; en: string }> = {
  "/analizy": { pl: "Analizy", en: "Analyses" },
  "/category/wywiady": { pl: "Wywiady", en: "Interviews" },
  "/category/policy-papers": { pl: "Policy papers", en: "Policy papers" },
  "/podcasts": { pl: "Podcast", en: "Podcast" },
  "/category/geopolityka": { pl: "Geopolityka", en: "Geopolitics" },
  "/category/bezpieczenstwo": { pl: "Bezpieczeństwo", en: "Security" },
  "/category/gospodarka": { pl: "Gospodarka", en: "Economy" },
  "/category/nato": { pl: "NATO", en: "NATO" },
  "/wydarzenia": { pl: "Wydarzenia", en: "Events" },
  "/spotkania-chatham-house": { pl: "Spotkania Chatham House", en: "Chatham House meetings" },
  "/dolacz-do-newslettera": { pl: "Newsletter", en: "Newsletter" },
  "/pricing": { pl: "Subskrypcje", en: "Subscriptions" },
  "/o-nas": { pl: "O nas", en: "About us" },
  "/kontakt": { pl: "Kontakt", en: "Contact" },
  "/wspieraj-nas": { pl: "Wspieraj nas", en: "Support us" },
  "/reklamuj-sie-u-nas": { pl: "Reklama", en: "Advertise" },
  "/regulamin": { pl: "Regulamin", en: "Terms & conditions" },
  "/polityka-prywatnosci": { pl: "Polityka prywatności", en: "Privacy notice" },
  "/zwroty-i-reklamacje": { pl: "Zwroty i reklamacje", en: "Refund policy" },
  "/cookies": { pl: "Polityka cookies", en: "Cookie policy" },
  "/wytyczne-dotyczace-reklam": { pl: "Wytyczne reklam", en: "Advertising guidelines" },
};

/** Adresy powtórzone w mapie - komunikat asercji ma je wymienić z nazwy. */
function duplicateHrefs(links: readonly FooterLink[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const link of links) {
    if (seen.has(link.href)) duplicates.add(link.href);
    seen.add(link.href);
  }
  return [...duplicates];
}

describe("footerLinksByGroup", () => {
  it.each(FOOTER_GROUPS)("zwraca wyłącznie linki grupy %s", (group) => {
    const links = footerLinksByGroup(group);
    expect(links.length).toBe(EXPECTED_GROUP_SIZES[group]);
    expect(links.map((l) => l.group)).toEqual(Array(links.length).fill(group));
  });

  it("zachowuje kolejność deklaracji z kanonicznej mapy", () => {
    // Kolejność jest treścią: to ona wyznacza `position` w JSON-LD i porządek
    // linków w pasku prawnym, więc filtr NIE MOŻE jej przetasować.
    expect(footerLinksByGroup("legal").map((l) => l.href)).toEqual([
      "/regulamin",
      "/polityka-prywatnosci",
      "/zwroty-i-reklamacje",
      "/cookies",
      "/wytyczne-dotyczace-reklam",
    ]);
  });

  it("oddaje NOWĄ tablicę, więc konsument nie zmutuje kanonicznej mapy", () => {
    const first = footerLinksByGroup("topics");
    const second = footerLinksByGroup("topics");
    expect(first).not.toBe(FOOTER_LINKS);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("pięć grup rozbija mapę bez reszty i bez nakładek", () => {
    // Konsekwencja tej asercji: gałąź „grupa bez linków" jest NIEOSIĄGALNA -
    // każdy wpis mapy należy do dokładnie jednej z pięciu kolumn stopki.
    // Wartości spoza unii `FooterLinkGroup` nie da się tu podać bez
    // rzutowania, którego ten plik nie używa; miejsce tej gałęzi zajmuje
    // dowód rozbicia.
    const perGroup = FOOTER_GROUPS.flatMap((group) => [...footerLinksByGroup(group)]);
    expect(perGroup.length).toBe(FOOTER_LINKS.length);
    expect(new Set(perGroup.map((l) => l.href)).size).toBe(FOOTER_LINKS.length);
    expect([...FOOTER_GROUPS].sort()).toEqual(Object.keys(EXPECTED_GROUP_SIZES).sort());
  });
});

describe("labelFor", () => {
  it("tabela oczekiwanych etykiet opisuje DOKŁADNIE mapę produkcyjną", () => {
    // Bramka dla samej tabeli: dopisanie albo usunięcie linku w produkcji
    // musi tu wywalić test, zanim ktokolwiek sprawdzi pojedyncze etykiety.
    expect([...FOOTER_LINKS.map((l) => l.href)].sort()).toEqual(
      Object.keys(EXPECTED_LABELS).sort(),
    );
  });

  it.each(FOOTER_LINKS.map((link) => [link.href, link] as const))(
    "podaje etykietę PL i EN dla %s",
    (href, link) => {
      const expected = EXPECTED_LABELS[href];
      expect(labelFor(link, "pl")).toBe(expected.pl);
      expect(labelFor(link, "en")).toBe(expected.en);
    },
  );

  it("gałąź domyślna to polski - `en` jest jedynym językiem wybieranym jawnie", () => {
    const link = FOOTER_LINKS[0];
    expect(labelFor(link, "pl")).toBe(link.label.pl);
    expect(labelFor(link, "en")).toBe(link.label.en);
    expect(labelFor(link, "pl")).not.toBe(labelFor(link, "en"));
  });
});

describe("inwarianty ręcznie utrzymywanej mapy", () => {
  it("każdy href jest ścieżką WEWNĘTRZNĄ zaczynającą się od /", () => {
    // KONSEKWENCJA złego wpisu: `siteNavigationJsonLd` prefiksuje originem
    // tylko adresy, które NIE zaczynają się od "http". Adres bezwzględny albo
    // protokołowo-względny („//evil.example") wjechałby do grafu nawigacji
    // Google jako link na obcą domenę, podpisany naszym `@id`.
    for (const link of FOOTER_LINKS) {
      expect(link.href.startsWith("/"), `href poza serwisem: ${link.href}`).toBe(true);
      expect(link.href.startsWith("//"), `adres protokołowo-względny: ${link.href}`).toBe(false);
      expect(link.href).not.toMatch(/^https?:/);
      expect(link.href, `href z białym znakiem: ${link.href}`).toBe(link.href.trim());
      expect(link.href).not.toMatch(/\s/);
      expect(link.href.endsWith("/"), `href z końcowym ukośnikiem: ${link.href}`).toBe(false);
    }
  });

  it("ZERO duplikatów href w całej mapie", () => {
    // KONSEKWENCJA duplikatu: dwa `SiteNavigationElement` o tym samym `url`
    // (Google raportuje to jako zduplikowaną nawigację) i dwie linie w
    // raporcie kliknięć stopki, bo `footerTracking` używa `href` jako
    // `entityId` zdarzenia.
    expect(duplicateHrefs(FOOTER_LINKS)).toEqual([]);
    expect(new Set(FOOTER_LINKS.map((l) => l.href)).size).toBe(FOOTER_LINKS.length);
  });

  it("każdy link ma NIEPUSTĄ etykietę w OBU językach", () => {
    // KONSEKWENCJA braku etykiety: pusty `name` w JSON-LD i pusty, ale
    // klikalny element w stopce - dla czytnika ekranu link bez nazwy.
    for (const link of FOOTER_LINKS) {
      for (const lang of ["pl", "en"] as const) {
        const label = labelFor(link, lang);
        expect(label.trim().length, `pusta etykieta ${lang} dla ${link.href}`).toBeGreaterThan(0);
        expect(label, `etykieta ${lang} z niepotrzebnymi spacjami: ${link.href}`).toBe(
          label.trim(),
        );
      }
    }
  });

  it("każda z pięciu grup ma co najmniej jeden link i tylko znane grupy", () => {
    // KONSEKWENCJA pustej grupy: kolumna mega-stopki renderuje sam nagłówek
    // bez treści (i pusty nagłówek trafia do drzewa nagłówków strony).
    for (const group of FOOTER_GROUPS) {
      expect(footerLinksByGroup(group).length, `grupa bez linków: ${group}`).toBeGreaterThan(0);
    }
    for (const link of FOOTER_LINKS) {
      expect(isKnownGroup(link.group), `nieznana grupa dla ${link.href}`).toBe(true);
    }
  });
});
