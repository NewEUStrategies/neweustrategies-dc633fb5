// WIDGETY GLOBALNE BUILDERA - reguly czyste ORAZ warstwa danych.
//
// Widget globalny to JEDEN wiersz `builder_global_widgets` wskazywany przez
// wiele stron. Wezel instancji niesie pelna migawke lokalna (fallback SSR /
// offline) plus `globalId`, a renderer naklada na nia zywy rekord z zapytania,
// zeby edycja globala propagowala sie na kazda strone naraz.
//
// CO TU JEST NAPRAWDE DO OBRONY
//
// 1. BARIERY ODMOWY W `resolveGlobalWidgetInstance`. Nakladka wolno nadpisac
//    instancje TYLKO wtedy, gdy instancja naprawde wskazuje globala i payload
//    juz przyjechal. Zdjecie warunku `!instance.globalId` zamienia zwykly,
//    lokalny widget w cudza tresc; zdjecie `!data` kasuje migawke SSR na czas
//    ladowania, wiec strona mruga pustka przy kazdym wejsciu.
// 2. IZOLACJA OBSZARU ROBOCZEGO W PALECIE. Lista pyta o `tenant_id` i wylacza
//    sie w calosci, dopoki tenant nie jest znany. Gdyby pytala bez filtru albo
//    przed poznaniem tenanta, redaktor zobaczylby w palecie widgety cudzej
//    redakcji - i wstawilby je na swoja strone jednym kliknieciem.
// 3. ZASIEG UNIEWAZNIENIA PO MUTACJI. Jedna zmiana globala musi odswiezyc TRZY
//    korzenie cache (lista palety, nakladki renderu, baner panelu) i rozeslac
//    sygnal miedzy kartami. Kazda z tych czterech linii daje sie skasowac bez
//    zadnego natychmiast widocznego skutku, a skutkiem jest redaktor patrzacy
//    po zapisie na stan sprzed wlasnej zmiany.
// 4. ODMOWA NIE UDAJE SUKCESU. Nieudany `save` zwraca `null`, nieudane
//    `rename`/`remove` zwracaja `false` i NIE uniewazniaja cache; nieudany
//    `pushGlobalWidgetData` zwraca `false` i NIE rozsyla sygnalu miedzy
//    kartami; blad odczytu globala jest bledem zapytania, a nie sukcesem `null`.
// 5. TENANT Z SESJI W KAZDYM ZAPISIE (od 2026-10-18). Insert niesie
//    `tenant_id`, update/delete domykaja `.eq("tenant_id")` obok `.eq("id")`,
//    a przy nieznanym tenancie zaden zapis nie leci do bazy.
//
// GRANICA DOWODU.
// (a) TRZY straze sa nieosiagalne z zewnatrz i zostaja poza pomiarem:
//     `if (!globalId) return null` wewnatrz `queryFn` obu hookow odczytu
//     (globalWidgets.ts:134 i :154) oraz prawa strona `tenantId ?? ""` w
//     filtrze listy (:181). We wszystkich trzech `enabled: Boolean(...)` nie
//     dopusci `queryFn` bez identyfikatora, wiec zaden test czarnoskrzynkowy
//     w nie nie trafi - to martwy kod obronny, a nie luka w pokryciu.
// (b) Zgodnosc z politykami RLS (`bgw_insert_tenant`, `bgw_update_tenant`,
//     `bgw_delete_tenant`) jest poza zasiegiem atrapy PostgREST. Tu dowodzimy
//     WYLACZNIE ksztaltu zapytania, ktore do bazy poleci - to, czy baza je
//     przyjmie, sprawdzaja testy migracji.
// (c) Debounce zapisu instancji siedzi w `useGlobalWidgetSync` i ma wlasny
//     test. W tym pliku nic nie liczy czasu, wiec zegar swiadomie NIE jest
//     zamrozony - zamrozenie tylko udawaloby determinizm, ktorego nie brakuje.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** `null` = jeszcze nie wiadomo, w ktorym obszarze roboczym jestesmy. */
  tenantId: null as string | null,
  /** Sesja oddawana przez `supabase.auth.getSession()`. */
  session: null as { user: { id: string } } | null,
  emitInvalidate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nie zostala zainicjalizowana");
      return h.db.from(table);
    },
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: null }),
    },
  },
}));

// Podmieniamy WYLACZNIE hook tenanta - jego droga do `profiles` ma wlasny test,
// a tutaj liczy sie to, co paleta robi ze stanem "tenant jeszcze nieznany".
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

// Sygnal miedzy kartami jest zdarzeniem `window`; atrapa pozwala sprawdzic, czy
// w ogole poszedl, bez nasluchiwania na globalnym obiekcie. Alias przechwytuje
// takze import wzgledny `./widgetCacheInvalidation` z modulu badanego.
vi.mock("@/lib/builder/widgetCacheInvalidation", () => ({
  emitWidgetCacheInvalidate: h.emitInvalidate,
}));

import { fail, ok, supabaseFromStub } from "@/test/supabase";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import {
  globalWidgetKey,
  makeGlobalInstance,
  mergeGlobalIntoInstance,
  parseGlobalWidgetData,
  pushGlobalWidgetData,
  resolveGlobalWidgetInstance,
  useGlobalWidgetMeta,
  useGlobalWidgetNode,
  useGlobalWidgets,
  widgetToGlobalData,
} from "../globalWidgets";
import type { WidgetNode } from "../types";

const TABLE = "builder_global_widgets";
const TENANT = "11111111-1111-4111-8111-111111111111";
const GID = "g1";

const widget: WidgetNode = {
  id: "w1",
  kind: "widget",
  type: "button",
  content: { label_pl: "Kup", label_en: "Buy" },
  style: { bgColor: "#111" },
  advanced: { cssClass: "cta" },
};

/** Wezel BEZ wspolnych ozdobnikow - tylko to, co `WidgetNode` wymaga. */
const bareWidget: WidgetNode = {
  id: "w2",
  kind: "widget",
  type: "text",
  content: { html_pl: "<p>Stopka</p>" },
};

/**
 * Wezel, ktoremu USUNIETO tresc. Taki ksztalt przychodzi z dokumentu zapisanego
 * przez starsza wersje schematu, a `widgetToGlobalData` ma go domknac pustym
 * obiektem - bez rzutowania na `any`, przez zawezenie z `Partial`.
 */
function widgetWithoutContent(): WidgetNode {
  const node: Partial<WidgetNode> = { id: "w3", kind: "widget", type: "text" };
  return node as WidgetNode;
}

function db(): SupabaseFromStub {
  const stub = h.db;
  if (stub === null) throw new Error("test: atrapa bazy nie zostala zainicjalizowana");
  return stub;
}

/** Wiersz w ksztalcie, jaki oddaje PostgREST dla kolumn listy palety. */
function widgetRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: GID,
    name: "Stopka redakcyjna",
    data: { type: "button", content: { label_pl: "Kup", label_en: "Buy" } },
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-02T10:00:00.000Z",
    created_by: null,
    ...over,
  };
}

/**
 * Jedna odpowiedz dla tabeli globali rozdzielana po OGNIWIE lancucha: lista,
 * odczyt pojedynczego wiersza, insert (`.select("id").single()`), update
 * i delete ida ta sama tabela.
 */
function respondWidgets(parts: {
  list?: SupabaseResult;
  row?: SupabaseResult;
  single?: SupabaseResult;
  write?: SupabaseResult;
}) {
  db().setResponse(TABLE, (chain: RecordedChain) => {
    if (chain.has("insert")) return parts.single ?? ok({ id: "g-new" });
    if (chain.has("update") || chain.has("delete")) return parts.write ?? ok(null);
    if (chain.has("maybeSingle")) return parts.row ?? ok(null);
    return parts.list ?? ok([]);
  });
}

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, invalidateSpy, wrapper };
}

/** Wywolania szpiega w ksztalcie, ktorego dotyczy odczyt klucza cache. */
type InvalidateSpy = { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } };

/** Klucze cache, w ktore trafilo uniewaznienie (pierwszy czlon kazdego klucza). */
function invalidatedRoots(spy: InvalidateSpy): string[] {
  return spy.mock.calls
    .map((call) => {
      const arg = call[0] as { queryKey?: unknown } | undefined;
      const key = Array.isArray(arg?.queryKey) ? arg.queryKey : [];
      return typeof key[0] === "string" ? key[0] : "";
    })
    .filter(Boolean);
}

/** Wszystkie ogniwa `.eq(...)` lancucha w kolejnosci wywolania. */
function eqCalls(chain: RecordedChain | undefined): ReadonlyArray<ReadonlyArray<unknown>> {
  return (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => c.args);
}

/** Pierwszy lancuch tabeli globali zawierajacy dane ogniwo. */
function chainWith(method: string): RecordedChain | undefined {
  return db()
    .chainsFor(TABLE)
    .find((c) => c.has(method));
}

/** Odpalone zapytanie o liste palety (klucz nie jest eksportowany z modulu). */
function listQueryKeys(client: QueryClient): unknown[][] {
  return client
    .getQueryCache()
    .getAll()
    .map((q) => [...q.queryKey])
    .filter((key) => key[0] === WIDGET_QUERY_ROOTS.globalWidgets);
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  h.session = { user: { id: "user-9" } };
  h.emitInvalidate.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  h.db?.reset();
});

// ---------------------------------------------------------------------------
describe("parseGlobalWidgetData - co wolno wpuscic z kolumny jsonb", () => {
  it("odrzuca smiec i nieznany rodzaj widgetu", () => {
    expect(parseGlobalWidgetData(null)).toBeNull();
    expect(parseGlobalWidgetData({ type: "not-a-widget", content: {} })).toBeNull();
  });

  it("odrzuca tablice i wartosc niezdefiniowana, bo to nie sa obiekty payloadu", () => {
    // Tablica przepuszczona jako "obiekt" rozlozylaby sie spreadem w
    // `makeGlobalInstance` na klucze "0", "1", ... i dalaby wezel bez `type`.
    expect(parseGlobalWidgetData([])).toBeNull();
    expect(parseGlobalWidgetData([{ type: "button", content: {} }])).toBeNull();
    expect(parseGlobalWidgetData(undefined)).toBeNull();
    expect(parseGlobalWidgetData("tekst")).toBeNull();
  });

  it("odrzuca rodzaj widgetu, ktory nie jest napisem", () => {
    // Straz musi bronic takze przed liczba, nie tylko przed nieznanym napisem.
    expect(parseGlobalWidgetData({ type: 7, content: {} })).toBeNull();
    expect(parseGlobalWidgetData({ type: null, content: {} })).toBeNull();
  });

  it("zachowuje styl i ustawienia zaawansowane, gdy SA obiektami", () => {
    const parsed = parseGlobalWidgetData({
      type: "button",
      content: { label_pl: "x" },
      style: { bgColor: "#0a0" },
      advanced: { cssClass: "cta" },
    });
    expect(parsed).toEqual({
      type: "button",
      content: { label_pl: "x" },
      style: { bgColor: "#0a0" },
      advanced: { cssClass: "cta" },
    });
  });

  it("odrzuca styl i ustawienia zaawansowane, gdy NIE sa obiektami", () => {
    const parsed = parseGlobalWidgetData({
      type: "button",
      content: { label_pl: "x" },
      style: "red",
      advanced: 3,
    });
    expect(parsed).toEqual({ type: "button", content: { label_pl: "x" } });
  });

  it("tresc nieobiektowa schodzi do pustego obiektu, a nie do braku wartosci", () => {
    // Renderer czyta `content.label_pl` bezwarunkowo - `undefined` wywrocilby go.
    const parsed = parseGlobalWidgetData({ type: "button", content: "napis" });
    expect(parsed?.content).toEqual({});
  });
});

// ---------------------------------------------------------------------------
describe("widgetToGlobalData - co z instancji jedzie do wspolnego wiersza", () => {
  it("wyciaga gleboko skopiowany payload bez identyfikatora instancji", () => {
    const data = widgetToGlobalData(widget);
    expect(data).toEqual({
      type: "button",
      content: { label_pl: "Kup", label_en: "Buy" },
      style: { bgColor: "#111" },
      advanced: { cssClass: "cta" },
    });
    // Gleboka kopia - zmiana payloadu nigdy nie dotyka wezla zrodlowego.
    (data.content as Record<string, unknown>).label_pl = "Zmienione";
    expect(widget.content.label_pl).toBe("Kup");
  });

  it("wezel bez stylu i bez ustawien zaawansowanych nie doklada tych kluczy", () => {
    const data = widgetToGlobalData(bareWidget);
    // Klucz o wartosci `undefined` i BRAK klucza to dwie rozne rzeczy: pierwszy
    // przezylby merge i wykasowal zywy styl globala, drugi zostawia go w spokoju.
    expect(Object.keys(data).sort()).toEqual(["content", "type"]);
    expect("style" in data).toBe(false);
    expect("advanced" in data).toBe(false);
  });

  it("wezel bez tresci daje pusty obiekt tresci zamiast braku wartosci", () => {
    const data = widgetToGlobalData(widgetWithoutContent());
    expect(data).toEqual({ type: "text", content: {} });
  });
});

// ---------------------------------------------------------------------------
describe("makeGlobalInstance / mergeGlobalIntoInstance - instancja a wspolny payload", () => {
  it("tworzy instancje ze swiezym identyfikatorem, migawka i powiazaniem", () => {
    const data = widgetToGlobalData(widget);
    const instance = makeGlobalInstance({ id: GID, data });
    expect(instance.globalId).toBe(GID);
    expect(instance.id).not.toBe(widget.id);
    expect(instance.type).toBe("button");
    expect(instance.content).toEqual(widget.content);
  });

  it("dwie instancje tego samego globala dostaja ROZNE identyfikatory", () => {
    const data = widgetToGlobalData(widget);
    const first = makeGlobalInstance({ id: GID, data });
    const second = makeGlobalInstance({ id: GID, data });
    // Ten sam identyfikator na jednej stronie to kolizja w operacjach buildera:
    // zaznaczenie, usuniecie i przeniesienie trafialyby w oba wezly naraz.
    expect(first.id).not.toBe(second.id);
  });

  it("migawka instancji jest odcieta od zrodla - zmiana globala jej nie rusza", () => {
    const data = widgetToGlobalData(widget);
    const instance = makeGlobalInstance({ id: GID, data });
    (data.content as Record<string, unknown>).label_pl = "Podmienione";
    expect(instance.content.label_pl).toBe("Kup");
  });

  it("naklada zywy payload, zostawiajac tozsamosc instancji", () => {
    const instance = makeGlobalInstance({ id: GID, data: widgetToGlobalData(widget) });
    const merged = mergeGlobalIntoInstance(instance, {
      type: "button",
      content: { label_pl: "Nowy" },
      style: { bgColor: "#222" },
    });
    expect(merged.id).toBe(instance.id);
    expect(merged.globalId).toBe(GID);
    expect(merged.content).toEqual({ label_pl: "Nowy" });
    expect(merged.style).toEqual({ bgColor: "#222" });
    // Stare `advanced` z migawki nie moze przeciec do wezla po nalozeniu.
    expect(merged.advanced).toBeUndefined();
  });

  it("instancja bez powiazania po nalozeniu nadal nie ma powiazania", () => {
    const merged = mergeGlobalIntoInstance(bareWidget, widgetToGlobalData(widget));
    // Funkcja nie wymysla powiazania, ktorego nie bylo - inaczej zwykly widget
    // zaczalby sie synchronizowac z globalem po jednym przejsciu renderera.
    expect(merged.globalId).toBeUndefined();
    expect(merged.id).toBe(bareWidget.id);
    expect(merged.kind).toBe("widget");
  });

  it("w builderze wygrywa optymistyczna migawka, na publicznym renderze wspolny payload", () => {
    const instance = makeGlobalInstance({ id: GID, data: widgetToGlobalData(widget) });
    instance.content = { ...instance.content, titleSize: 39 };
    const staleGlobal = {
      ...widgetToGlobalData(widget),
      content: { ...widget.content, titleSize: 24 },
    };

    expect(resolveGlobalWidgetInstance(instance, staleGlobal, true).content.titleSize).toBe(39);
    expect(resolveGlobalWidgetInstance(instance, staleGlobal, false).content.titleSize).toBe(24);
  });

  it("widget BEZ powiazania zostaje nietkniety mimo niepustego payloadu globala", () => {
    const data = widgetToGlobalData(widget);
    const resolved = resolveGlobalWidgetInstance(bareWidget, data, false);
    // To jedyna bariera, ktora broni zwyklego widgetu przed nadpisaniem cudza
    // trescia, gdy w cache akurat lezy payload jakiegos globala.
    expect(resolved).toBe(bareWidget);
    expect(resolved.content).toEqual({ html_pl: "<p>Stopka</p>" });
  });

  it("niezaladowany global (payload null) nie kasuje migawki SSR", () => {
    const instance = makeGlobalInstance({ id: GID, data: widgetToGlobalData(widget) });
    const resolved = resolveGlobalWidgetInstance(instance, null, false);
    expect(resolved).toBe(instance);
    expect(resolved.content.label_pl).toBe("Kup");
  });
});

// ---------------------------------------------------------------------------
describe("globalWidgetKey - wspolny klucz nakladki renderu", () => {
  it("stoi pod korzeniem zaimportowanym z rejestru kluczy widgetow", () => {
    // Literal przepisany w tescie nie dowodzilby niczego: chodzi o to, ze modul
    // i rejestr `WIDGET_QUERY_ROOTS` mowia o TYM SAMYM korzeniu, bo to po nim
    // `invalidate()` kasuje nakladki po kazdej mutacji.
    expect(globalWidgetKey(GID)).toEqual([WIDGET_QUERY_ROOTS.globalWidget, GID]);
  });
});

// ---------------------------------------------------------------------------
describe("pushGlobalWidgetData - zapis payloadu globala z buildera", () => {
  it("udany zapis zwraca prawde, wysyla update po identyfikatorze i rozsyla sygnal", async () => {
    respondWidgets({ write: ok(null) });

    const okResult = await pushGlobalWidgetData(
      GID,
      { type: "button", content: { label_pl: "Zapisz" } },
      TENANT,
    );

    expect(okResult).toBe(true);
    const chain = chainWith("update");
    expect(chain?.argsOf("update")).toEqual([
      { data: { type: "button", content: { label_pl: "Zapisz" } } },
    ]);
    expect(eqCalls(chain)).toEqual([
      ["id", GID],
      ["tenant_id", TENANT],
    ]);
    // Bez sygnalu podglad w drugiej karcie zostalby przy starej tresci.
    expect(h.emitInvalidate).toHaveBeenCalledTimes(1);
  });

  it("odmowa bazy zwraca falsz i NIE rozsyla sygnalu miedzy kartami", async () => {
    respondWidgets({ write: fail("permission denied for table builder_global_widgets", "42501") });

    const okResult = await pushGlobalWidgetData(GID, { type: "text", content: {} }, TENANT);

    expect(okResult).toBe(false);
    // Sygnal po nieudanym zapisie kazalby wszystkim kartom pobrac dane na nowo
    // i pokazac je jako "zapisane" - czyli odmowa udawalaby sukces.
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): ZAPIS PAYLOADU DOMYKA FILTR
  // OBSZARU ROBOCZEGO. Wczesniej autozapis filtrowal WYLACZNIE `.eq("id")`,
  // wiec izolacje trzymala tylko polityka `bgw_update_tenant`. Kontrakt:
  // funkcja przyjmuje tenant z sesji wolajacego (`useGlobalWidgetSync` czyta
  // `useCurrentTenantId`, te sama droge co lista) i domyka `tenant_id` obok id.
  it("zapis payloadu domyka filtr tenant_id obok id", async () => {
    respondWidgets({ write: ok(null) });

    await pushGlobalWidgetData(GID, { type: "text", content: {} }, TENANT);

    expect(eqCalls(chainWith("update")).map((args) => args[0])).toEqual(["id", "tenant_id"]);
  });

  it("bez znanego tenanta zapis payloadu odmawia BEZ zapytania i bez sygnalu", async () => {
    respondWidgets({ write: ok(null) });

    const okResult = await pushGlobalWidgetData(GID, { type: "text", content: {} }, null);

    // Zapis w ciemno trafilby w tenant, ktorego kod jeszcze nie zna.
    expect(okResult).toBe(false);
    expect(db().chainsFor(TABLE)).toHaveLength(0);
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("useGlobalWidgetNode - nakladka zywego payloadu w renderze", () => {
  it("bez powiazania nie pyta bazy w ogole i oddaje pusty wynik", async () => {
    respondWidgets({ row: ok(widgetRow()) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetNode(undefined), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    // Dzieki temu `WidgetView` moze wolac hook bezwarunkowo dla KAZDEGO widgetu.
    expect(view.result.current).toBeNull();
    expect(db().chainsFor(TABLE)).toHaveLength(0);
  });

  it("dopoki odpowiedz nie wrocila, oddaje pusty wynik zamiast braku wartosci", () => {
    respondWidgets({ row: ok(widgetRow()) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetNode(GID), { wrapper });

    // Wolajacy ma z czego wziac fallback na migawke wezla, a nie `undefined`.
    expect(view.result.current).toBeNull();
  });

  it("udany odczyt oddaje sparsowany payload i pyta wylacznie o kolumne data", async () => {
    respondWidgets({ row: ok({ data: { type: "button", content: { label_pl: "Kup" } } }) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetNode(GID), { wrapper });

    await waitFor(() => expect(view.result.current).not.toBeNull());
    expect(view.result.current).toEqual({ type: "button", content: { label_pl: "Kup" } });
    const chain = db().lastChain(TABLE);
    expect(chain?.argsOf("select")).toEqual(["data"]);
    expect(eqCalls(chain)).toEqual([["id", GID]]);
    // `maybeSingle` - brak wiersza to poprawna odpowiedz, a nie blad zapytania.
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("wynik ladzie dokladnie pod kluczem globalWidgetKey", async () => {
    respondWidgets({ row: ok({ data: { type: "text", content: { html_pl: "<p>a</p>" } } }) });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetNode(GID), { wrapper });

    await waitFor(() => expect(view.result.current).not.toBeNull());
    // Optymistyczny zapis z `useGlobalWidgetSync` idzie WLASNIE pod ten klucz -
    // rozjazd znaczylby, ze kanwa zapisuje w pustke i nie odswieza instancji.
    expect(client.getQueryData(globalWidgetKey(GID))).toEqual({
      type: "text",
      content: { html_pl: "<p>a</p>" },
    });
  });

  it("uszkodzony rekord daje pusty wynik zamiast wywracac render", async () => {
    respondWidgets({ row: ok({ data: { type: "nie-widget", content: {} } }) });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetNode(GID), { wrapper });

    await waitFor(() =>
      expect(client.getQueryState(globalWidgetKey(GID))?.fetchStatus).toBe("idle"),
    );
    // Instancja zostaje przy wlasnej migawce - strona nadal cos pokazuje.
    expect(view.result.current).toBeNull();
  });

  it("brak wiersza daje pusty wynik", async () => {
    respondWidgets({ row: ok(null) });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetNode(GID), { wrapper });

    await waitFor(() =>
      expect(client.getQueryState(globalWidgetKey(GID))?.fetchStatus).toBe("idle"),
    );
    expect(view.result.current).toBeNull();
  });

  it("odmowa bazy daje pusty wynik, a nie wyjatek w drzewie renderu", async () => {
    respondWidgets({ row: fail("permission denied for table builder_global_widgets", "42501") });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetNode(GID), { wrapper });

    await waitFor(() =>
      expect(client.getQueryState(globalWidgetKey(GID))?.fetchStatus).toBe("idle"),
    );
    expect(view.result.current).toBeNull();
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): AWARIA ODCZYTU NIE JEST
  // CACHE-OWANA JAKO SUKCES. Wczesniej `queryFn` polykal `error` i zwracal
  // `null`, ktory React Query trzymal 60 s jako poprawna odpowiedz "globala nie
  // ma" (bez ponowienia), a nieudany refetch kasowal dobre dane. Kontrakt: blad
  // jest bledem zapytania (throw) - React Query moze ponowic i zachowuje
  // poprzednie dane; fallback na migawke robi `?? null` w hooku.
  it("blad odczytu globala jest bledem zapytania, a nie sukcesem w cache", async () => {
    respondWidgets({ row: fail("permission denied for table builder_global_widgets", "42501") });
    const { client, wrapper } = harness();
    renderHook(() => useGlobalWidgetNode(GID), { wrapper });

    await waitFor(() =>
      expect(client.getQueryState(globalWidgetKey(GID))?.fetchStatus).toBe("idle"),
    );
    expect(client.getQueryState(globalWidgetKey(GID))?.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
describe("useGlobalWidgetMeta - baner panelu wlasciwosci", () => {
  const metaKey = [WIDGET_QUERY_ROOTS.globalWidgetMeta, GID];

  it("bez powiazania nie pyta bazy i oddaje pusty wynik", async () => {
    respondWidgets({ row: ok({ name: "Stopka redakcyjna" }) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetMeta(undefined), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(view.result.current).toBeNull();
    expect(db().chainsFor(TABLE)).toHaveLength(0);
  });

  it("udany odczyt oddaje nazwe i pyta WYLACZNIE o kolumne name", async () => {
    respondWidgets({ row: ok({ name: "Stopka redakcyjna" }) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetMeta(GID), { wrapper });

    await waitFor(() => expect(view.result.current).toEqual({ name: "Stopka redakcyjna" }));
    const chain = db().lastChain(TABLE);
    // Baner nie ma powodu ciagnac calego payloadu widgetu przez siec.
    expect(chain?.argsOf("select")).toEqual(["name"]);
    expect(eqCalls(chain)).toEqual([["id", GID]]);
  });

  it("brak wiersza daje pusty wynik, a nie nazwe o wartosci niezdefiniowanej", async () => {
    respondWidgets({ row: ok(null) });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetMeta(GID), { wrapper });

    await waitFor(() => expect(client.getQueryState(metaKey)?.fetchStatus).toBe("idle"));
    // `{ name: undefined }` wygladalby w panelu jak istniejacy global bez nazwy.
    expect(view.result.current).toBeNull();
  });

  it("odmowa bazy daje pusty wynik i stan bledu zamiast sukcesu `null` w cache", async () => {
    respondWidgets({ row: fail("permission denied", "42501") });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetMeta(GID), { wrapper });

    await waitFor(() => expect(client.getQueryState(metaKey)?.fetchStatus).toBe("idle"));
    expect(view.result.current).toBeNull();
    // Ta sama regula co nakladka renderu: odmowa nie moze udawac "brak globala".
    expect(client.getQueryState(metaKey)?.status).toBe("error");
  });

  it("klucz zapytania stoi pod korzeniem globalWidgetMeta z rejestru kluczy", async () => {
    respondWidgets({ row: ok({ name: "Stopka redakcyjna" }) });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetMeta(GID), { wrapper });

    await waitFor(() => expect(view.result.current).not.toBeNull());
    // Ten korzen kasuje `invalidate()` po kazdej mutacji (globalWidgets.ts:194).
    // Klucz wpisany w miejscu nie ma eksportu, wiec czytamy go z cache.
    const keys = client
      .getQueryCache()
      .getAll()
      .map((q) => [...q.queryKey]);
    expect(keys).toContainEqual([WIDGET_QUERY_ROOTS.globalWidgetMeta, GID]);
  });
});

// ---------------------------------------------------------------------------
describe("useGlobalWidgets - lista palety widgetow globalnych", () => {
  it("przy nieznanym obszarze roboczym nie pyta bazy i oddaje pusta liste", async () => {
    h.tenantId = null;
    respondWidgets({ list: ok([widgetRow()]) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    // Paleta nie pokazuje niczego, zanim wiadomo, czyja jest sesja.
    expect(view.result.current.items).toEqual([]);
    expect(db().chainsFor(TABLE)).toHaveLength(0);
  });

  it("lista jest zawezona do obszaru roboczego, od najnowszych i ucieta na dwustu", async () => {
    respondWidgets({ list: ok([widgetRow()]) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.items).toHaveLength(1));
    const chain = db().lastChain(TABLE);
    expect(chain?.argsOf("select")).toEqual(["id, name, data, created_at, updated_at, created_by"]);
    // Filtr po tenancie jest DRUGA bramka obok RLS - chroni takze przed
    // pomylka klucza cache miedzy obszarami roboczymi.
    expect(eqCalls(chain)).toEqual([["tenant_id", TENANT]]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("klucz listy niesie identyfikator obszaru roboczego", async () => {
    respondWidgets({ list: ok([]) });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    // Bez tenanta w kluczu przelaczenie obszaru roboczego pokazywaloby
    // poprzednia palete z cache do czasu jej wygasniecia.
    expect(listQueryKeys(client)).toEqual([[WIDGET_QUERY_ROOTS.globalWidgets, TENANT]]);
  });

  it("poprawny wiersz dojezdza z kompletem metadanych, razem z pustym autorem", async () => {
    respondWidgets({
      list: ok([
        widgetRow({ id: "g-autor", created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f" }),
        widgetRow({ id: "g-bez-autora", name: "Baner zgody", created_by: null }),
      ]),
    });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.items).toHaveLength(2));
    expect(view.result.current.items[0]).toEqual({
      id: "g-autor",
      name: "Stopka redakcyjna",
      data: { type: "button", content: { label_pl: "Kup", label_en: "Buy" } },
      created_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-02T10:00:00.000Z",
      created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    });
    // Wiersz zalozony migracja albo skryptem nie ma autora - to poprawny stan.
    expect(view.result.current.items[1].created_by).toBeNull();
  });

  it("wiersz z niesparsowalnym payloadem znika z palety, reszta zostaje", async () => {
    respondWidgets({
      list: ok([
        widgetRow({ id: "g-zepsuty", data: { type: "nie-widget" } }),
        widgetRow({ id: "g-dobry" }),
      ]),
    });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.items).toHaveLength(1));
    // Jeden zepsuty rekord nie moze zabrac redaktorowi calej palety.
    expect(view.result.current.items[0].id).toBe("g-dobry");
  });

  it("odpowiedz bez tablicy wierszy daje pusta liste", async () => {
    respondWidgets({ list: ok(null) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.items).toEqual([]);
  });

  it("odmowa bazy stawia zapytanie w stanie bledu, a paleta zostaje pusta", async () => {
    respondWidgets({ list: fail("permission denied for table builder_global_widgets", "42501") });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.items).toEqual([]);
    // ZAMIERZONA roznica wobec `useGlobalWidgetNode`: paleta MA prawo wiedziec,
    // ze odczyt sie nie udal, bo redaktor patrzy na nia wprost i moze ponowic.
    const key = listQueryKeys(client)[0];
    expect(client.getQueryState(key)?.status).toBe("error");
  });

  it("oddany obiekt jest stabilny miedzy renderami bez zmiany danych", async () => {
    respondWidgets({ list: ok([widgetRow()]) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.items).toHaveLength(1));
    const before = view.result.current;
    view.rerender();

    // `useGlobalWidgetSync` trzyma te funkcje w tablicy zaleznosci efektu -
    // nowa referencja przy kazdym renderze dalaby petle zapisow do bazy.
    expect(view.result.current).toBe(before);
    expect(view.result.current.save).toBe(before.save);
    expect(view.result.current.rename).toBe(before.rename);
    expect(view.result.current.remove).toBe(before.remove);
  });

  it("kontrakt ksztaltu: hook oddaje dokladnie liste, stan ladowania i trzy mutacje", async () => {
    respondWidgets({ list: ok([]) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    // Atrapy tego hooka w piaciu innych plikach testowych obiecuja wiecej, niz
    // produkcja oddaje (np. `reload`). Ta asercja jest jedynym miejscem, ktore
    // wywroci sie, gdy atrapa i kontrakt zaczna sie rozjezdzac.
    expect(Object.keys(view.result.current).sort()).toEqual([
      "items",
      "loading",
      "remove",
      "rename",
      "save",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("useGlobalWidgets - zapis, zmiana nazwy i usuniecie globala", () => {
  it("zapis wysyla payload widgetu, autora z sesji i oddaje nowy identyfikator", async () => {
    respondWidgets({ list: ok([]), single: ok({ id: "g-new" }) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    let created: string | null = null;
    await act(async () => {
      created = await view.result.current.save("Stopka redakcyjna", widget);
    });

    expect(created).toBe("g-new");
    const insert = chainWith("insert");
    const payload = insert?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.name).toBe("Stopka redakcyjna");
    expect(payload.data).toEqual({
      type: "button",
      content: { label_pl: "Kup", label_en: "Buy" },
      style: { bgColor: "#111" },
      advanced: { cssClass: "cta" },
    });
    expect(payload.created_by).toBe("user-9");
    // Tenant z sesji - ten sam, po ktorym filtruje lista palety.
    expect(payload.tenant_id).toBe(TENANT);
    // Do bazy NIE moze pojechac tozsamosc instancji - wspolny wiersz jej nie ma.
    expect(payload.id).toBeUndefined();
    expect(payload.kind).toBeUndefined();
    expect(insert?.argsOf("select")).toEqual(["id"]);
    expect(insert?.has("single")).toBe(true);
  });

  it("zapis bez sesji zostawia autora pustego, zamiast go wymyslac", async () => {
    h.session = null;
    respondWidgets({ list: ok([]), single: ok({ id: "g-new" }) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    await act(async () => {
      await view.result.current.save("Bez autora", bareWidget);
    });

    const payload = chainWith("insert")?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.created_by).toBeNull();
  });

  it("udany zapis uniewaznia trzy korzenie cache i rozsyla sygnal miedzy kartami", async () => {
    respondWidgets({ list: ok([]), single: ok({ id: "g-new" }) });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    await act(async () => {
      await view.result.current.save("Stopka redakcyjna", widget);
    });

    // Paleta, nakladki renderu i baner panelu odswiezaja sie jednym ruchem.
    expect(invalidatedRoots(invalidateSpy)).toEqual([
      WIDGET_QUERY_ROOTS.globalWidgets,
      WIDGET_QUERY_ROOTS.globalWidget,
      WIDGET_QUERY_ROOTS.globalWidgetMeta,
    ]);
    expect(h.emitInvalidate).toHaveBeenCalledTimes(1);
  });

  it("odrzucony zapis oddaje pusty wynik, nie czysci cache i nie rozsyla sygnalu", async () => {
    respondWidgets({ list: ok([]), single: fail("new row violates row-level security", "42501") });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    let created: string | null = "cos";
    await act(async () => {
      created = await view.result.current.save("Odrzucony", widget);
    });

    // `null` to jedyny sygnal dla panelu, ze nie ma czego oznaczyc jako global.
    expect(created).toBeNull();
    expect(invalidatedRoots(invalidateSpy)).toEqual([]);
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });

  it("zmiana nazwy dotyka wylacznie kolumny name jednego wiersza", async () => {
    respondWidgets({ list: ok([]), write: ok(null) });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    await act(async () => {
      await view.result.current.rename(GID, "Stopka 2026");
    });

    const chain = chainWith("update");
    expect(chain?.argsOf("update")).toEqual([{ name: "Stopka 2026" }]);
    expect(eqCalls(chain)).toEqual([
      ["id", GID],
      ["tenant_id", TENANT],
    ]);
    expect(invalidatedRoots(invalidateSpy)).toContain(WIDGET_QUERY_ROOTS.globalWidgets);
    expect(h.emitInvalidate).toHaveBeenCalledTimes(1);
  });

  it("usuniecie kasuje jeden wiersz po identyfikatorze i odswieza wszystkie widoki", async () => {
    respondWidgets({ list: ok([]), write: ok(null) });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    await act(async () => {
      await view.result.current.remove(GID);
    });

    const chain = chainWith("delete");
    expect(chain?.has("delete")).toBe(true);
    expect(eqCalls(chain)).toEqual([
      ["id", GID],
      ["tenant_id", TENANT],
    ]);
    // Po usunieciu globala nakladki renderu MUSZA zniknac razem z pozycja
    // w palecie - inaczej strony wisza na wierszu, ktorego juz nie ma.
    expect(invalidatedRoots(invalidateSpy)).toEqual([
      WIDGET_QUERY_ROOTS.globalWidgets,
      WIDGET_QUERY_ROOTS.globalWidget,
      WIDGET_QUERY_ROOTS.globalWidgetMeta,
    ]);
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): NIEUDANA ZMIANA NAZWY NIE UDAJE
  // SUKCESU. Wczesniej `rename` nie czytal `error`, bezwarunkowo uniewaznial
  // trzy korzenie cache i zwracal `void`, wiec stara nazwa "wracala" bez
  // komunikatu. Kontrakt: `Promise<boolean>`; cache i sygnal miedzy kartami
  // WYLACZNIE przy powodzeniu.
  it("nieudana zmiana nazwy oddaje false i nie uniewaznia cache", async () => {
    respondWidgets({ list: ok([]), write: fail("permission denied", "42501") });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    let wynik: boolean | null = null;
    await act(async () => {
      wynik = await view.result.current.rename(GID, "Stopka 2026");
    });

    expect(wynik).toBe(false);
    expect(invalidatedRoots(invalidateSpy)).toEqual([]);
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): NIEUDANE USUNIECIE NIE UDAJE
  // SUKCESU. Wczesniej `remove` nie czytal `error` i bezwarunkowo uniewaznial
  // cache (pozycja migala w palecie). Kontrakt: `Promise<boolean>`, cache
  // WYLACZNIE przy powodzeniu (`true` przy sukcesie dowodzi plik
  // globalWidgetsTenantAndFailures.test.ts).
  it("nieudane usuniecie nie uniewaznia cache ani nie udaje sukcesu", async () => {
    respondWidgets({ list: ok([]), write: fail("permission denied", "42501") });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    let wynik: boolean | null = null;
    await act(async () => {
      wynik = await view.result.current.remove(GID);
    });

    expect(wynik).toBe(false);
    expect(invalidatedRoots(invalidateSpy)).toEqual([]);
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): ZAPIS PODAJE TENANTA, PO KTORYM
  // FILTRUJE LISTA. Wczesniej `tenant_id` uzupelnial DEFAULT bazy - inne
  // zrodlo prawdy niz `useCurrentTenantId` listy - wiec zapisany widget mogl
  // nie pojawic sie w palecie. Kontrakt: insert niesie `tenant_id` z sesji.
  it("zapis podaje jawnie tenant_id, po ktorym filtruje lista", async () => {
    respondWidgets({ list: ok([]), single: ok({ id: "g-new" }) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    await act(async () => {
      await view.result.current.save("Stopka redakcyjna", widget);
    });

    const payload = chainWith("insert")?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.tenant_id).toBe(TENANT);
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): ZAPIS ODMAWIA PRZY NIEZNANYM
  // OBSZARZE ROBOCZYM. Wczesniej insert lecial, choc lista byla w tym stanie
  // wylaczona - zapis w ciemno. Kontrakt: `tenantId === null` -> `null` bez
  // zadnego zapytania, symetrycznie do wylaczonej listy.
  it("zapis przy nieznanym obszarze roboczym odmawia bez zapytania", async () => {
    h.tenantId = null;
    respondWidgets({ list: ok([]), single: ok({ id: "g-new" }) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    let created: string | null = "cos";
    await act(async () => {
      created = await view.result.current.save("Zapis w ciemno", widget);
    });

    expect(db().chainsFor(TABLE)).toHaveLength(0);
    expect(created).toBeNull();
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): MUTACJE DOMYKAJA FILTR OBSZARU
  // ROBOCZEGO. Wczesniej `rename` i `remove` filtrowaly wylacznie po id, wiec
  // przed skasowaniem cudzego globala bronil tylko RLS. Kontrakt: obie mutacje
  // domykaja `.eq("tenant_id", tenantId)` obok `.eq("id")` tenantem listy.
  it("zmiana nazwy i usuniecie domykaja filtr tenant_id obok id", async () => {
    respondWidgets({ list: ok([]), write: ok(null) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    await act(async () => {
      await view.result.current.rename(GID, "Stopka 2026");
      await view.result.current.remove(GID);
    });

    expect(eqCalls(chainWith("update")).map((args) => args[0])).toEqual(["id", "tenant_id"]);
    expect(eqCalls(chainWith("delete")).map((args) => args[0])).toEqual(["id", "tenant_id"]);
  });
});
