// WIDOCZNOSC WARUNKOWA POL SCHEMATU - DOWOD W OBIE STRONY.
//
// DLACZEGO TEN PLIK ISTNIEJE
// `WIDGET_SCHEMAS` niesie 51 predykatow `visibleWhen`. Wszystkie SA dzis
// wolane, ale wylacznie w JEDNA strone: bramka osiagalnosci
// (`settingsFidelity.gate.test.tsx`, opis "osiagalnosc pol schematu") szuka
// dla kazdego pola JAKIEJKOLWIEK kombinacji ustawien, ktora warunek SPELNIA,
// i konczy prace przy pierwszym trafieniu. Stad w audycie 100% funkcji przy
// 85,41% galezi: kazda lambda ma wywolanie, ale galaz ODMOWY ("kiedy pole ma
// zniknac") oraz wartosci domyslne ukryte w srodku predykatu
// (`c.widthPct ?? 100`, `typeof c.variant === "string" ? c.variant : "icon"`,
// drugi argument `asBool`) nie maja zadnego dowodu.
//
// CO TU JEST NAPRAWDE DO OBRONY - trzy klasy bledu, kazda widoczna dopiero
// przy asercji na FALSZ:
//
//  1. POLE, KTORE NIE ZNIKA. Predykat odwrocony w refaktorze (`===` zamiast
//     `!==`) przechodzi bramke osiagalnosci bez mrugniecia okiem - ona pyta
//     tylko "czy da sie pokazac". Redakcja dostaje wtedy panel z kontrolkami,
//     ktore w wybranym wariancie nic nie robia (kolor gradientu przy wariancie
//     "linia", CTA platform w ukladzie "rzad"). To dokladnie ta klasa martwych
//     ustawien, ktora reszta bramek modulu 3 wyplenia po stronie renderera.
//
//  2. PUSTA TRESC. Swiezo wstawiony widget ma `content` PRAWIE pusty - panel
//     rysuje sie ZANIM redaktor cokolwiek wybierze. To wtedy dzialaja domyslne
//     w srodku predykatu i to wtedy najlatwiej o regresje, bo zaden test
//     renderera tu nie siega. Kazdy przypadek nizej ma wiec wariant `{}`.
//
//  3. KONTRAKT Z DOMYSLNA WARTOSCIA POLA. Domyslna wartosc deklarowana w
//     schemacie (`default: 100` dla `widthPct`, `default: false` dla
//     `showCaption`) musi zgadzac sie z domyslna zaszyta w predykacie. Rozjazd
//     znaczy, ze pole pokazuje sie (albo znika) inaczej niz mowi jego wlasna
//     deklaracja - i nikt tego nie zobaczy, dopoki nie kliknie.
//
// GRANICA DOWODU: plik NIE renderuje panelu. Predykat jest czysta funkcja
// `(content) => boolean` i tak wlasnie jest tu wolany - to jednostka, nie
// integracja. Wzorzec asercji w obie strony pochodzi z
// `socialIconsSettings.test.tsx` ("keeps the CTA fields editable only for the
// list layout"); tutaj jest rozciagniety na CALY rejestr schematow, razem z
// bramka kompletnosci, ktora nie pozwala dolozyc nowego `visibleWhen` bez
// dowodu.
//
// SUFIT POMIARU `schemas.ts` - 43 z 48 galezi (89,58%). Po tym pliku KAZDA
// galaz predykatu ma dowod; pozostale PIEC lezy w kodzie INICJALIZACJI modulu
// i zadnym testem sie ich nie ruszy, bo helpery nie sa eksportowane, a ich
// jedyne wywolania to literaly wpisane w ten sam plik (`schemas.ts:3706-3723`):
//   * `opts.defaultShow ?? "1"`      (schemas.ts:3650) - kazde wywolanie
//     `fieldBlock` podaje `defaultShow` jawnie, wiec domyslna nie zapada,
//   * `opts.defaultRequire ?? "0"`   (schemas.ts:3660) - jak wyzej,
//   * `if (!arr) return;`            (schemas.ts:3683) - `pushLabelsFor` jest
//     wolane raz, dla "contact-form", ktory w schematach ISTNIEJE,
//   * dwie galezie `existingKeys.has(...)` (schemas.ts:3687 i 3690) - zbior
//     kluczy jest ustalony przez sam literal schematu.
// Podniesienie tej liczby wymagaloby zmiany pliku produkcyjnego (eksport
// helperow albo ich wydzielenie), a nie kolejnego testu.
import { describe, expect, it } from "vitest";
import { WIDGET_SCHEMAS } from "../schemas";
import type { WidgetType } from "../types";

/** Worek tresci widgetu w takiej postaci, w jakiej widzi go predykat. */
type Content = Record<string, unknown>;

function predicateOf(type: WidgetType, key: string): (content: Content) => boolean {
  const field = (WIDGET_SCHEMAS[type] ?? []).find((f) => f.key === key);
  if (!field) throw new Error(`brak pola "${key}" w schemacie widgetu "${type}"`);
  if (!field.visibleWhen) throw new Error(`pole "${type}.${key}" stracilo warunek visibleWhen`);
  return field.visibleWhen;
}

function defaultOf(type: WidgetType, key: string): number | string | boolean | undefined {
  return (WIDGET_SCHEMAS[type] ?? []).find((f) => f.key === key)?.default;
}

interface VisibilityCase {
  /** Widget, ktorego schemat obejmuje ten przypadek. */
  readonly widget: WidgetType;
  /** Pola dzielace DOKLADNIE ten sam warunek widocznosci. */
  readonly keys: ReadonlyArray<string>;
  /** Co warunek ma znaczyc - trafia do nazwy testu. */
  readonly why: string;
  /** Tresci, przy ktorych pole MUSI byc widoczne. */
  readonly visible: ReadonlyArray<Content>;
  /** Tresci, przy ktorych pole MUSI byc ukryte. */
  readonly hidden: ReadonlyArray<Content>;
}

const CASES: ReadonlyArray<VisibilityCase> = [
  // ---- naglowek ----
  {
    widget: "heading",
    keys: ["gradientFrom", "gradientTo", "gradientAngle"],
    why: "kolory i kat gradientu tylko w wariancie gradientowym",
    visible: [{ variant: "gradient" }],
    // "Gradient" z wielkiej litery to NIE jest wariant ze schematu - porownanie
    // jest scisle i ma takie zostac, bo select commituje dokladne wartosci.
    hidden: [{}, { variant: "default" }, { variant: "outlined" }, { variant: "Gradient" }],
  },
  {
    widget: "heading",
    keys: ["highlightColor"],
    why: "kolor podkreslenia tylko w wariancie z podkresleniem",
    visible: [{ variant: "highlight" }],
    hidden: [{}, { variant: "default" }, { variant: "gradient" }],
  },
  {
    widget: "heading",
    keys: ["outlineColor"],
    // Naglowek nazywa ten wariant "outlined", przycisk - "outline". Rozjazd
    // nazw jest w schemacie realny, wiec obie wartosci sa tu sprawdzone.
    why: "kolor obrysu tylko w wariancie obrysowanym (outlined, nie outline)",
    visible: [{ variant: "outlined" }],
    hidden: [{}, { variant: "outline" }, { variant: "default" }],
  },
  {
    widget: "heading",
    keys: ["target"],
    why: "wybor okna dopiero wtedy, gdy naglowek MA link",
    visible: [{ href: "/o-nas" }, { href: "https://example.com/kontakt" }],
    hidden: [{}, { href: "" }, { href: 12 }, { href: null }],
  },
  {
    widget: "heading",
    keys: ["iconPosition"],
    why: "pozycja ikony dopiero wtedy, gdy ikona jest wybrana",
    visible: [{ iconName: "Star" }],
    hidden: [{}, { iconName: "" }, { iconName: 3 }],
  },

  // ---- przycisk ----
  {
    widget: "button",
    keys: ["gradientFrom", "gradientTo", "gradientAngle"],
    why: "kolory i kat gradientu tylko w wariancie gradientowym",
    visible: [{ variant: "gradient" }],
    hidden: [{}, { variant: "primary" }, { variant: "outline" }],
  },
  {
    widget: "button",
    keys: ["btnBgColor"],
    why: "kolor tla w kazdym z trzech wariantow, ktore realnie maja tlo",
    visible: [{ variant: "primary" }, { variant: "soft" }, { variant: "outline" }],
    hidden: [{}, { variant: "gradient" }, { variant: "ghost" }, { variant: "link" }],
  },
  {
    widget: "button",
    keys: ["btnTextColor"],
    why: "kolor tekstu wszedzie POZA gradientem (takze przy pustej tresci)",
    visible: [{}, { variant: "primary" }, { variant: "ghost" }],
    hidden: [{ variant: "gradient" }],
  },
  {
    widget: "button",
    keys: ["btnBorderColor"],
    why: "kolor obramowania tylko w wariancie outline",
    visible: [{ variant: "outline" }],
    hidden: [{}, { variant: "primary" }, { variant: "gradient" }],
  },
  {
    widget: "button",
    keys: ["iconPosition"],
    why: "pozycja ikony dopiero wtedy, gdy ikona jest wybrana",
    visible: [{ iconName: "ArrowRight" }],
    hidden: [{}, { iconName: "" }],
  },

  // ---- separator ----
  {
    widget: "divider",
    keys: ["iconName", "iconColor"],
    why: "ikona i jej kolor tylko w wariancie z ikona na srodku",
    visible: [{ variant: "icon" }],
    hidden: [{}, { variant: "line" }, { variant: "space" }],
  },
  {
    widget: "divider",
    keys: ["widthPct"],
    why: "szerokosc linii wszedzie POZA wariantem samego odstepu",
    visible: [{}, { variant: "line" }, { variant: "gradient" }],
    hidden: [{ variant: "space" }],
  },
  {
    widget: "divider",
    keys: ["align"],
    // Wyrownanie ma sens dopiero wtedy, gdy linia jest WEZSZA niz kontener -
    // przy 100% nie ma czego wyrownywac. Domyslna 100 siedzi w srodku
    // predykatu (`c.widthPct ?? 100`), wiec pusta tresc MUSI dawac ukrycie.
    why: "wyrownanie tylko dla linii wezszej niz kontener (domyslna szerokosc 100 ukrywa pole)",
    visible: [
      { variant: "line", widthPct: 50 },
      // Panel commituje liczby jako stringi - koercja `Number(...)` ma to
      // wytrzymac, inaczej kontrolka znikalaby po pierwszej edycji.
      { variant: "line", widthPct: "50" },
      { variant: "icon", widthPct: 10 },
    ],
    hidden: [
      {},
      { variant: "line" },
      { variant: "line", widthPct: 100 },
      { variant: "line", widthPct: null },
      { variant: "space", widthPct: 50 },
    ],
  },
  {
    widget: "divider",
    keys: ["color"],
    why: "kolor linii wszedzie POZA odstepem i gradientem (te dwa nie maja czego kolorowac)",
    visible: [{}, { variant: "line" }, { variant: "icon" }],
    hidden: [{ variant: "space" }, { variant: "gradient" }],
  },
  {
    widget: "divider",
    keys: ["gradientFrom", "gradientTo"],
    why: "kolory gradientu tylko w wariancie gradientowym",
    visible: [{ variant: "gradient" }],
    hidden: [{}, { variant: "line" }, { variant: "space" }],
  },

  // ---- wykres ----
  {
    widget: "chart",
    keys: ["stacked"],
    // Brak `kind` znaczy "slupkowy" (domyslny rodzaj wykresu), wiec pusta tresc
    // MUSI pokazywac przelacznik skumulowania.
    why: "skumulowanie tylko dla slupkow - w tym dla domyslnego, jeszcze niewybranego rodzaju",
    visible: [{}, { kind: "bar" }, { kind: "bar-horizontal" }, { kind: "" }],
    hidden: [{ kind: "pie" }, { kind: "donut" }, { kind: "line" }],
  },
  {
    widget: "chart",
    keys: ["showGrid"],
    why: "siatka wszedzie POZA wykresami bez osi (kolowy, pierscien)",
    visible: [{}, { kind: "bar" }, { kind: "line" }],
    hidden: [{ kind: "pie" }, { kind: "donut" }],
  },

  // ---- mapa swiata ----
  {
    widget: "world-map",
    keys: ["animationDuration", "loop"],
    why: "ustawienia animacji znikaja dopiero po JAWNYM jej wylaczeniu",
    visible: [{}, { animate: true }],
    hidden: [{ animate: false }],
  },

  // ---- czytanie na glos ----
  {
    widget: "tts",
    keys: ["text"],
    why: "wlasny tekst tylko wtedy, gdy zrodlem NIE jest tresc wpisu",
    visible: [{ source: "custom" }],
    hidden: [{}, { source: "post" }],
  },

  // ---- newsletter ----
  {
    widget: "newsletter",
    keys: ["iconName", "size"],
    // Domyslny wariant ("icon") jest zaszyty w predykacie, nie w tresci -
    // swiezy widget MUSI wiec pokazywac ikone i jej rozmiar. Wartosc `variant`
    // spoza typu string (historyczna rewizja, zly import) ma spadac na te sama
    // domyslna, a nie chowac obu kontrolek.
    why: "kafelek ikony ma tylko wariant ikonowy - domyslny i przy nie-stringowym wariancie takze",
    visible: [{}, { variant: "icon" }, { variant: "icon-only" }, { variant: 7 }, { variant: null }],
    hidden: [{ variant: "inline" }, { variant: "card" }, { variant: "minimal" }],
  },

  // ---- CTA ----
  {
    widget: "cta",
    keys: ["ctaBgFrom", "ctaBgTo", "ctaGradientAngle"],
    why: "kolory i kat gradientu tla tylko w wariancie gradientowym",
    visible: [{ variant: "gradient" }],
    hidden: [{}, { variant: "default" }, { variant: "bar" }],
  },
  {
    widget: "cta",
    keys: ["ctaBgColor"],
    why: "jednolity kolor tla wszedzie POZA gradientem (takze przy pustej tresci)",
    visible: [{}, { variant: "bar" }, { variant: "card" }],
    hidden: [{ variant: "gradient" }],
  },

  // ---- lista wydarzen ----
  {
    widget: "event-list",
    // Domyslny wariant ("cards") jest zaszyty w predykacie. Wariant spoza typu
    // string ma spadac na niego, a nie chowac liczby kolumn.
    keys: ["columns"],
    why: "liczba kolumn tylko dla kart - domyslnie i przy nie-stringowym wariancie takze",
    visible: [{}, { variant: "cards" }, { variant: 3 }, { variant: null }],
    hidden: [{ variant: "list" }],
  },

  // ---- ikony social ----
  {
    widget: "social-icons",
    keys: ["customColor"],
    why: "wlasny kolor ikon tylko przy trybie 'wlasny kolor'",
    visible: [{ colorMode: "custom" }],
    hidden: [{}, { colorMode: "brand" }, { colorMode: "official" }],
  },
  {
    widget: "social-icons",
    keys: ["customBgColor"],
    why: "wlasny kolor tla tylko przy trybie tla 'wlasne'",
    visible: [{ bgMode: "custom" }],
    hidden: [{}, { bgMode: "none" }, { bgMode: "brand" }],
  },
  {
    widget: "social-icons",
    keys: ["rowHoverColor"],
    why: "wlasny kolor podswietlenia tylko przy podswietleniu 'wlasny kolor'",
    visible: [{ rowHover: "custom" }],
    hidden: [{}, { rowHover: "house" }, { rowHover: "none" }],
  },
  {
    widget: "social-icons",
    keys: ["hoverIconColor"],
    why: "wlasny kolor ikony na hoverze tylko przy trybie ikon 'wlasny kolor'",
    visible: [{ hoverIconMode: "custom" }],
    hidden: [{}, { hoverIconMode: "auto" }, { hoverIconMode: "keep" }],
  },
  {
    widget: "social-icons",
    // Dwa niezalezne powody widocznosci: firmowy pomaranicz maluje CALY widget
    // (takze uklad "rzad"), a lista maluje wiersz newslettera - o ile ten
    // wiersz nie zostal wylaczony.
    keys: ["newsletterTone"],
    why: "tonacja firmowego gradientu przy trybie 'house' ALBO przy liscie z wierszem newslettera",
    visible: [
      { rowHover: "house" },
      { rowHover: "house", layout: "row" },
      { rowHover: "house", layout: "list", showNewsletter: "0" },
      { layout: "list" },
      { layout: "list", showNewsletter: "1" },
    ],
    hidden: [
      {},
      { layout: "row" },
      { rowHover: "soft", layout: "row" },
      { layout: "list", showNewsletter: "0" },
      { rowHover: "brand", layout: "list", showNewsletter: "0" },
    ],
  },
  {
    widget: "social-icons",
    keys: [
      "ctaFacebook",
      "ctaX",
      "ctaYoutube",
      "ctaInstagram",
      "ctaLinkedin",
      "ctaSpotify",
      "showNewsletter",
    ],
    why: "CTA platform i przelacznik newslettera istnieja wylacznie w ukladzie listy",
    visible: [{ layout: "list" }, { layout: "list", rowHover: "house" }],
    hidden: [{}, { layout: "row" }, { layout: "List" }],
  },
  {
    widget: "social-icons",
    keys: ["newsletterUrl", "ctaNewsletter"],
    // Brak klucza `showNewsletter` znaczy "pokaz" - dokladnie tak jak w
    // rendererze (`getStr(c, "showNewsletter") !== "0"`), wiec pusty wiersz
    // newslettera jest domyslnie WLACZONY i jego ustawienia maja byc widoczne.
    why: "adres i CTA newslettera tylko w liscie i tylko gdy wiersz newslettera nie zostal wylaczony",
    visible: [{ layout: "list" }, { layout: "list", showNewsletter: "1" }],
    hidden: [
      {},
      { layout: "row" },
      { layout: "row", showNewsletter: "1" },
      { layout: "list", showNewsletter: "0" },
    ],
  },

  // ---- widgety dynamiczne wpisu ----
  {
    widget: "post-meta",
    // `asBool` z domyslna TRUE: pusta tresc znaczy "data widoczna", wiec format
    // daty tez ma byc do wyboru. Historyczne zapisy "1"/"0" i 1/0 musza dzialac
    // tak samo jak natywny boolean - inaczej starszy dokument gubi kontrolke.
    keys: ["dateFormat"],
    why: "format daty tylko przy widocznej dacie - domyslnie widocznej, w kazdym zapisie historycznym",
    visible: [{}, { showDate: true }, { showDate: "1" }, { showDate: 1 }, { showDate: "tak" }],
    hidden: [{ showDate: false }, { showDate: "0" }, { showDate: 0 }, { showDate: "nie" }],
  },
  {
    widget: "post-tags-dyn",
    keys: ["label"],
    why: "tresc etykiety tylko przy wlaczonej etykiecie - domyslnie wlaczonej",
    visible: [{}, { showLabel: true }, { showLabel: "1" }],
    hidden: [{ showLabel: false }, { showLabel: "0" }],
  },
  {
    widget: "post-breadcrumbs",
    keys: ["home"],
    why: "etykieta strony glownej tylko przy wlaczonej stronie glownej - domyslnie wlaczonej",
    visible: [{}, { showHome: true }, { showHome: "1" }],
    hidden: [{ showHome: false }, { showHome: "0" }],
  },
  {
    widget: "post-cover",
    // Jedyny predykat `asBool` z domyslna FALSE w calym rejestrze: pusta tresc
    // ma UKRYWAC podpis, zgodnie z `default: false` przy `showCaption`.
    keys: ["caption"],
    why: "podpis pod okladka dopiero po jawnym wlaczeniu - domyslnie wylaczony",
    visible: [{ showCaption: true }, { showCaption: "1" }],
    hidden: [{}, { showCaption: false }, { showCaption: "0" }],
  },
];

describe("visibleWhen: kazdy warunek ma dowod na POKAZANIE i na UKRYCIE pola", () => {
  it.each(CASES.map((c) => [`${c.widget}: ${c.why}`, c] as const))("%s", (_name, testCase) => {
    expect(testCase.visible.length, "przypadek bez dowodu na pokazanie").toBeGreaterThan(0);
    expect(testCase.hidden.length, "przypadek bez dowodu na ukrycie").toBeGreaterThan(0);

    for (const key of testCase.keys) {
      const isVisible = predicateOf(testCase.widget, key);
      for (const content of testCase.visible) {
        expect(
          isVisible(content),
          `${testCase.widget}.${key} MA byc widoczne dla ${JSON.stringify(content)}`,
        ).toBe(true);
      }
      for (const content of testCase.hidden) {
        expect(
          isVisible(content),
          `${testCase.widget}.${key} MA byc ukryte dla ${JSON.stringify(content)}`,
        ).toBe(false);
      }
    }
  });
});

describe("visibleWhen: domyslna zaszyta w predykacie zgadza sie z deklaracja pola", () => {
  it("separator - domyslna szerokosc 100 to ta sama liczba, ktora chowa wyrownanie", () => {
    expect(defaultOf("divider", "widthPct")).toBe(100);
    const isVisible = predicateOf("divider", "align");
    // Dokladnie na progu (100) pole znika, jeden krok ponizej sie pojawia.
    expect(isVisible({ variant: "line", widthPct: defaultOf("divider", "widthPct") })).toBe(false);
    expect(isVisible({ variant: "line", widthPct: 95 })).toBe(true);
    // Pusta tresc MUSI zachowywac sie tak samo jak tresc z wpisana domyslna.
    expect(isVisible({ variant: "line" })).toBe(false);
  });

  it("okladka wpisu - `default: false` przy showCaption to ta sama domyslna, co w predykacie", () => {
    expect(defaultOf("post-cover", "showCaption")).toBe(false);
    expect(predicateOf("post-cover", "caption")({})).toBe(false);
  });

  it("meta wpisu - `default: true` przy showDate to ta sama domyslna, co w predykacie", () => {
    expect(defaultOf("post-meta", "showDate")).toBe(true);
    expect(predicateOf("post-meta", "dateFormat")({})).toBe(true);
  });

  it("newsletter - kafelek ikony jest widoczny dla domyslnego wariantu ze schematu", () => {
    const variants = (WIDGET_SCHEMAS.newsletter ?? [])
      .find((f) => f.key === "variant")
      ?.options?.map((o) => o.value);
    expect(variants).toContain("icon");
    // Pusta tresc = wariant domyslny "icon", zaszyty w samym predykacie.
    expect(predicateOf("newsletter", "iconName")({})).toBe(true);
    expect(predicateOf("newsletter", "size")({})).toBe(true);
  });

  it("lista wydarzen - liczba kolumn jest widoczna dla domyslnego wariantu 'cards'", () => {
    const variants = (WIDGET_SCHEMAS["event-list"] ?? [])
      .find((f) => f.key === "variant")
      ?.options?.map((o) => o.value);
    expect(variants).toContain("cards");
    expect(predicateOf("event-list", "columns")({})).toBe(true);
  });
});

describe("visibleWhen: bramka kompletnosci dowodu", () => {
  it("kazde pole warunkowe w calym rejestrze schematow jest opisane przypadkiem", () => {
    const proven = new Set(CASES.flatMap((c) => c.keys.map((key) => `${c.widget}.${key}`)));
    const missing: string[] = [];
    for (const [type, fields] of Object.entries(WIDGET_SCHEMAS)) {
      for (const field of fields ?? []) {
        if (field.visibleWhen && !proven.has(`${type}.${field.key}`)) {
          missing.push(`${type}.${field.key}`);
        }
      }
    }
    expect(
      missing,
      "Nowy warunek `visibleWhen` bez wpisu w CASES - bramka osiagalnosci sprawdzi tylko,\n" +
        "czy da sie pole POKAZAC. Dopisz przypadek z dowodem na UKRYCIE, w tym dla pustej tresci.",
    ).toEqual([]);
  });

  it("zaden przypadek nie odwoluje sie do pola, ktore stracilo warunek", () => {
    for (const testCase of CASES) {
      for (const key of testCase.keys) {
        expect(() => predicateOf(testCase.widget, key)).not.toThrow();
      }
    }
  });
});
