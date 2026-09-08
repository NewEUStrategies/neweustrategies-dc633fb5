// MAGAZYN SZABLONÓW SEKCJI - warstwa danych, której do dziś NIKT nie wykonał.
//
// `templates.ts` to dwa haki nad dwiema tabelami: `builder_templates`
// (scope = "section") i `builder_template_revisions` (historia snapshotowana
// wyzwalaczem w bazie). Moduł nie ma react-query, nie ma i18n, nie ma tenanta -
// stoi na gołych `useState`/`useEffect`/`useCallback`, więc testuje się go
// `renderHook` BEZ ŻADNEGO wrappera, z jedną atrapą klienta Supabase.
//
// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOZA: DLACZEGO 13 Z 13 FUNKCJI TEGO MODUŁU BYŁO NIEWYWOŁANYCH
// ─────────────────────────────────────────────────────────────────────────────
// Nazwa "templates" trafia w kilkadziesiąt plików testowych, ale to artefakt
// wyszukiwania - tamte pliki dotyczą zupełnie innych dziedzin (email-templates,
// workflow templates, badge templates, eventPageTemplates, starterTemplates,
// pageTemplates). Dokładny grep po ścieżce `@/lib/builder/templates` daje PIĘĆ
// plików testowych i ZERO takich, które ten moduł naprawdę wykonują - wszystkie
// pięć go PODMIENIAJĄ:
//
//   1. src/components/admin/builder/__tests__/builderShell.test.tsx:105
//      `vi.mock(..., importOriginal)` - moduł JEST ładowany, ale wyłącznie po
//      to, żeby rozlać `...actual` obok podmienionego `useSectionTemplates`.
//   2. src/components/admin/builder/ui/hooks/__tests__/useBuilderOperations.test.tsx:40
//      `vi.mock` z pełną fabryką BEZ `importOriginal` - moduł nie jest ładowany
//      w ogóle.
//   3. src/components/admin/builder/ui/organisms/__tests__/WidgetLibrary.test.tsx:39
//      `vi.mock(..., importOriginal)` - `useSectionTemplates` podmieniony,
//      `useTemplateRevisions` przechodzi z `...actual`, ale jest nieosiągalny,
//      bo `TemplateHistoryDialog` też jest atrapą.
//   4. src/components/admin/builder/ui/organisms/__tests__/builderDialogsAndPreview.test.tsx:31
//      `vi.mock` z pełną fabryką BEZ `importOriginal`; linia 17 importuje
//      z modułu WYŁĄCZNIE typ, a import typu jest wymazywany przy kompilacji,
//      więc nie ładuje ani jednej linii.
//   5. src/components/admin/versions/__tests__/BuilderVersionsPane.test.tsx:51
//      `vi.mock` z pełną fabryką BEZ `importOriginal`.
//
// Stąd dokładnie 4,08% linii przy 0% gałęzi: dwa mocki z `importOriginal`
// ładują plik, więc V8 zalicza linie wykonywane PRZY IMPORCIE (importy 3-6 oraz
// przypisania stałych `toTemplate` w :44 i `toRevision` w :50) - i ani jednego
// ciała funkcji.
//
// TO JEST TA SAMA KLASA DEFEKTU CO PUNKT B3 POPRZEDNIEGO ZLECENIA
// (docs/PROMPT_CMS_BUILDER_BLOKI_WIDGETY.md, rozdz. B3 "Trzy funkcje są martwe,
// bo JEDYNY test, który dociera do ich wywołania, podmienia je na atrapę" -
// tam `clearAllLiveWidgetTypography`, `BrandIcon` i `useBrandLogoUrl`, tu cały
// magazyn szablonów). Skutek jest tu jednak cięższy niż w B3, bo podmiany
// ROZJECHAŁY SIĘ Z PRODUKCJĄ: `save` ma dziś TRZY różne kontrakty zwrotne,
// z których żaden nie jest prawdziwy -
//   * produkcja (templates.ts:84-99)          -> `Promise<void>`,
//   * builderShell.test.tsx:112               -> `Promise<string>` ("t-nowy"),
//   * useBuilderOperations.test.tsx:24        -> `Promise<boolean>` (`true`).
// Fabryka `vi.mock` bez `importOriginal` nie jest typowana względem modułu,
// więc TypeScript tego nie łapie, a testy „dowodzą" kontraktu, którego nie ma.
// Dlatego dzisiejszy kontrakt `save` jest tu PRZYPIĘTY jawnym przypadkiem.
//
// ─────────────────────────────────────────────────────────────────────────────
// CO TU JEST NAPRAWDĘ DO OBRONY
// ─────────────────────────────────────────────────────────────────────────────
// 1. BRAMKA JAKOŚCI MIĘDZY JSON-em Z BAZY A DRZEWEM DOKUMENTU. `toTemplate`
//    (:44-48) i `toRevision` (:50-62) są JEDYNYM miejscem, które odrzuca
//    wiersze, w których kolumna `data` nie jest obiektem o `kind === "section"`.
//    Przepuszczony śmieć nie zatrzymuje się na tym haku - ląduje w kanwie
//    buildera jako węzeł sekcji i wywraca render całej strony.
// 2. ZAPIS JEST KOPIĄ, NIE REFERENCJĄ. `save` i `update` przepuszczają sekcję
//    przez PRAWDZIWY `cloneSection`, który nadaje świeże identyfikatory. Bez
//    tego szablon wstawiony dwa razy na jedną stronę dałby dwa węzły o tym
//    samym `id`, a operacje buildera (zaznaczenie, usunięcie, undo) trafiałyby
//    w oba naraz.
// 3. PUSTY PATCH NIE JEST ZAPISEM (:106). Nadpisanie niczym też jest zapisem -
//    kliknięcie „zapisz" bez zmian nie może ruszyć wiersza ani migać listą.
// 4. LENIWA HISTORIA. `useTemplateRevisions(null)` NIE MOŻE pytać bazy - dialog
//    historii jest zamontowany zawsze i przekazuje `null`, dopóki jest zamknięty
//    (TemplateHistoryDialog.tsx:44). Zapytanie „na zapas" to jedno zbędne
//    okrążenie do bazy przy każdym otwarciu buildera.
//
// ─────────────────────────────────────────────────────────────────────────────
// GRANICA DOWODU
// ─────────────────────────────────────────────────────────────────────────────
// * `.update(patch as never)` (:109) to dziura w TYPOWANIU, nie w zachowaniu -
//   z tego poziomu widać tylko ładunek, który naprawdę poszedł do bazy (i to
//   jest tu sprawdzone). Że rzutowanie na `never` wyłącza kontrolę zgodności
//   ze schematem tabeli i przykrywa brak konwersji `SectionNode` -> `Json`
//   (siostrzany `globalWidgets.ts` robi to przez `toJson`), żaden test runtime
//   nie pokaże. To zadanie dla przeglądu typów, nie dla vitest.
// * Izolacja najemców opiera się tu WYŁĄCZNIE na RLS. Atrapa klienta nie zna
//   polityk bazy, więc test może dowieść tylko tego, czego kwerenda NIE mówi
//   (brak jawnego `eq("tenant_id", ...)`) - nie tego, czy polityka działa.
// * PUŁAPKA POMIARU (zdiagnozowana tutaj, warta zapamiętania). Pokrycie tego
//   pliku potrafi wyjść 4,08% linii i 0% gałęzi MIMO zielonych testów - i nie
//   jest to wina testu. `coverage.reportsDirectory` jest w tym repo wspólny
//   (`coverage/`), więc DRUGI, równoległy przebieg vitest w tym samym katalogu
//   roboczym kasuje `coverage/.tmp` w trakcie zbierania. Objawy są dwa: cicho
//   zgubione pokrycie jednego workera (raport pokazuje wtedy tylko linie
//   wykonane przy imporcie) albo jawne `ENOENT ... coverage/.tmp/coverage-0.json`.
//   Mierząc ten plik, kieruj raport w miejsce prywatne dla przebiegu:
//     ./node_modules/.bin/vitest run --coverage \
//       --coverage.include='src/lib/builder/templates.ts' \
//       --coverage.reporter=text --coverage.reportsDirectory=/tmp/cov-templates \
//       src/lib/builder/__tests__/templates.test.ts
//   Tak zmierzone: 100% linii, 100% gałęzi, 100% funkcji (49/49, 26/26, 13/13),
//   powtarzalnie w dwóch kolejnych przebiegach. To ten sam rodzaj cichej utraty
//   danych pomiarowych, przed którym ostrzega komentarz w vitest.config.ts przy
//   rachunku „ZEBRANE = ZARAPORTOWANE".
// * `builder_template_revisions` wypełnia WYZWALACZ w bazie. Tu widać wyłącznie
//   odczyt historii; że snapshot w ogóle powstaje, dowodzi migracja i jej test
//   SQL, nie ten plik.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Sesja oddawana przez `supabase.auth.getSession()` - źródło `created_by`. */
  session: null as { user: { id: string } } | null,
  /**
   * Podmiana CAŁEGO `from` na czas jednego przypadku. Potrzebna wyłącznie tam,
   * gdzie trzeba zatrzymać odpowiedź w locie: wspólna atrapa rozwiązuje łańcuch
   * przez `Promise.resolve`, więc okno wyścigu to jeden mikrotask i nie da się
   * w nim przełączyć propsa.
   */
  fromOverride: null as ((table: string) => unknown) | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (h.fromOverride) return h.fromOverride(table);
      if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
      return h.db.from(table);
    },
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: null }),
    },
  },
}));

import { fail, ok, supabaseFromStub } from "@/test/supabase";
import type { SectionNode } from "@/lib/builder/types";
import { useSectionTemplates, useTemplateRevisions } from "@/lib/builder/templates";

const TPL = "builder_templates";
const REV = "builder_template_revisions";
const AUTOR = "user-9";
const KIEDY = "2026-08-22T10:00:00.000Z";

function db(): SupabaseFromStub {
  const stub = h.db;
  if (stub === null) throw new Error("test: atrapa bazy nie została zainicjalizowana");
  return stub;
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.session = { user: { id: AUTOR } };
  h.fromOverride = null;
});

afterEach(() => {
  h.db?.reset();
  h.fromOverride = null;
  vi.restoreAllMocks();
});

/**
 * Minimalna, ale NIEPŁASKA sekcja: kolumna z widgetem. Głębokość ma znaczenie,
 * bo `cloneSection` nadaje świeże `id` na każdym piętrze - płaska sekcja nie
 * odróżniłaby klonowania od zwykłego `JSON.parse(JSON.stringify(...))`.
 */
function sec(id = "sec-zrodlowa"): SectionNode {
  return {
    id,
    kind: "section",
    children: [
      {
        id: "kol-zrodlowa",
        kind: "column",
        span: { desktop: 12 },
        children: [
          {
            id: "widget-zrodlowy",
            kind: "widget",
            type: "text",
            content: { text_pl: "Zaproszenie na debatę", text_en: "Debate invitation" },
          },
        ],
      },
    ],
  };
}

/** Wiersz w kształcie, jaki oddaje PostgREST dla kolumn z `reload` (:72). */
function tplRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    name: "Sekcja powitalna",
    data: sec("sec-z-bazy"),
    created_at: KIEDY,
    created_by: AUTOR,
    ...over,
  };
}

/** Wiersz historii w kształcie z `useTemplateRevisions.reload` (:140). */
function revRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "r1",
    template_id: "t1",
    name: "Sekcja powitalna",
    data: sec("sec-rewizja"),
    note: null,
    created_at: KIEDY,
    created_by: AUTOR,
    ...over,
  };
}

/**
 * Jedna odpowiedź dla tabeli szablonów rozdzielana po OGNIWIE łańcucha: lista,
 * insert, update i delete idą tą samą tabelą, a rozróżnia je tylko to, co kod
 * produkcyjny naprawdę wywołał.
 */
function respondTemplates(parts: { list?: SupabaseResult; write?: SupabaseResult }): void {
  db().setResponse(TPL, (chain: RecordedChain) => {
    if (chain.has("insert") || chain.has("update") || chain.has("delete")) {
      return parts.write ?? ok(null);
    }
    return parts.list ?? ok([]);
  });
}

/** Ładunek zapisu wyjęty z łańcucha - bez rzutowań na `any`. */
function payloadOf(chain: RecordedChain, link: "insert" | "update"): Record<string, unknown> {
  const row = chain.argsOf(link)?.[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`test: łańcuch nie niesie ładunku ${link.toUpperCase()}`);
  }
  return row as Record<string, unknown>;
}

/** Sekcja wyjęta z ładunku zapisu. */
function sectionOf(payload: Record<string, unknown>): SectionNode {
  return payload.data as SectionNode;
}

/** Czy łańcuch zawężał po danej kolumnie (`eq` może wystąpić wiele razy). */
function filtersOn(chain: RecordedChain, column: string): boolean {
  return chain.calls.some((c) => c.method === "eq" && c.args[0] === column);
}

/** Montaż listy szablonów z odczekaniem na pierwszą odpowiedź. */
async function mountTemplates() {
  const view = renderHook(() => useSectionTemplates());
  await waitFor(() => {
    expect(db().chainsFor(TPL).length).toBeGreaterThan(0);
    expect(view.result.current.loading).toBe(false);
  });
  return view;
}

/** Domknięcie kolejki mikrotasków tam, gdzie z założenia NIC nie ma przyjechać. */
async function przemiel(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSectionTemplates - biblioteka zapisanych sekcji", () => {
  it("przy montowaniu pyta o szablony sekcji, najnowsze najpierw, najwyżej sto", async () => {
    respondTemplates({ list: ok([tplRow()]) });

    await mountTemplates();

    const chain = db().lastChain(TPL);
    expect(chain).toBeDefined();
    // `scope = "section"` odsiewa szablony INNYCH zakresów (np. całych stron) -
    // bez tego ogniwa biblioteka sekcji pokazałaby cudze byty jako sekcje.
    expect(chain?.argsOf("eq")).toEqual(["scope", "section"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([100]);
    // Kolumna autora jest częścią kontraktu typu `SectionTemplate`; gdyby
    // wypadła z listy `select`, `created_by` byłoby wszędzie `undefined`.
    expect(String(chain?.argsOf("select")?.[0])).toContain("created_by");
  });

  it("dopóki odpowiedź nie wróci, `loading` jest podniesione, a po niej opada", async () => {
    respondTemplates({ list: ok([tplRow()]) });

    const view = renderHook(() => useSectionTemplates());

    expect(view.result.current.loading).toBe(true);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
  });

  it("poprawny wiersz staje się szablonem z kompletem pięciu pól", async () => {
    respondTemplates({ list: ok([tplRow()]) });

    const view = await mountTemplates();

    expect(view.result.current.items).toHaveLength(1);
    const t = view.result.current.items[0];
    expect(t.id).toBe("t1");
    expect(t.name).toBe("Sekcja powitalna");
    expect(t.created_at).toBe(KIEDY);
    expect(t.created_by).toBe(AUTOR);
    expect(t.data.kind).toBe("section");
    expect(t.data.children).toHaveLength(1);
  });

  it("wiersz bez autora zachowuje `created_by` jako null, a nie pusty napis", async () => {
    respondTemplates({ list: ok([tplRow({ id: "t-anon", created_by: null })]) });

    const view = await mountTemplates();

    expect(view.result.current.items[0].created_by).toBeNull();
  });

  it("wiersze z uszkodzoną kolumną `data` w ogóle nie trafiają do biblioteki", async () => {
    // Cztery kształty, które w bazie są legalnym JSON-em, a sekcją nie są.
    // Każdy przepuszczony tutaj wywraca render kanwy przy wstawieniu szablonu.
    respondTemplates({
      list: ok([
        tplRow(),
        tplRow({ id: "t-null", data: null }),
        tplRow({ id: "t-napis", data: "sekcja" }),
        tplRow({ id: "t-tablica", data: [] }),
        tplRow({ id: "t-widget", data: { kind: "widget", id: "w", type: "text", content: {} } }),
      ]),
    });

    const view = await mountTemplates();

    expect(view.result.current.items.map((t) => t.id)).toEqual(["t1"]);
  });

  it("odmowa odczytu nie wywraca haka - lista zostaje pusta, ładowanie opada", async () => {
    respondTemplates({ list: fail("permission denied for table builder_templates", "42501") });

    const view = await mountTemplates();

    expect(view.result.current.items).toEqual([]);
    expect(view.result.current.loading).toBe(false);
  });
});

describe("useSectionTemplates.save - zapis sekcji jako szablonu", () => {
  it("zapisuje świeżą KOPIĘ sekcji, a dokument źródłowy zostaje nietknięty", async () => {
    respondTemplates({ list: ok([]) });
    const view = await mountTemplates();
    const zrodlo = sec();

    await act(async () => {
      await view.result.current.save("Sekcja powitalna", zrodlo);
    });

    const zapis = db()
      .chainsFor(TPL)
      .find((c) => c.has("insert"));
    expect(zapis).toBeDefined();
    const payload = payloadOf(zapis as RecordedChain, "insert");
    expect(payload.name).toBe("Sekcja powitalna");
    expect(payload.scope).toBe("section");
    expect(payload.created_by).toBe(AUTOR);

    const zapisana = sectionOf(payload);
    expect(zapisana.kind).toBe("section");
    // Świeże identyfikatory na KAŻDYM piętrze - inaczej dwa wstawienia tego
    // samego szablonu dałyby na stronie dwa węzły o tym samym `id`.
    expect(zapisana.id).not.toBe(zrodlo.id);
    expect(zapisana.children[0].id).not.toBe(zrodlo.children[0].id);
    // Dokument redaktora nie może zostać dotknięty przez zapis do biblioteki.
    expect(zrodlo.id).toBe("sec-zrodlowa");
    expect(zrodlo.children[0].id).toBe("kol-zrodlowa");
  });

  it("po zapisie lista jest przeładowana, żeby nowy szablon był od razu widoczny", async () => {
    respondTemplates({ list: ok([]) });
    const view = await mountTemplates();
    expect(db().chainsFor(TPL)).toHaveLength(1);

    await act(async () => {
      await view.result.current.save("Sekcja powitalna", sec());
    });

    const lancuchy = db().chainsFor(TPL);
    expect(lancuchy).toHaveLength(3);
    expect(lancuchy[1].has("insert")).toBe(true);
    expect(lancuchy[2].has("select")).toBe(true);
    expect(lancuchy[2].argsOf("eq")).toEqual(["scope", "section"]);
  });

  it("bez sesji szablon zapisuje się bez autora zamiast wywracać zapis", async () => {
    h.session = null;
    respondTemplates({ list: ok([]) });
    const view = await mountTemplates();

    await act(async () => {
      await view.result.current.save("Sekcja anonimowa", sec());
    });

    const zapis = db()
      .chainsFor(TPL)
      .find((c) => c.has("insert"));
    expect(payloadOf(zapis as RecordedChain, "insert").created_by).toBeNull();
  });

  it("KONTRAKT DZISIEJSZY: `save` rozwiązuje się do `undefined`, cokolwiek zrobi baza", async () => {
    // Ten przypadek istnieje po to, żeby prawdziwy kontrakt był ZAPISANY choć
    // raz. Trzy atrapy w repo udają trzy RÓŻNE i wzajemnie sprzeczne kontrakty:
    //   builderShell.test.tsx:112        -> Promise<string> ("t-nowy"),
    //   useBuilderOperations.test.tsx:24 -> Promise<boolean> (true),
    //   WidgetLibrary.test.tsx:44        -> vi.fn() (undefined).
    // Produkcja (templates.ts:84-99) nie zwraca NICZEGO. Dopóki tak jest, ten
    // test ma być czerwony w chwili, w której ktoś kontrakt zmieni - i wtedy
    // trzeba poprawić także trzy atrapy wyżej, bo dziś nie pilnuje ich typ.
    respondTemplates({ list: ok([]) });
    const view = await mountTemplates();
    const zapisz: (n: string, s: SectionNode) => Promise<unknown> = view.result.current.save;

    let wynik: unknown = "wartość, której nikt nie nadpisał";
    await act(async () => {
      wynik = await zapisz("Sekcja powitalna", sec());
    });

    expect(wynik).toBeUndefined();
  });
});

describe("useSectionTemplates.update - zmiana nazwy i treści szablonu", () => {
  it("sama nazwa idzie do bazy jako patch jednopolowy, celowany w jedno id", async () => {
    respondTemplates({ list: ok([tplRow()]) });
    const view = await mountTemplates();

    await act(async () => {
      await view.result.current.update("t1", { name: "Sekcja powitalna (2026)" });
    });

    const zmiana = db()
      .chainsFor(TPL)
      .find((c) => c.has("update"));
    expect(zmiana).toBeDefined();
    expect(payloadOf(zmiana as RecordedChain, "update")).toEqual({
      name: "Sekcja powitalna (2026)",
    });
    expect(zmiana?.argsOf("eq")).toEqual(["id", "t1"]);
  });

  it("sama sekcja idzie jako sklonowana treść, bez tykania nazwy", async () => {
    respondTemplates({ list: ok([tplRow()]) });
    const view = await mountTemplates();
    const zrodlo = sec();

    await act(async () => {
      await view.result.current.update("t1", { section: zrodlo });
    });

    const zmiana = db()
      .chainsFor(TPL)
      .find((c) => c.has("update"));
    const patch = payloadOf(zmiana as RecordedChain, "update");
    expect(Object.keys(patch)).toEqual(["data"]);
    expect(sectionOf(patch).id).not.toBe(zrodlo.id);
    // Ładunek przeszedł przez JSON, więc jest zwykłym drzewem danych - żadnych
    // `undefined` ani klas, których PostgREST nie umiałby zserializować.
    expect(JSON.parse(JSON.stringify(patch))).toEqual(patch);
  });

  it("nazwa i sekcja naraz dają patch dwupolowy w jednym zapytaniu", async () => {
    respondTemplates({ list: ok([tplRow()]) });
    const view = await mountTemplates();

    await act(async () => {
      await view.result.current.update("t1", { name: "Nowa nazwa", section: sec() });
    });

    const zmiany = db()
      .chainsFor(TPL)
      .filter((c) => c.has("update"));
    expect(zmiany).toHaveLength(1);
    expect(Object.keys(payloadOf(zmiany[0], "update")).sort()).toEqual(["data", "name"]);
  });

  it("PUSTY PATCH NIE JEST ZAPISEM - nie leci UPDATE ani przeładowanie listy", async () => {
    respondTemplates({ list: ok([tplRow()]) });
    const view = await mountTemplates();

    await act(async () => {
      await view.result.current.update("t1", {});
    });

    // Nadpisanie niczym też jest zapisem: ruszyłoby `updated_at`, odpaliło
    // wyzwalacz rewizji i mignęło listą, choć redaktor niczego nie zmienił.
    expect(db().chainsFor(TPL)).toHaveLength(1);
    expect(
      db()
        .chainsFor(TPL)
        .some((c) => c.has("update")),
    ).toBe(false);
  });

  it("PUSTA NAZWA JEST wysyłana - `!== undefined` przepuszcza pusty napis", async () => {
    // Przypadek brzegowy przypięty świadomie: dziś da się pozbawić szablon
    // nazwy i biblioteka pokaże pusty wiersz. Gdyby ktoś to kiedyś uznał za
    // defekt, ten test jest miejscem, w którym decyzja się zmienia jawnie.
    respondTemplates({ list: ok([tplRow()]) });
    const view = await mountTemplates();

    await act(async () => {
      await view.result.current.update("t1", { name: "" });
    });

    const zmiana = db()
      .chainsFor(TPL)
      .find((c) => c.has("update"));
    expect(payloadOf(zmiana as RecordedChain, "update")).toEqual({ name: "" });
  });
});

describe("useSectionTemplates.remove i ręczne przeładowanie", () => {
  it("usunięcie celuje w jeden wiersz po id i przeładowuje bibliotekę", async () => {
    respondTemplates({ list: ok([tplRow()]) });
    const view = await mountTemplates();

    await act(async () => {
      await view.result.current.remove("t1");
    });

    const lancuchy = db().chainsFor(TPL);
    expect(lancuchy).toHaveLength(3);
    expect(lancuchy[1].has("delete")).toBe(true);
    expect(lancuchy[1].argsOf("eq")).toEqual(["id", "t1"]);
    expect(lancuchy[2].has("select")).toBe(true);
  });

  it("ręczny `reload` strzela drugim zapytaniem o dokładnie tym samym kształcie", async () => {
    respondTemplates({ list: ok([tplRow()]) });
    const view = await mountTemplates();

    await act(async () => {
      await view.result.current.reload();
    });

    const lancuchy = db().chainsFor(TPL);
    expect(lancuchy).toHaveLength(2);
    expect(lancuchy[1].argsOf("eq")).toEqual(["scope", "section"]);
    expect(lancuchy[1].argsOf("limit")).toEqual([100]);
    expect(view.result.current.items).toHaveLength(1);
  });
});

describe("useTemplateRevisions - historia jednego szablonu", () => {
  it("bez wybranego szablonu NIE PYTA BAZY i zostawia listę pustą", async () => {
    db().setResponse(REV, () => ok([revRow()]));

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: null },
    });
    await przemiel();

    // Dialog historii jest zamontowany zawsze i podaje `null`, dopóki jest
    // zamknięty - zapytanie „na zapas" to zbędne okrążenie do bazy przy KAŻDYM
    // otwarciu buildera.
    expect(db().chainsFor(REV)).toHaveLength(0);
    expect(view.result.current.items).toEqual([]);
    expect(view.result.current.loading).toBe(false);
  });

  it("dla wybranego szablonu pyta o jego rewizje, najnowsze najpierw, najwyżej pięćdziesiąt", async () => {
    db().setResponse(REV, () => ok([revRow()]));

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await waitFor(() => expect(view.result.current.items).toHaveLength(1));

    const chain = db().lastChain(REV);
    expect(chain?.argsOf("eq")).toEqual(["template_id", "t1"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([50]);
    expect(String(chain?.argsOf("select")?.[0])).toContain("note");
  });

  it("rewizja dojeżdża z notatką albo bez niej, a brak notatki zostaje null-em", async () => {
    db().setResponse(REV, () =>
      ok([revRow({ id: "r2", note: "korekta nagłówka" }), revRow({ id: "r1", note: null })]),
    );

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await waitFor(() => expect(view.result.current.items).toHaveLength(2));

    const [nowsza, starsza] = view.result.current.items;
    expect(nowsza.note).toBe("korekta nagłówka");
    // `null` przechodzi wprost - zamiana na pusty napis zabrałaby widokowi
    // możliwość odróżnienia „bez opisu" od „opis skasowany".
    expect(starsza.note).toBeNull();
    expect(starsza.template_id).toBe("t1");
    expect(starsza.data.kind).toBe("section");
  });

  it("rewizje z uszkodzoną kolumną `data` są pomijane, reszta historii zostaje", async () => {
    db().setResponse(REV, () =>
      ok([
        revRow({ id: "r-dobra" }),
        revRow({ id: "r-null", data: null }),
        revRow({ id: "r-napis", data: "sekcja" }),
        revRow({ id: "r-tablica", data: [] }),
        revRow({ id: "r-widget", data: { kind: "widget", id: "w", type: "text", content: {} } }),
      ]),
    );

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await waitFor(() => expect(view.result.current.items).toHaveLength(1));

    expect(view.result.current.items[0].id).toBe("r-dobra");
  });

  it("odmowa odczytu historii daje pustą listę zamiast wyjątku", async () => {
    db().setResponse(REV, () =>
      fail("permission denied for table builder_template_revisions", "42501"),
    );

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    expect(view.result.current.items).toEqual([]);
  });

  it("przełączenie szablonu odpala nowe zapytanie o NOWE id", async () => {
    db().setResponse(REV, (chain) =>
      ok(
        chain.argsOf("eq")?.[1] === "t2"
          ? [revRow({ id: "r-drugi", template_id: "t2" })]
          : [revRow()],
      ),
    );

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await waitFor(() => expect(view.result.current.items[0]?.id).toBe("r1"));

    view.rerender({ id: "t2" });
    await waitFor(() => expect(view.result.current.items[0]?.id).toBe("r-drugi"));

    expect(db().chainsFor(REV)).toHaveLength(2);
    expect(db().lastChain(REV)?.argsOf("eq")).toEqual(["template_id", "t2"]);
  });

  it("powrót do braku szablonu czyści listę i NIE dokłada trzeciego zapytania", async () => {
    db().setResponse(REV, () => ok([revRow()]));

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await waitFor(() => expect(view.result.current.items).toHaveLength(1));

    view.rerender({ id: null });
    await przemiel();

    expect(view.result.current.items).toEqual([]);
    expect(db().chainsFor(REV)).toHaveLength(1);
  });
});

describe("templates.ts - świadkowie defektów (it.fails)", () => {
  // DEFEKT: ODMOWA ODCZYTU UDAJE PUSTĄ BIBLIOTEKĘ.
  //
  // WEJSCIE: redaktor otwiera bibliotekę widgetów, a odczyt `builder_templates`
  //   kończy się odmową RLS (42501), wygasłą sesją albo awarią sieci.
  // CO PSUJE: `useSectionTemplates.reload` (src/lib/builder/templates.ts:68-78)
  //   destrukturyzuje WYŁĄCZNIE `{ data }` i nigdy nie ogląda `error`. Nieudany
  //   odczyt daje `undefined`, `(data ?? [])` robi z tego pustą listę, hak
  //   oddaje `items: []` i `loading: false` - czyli DOKŁADNIE ten sam stan,
  //   co u nowego najemcy, który naprawdę nic jeszcze nie zapisał.
  // KONSEKWENCJA: panel mówi „brak zapisanych szablonów". Redaktor nie
  //   dowiaduje się, że NIE WIDZI biblioteki - dowiaduje się, że biblioteka
  //   jest pusta, więc zapisuje sekcje po raz drugi albo uznaje, że ktoś
  //   skasował dorobek zespołu. To ta sama klasa co „awaria odczytu udaje
  //   pustkę" zarejestrowana już w repo jako
  //   src/components/admin/community/__tests__/VerificationDomainsCard.test.tsx:863
  //   („BŁĄD ODCZYTU KATALOGU UDAJE PUSTY KATALOG").
  // WYMAGANA POPRAWKA: hak MUSI czytać `error` i wystawiać stan błędu
  //   (np. `error: string | null`), żeby biblioteka mogła pokazać komunikat
  //   zamiast pustki. Zero wierszy i „nie wolno mi czytać" to dwa różne stany.
  it.fails("DEFEKT: odmowa odczytu NIE MOŻE wyglądać jak pusta biblioteka", async () => {
    respondTemplates({ list: fail("permission denied for table builder_templates", "42501") });

    const view = await mountTemplates();

    const api: Record<string, unknown> = { ...view.result.current };
    expect(api.error).toBeTruthy();
  });

  it("KONTROLA DODATNIA defektu wyżej: ta sama ścieżka POKAZUJE szablony, gdy je dostanie", async () => {
    // Bez tego przypadku „naprawa" defektu mogłaby polegać na zwracaniu stanu
    // błędu ZAWSZE. Ta sama funkcja `reload`, ten sam hak, poprawna odpowiedź -
    // i lista musi być pełna, a nie pusta.
    respondTemplates({ list: ok([tplRow(), tplRow({ id: "t2", name: "Stopka wydarzeń" })]) });

    const view = await mountTemplates();

    expect(view.result.current.items.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  // DEFEKT: NIEUDANY ZAPIS SZABLONU JEST NIEODRÓŻNIALNY OD UDANEGO.
  //
  // WEJSCIE: redaktor nazywa sekcję i klika „zapisz jako szablon", a INSERT do
  //   `builder_templates` kończy się odmową (RLS, brak grantu, konflikt).
  // CO PSUJE: `save` (src/lib/builder/templates.ts:84-99) nie czyta wyniku
  //   `insert` - ani `data`, ani `error` - i deklaruje `Promise<void>`.
  //   Wołający `useBuilderOperations.saveSectionAsTemplate` robi
  //   `void templates.save(name.trim(), s)` (useBuilderOperations.ts:113), więc
  //   nie ma Z CZEGO zbudować toastu porażki. Po nieudanym zapisie leci jeszcze
  //   `reload()`, który (patrz defekt wyżej) też milczy.
  // KONSEKWENCJA: praca redaktora - nazwanie i zapisanie sekcji - znika bez
  //   żadnego śladu na ekranie; interfejs zachowuje się identycznie jak przy
  //   sukcesie. Dowodem pośrednim, że tego kontraktu NIKT nie sprawdzał, są trzy
  //   wzajemnie sprzeczne atrapy w repo (Promise<string>, Promise<boolean>,
  //   vi.fn()) opisane w nagłówku tego pliku.
  // WYMAGANA POPRAWKA: `save` MUSI zwracać id nowego szablonu albo `null` przy
  //   błędzie - dokładnie jak siostrzane `useGlobalWidgets.save`
  //   (src/lib/builder/globalWidgets.ts: insert z `.select("id").single()`
  //   i `if (error) return null`).
  it.fails("DEFEKT: nieudany zapis szablonu MUSI być odróżnialny od udanego", async () => {
    respondTemplates({
      list: ok([]),
      write: fail("new row violates row-level security policy", "42501"),
    });
    const view = await mountTemplates();
    const zapisz: (n: string, s: SectionNode) => Promise<unknown> = view.result.current.save;

    let wynik: unknown = "wartość, której nikt nie nadpisał";
    await act(async () => {
      wynik = await zapisz("Sekcja powitalna", sec());
    });

    expect(wynik).toBeNull();
  });

  // DEFEKT: PÓŹNA ODPOWIEDŹ WRACA PO WYCZYSZCZENIU LISTY REWIZJI.
  //
  // WEJSCIE: redaktor otwiera historię szablonu „t1", a potem zamyka dialog,
  //   zanim odpowiedź bazy zdąży wrócić (wolne łącze, duża historia).
  // CO PSUJE: `useTemplateRevisions.reload`
  //   (src/lib/builder/templates.ts:132-148) przy `templateId === null` robi
  //   `setItems([])` i WYCHODZI, ale nie anuluje ani nie znakuje zapytania
  //   będącego w locie. `TemplateHistoryDialog` przekazuje
  //   `open ? (template?.id ?? null) : null` (TemplateHistoryDialog.tsx:44),
  //   więc zamknięcie dialogu to właśnie przejście na `null`. Spóźniona
  //   odpowiedź wykonuje `setItems(...)` już PO wyczyszczeniu.
  // KONSEKWENCJA: po otwarciu historii INNEGO szablonu redaktor widzi przez
  //   moment rewizje poprzedniego i może kliknąć „przywróć" na cudzej wersji -
  //   czyli nadpisać szablon treścią, której nigdy nie oglądał.
  // WYMAGANA POPRAWKA: wynik zapytania MUSI zostać odrzucony, jeśli
  //   `templateId` zmienił się w międzyczasie - znacznik pokolenia zapytania
  //   albo `AbortController` w zależności efektu.
  it.fails("DEFEKT: późna odpowiedź NIE MOŻE przywrócić rewizji zamkniętego szablonu", async () => {
    // Wspólna atrapa rozwiązuje łańcuch przez `Promise.resolve`, więc okno
    // wyścigu to jeden mikrotask. Tylko na TEN przypadek podmieniamy `from`
    // na łańcuch trzymany na uwięzi, którą zwalnia sam test.
    let zwolnij: (result: SupabaseResult) => void = () => undefined;
    const brama = new Promise<SupabaseResult>((resolve) => {
      zwolnij = resolve;
    });
    const zapytano: string[] = [];
    const builder: Record<string, unknown> = {};
    for (const ogniwo of ["select", "eq", "order", "limit"]) {
      builder[ogniwo] = (...args: unknown[]) => {
        if (ogniwo === "eq" && typeof args[1] === "string") zapytano.push(args[1]);
        return builder;
      };
    }
    builder.then = (
      onFulfilled?: (value: SupabaseResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => brama.then(onFulfilled, onRejected);
    h.fromOverride = () => builder;

    const view = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await przemiel();
    expect(zapytano).toEqual(["t1"]);

    // Dialog się zamyka - hak dostaje `null` i czyści listę.
    view.rerender({ id: null });
    await przemiel();
    expect(view.result.current.items).toEqual([]);

    // DOPIERO TERAZ wraca odpowiedź dla zamkniętego już szablonu.
    await act(async () => {
      zwolnij(ok([revRow({ id: "r-spozniona" })]));
      await przemiel();
    });

    expect(view.result.current.items).toEqual([]);
  });

  // DEFEKT: KWERENDY NIE ZAWĘŻAJĄ PO `tenant_id`.
  //
  // WEJSCIE: dowolny odczyt biblioteki szablonów lub historii rewizji.
  // CO PSUJE: obie kwerendy (src/lib/builder/templates.ts:70-75 i :138-143)
  //   filtrują wyłącznie po `scope` i po `template_id`. Obie tabele mają
  //   kolumnę `tenant_id NOT NULL` (src/integrations/supabase/types.ts), a
  //   izolacja obszarów roboczych opiera się TYLKO na polityce RLS
  //   (`tenant_id = current_tenant_id()`). Siostrzany `useGlobalWidgets`
  //   w src/lib/builder/globalWidgets.ts filtruje jawnie
  //   (`.eq("tenant_id", tenantId ?? "")`) - ten moduł odstaje od reguły repo.
  // KONSEKWENCJA: jedna pomyłka w polityce RLS albo jeden odczyt rolą serwisową
  //   pokazuje redakcji szablony CUDZEGO najemcy - bez żadnej drugiej bariery.
  //   Klasa: obrona w głąb, nie potwierdzony wyciek; ten test nie dowodzi
  //   wycieku, dowodzi BRAKU DRUGIEJ BARIERY.
  // WYMAGANA POPRAWKA: obie kwerendy MUSZĄ same zawężać po `tenant_id`,
  //   tak jak `globalWidgets.ts`, zamiast polegać wyłącznie na RLS.
  it.fails("DEFEKT: obie kwerendy MUSZĄ jawnie zawężać po tenant_id", async () => {
    respondTemplates({ list: ok([tplRow()]) });
    db().setResponse(REV, () => ok([revRow()]));

    await mountTemplates();
    const historia = renderHook(({ id }: { id: string | null }) => useTemplateRevisions(id), {
      initialProps: { id: "t1" as string | null },
    });
    await waitFor(() => expect(historia.result.current.items).toHaveLength(1));

    const listaSzablonow = db().lastChain(TPL);
    const listaRewizji = db().lastChain(REV);
    expect(filtersOn(listaSzablonow as RecordedChain, "tenant_id")).toBe(true);
    expect(filtersOn(listaRewizji as RecordedChain, "tenant_id")).toBe(true);
  });

  // DEFEKT: CICHE OBCIĘCIE BIBLIOTEKI NA SETNYM SZABLONIE.
  //
  // WEJSCIE: najemca ma w bibliotece więcej niż sto szablonów sekcji (albo
  //   szablon ma więcej niż pięćdziesiąt rewizji).
  // CO PSUJE: `limit(100)` dla szablonów (src/lib/builder/templates.ts:75)
  //   i `limit(50)` dla rewizji (:143) stoją bez stronicowania i bez żadnego
  //   sygnału w interfejsie. Hak oddaje `items` i `loading` - nic więcej, więc
  //   widok nie ma jak odróżnić „to wszystko" od „to pierwsza setka".
  // KONSEKWENCJA: sto pierwszy szablon przestaje istnieć dla redakcji, a
  //   pięćdziesiąta pierwsza rewizja dla historii - mimo że wyzwalacz w bazie
  //   dalej je tworzy. Szablon, którego „nie ma", zostaje zapisany po raz drugi
  //   pod tą samą nazwą i biblioteka rośnie duplikatami.
  // WYMAGANA POPRAWKA: albo stronicowanie (`.range(...)` z kursorem), albo
  //   jawny sygnał obcięcia w wartości zwracanej („pokazano 100 z N"). Ten test
  //   przyjmuje KAŻDĄ z dwóch poprawek - blokuje tylko dzisiejsze milczenie.
  it.fails("DEFEKT: obcięcie biblioteki na setnym szablonie NIE MOŻE być ciche", async () => {
    const pelnaSetka = Array.from({ length: 100 }, (_, i) =>
      tplRow({ id: `t-${i}`, name: `Sekcja ${i}` }),
    );
    respondTemplates({ list: ok(pelnaSetka) });

    const view = await mountTemplates();

    expect(view.result.current.items).toHaveLength(100);
    const api: Record<string, unknown> = { ...view.result.current };
    const stronicuje = db().lastChain(TPL)?.has("range") === true;
    const sygnalizuje = Object.keys(api).some((k) => /more|total|count|truncat/i.test(k));
    expect(stronicuje || sygnalizuje).toBe(true);
  });
});
