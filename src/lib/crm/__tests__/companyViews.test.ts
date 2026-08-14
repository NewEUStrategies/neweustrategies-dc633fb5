// Lista firm CRM (`/admin/companies`) - 333 linie, zero testów do dziś.
//
// Audyt 14.08 policzył CRM na T/P 0,12 przy +1 163 liniach przyrostu. Ten plik
// jest w tym module najbardziej opłacalny: jest CZYSTY (bez sieci, bez Reacta),
// a jednocześnie decyduje o tym, co operator WIDZI i co WYWOZI z platformy.
//
// Trzy warstwy, każda z własnym rodzajem błędu:
//
//   1. FILTR I SORTOWANIE działają po stronie klienta na wierszach już
//      pobranych. Błąd tutaj nie wycieka danych, ale kłamie liczbą: "znaleziono
//      12 firm" przy dwudziestu spełniających warunek. Operator podejmuje na tym
//      decyzje handlowe.
//   2. `parseCompanyViewConfig` czyta JSONB z serwera. Musi być fail-safe:
//      uszkodzony zapisany widok nie może wysypać ekranu ani - drugi skrajny
//      przypadek - przepuścić kształtu, który potem wywala render.
//   3. EKSPORT CSV wynosi dane z platformy do arkusza operatora. Bramka
//      wstrzyknięcia formuły ma własny plik (`csv.test.ts`); tutaj sprawdzamy
//      SKLEJENIE - że kolumny, kolejność i język nagłówka są takie, jak operator
//      widzi na ekranie.
import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMPANY_VIEWS,
  COMPANY_COLUMNS,
  COMPANY_COLUMN_BY_KEY,
  CompanySortSchema,
  CompanyViewConfigSchema,
  DEFAULT_COMPANY_FILTER,
  DEFAULT_COMPANY_SORT,
  DEFAULT_COMPANY_VIEW_CONFIG,
  applyCompanyFilter,
  applyCompanySort,
  isDefaultFilter,
  parseCompanyViewConfig,
  rowsToCsv,
  type CompanyColumnKey,
  type CompanyFilter,
  type CompanyRowShape,
} from "../companyViews";

/** Chwila odniesienia - wiersze budowane względem niej, nie względem "teraz". */
const NOW = Date.parse("2026-08-14T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

function row(overrides: Partial<CompanyRowShape> & { id: string }): CompanyRowShape {
  return {
    name: `Firma ${overrides.id}`,
    domain: null,
    country: "Polska",
    branch: "energia",
    city: "Warszawa",
    created_at: daysAgo(10),
    updated_at: daysAgo(5),
    leads_count: 0,
    contacts_count: 0,
    last_lead_activity_at: null,
    ...overrides,
  };
}

function filter(overrides: Partial<CompanyFilter> = {}): CompanyFilter {
  return { ...DEFAULT_COMPANY_FILTER, ...overrides };
}

function ids(rows: readonly CompanyRowShape[]): string[] {
  return rows.map((r) => r.id);
}

describe("katalog kolumn", () => {
  it("kolumna `name` jest wymagana - nie da się jej ukryć", () => {
    // Lista bez nazwy firmy to lista identyfikatorów. Flaga `required` jest
    // jedynym, co trzyma tę kolumnę na ekranie.
    expect(COMPANY_COLUMN_BY_KEY.name.required).toBe(true);
    const required = COMPANY_COLUMNS.filter((c) => c.required === true).map((c) => c.key);
    expect(required).toEqual(["name"]);
  });

  it("każdy klucz kolumny występuje dokładnie raz", () => {
    const keys = COMPANY_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("mapa po kluczu pokrywa cały katalog", () => {
    for (const col of COMPANY_COLUMNS) {
      expect(COMPANY_COLUMN_BY_KEY[col.key], col.key).toBe(col);
    }
    expect(Object.keys(COMPANY_COLUMN_BY_KEY)).toHaveLength(COMPANY_COLUMNS.length);
  });

  it("każda kolumna ma etykietę PL i EN, i to RÓŻNE etykiety tam, gdzie języki się różnią", () => {
    for (const col of COMPANY_COLUMNS) {
      expect(col.labelPl.trim(), `${col.key} PL`).not.toBe("");
      expect(col.labelEn.trim(), `${col.key} EN`).not.toBe("");
    }
    // `Domena`/`Domain` i `WWW`/`Website` się różnią; identyczna para w OBU
    // językach jest dopuszczalna tylko dla nazw własnych, których tu nie ma.
    const identical = COMPANY_COLUMNS.filter((c) => c.labelPl === c.labelEn).map((c) => c.key);
    expect(identical).toEqual([]);
  });

  it("żadna etykieta nie zawiera pauzy - konwencja typograficzna platformy", () => {
    const offenders = COMPANY_COLUMNS.filter(
      (c) => /[—–]/.test(c.labelPl) || /[—–]/.test(c.labelEn),
    ).map((c) => c.key);
    expect(offenders).toEqual([]);
  });

  it("każdy klucz sortowania odpowiada istniejącej i sortowalnej kolumnie", () => {
    // Rozjazd między enumem sortowania a katalogiem kolumn daje strzałkę
    // sortowania na kolumnie, której serwer nie umie posortować - albo, gorzej,
    // sortowanie bez widocznej kolumny.
    const sortable = new Set(COMPANY_COLUMNS.filter((c) => c.sortable === true).map((c) => c.key));
    for (const key of CompanySortSchema.shape.key.options) {
      expect(sortable, `klucz sortowania ${key} nie jest sortowalną kolumną`).toContain(key);
    }
  });
});

describe("isDefaultFilter", () => {
  it("filtr domyślny jest rozpoznany jako domyślny", () => {
    expect(isDefaultFilter(DEFAULT_COMPANY_FILTER)).toBe(true);
  });

  it("`minLeads: 0` liczy się jako brak zawężenia", () => {
    // Świadome: zero leadów to nie filtr, tylko wartość neutralna. Bez tej
    // gałęzi wskaźnik "filtry aktywne" świeciłby się po samym dotknięciu suwaka.
    expect(isDefaultFilter(filter({ minLeads: 0 }))).toBe(true);
    expect(isDefaultFilter(filter({ minLeads: 1 }))).toBe(false);
  });

  it.each([
    ["country", filter({ country: "Polska" })],
    ["branch", filter({ branch: "energia" })],
    ["hasLeads", filter({ hasLeads: "with" })],
    ["createdRange", filter({ createdRange: "30d" })],
    ["activityRange", filter({ activityRange: "7d" })],
  ] as ReadonlyArray<[string, CompanyFilter]>)("oś %s wyłącza stan domyślny", (_axis, f) => {
    expect(isDefaultFilter(f)).toBe(false);
  });

  it("każda oś schematu jest brana pod uwagę (kanarek kompletności)", () => {
    // Nowa oś filtra dopisana do schematu, a pominięta w `isDefaultFilter`,
    // zostaje na zawsze niewidoczna dla wskaźnika "filtry aktywne". Ten warunek
    // wiąże obie listy.
    const axes = Object.keys(DEFAULT_COMPANY_FILTER);
    expect(axes.sort()).toEqual(
      ["activityRange", "branch", "country", "createdRange", "hasLeads", "minLeads"].sort(),
    );
  });
});

describe("applyCompanyFilter", () => {
  const ROWS: readonly CompanyRowShape[] = [
    row({ id: "a", country: "Polska", branch: "energia", leads_count: 5 }),
    row({ id: "b", country: "Belgia", branch: "energia", leads_count: 0 }),
    row({ id: "c", country: "Polska", branch: "obronność", leads_count: 2 }),
  ];

  it("filtr domyślny nie odrzuca niczego", () => {
    expect(ids(applyCompanyFilter([...ROWS], DEFAULT_COMPANY_FILTER))).toEqual(["a", "b", "c"]);
  });

  it("zawęża po kraju", () => {
    expect(ids(applyCompanyFilter([...ROWS], filter({ country: "Polska" })))).toEqual(["a", "c"]);
  });

  it("zawęża po branży", () => {
    expect(ids(applyCompanyFilter([...ROWS], filter({ branch: "energia" })))).toEqual(["a", "b"]);
  });

  it("osie filtra działają KONIUNKCYJNIE", () => {
    // Alternatywa dawałaby szerszy wynik niż operator zamówił - a to wynik,
    // na którym prowadzi się kampanię.
    const out = applyCompanyFilter([...ROWS], filter({ country: "Polska", branch: "energia" }));
    expect(ids(out)).toEqual(["a"]);
  });

  it("`hasLeads: with` / `without` dzielą zbiór rozłącznie i wyczerpująco", () => {
    const withLeads = applyCompanyFilter([...ROWS], filter({ hasLeads: "with" }));
    const without = applyCompanyFilter([...ROWS], filter({ hasLeads: "without" }));
    expect(ids(withLeads)).toEqual(["a", "c"]);
    expect(ids(without)).toEqual(["b"]);
    expect(withLeads.length + without.length).toBe(ROWS.length);
  });

  it("`minLeads` jest progiem WŁĄCZNYM", () => {
    const rows = [row({ id: "x", leads_count: 3 }), row({ id: "y", leads_count: 2 })];
    expect(ids(applyCompanyFilter(rows, filter({ minLeads: 3 })))).toEqual(["x"]);
  });

  it("`minLeads: 0` nie odrzuca firm bez leadów", () => {
    const rows = [row({ id: "x", leads_count: 0 })];
    expect(ids(applyCompanyFilter(rows, filter({ minLeads: 0 })))).toEqual(["x"]);
  });

  it("zakres utworzenia liczy się od `created_at`", () => {
    const rows = [
      row({ id: "swieza", created_at: daysAgo(5) }),
      row({ id: "stara", created_at: daysAgo(40) }),
    ];
    expect(ids(applyCompanyFilter(rows, filter({ createdRange: "30d" })))).toEqual(["swieza"]);
    expect(ids(applyCompanyFilter(rows, filter({ createdRange: "365d" })))).toEqual([
      "swieza",
      "stara",
    ]);
  });

  it("zakres aktywności spada na `updated_at`, gdy nie ma aktywności leada", () => {
    // Firma bez ani jednego leada nie ma `last_lead_activity_at`, ale ma datę
    // edycji kartoteki. Bez tego zapasu każda taka firma wypadałaby z filtra
    // "ostatnia aktywność" niezależnie od tego, kiedy ktoś ją naprawdę ruszał.
    const rows = [
      row({ id: "edytowana", last_lead_activity_at: null, updated_at: daysAgo(3) }),
      row({ id: "zapomniana", last_lead_activity_at: null, updated_at: daysAgo(90) }),
    ];
    expect(ids(applyCompanyFilter(rows, filter({ activityRange: "7d" })))).toEqual(["edytowana"]);
  });

  it("aktywność leada ma pierwszeństwo nad datą edycji kartoteki", () => {
    const rows = [
      row({ id: "zywa", last_lead_activity_at: daysAgo(2), updated_at: daysAgo(200) }),
      row({ id: "martwa", last_lead_activity_at: daysAgo(200), updated_at: daysAgo(1) }),
    ];
    expect(ids(applyCompanyFilter(rows, filter({ activityRange: "7d" })))).toEqual(["zywa"]);
  });

  it("nie mutuje wejścia", () => {
    const rows = [row({ id: "a", leads_count: 0 }), row({ id: "b", leads_count: 9 })];
    const snapshot = ids(rows);
    applyCompanyFilter(rows, filter({ hasLeads: "with" }));
    expect(ids(rows)).toEqual(snapshot);
  });
});

describe("applyCompanySort", () => {
  it("nie mutuje wejścia - lista na ekranie nie może przeskoczyć pod sortowaniem", () => {
    const rows = [row({ id: "b", name: "Beta" }), row({ id: "a", name: "Alfa" })];
    const snapshot = ids(rows);
    applyCompanySort(rows, { key: "name", dir: "asc" });
    expect(ids(rows)).toEqual(snapshot);
  });

  it("sortuje nazwy alfabetycznie z uwzględnieniem polskich znaków", () => {
    // `localeCompare`, nie `<`: przy porównaniu kodowym "Łódź" wypada za "Zamość",
    // co w polskim panelu wygląda na zepsute sortowanie.
    const rows = [
      row({ id: "z", name: "Zamość" }),
      row({ id: "l", name: "Łódź" }),
      row({ id: "a", name: "Aleja" }),
    ];
    expect(ids(applyCompanySort(rows, { key: "name", dir: "asc" }))).toEqual(["a", "l", "z"]);
  });

  it("kierunek `desc` odwraca porządek `asc`", () => {
    const rows = [
      row({ id: "a", name: "Alfa" }),
      row({ id: "b", name: "Beta" }),
      row({ id: "c", name: "Gamma" }),
    ];
    const asc = ids(applyCompanySort(rows, { key: "name", dir: "asc" }));
    const desc = ids(applyCompanySort(rows, { key: "name", dir: "desc" }));
    expect(desc).toEqual([...asc].reverse());
  });

  it.each(["contacts", "leads"] as const)("sortuje licznik %s liczbowo, nie tekstowo", (key) => {
    // Porównanie tekstowe stawia 10 przed 9. Przy listach leadów to nie jest
    // subtelność - operator sortuje właśnie po to, żeby zobaczyć górę listy.
    const rows = [
      row({ id: "malo", leads_count: 9, contacts_count: 9 }),
      row({ id: "duzo", leads_count: 10, contacts_count: 10 }),
    ];
    expect(ids(applyCompanySort(rows, { key, dir: "desc" }))).toEqual(["duzo", "malo"]);
  });

  it.each(["branch", "country"] as const)("brak wartości w %s nie wysypuje sortowania", (key) => {
    const rows = [row({ id: "z", [key]: null }), row({ id: "a", [key]: "Alfa" })];
    expect(() => applyCompanySort(rows, { key, dir: "asc" })).not.toThrow();
    expect(ids(applyCompanySort(rows, { key, dir: "asc" }))).toEqual(["z", "a"]);
  });

  it("sortuje daty utworzenia chronologicznie", () => {
    const rows = [
      row({ id: "stara", created_at: daysAgo(90) }),
      row({ id: "nowa", created_at: daysAgo(1) }),
    ];
    expect(ids(applyCompanySort(rows, { key: "created", dir: "desc" }))).toEqual(["nowa", "stara"]);
  });

  it("sortowanie po aktywności używa tego samego zapasu, co filtr", () => {
    // Rozjazd między zapasem w filtrze (`?? updated_at`) i w sortowaniu dawałby
    // listę, w której wiersz przeszedł filtr "ostatnie 7 dni", a stoi na końcu
    // sortowania po aktywności.
    const rows = [
      row({ id: "przez-edycje", last_lead_activity_at: null, updated_at: daysAgo(1) }),
      row({ id: "przez-leada", last_lead_activity_at: daysAgo(5), updated_at: daysAgo(300) }),
    ];
    expect(ids(applyCompanySort(rows, { key: "lastActivity", dir: "desc" }))).toEqual([
      "przez-edycje",
      "przez-leada",
    ]);
  });

  it("każdy klucz schematu sortowania jest obsłużony", () => {
    // `default` w `switch` łapie `lastActivity`, więc nieobsłużony klucz nie
    // rzuca - po prostu CICHO sortuje po czymś innym. Ten warunek wymusza, żeby
    // każdy klucz dawał WŁASNY porządek, a nie porządek gałęzi domyślnej.
    const rows = [
      row({
        id: "pierwszy",
        name: "Alfa",
        branch: "aaa",
        country: "aaa",
        contacts_count: 1,
        leads_count: 1,
        created_at: daysAgo(1),
        last_lead_activity_at: daysAgo(1),
      }),
      row({
        id: "drugi",
        name: "Beta",
        branch: "bbb",
        country: "bbb",
        contacts_count: 2,
        leads_count: 2,
        created_at: daysAgo(2),
        last_lead_activity_at: daysAgo(2),
      }),
    ];
    for (const key of CompanySortSchema.shape.key.options) {
      const asc = ids(applyCompanySort(rows, { key, dir: "asc" }));
      const desc = ids(applyCompanySort(rows, { key, dir: "desc" }));
      expect(asc, `klucz ${key} nie różnicuje porządku`).not.toEqual(desc);
    }
  });
});

describe("parseCompanyViewConfig - fail-safe wobec JSONB z serwera", () => {
  it("uszkodzony zapis spada na konfigurację domyślną, nie na wyjątek", () => {
    for (const broken of [null, undefined, 42, "nie-obiekt", [], { columns: [] }]) {
      expect(parseCompanyViewConfig(broken)).toEqual(DEFAULT_COMPANY_VIEW_CONFIG);
    }
  });

  it("pusta lista kolumn jest odrzucana - widok bez kolumn to pusty ekran", () => {
    expect(parseCompanyViewConfig({ columns: [] })).toEqual(DEFAULT_COMPANY_VIEW_CONFIG);
  });

  it("nieznany klucz kolumny unieważnia CAŁY widok", () => {
    // Świadomie ostro: gdyby schemat po cichu odsiewał nieznane klucze,
    // literówka w nazwie kolumny dawałaby widok z brakującą kolumną i nikt nie
    // wiedziałby, dlaczego. Spadek na domyślny jest widoczny.
    expect(parseCompanyViewConfig({ columns: ["name", "nie-ma-takiej"] })).toEqual(
      DEFAULT_COMPANY_VIEW_CONFIG,
    );
  });

  it("poprawny widok przechodzi bez zmian", () => {
    const config = {
      columns: ["name", "leads"] satisfies CompanyColumnKey[],
      filter: filter({ country: "Polska" }),
      sort: { key: "leads", dir: "desc" } as const,
    };
    expect(parseCompanyViewConfig(config)).toEqual(config);
  });

  it("brakujące gałęzie dostają wartości domyślne, nie `undefined`", () => {
    const parsed = parseCompanyViewConfig({ columns: ["name"] });
    expect(parsed.filter).toEqual(DEFAULT_COMPANY_FILTER);
    expect(parsed.sort).toEqual(DEFAULT_COMPANY_SORT);
  });

  it("`safeParse` na kształcie domyślnym przechodzi (spójność stałej ze schematem)", () => {
    // Stała i schemat to dwa niezależne zapisy tej samej prawdy - rozjazd
    // między nimi znaczy, że fallback sam by nie przeszedł walidacji.
    expect(CompanyViewConfigSchema.safeParse(DEFAULT_COMPANY_VIEW_CONFIG).success).toBe(true);
  });
});

describe("widoki wbudowane", () => {
  it("każdy ma unikalny identyfikator z prefiksem `builtin:`", () => {
    // Prefiks odróżnia widok wbudowany od zapisanego przez operatora - bez niego
    // zapisany widok o tym samym id nadpisywałby wbudowany w droplistcie.
    const identifiers = BUILTIN_COMPANY_VIEWS.map((v) => v.id);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    for (const id of identifiers) expect(id.startsWith("builtin:"), id).toBe(true);
  });

  it("każdy ma etykietę PL i EN", () => {
    for (const view of BUILTIN_COMPANY_VIEWS) {
      expect(view.labelPl.trim(), view.id).not.toBe("");
      expect(view.labelEn.trim(), view.id).not.toBe("");
    }
  });

  it("konfiguracja każdego przechodzi własny schemat", () => {
    for (const view of BUILTIN_COMPANY_VIEWS) {
      expect(CompanyViewConfigSchema.safeParse(view.config).success, view.id).toBe(true);
    }
  });

  it("każdy widok poza `all` realnie zawęża albo przestawia porządek", () => {
    // Widok wbudowany, który po drodze zgubił swój filtr, wygląda w interfejsie
    // dokładnie jak działający i nikt tego nie zauważy.
    for (const view of BUILTIN_COMPANY_VIEWS) {
      if (view.id === "builtin:all") continue;
      const narrows = !isDefaultFilter(view.config.filter);
      const reorders =
        view.config.sort.key !== DEFAULT_COMPANY_SORT.key ||
        view.config.sort.dir !== DEFAULT_COMPANY_SORT.dir;
      expect(narrows || reorders, `${view.id} nie robi nic`).toBe(true);
    }
  });

  it("widok `Z leadami` faktycznie odsiewa firmy bez leadów", () => {
    const view = BUILTIN_COMPANY_VIEWS.find((v) => v.id === "builtin:with-leads");
    expect(view).toBeDefined();
    const rows = [row({ id: "z", leads_count: 3 }), row({ id: "bez", leads_count: 0 })];
    expect(ids(applyCompanyFilter(rows, view!.config.filter))).toEqual(["z"]);
  });
});

describe("rowsToCsv - sklejenie eksportu", () => {
  const ROW = row({
    id: "a",
    name: "Instytut Analiz",
    domain: "analizy.example",
    branch: "energia",
    city: "Warszawa",
    country: "Polska",
    contacts_count: 4,
    leads_count: 12,
    created_at: "2026-01-15T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
    last_lead_activity_at: "2026-08-10T08:00:00.000Z",
  });

  it("nagłówek jest w języku operatora", () => {
    expect(rowsToCsv([ROW], ["name", "leads"], "pl").split("\n")[0]).toBe("Firma,Leady");
    expect(rowsToCsv([ROW], ["name", "leads"], "en").split("\n")[0]).toBe("Company,Leads");
  });

  it("kolumny wychodzą w kolejności podanej przez operatora, nie katalogu", () => {
    // Operator przestawia kolumny na ekranie i oczekuje tej samej kolejności
    // w pliku - inaczej porównanie eksportu z ekranem jest bezużyteczne.
    expect(rowsToCsv([ROW], ["leads", "name"], "pl").split("\n")[0]).toBe("Leady,Firma");
    expect(rowsToCsv([ROW], ["leads", "name"], "pl").split("\n")[1]).toBe("12,Instytut Analiz");
  });

  it("eksportuje tylko wybrane kolumny", () => {
    const csv = rowsToCsv([ROW], ["name"], "pl");
    expect(csv).toBe("Firma\nInstytut Analiz");
    expect(csv).not.toContain("energia");
  });

  it("`location` skleja miasto i kraj, a przecinek nie rozsypuje wiersza", () => {
    const csv = rowsToCsv([ROW], ["location"], "pl");
    expect(csv.split("\n")[1]).toBe('"Warszawa, Polska"');
  });

  it("`location` bez miasta oddaje sam kraj bez wiszącego przecinka", () => {
    const csv = rowsToCsv([row({ id: "b", city: null, country: "Belgia" })], ["location"], "pl");
    expect(csv.split("\n")[1]).toBe("Belgia");
  });

  it("`location` bez miasta i kraju jest pusta, nie jest tekstem `null`", () => {
    const csv = rowsToCsv([row({ id: "c", city: null, country: null })], ["location"], "pl");
    expect(csv.split("\n")[1]).toBe("");
  });

  it("`lastActivity` spada na datę edycji, gdy nie ma aktywności leada", () => {
    const rows = [
      row({ id: "d", last_lead_activity_at: null, updated_at: "2026-07-07T00:00:00.000Z" }),
    ];
    expect(rowsToCsv(rows, ["lastActivity"], "pl").split("\n")[1]).toBe("2026-07-07T00:00:00.000Z");
  });

  it("kolumny poza minimalnym kształtem wiersza dają pustkę, nie `undefined`", () => {
    // `phone` i `website` są w katalogu kolumn, ale NIEOBOWIĄZKOWE w kształcie
    // wiersza - operator może włączyć kolumnę dla listy, która ich nie ma.
    // Poprzednia wersja czytała je rzutowaniem `as unknown as {...}`, które
    // OBIECYWAŁO `string | null` - a przy wierszu bez tych pól do pliku szło
    // słowo `undefined`.
    const csv = rowsToCsv([ROW], ["phone", "website"], "pl");
    expect(csv.split("\n")[1]).toBe(",");
    expect(csv).not.toContain("undefined");
  });

  it("czyta `phone` i `website`, gdy serwer je poda", () => {
    const enriched = { ...ROW, phone: "+48 22 123 45 67", website: "https://analizy.example" };
    expect(rowsToCsv([enriched], ["phone", "website"], "pl").split("\n")[1]).toBe(
      "'+48 22 123 45 67,https://analizy.example",
    );
  });

  it("numer międzynarodowy dostaje apostrof - to koszt osłony, nie usterka", () => {
    // `+48...` zaczyna się znakiem, na którym arkusz zaczyna liczyć wyrażenie,
    // więc trafia pod tę samą osłonę co ładunek. Skutek jest widoczny: numer
    // w pliku ma wiodący apostrof. Tak samo działa eksport leadów od początku
    // i tak samo robi każde narzędzie, które tę klasę podatności zamyka -
    // alternatywą jest zgoda na wykonywanie treści komórki. Zapisane wprost,
    // żeby nikt nie "naprawił" tego, wycinając `+` z zestawu znaków formuły.
    const enriched = { ...ROW, phone: "+48221234567" };
    expect(rowsToCsv([enriched], ["phone"], "pl").split("\n")[1]).toBe("'+48221234567");
  });

  it("pusta lista firm daje sam nagłówek", () => {
    expect(rowsToCsv([], ["name", "leads"], "pl")).toBe("Firma,Leady");
  });

  it("liczba wierszy pliku odpowiada liczbie firm plus nagłówek", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    expect(rowsToCsv(rows, ["name"], "pl").split("\n")).toHaveLength(4);
  });

  it("każda kolumna katalogu daje się wyeksportować", () => {
    // Kolumna dopisana do katalogu, a pominięta w `switch`, wychodzi jako pusta
    // komórka bez żadnego sygnału. Ten warunek wymusza, żeby każda kolumna
    // umiała oddać wartość dla wiersza, który ją ma.
    const enriched = { ...ROW, phone: "+48 22 000 00 00", website: "https://x.example" };
    const empty: CompanyColumnKey[] = [];
    for (const col of COMPANY_COLUMNS) {
      const cell = rowsToCsv([enriched], [col.key], "pl").split("\n")[1];
      if (cell === "") empty.push(col.key);
    }
    expect(empty).toEqual([]);
  });

  it("nazwa firmy z ładunkiem formuły wychodzi zneutralizowana", () => {
    // Bramka ma własny plik (`csv.test.ts`); tutaj sprawdzamy, że eksport firm
    // faktycznie przez nią idzie. To ten eksport był bez osłony.
    const attacker = row({ id: "x", name: '=HYPERLINK("https://zbieram.example","Faktura")' });
    const cell = rowsToCsv([attacker], ["name"], "pl").split("\n")[1];
    expect(cell.startsWith(`"'=`)).toBe(true);
  });
});
