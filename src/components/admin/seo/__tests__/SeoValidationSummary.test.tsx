// CO DOWODZI TEN PLIK: `SeoValidationSummary` to JEDYNE miejsce, w którym
// redakcja widzi wynik walidacji SEO przed publikacją. Dowodzimy trzech rzeczy,
// których nie widać ani w typach, ani na zrzucie ekranu:
//
//   1. POZIOM ISTOTNOŚCI STERUJE ROLĄ ARIA I NAGŁÓWKIEM. `role="alert"`
//      (czytnik PRZERYWA to, co czyta) i `role="status"` (czytnik tylko
//      dopowiada) to dwa RÓŻNE zachowania asystujące. Błąd podany jako
//      `status` przechodzi obok osoby korzystającej z czytnika, a ostrzeżenie
//      podane jako `alert` uczy ją ignorować przerwania. Przy uwagach
//      MIESZANYCH musi wygrać błąd - inaczej twardy limit znaków (zapis
//      zablokowany) zostaje ogłoszony tak samo cicho jak przekroczony budżet
//      pikselowy (zapis przechodzi, Google tylko ucina).
//   2. KAŻDY RODZAJ UWAGI O NAGŁÓWKACH DOJEŻDŻA DO WIERSZA Z PARAMETRAMI.
//      Osiem rodzajów `HeadingIssue["kind"]` ma osiem różnych kluczy i18n,
//      a numer pozycji (`pos`), fragment tekstu (`snip`), liczba wystąpień
//      (`count`, `extra`) i skok poziomów (`from`/`to`) są jedyną informacją,
//      po której redaktor znajduje FIZYCZNE miejsce w treści. Cichy zanik
//      parametru zamienia konkretną uwagę ("H1 numer 4: ...") w bezużyteczne
//      "jest źle" - a długi łańcuch `else if` w komponencie nie ma żadnego
//      zabezpieczenia typu na to, że rodzaj trafi w swoją gałąź.
//   3. DWA DEFEKTY PRODUKCYJNE OPISANE JAKO `it.fails` (stan pożądany, nie
//      obecny): stan "NIE UDAŁO SIĘ SPRAWDZIĆ" nie jest odróżniony od "BRAK
//      UWAG" (klasa defektu, która w tym repo wracała już trzykrotnie) oraz
//      polski napis wpisany na sztywno w parametrze `extra`, który trafia do
//      angielskiego wariantu panelu.
//
// Asercje idą po KLUCZACH i18n (atrapa `reactI18nextStub` zwraca klucz, a
// parametry dokleja jako `klucz(param=wartość,...)` alfabetycznie), nie po
// polskim ani angielskim brzmieniu - brzmień pilnują bramki parytetu i18n
// (`src/lib/__tests__/i18nAdminExtras.test.ts`).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `src/components/admin/seo/__tests__/seoAtoms.test.tsx` - tam
//     `SeverityBadge`, `severityHeadingKey` i `severityLiveRole` są dowodzone
//     SAMODZIELNIE, tabelą wejść, bez żadnej reguły walidacji. Tutaj wchodzą
//     wyłącznie jako wynik AGREGACJI listy uwag (kto wygrywa przy mieszance).
//   - `src/lib/seo/__tests__/validation.test.ts` - tam `validateSeoPanel`
//     liczy uwagi z wartości pól (znaki, piksele). Tutaj uwagi wchodzą już
//     policzone, jako dane wejściowe podsumowania.
//   - `validateHeadings` (`src/lib/seo/headingValidation.ts`) - nie powtarzamy
//     jego reguł jednostkowych (który HTML daje który rodzaj uwagi). Prawdziwy
//     walidator pojawia się tu tylko dwa razy i tylko po to, żeby pokazać, że
//     ŻADNA policzona uwaga nie ginie po drodze do listy, oraz żeby nazwać
//     źródło niejednoznaczności w `it.fails`.
//   - `SeoTextField.test.tsx` / `SerpMeter.test.tsx` - ostrzeżenia POJEDYNCZEGO
//     pola przy wpisywaniu; podsumowanie jest zbiorcze i nie ma stanu.
//   - `e2e/seo.spec.ts` - ten plik NIE styka się z e2e. Cała suita e2e SEO
//     dotyczy powierzchni publicznych (sitemapy, robots.txt, feedy, kontrakt
//     <head>), a jedyny jej test dotykający panelu, "/admin/seo is auth-gated
//     (redirects to /auth or /login)", kończy się na przekierowaniu do
//     logowania i NIGDY nie renderuje wnętrza panelu SEO - żadnej uwagi
//     walidacyjnej tam nie widać.
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { SeoValidationSummary } from "@/components/admin/seo/SeoValidationSummary";
import { axeViolations, summarize } from "@/test/axe";
import type { SeoIssue } from "@/lib/seo/validation";
import { validateHeadings, type HeadingIssue } from "@/lib/seo/headingValidation";

const K = {
  errorHeading: "admin.seo.validation.errorHeading",
  warnHeading: "admin.seo.validation.warnHeading",
  ok: "admin.seo.validation.ok",
  headingLabel: "admin.seo.validation.headingLabel",
  titleLabel: "admin.seo.titleLabel",
  descriptionLabel: "admin.seo.descriptionLabel",
} as const;

/** Uwaga meta (tytuł / opis) - wartości liczbowe stałe, bez losowości. */
function meta(over: Partial<SeoIssue> = {}): SeoIssue {
  return {
    lang: "pl",
    kind: "title",
    severity: "error",
    chars: 70,
    charLimit: 60,
    px: 640,
    pxLimit: 600,
    ...over,
  };
}

/** Uwaga o strukturze nagłówków; `severity` domyślnie ostrzeżeniem. */
function heading(kind: HeadingIssue["kind"], over: Partial<HeadingIssue> = {}): HeadingIssue {
  return { lang: "pl", kind, severity: "warning", ...over };
}

function renderSummary(issues: SeoIssue[], headingIssues?: HeadingIssue[]) {
  return headingIssues === undefined
    ? render(<SeoValidationSummary issues={issues} />)
    : render(<SeoValidationSummary issues={issues} headingIssues={headingIssues} />);
}

/** Treść wierszy listy uwag - kontraktem jest tekst wiersza, nie kształt DOM. */
function rows(): string[] {
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
}

afterEach(cleanup);

describe("SeoValidationSummary - poziom istotności steruje rolą ARIA i nagłówkiem", () => {
  it("same błędy: kontener ma rolę alert i nagłówek błędu", () => {
    renderSummary([meta(), meta({ kind: "description", chars: 200, charLimit: 160 })]);

    const box = screen.getByRole("alert");
    // Nagłówek MUSI stać w tym samym kontenerze co lista - czytnik ogłasza
    // zawartość regionu, a nie przypadkowe rodzeństwo w drzewie.
    expect(within(box).getByText(K.errorHeading)).toBeInTheDocument();
    expect(within(box).getByTestId("seo-severity-badge")).toHaveAttribute("data-severity", "error");
    expect(screen.queryByText(K.warnHeading)).not.toBeInTheDocument();
    expect(screen.queryByText(K.ok)).not.toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it("same ostrzeżenia: kontener ma rolę status i nagłówek ostrzeżenia", () => {
    renderSummary([meta({ severity: "warning" })], [heading("missing_h1")]);

    const box = screen.getByRole("status");
    expect(within(box).getByText(K.warnHeading)).toBeInTheDocument();
    expect(within(box).getByTestId("seo-severity-badge")).toHaveAttribute(
      "data-severity",
      "warning",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(K.errorHeading)).not.toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it("uwagi MIESZANE: błąd wygrywa nad ostrzeżeniem (rola alert, nagłówek błędu)", () => {
    // Ostrzeżenie jest PIERWSZE na liście - gdyby agregacja czytała tylko
    // pierwszy element, twardy limit znaków zostałby ogłoszony jako `status`.
    renderSummary([meta({ severity: "warning" })], [heading("multiple_h1", { severity: "error" })]);

    const box = screen.getByRole("alert");
    expect(within(box).getByText(K.errorHeading)).toBeInTheDocument();
    expect(screen.queryByText(K.warnHeading)).not.toBeInTheDocument();
    // Żadna z uwag nie ginie przy podniesieniu poziomu całego bloku.
    expect(rows()).toHaveLength(2);
  });

  it("błąd w uwadze o nagłówkach też podnosi cały blok do roli alert", () => {
    renderSummary([], [heading("multiple_h1", { severity: "error", count: 3 })]);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(K.errorHeading)).toBeInTheDocument();
  });

  it("bez uwag (obie listy puste): rola status i klucz potwierdzenia", () => {
    // Prop `headingIssues` POMINIĘTY - domyślna pusta lista jest częścią
    // kontraktu (panel montuje podsumowanie także bez walidacji nagłówków).
    renderSummary([]);

    const box = screen.getByRole("status");
    expect(within(box).getByText(K.ok)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("seo-severity-badge")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("SeoValidationSummary - wiersz uwagi meta: język, pole, liczby", () => {
  // Parametry w atrapie i18n stoją alfabetycznie, więc asercja przypina
  // JEDNOCZEŚNIE klucz i komplet liczb podanych redakcji.
  it.each([
    [
      "PL / tytuł / twardy limit znaków",
      meta(),
      `PL - ${K.titleLabel}: admin.seo.validation.errorLine(chars=70,limit=60)`,
    ],
    [
      "EN / opis / budżet pikselowy",
      meta({ lang: "en", kind: "description", severity: "warning", chars: 190, px: 1040 }),
      `EN - ${K.descriptionLabel}: admin.seo.validation.warnLine(chars=190,px=1040,pxLimit=600)`,
    ],
    [
      "EN / tytuł / twardy limit znaków",
      meta({ lang: "en" }),
      `EN - ${K.titleLabel}: admin.seo.validation.errorLine(chars=70,limit=60)`,
    ],
    [
      "PL / opis / budżet pikselowy",
      meta({ kind: "description", severity: "warning", chars: 200, px: 1100, pxLimit: 960 }),
      `PL - ${K.descriptionLabel}: admin.seo.validation.warnLine(chars=200,px=1100,pxLimit=960)`,
    ],
  ])("%s", (_opis, issue, expected) => {
    renderSummary([issue]);
    expect(rows()).toEqual([expected]);
  });
});

describe("SeoValidationSummary - każdy rodzaj uwagi o nagłówkach osobno", () => {
  const H = "admin.seo.validation";
  // Tabela: rodzaj uwagi -> DOKŁADNY klucz z parametrami. Warianty z pozycją
  // i fragmentem tekstu OBECNYM i BRAKUJĄCYM domykają gałęzie `pos` / `snip`,
  // bo tylko one decydują, czy redaktor dostaje adres uwagi, czy samą diagnozę.
  it.each<[string, HeadingIssue, string]>([
    ["missing_h1 (bez żadnych parametrów)", heading("missing_h1"), `${H}.missingH1`],
    [
      "multiple_h1 z licznikiem, pozycją i fragmentem",
      heading("multiple_h1", {
        severity: "error",
        count: 3,
        position: 4,
        snippet: "Drugi tytuł",
      }),
      `${H}.multipleH1(count=3,pos= (#4),snip= - "Drugi tytuł")`,
    ],
    [
      "multiple_h1 BEZ licznika - domyślka 2 (są przynajmniej dwa H1)",
      heading("multiple_h1", { severity: "error" }),
      `${H}.multipleH1(count=2,pos=,snip=)`,
    ],
    [
      "extra_h1 z pozycją i fragmentem",
      heading("extra_h1", { count: 1, position: 1, snippet: "Tytuł w treści" }),
      `${H}.extraH1(pos= (#1),snip= - "Tytuł w treści")`,
    ],
    ["extra_h1 bez pozycji i bez fragmentu", heading("extra_h1"), `${H}.extraH1(pos=,snip=)`],
    [
      "skipped_level z pełnym kontekstem skoku",
      heading("skipped_level", { from: 2, to: 4, position: 5, snippet: "Sekcja czwarta" }),
      `${H}.skippedLevel(from=2,pos= (#5),snip= - "Sekcja czwarta",to=4)`,
    ],
    [
      "skipped_level z pustym fragmentem (nagłówek bez tekstu)",
      heading("skipped_level", { from: 3, to: 5, position: 6, snippet: "" }),
      `${H}.skippedLevel(from=3,pos= (#6),snip=,to=5)`,
    ],
    [
      // Dopisek o łącznej liczbie jest składany w komponencie z polskiego
      // napisu, ale prawdziwe i18next go WYRZUCA (klucz nie ma `{{extra}}`) -
      // widać go tylko w atrapie. Rozjazd kod<->słownik opisany pod tabelą.
      "empty_heading z licznikiem > 1 (gałąź `extra`)",
      heading("empty_heading", { count: 3, position: 2 }),
      `${H}.emptyHeading(extra= (łącznie 3),pos= (#2))`,
    ],
    [
      "empty_heading z licznikiem 1 - bez dopisku o łącznej liczbie",
      heading("empty_heading", { count: 1, position: 2 }),
      `${H}.emptyHeading(extra=,pos= (#2))`,
    ],
    [
      "empty_heading BEZ licznika i bez pozycji",
      heading("empty_heading"),
      `${H}.emptyHeading(extra=,pos=)`,
    ],
    [
      "duplicate_heading z pozycją i fragmentem",
      heading("duplicate_heading", { position: 7, snippet: "Podsumowanie" }),
      `${H}.duplicateHeading(pos= (#7),snip= - "Podsumowanie")`,
    ],
    [
      "duplicate_heading bez pozycji i bez fragmentu",
      heading("duplicate_heading"),
      `${H}.duplicateHeading(pos=,snip=)`,
    ],
    [
      "too_long_heading z długością znakową (klucz ma formy mnogie po `count`)",
      heading("too_long_heading", { position: 3, count: 92, snippet: "Bardzo długi nagłówek" }),
      `${H}.tooLongHeading(count=92,pos= (#3),snip= - "Bardzo długi nagłówek")`,
    ],
    [
      "too_long_heading BEZ długości - liczebnik przechodzi jako brak",
      heading("too_long_heading", { position: 3 }),
      `${H}.tooLongHeading(count=undefined,pos= (#3),snip=)`,
    ],
    [
      "shouty_heading z pozycją i fragmentem",
      heading("shouty_heading", { position: 8, snippet: "WERSALIKI W NAGŁÓWKU" }),
      `${H}.shoutyHeading(pos= (#8),snip= - "WERSALIKI W NAGŁÓWKU")`,
    ],
    [
      "shouty_heading bez pozycji i bez fragmentu",
      heading("shouty_heading"),
      `${H}.shoutyHeading(pos=,snip=)`,
    ],
  ])("%s", (_opis, issue, expectedText) => {
    renderSummary([], [issue]);
    // Etykieta struktury nagłówków stoi przed każdą taką uwagą - inaczej
    // redakcja nie wie, czy uwaga dotyczy meta tagów, czy treści wpisu.
    expect(rows()).toEqual([`PL - ${K.headingLabel}: ${expectedText}`]);
  });

  // ROZJAZD KOD <-> SŁOWNIK, nie polski wtręt w interfejsie EN.
  //
  // Poprzednia wersja tego pliku oskarżała komponent o wstrzykiwanie polskiego
  // napisu ` (łącznie N)` do komunikatu anglojęzycznego redaktora. To jest
  // NIEPRAWDA i warto wiedzieć, dlaczego, bo pułapka jest ogólna: atrapa
  // `translateKey` z `@/test/i18nStub` DOKLEJA wszystkie parametry do klucza
  // (`klucz(param=wartość)`), żeby asercja widziała, co kod przekazał. Prawdziwe
  // i18next robi coś odwrotnego - parametr bez `{{miejsca}}` w wartości klucza
  // jest po cichu WYRZUCANY. Napis ` (łącznie 3)` nie dociera więc do żadnego
  // interfejsu, ani polskiego, ani angielskiego; widać go WYŁĄCZNIE w teście.
  // Test oparty na tym, co dokleiła atrapa, dowodziłby zachowania atrapy.
  //
  // DEFEKT JEST INNY I JEST REALNY: `empty_heading` to jedyny rodzaj uwagi,
  // przy którym pozycja nagłówka jest LICZONA I PRZEKAZANA, a potem ginie.
  // Wartość klucza `admin.seo.validation.emptyHeading` (PL i EN) nie ma ani
  // `{{pos}}`, ani `{{extra}}` - podczas gdy `duplicateHeading`, `extraH1`,
  // `shoutyHeading`, `tooLongHeading` i `skippedLevel` mają `{{pos}}` i mówią
  // redakcji, KTÓRY nagłówek poprawić.
  //
  // Fakt czytamy ze SŁOWNIKA jako tekstu (`readFileSync`, wzorzec bramek
  // w `src/routes/__tests__/adminRouteAuthority.gate.test.ts`), a nie przez
  // import - ten plik mockuje `react-i18next`, a `i18n-admin-extras.ts` sięga
  // przez `./i18n` właśnie do niego, więc import domknąłby cykl i ZAWIESIŁ
  // plik testowy bez komunikatu (patrz ostrzeżenie w `@/test/i18nStub`).
  const DICTIONARY = "src/lib/i18n-admin-extras.ts";

  it("pozycja i licznik pustego nagłówka są przekazywane do i18n - to nie jest luka po stronie komponentu", () => {
    renderSummary([], [heading("empty_heading", { count: 3, position: 2 })]);
    // Komponent robi swoje: oba parametry lecą do `t()`.
    expect(rows()[0]).toContain("pos= (#2)");
    expect(rows()[0]).toContain("extra= (łącznie 3)");
  });

  it("słownik NIE ma miejsca na te parametry - stan faktyczny, przypięty na wartości klucza", () => {
    const dictionary = readFileSync(DICTIONARY, "utf8");
    const emptyHeadingValues = [...dictionary.matchAll(/emptyHeading:\s*("(?:[^"\\]|\\.)*")/g)].map(
      (m) => m[1],
    );
    // Dwie wartości: PL i EN. Kanarek zasięgu - gdyby regex przestał trafiać,
    // asercje niżej przechodziłyby na pustej liście i nic nie dowodziły.
    expect(emptyHeadingValues, `brak klucza emptyHeading w ${DICTIONARY}`).toHaveLength(2);
    for (const value of emptyHeadingValues) {
      expect(value, "emptyHeading nie interpoluje pozycji").not.toContain("{{pos}}");
      expect(value, "emptyHeading nie interpoluje licznika").not.toContain("{{extra}}");
    }
  });

  it("pozostałe rodzaje uwag o nagłówkach POKAZUJĄ pozycję - to z nimi `empty_heading` się rozjeżdża", () => {
    const dictionary = readFileSync(DICTIONARY, "utf8");
    // Bez tej asercji „brak {{pos}}" mógłby znaczyć „ten panel nigdy nie
    // pokazuje pozycji", czyli spójną decyzję projektową, a nie rozjazd.
    for (const key of ["duplicateHeading", "extraH1", "shoutyHeading"]) {
      const values = [
        ...dictionary.matchAll(new RegExp(`${key}:\\s*("(?:[^"\\\\]|\\\\.)*")`, "g")),
      ].map((m) => m[1]);
      expect(values.length, `brak klucza ${key} w ${DICTIONARY}`).toBeGreaterThan(0);
      expect(
        values.some((v) => v.includes("{{pos}}")),
        `${key} bez {{pos}}`,
      ).toBe(true);
    }
  });

  // Stan POŻĄDANY: redakcja dowiaduje się, KTÓRY nagłówek jest pusty.
  // KONSEKWENCJA obecnego stanu: przy wpisie z kilkunastoma sekcjami uwaga
  // „Pusty nagłówek w treści - usuń lub uzupełnij." nie mówi gdzie, więc
  // redaktor przechodzi wpis ręcznie albo ignoruje uwagę. Naprawa należy do
  // słownika i produkcji (dopisać `{{pos}}` do obu wersji klucza), nie do testu.
  it.fails(
    "DEFEKT: uwaga o pustym nagłówku nie mówi, KTÓRY nagłówek jest pusty, choć pozycja jest policzona",
    () => {
      const dictionary = readFileSync(DICTIONARY, "utf8");
      const values = [...dictionary.matchAll(/emptyHeading:\s*("(?:[^"\\]|\\.)*")/g)].map(
        (m) => m[1],
      );
      expect(values.every((v) => v.includes("{{pos}}"))).toBe(true);
    },
  );

  it("uwagi wchodzą do listy w KOLEJNOŚCI podania: najpierw meta, potem nagłówki", () => {
    renderSummary(
      [meta({ severity: "warning" })],
      [heading("missing_h1"), heading("empty_heading", { count: 2, position: 5 })],
    );

    expect(rows()).toEqual([
      `PL - ${K.titleLabel}: admin.seo.validation.warnLine(chars=70,px=640,pxLimit=600)`,
      `PL - ${K.headingLabel}: admin.seo.validation.missingH1`,
      `PL - ${K.headingLabel}: admin.seo.validation.emptyHeading(extra= (łącznie 2),pos= (#5))`,
    ]);
  });
});

describe("SeoValidationSummary - etykieta języka przed każdą uwagą", () => {
  // Panel ma zakładki PL/EN, a podsumowanie stoi PONAD nimi i pokazuje uwagi
  // z OBU języków naraz. Bez etykiety języka redaktor poprawia zły wariant.
  it.each<[HeadingIssue["lang"], string]>([
    ["pl", "PL"],
    ["en", "EN"],
  ])("uwaga w języku %s dostaje prefiks %s", (lang, label) => {
    renderSummary(
      [meta({ lang, severity: "warning" })],
      [heading("shouty_heading", { lang, position: 2, snippet: "ABC" })],
    );

    for (const row of rows()) {
      expect(row.startsWith(`${label} - `)).toBe(true);
    }
    expect(rows()).toHaveLength(2);
  });

  it("uwagi z obu języków stoją obok siebie z różnymi prefiksami", () => {
    renderSummary(
      [],
      [heading("missing_h1", { lang: "pl" }), heading("missing_h1", { lang: "en" })],
    );

    expect(rows()).toEqual([
      `PL - ${K.headingLabel}: admin.seo.validation.missingH1`,
      `EN - ${K.headingLabel}: admin.seo.validation.missingH1`,
    ]);
  });
});

describe("SeoValidationSummary - klucze wierszy Reacta", () => {
  it("dwie uwagi tego samego rodzaju w RÓŻNYCH pozycjach nie kolidują kluczem", () => {
    // Kolizja klucza to nie kosmetyka: React scala takie wiersze przy kolejnym
    // renderze, więc jedna z dwóch uwag przestaje być widoczna dla redakcji.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderSummary(
        [],
        [
          heading("duplicate_heading", { position: 3, snippet: "Wstęp" }),
          heading("duplicate_heading", { position: 7, snippet: "Wstęp" }),
        ],
      );

      expect(rows()).toEqual([
        `PL - ${K.headingLabel}: admin.seo.validation.duplicateHeading(pos= (#3),snip= - "Wstęp")`,
        `PL - ${K.headingLabel}: admin.seo.validation.duplicateHeading(pos= (#7),snip= - "Wstęp")`,
      ]);
      const ostrzezenia = spy.mock.calls
        .map((args) => args.map((a) => String(a)).join(" "))
        .filter((text) => text.includes("same key"));
      expect(ostrzezenia).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("uwagi meta o różnym poziomie istotności dla tego samego pola mają różne klucze", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderSummary([meta(), meta({ severity: "warning" })]);

      expect(rows()).toHaveLength(2);
      expect(
        spy.mock.calls.map((args) => args.map((a) => String(a)).join(" ")).join(" "),
      ).not.toContain("same key");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("SeoValidationSummary - dostępność", () => {
  it("stan Z uwagami nie ma naruszeń axe", async () => {
    const { container } = renderSummary(
      [meta(), meta({ lang: "en", kind: "description", severity: "warning" })],
      [
        heading("skipped_level", { from: 2, to: 4, position: 5, snippet: "Sekcja" }),
        heading("too_long_heading", { position: 6, count: 84, snippet: "Długi nagłówek" }),
      ],
    );

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan BEZ uwag nie ma naruszeń axe", async () => {
    const { container } = renderSummary([]);

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("SeoValidationSummary - komplet uwag z prawdziwego walidatora", () => {
  it("żadna uwaga policzona przez validateHeadings nie ginie po drodze do listy", () => {
    // Nie sprawdzamy TU reguł walidatora (to robi jego własna powierzchnia) -
    // sprawdzamy, że liczba wierszy równa się liczbie policzonych uwag, czyli
    // że żaden rodzaj nie wypada z łańcucha `else if` bez śladu na ekranie.
    const uwagi = validateHeadings("pl", {
      html:
        "<h1>Pierwszy</h1><h1>Drugi</h1><h3></h3><h2>WIELKIE LITERY W TYM</h2>" +
        "<h2>WIELKIE LITERY W TYM</h2>",
    });

    expect(uwagi.length).toBeGreaterThan(1);
    renderSummary([], uwagi);
    expect(rows()).toHaveLength(uwagi.length);
    // Każdy wiersz jest opisany kluczem, nie pustym miejscem po nieobsłużonym
    // rodzaju uwagi (`text` startuje w komponencie jako pusty napis).
    for (const row of rows()) {
      expect(row).toMatch(new RegExp(`^PL - ${K.headingLabel}: admin\\.seo\\.validation\\.`));
    }
  });

  // DEFEKT PRODUKTU, nie luka testu. Podsumowanie zna wyłącznie DWIE listy
  // uwag i nie ma żadnego sygnału "czy walidacja w ogóle się wykonała".
  // `validateHeadings` zwraca pustą listę zarówno wtedy, gdy treść jest czysta,
  // jak i wtedy, gdy NIE MA CZEGO SPRAWDZAĆ (brak nagłówków - `headings.length
  // === 0` kończy funkcję natychmiast); tak samo pusta lista przychodzi, gdy
  // panel montuje się przed policzeniem uwag albo gdy liczenie padnie.
  // KONSEKWENCJA: redakcja dostaje ZIELONE "wszystkie pola mieszczą się w
  // limitach Google" jako potwierdzenie czegoś, czego nikt nie sprawdził -
  // i publikuje wpis bez H1, z pustym opisem, w przekonaniu, że przeszedł
  // kontrolę. Test opisuje stan POŻĄDANY (dwa różne stany = dwa różne
  // komunikaty) i dlatego jest oznaczony `it.fails`. Naprawa należy do
  // produkcji (osobny stan "nie sprawdzono"), nie do testu.
  it.fails(
    "DEFEKT: podsumowanie pokazuje zielone „brak uwag” także wtedy, gdy walidacja NIE ZOSTAŁA WYKONANA - redakcja dostaje fałszywe potwierdzenie",
    () => {
      const nieSprawdzone = validateHeadings("pl", { html: "" });
      const sprawdzoneCzyste = validateHeadings("pl", {
        html: "<h1>Tytuł</h1><h2>Sekcja</h2><h3>Podsekcja</h3>",
      });
      // Oba wejścia dają pustą listę - walidator sam nie odróżnia tych stanów.
      expect(nieSprawdzone).toEqual([]);
      expect(sprawdzoneCzyste).toEqual([]);

      const bezWalidacji = renderSummary([], nieSprawdzone).container.textContent;
      cleanup();
      const poWalidacji = renderSummary([], sprawdzoneCzyste).container.textContent;

      expect(bezWalidacji).not.toBe(poWalidacji);
    },
  );
});
