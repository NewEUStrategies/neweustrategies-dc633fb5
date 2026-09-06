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
// 4. ODMOWA NIE UDAJE SUKCESU. Nieudany `save` zwraca `null` i NIE uniewaznia
//    cache; nieudany `pushGlobalWidgetData` zwraca `false` i NIE rozsyla
//    sygnalu miedzy kartami. Inaczej odrzucony zapis wygladalby jak zapisany.
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

    const okResult = await pushGlobalWidgetData(GID, {
      type: "button",
      content: { label_pl: "Zapisz" },
    });

    expect(okResult).toBe(true);
    const chain = chainWith("update");
    expect(chain?.argsOf("update")).toEqual([
      { data: { type: "button", content: { label_pl: "Zapisz" } } },
    ]);
    expect(eqCalls(chain)).toEqual([["id", GID]]);
    // Bez sygnalu podglad w drugiej karcie zostalby przy starej tresci.
    expect(h.emitInvalidate).toHaveBeenCalledTimes(1);
  });

  it("odmowa bazy zwraca falsz i NIE rozsyla sygnalu miedzy kartami", async () => {
    respondWidgets({ write: fail("permission denied for table builder_global_widgets", "42501") });

    const okResult = await pushGlobalWidgetData(GID, { type: "text", content: {} });

    expect(okResult).toBe(false);
    // Sygnal po nieudanym zapisie kazalby wszystkim kartom pobrac dane na nowo
    // i pokazac je jako "zapisane" - czyli odmowa udawalaby sukces.
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });

  // DEFEKT: ZAPIS PAYLOADU GLOBALA NIE DOMYKA FILTRA OBSZARU ROBOCZEGO.
  //
  // WEJSCIE: `pushGlobalWidgetData("g1", ...)` - autozapis instancji z kanwy
  //   buildera, wolany przy kazdej zmianie wlasciwosci widgetu globalnego.
  // CO PSUJE: zapytanie w src/lib/builder/globalWidgets.ts:245-248 filtruje
  //   WYLACZNIE `.eq("id", id)`. Lista palety w tym samym pliku (:181) domyka
  //   `.eq("tenant_id", tenantId)`, wiec regula repo "tenant_id w kazdej
  //   kwerendzie" jest tu zlamana wewnatrz jednego modulu.
  // KONSEKWENCJA: obrona w glab ma JEDNA warstwe zamiast dwoch - caly ciezar
  //   izolacji obszarow roboczych spoczywa na polityce `bgw_update_tenant`.
  //   Bledny warunek w migracji albo pomylka identyfikatora po stronie klienta
  //   konczy sie nadpisaniem cudzego widgetu globalnego, ktory stoi na
  //   wszystkich stronach obcej redakcji naraz.
  // WYMAGANA POPRAWKA: funkcja przyjmuje tenant (albo czyta go z tej samej
  //   drogi co lista) i domyka `.eq("tenant_id", tenantId)` obok `.eq("id")`.
  it.fails("DEFEKT: zapis payloadu MUSI domykac filtr tenant_id obok id", async () => {
    respondWidgets({ write: ok(null) });

    await pushGlobalWidgetData(GID, { type: "text", content: {} });

    expect(eqCalls(chainWith("update")).map((args) => args[0])).toEqual(["id", "tenant_id"]);
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

  // DEFEKT: AWARIA ODCZYTU JEST CACHE-OWANA JAKO SUKCES.
  //
  // WEJSCIE: chwilowa odmowa albo awaria sieci przy odczycie wiersza globala,
  //   ktory stoi na kilkunastu stronach serwisu.
  // CO PSUJE: `queryFn` w src/lib/builder/globalWidgets.ts:140 polyka `error`
  //   i zwraca `null`. React Query widzi SUKCES o wartosci `null` i zapisuje go
  //   z `staleTime` 60 s oraz `gcTime` 10 min (:131-132), bez ponowienia.
  // KONSEKWENCJA: przez minute KAZDA instancja tego globala dostaje odpowiedz
  //   "tego globala nie ma" i cicho zostaje przy swojej migawce - czyli po
  //   jednej mignietej awarii serwis przez minute renderuje wersje sprzed
  //   ostatniej edycji, nie sygnalizujac niczego ani redaktorowi, ani
  //   odwiedzajacemu. Ta sama warstwa w `useGlobalWidgets` robi ODWROTNIE
  //   (rzuca, :184), wiec niespojnosc jest wewnatrz jednego modulu.
  // WYMAGANA POPRAWKA: blad odczytu propaguje sie jako blad zapytania (throw),
  //   zeby React Query mogl ponowic; fallback na migawke i tak robi wolajacy
  //   przez `?? null` w miejscu uzycia.
  it.fails("DEFEKT: blad odczytu globala NIE moze byc zapisany w cache jako sukces", async () => {
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

  it("odmowa bazy daje pusty wynik", async () => {
    respondWidgets({ row: fail("permission denied", "42501") });
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetMeta(GID), { wrapper });

    await waitFor(() => expect(client.getQueryState(metaKey)?.fetchStatus).toBe("idle"));
    expect(view.result.current).toBeNull();
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
    expect(eqCalls(chain)).toEqual([["id", GID]]);
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
    expect(eqCalls(chain)).toEqual([["id", GID]]);
    // Po usunieciu globala nakladki renderu MUSZA zniknac razem z pozycja
    // w palecie - inaczej strony wisza na wierszu, ktorego juz nie ma.
    expect(invalidatedRoots(invalidateSpy)).toEqual([
      WIDGET_QUERY_ROOTS.globalWidgets,
      WIDGET_QUERY_ROOTS.globalWidget,
      WIDGET_QUERY_ROOTS.globalWidgetMeta,
    ]);
  });

  // DEFEKT: ZMIANA NAZWY IGNORUJE ODMOWE BAZY.
  //
  // WEJSCIE: `rename("g1", "Stopka 2026")` wolane przez redaktora, ktory nie ma
  //   roli admin/editor albo trafil na wiersz innego obszaru roboczego, wiec
  //   polityka `bgw_update_tenant` odrzuca UPDATE.
  // CO PSUJE: `rename` w src/lib/builder/globalWidgets.ts:215-221 w ogole nie
  //   czyta pola `error`, bezwarunkowo wola `invalidate()` i zwraca `void`.
  // KONSEKWENCJA: cache leci do kosza, paleta pobiera dane na nowo i STARA
  //   nazwa wraca na ekran bez zadnego komunikatu. Redaktor widzi, ze zmiana
  //   "sie cofnela", probuje jeszcze raz i jeszcze raz - a kazda proba to
  //   pelne odswiezenie trzech korzeni cache po nieudanym zapisie.
  // WYMAGANA POPRAWKA: `rename` zwraca `boolean` tak jak `pushGlobalWidgetData`
  //   (:250) i uniewaznia cache WYLACZNIE przy powodzeniu.
  it.fails(
    "DEFEKT: nieudana zmiana nazwy NIE moze uniewazniac cache ani udawac sukcesu",
    async () => {
      respondWidgets({ list: ok([]), write: fail("permission denied", "42501") });
      const { wrapper, invalidateSpy } = harness();
      const view = renderHook(() => useGlobalWidgets(), { wrapper });
      await waitFor(() => expect(view.result.current.loading).toBe(false));
      invalidateSpy.mockClear();

      await act(async () => {
        await view.result.current.rename(GID, "Stopka 2026");
      });

      expect(invalidatedRoots(invalidateSpy)).toEqual([]);
      expect(h.emitInvalidate).not.toHaveBeenCalled();
    },
  );

  // DEFEKT: USUNIECIE IGNORUJE ODMOWE BAZY (ten sam brak co przy zmianie nazwy).
  //
  // WEJSCIE: `remove("g1")` odrzucone przez polityke `bgw_delete_tenant`.
  // CO PSUJE: `remove` w src/lib/builder/globalWidgets.ts:223-229 nie czyta
  //   pola `error`, bezwarunkowo uniewaznia cache i zwraca `void`.
  // KONSEKWENCJA: pozycja znika z palety na czas jednego renderu i wraca po
  //   pobraniu. Redaktor odczytuje to jako blad interfejsu, a nie jako brak
  //   uprawnien - a przy okazji kazda nieudana proba usuniecia generuje pelne
  //   odswiezenie trzech korzeni cache.
  // WYMAGANA POPRAWKA: `remove` zwraca `boolean` i uniewaznia cache WYLACZNIE
  //   przy powodzeniu.
  it.fails("DEFEKT: nieudane usuniecie NIE moze uniewazniac cache ani udawac sukcesu", async () => {
    respondWidgets({ list: ok([]), write: fail("permission denied", "42501") });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    await act(async () => {
      await view.result.current.remove(GID);
    });

    expect(invalidatedRoots(invalidateSpy)).toEqual([]);
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });

  // DEFEKT: ZAPIS NIE PODAJE TENANTA, PO KTORYM POTEM SAM FILTRUJE LISTE.
  //
  // WEJSCIE: `save("Stopka redakcyjna", widget)` w obszarze roboczym, ktory
  //   `useCurrentTenantId` czyta z `profiles.tenant_id`.
  // CO PSUJE: insert w src/lib/builder/globalWidgets.ts:203-207 wysyla tylko
  //   `name`, `data` i `created_by`. Kolumne `tenant_id` uzupelnia DEFAULT bazy
  //   `current_tenant_id()` (supabase/migrations/20260702085900_builder_globals
  //   _popups_experiments.sql:43), czyli INNE zrodlo prawdy niz to, po ktorym
  //   filtruje lista (:181).
  // KONSEKWENCJA: gdy oba zrodla sie rozjada (uzytkownik w dwoch obszarach,
  //   swiezo zmieniony profil, sesja z innego kontekstu), zapis SIE UDAJE,
  //   zwraca identyfikator i uniewaznia cache - a widget NIE POJAWIA SIE
  //   w palecie, bo lista pyta o inny tenant. Redaktor zapisuje go drugi
  //   i trzeci raz, mnozac niewidoczne wiersze.
  // WYMAGANA POPRAWKA: insert podaje jawnie `tenant_id: tenantId` - ten sam,
  //   po ktorym filtruje lista, tak jak reszta zapytan w tym repo.
  it.fails("DEFEKT: zapis MUSI podac jawnie tenant_id, po ktorym filtruje lista", async () => {
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

  // DEFEKT: ZAPIS NIE ODMAWIA, GDY OBSZAR ROBOCZY JEST JESZCZE NIEZNANY.
  //
  // WEJSCIE: `save(...)` wolane, zanim `useCurrentTenantId` zwroci tenant
  //   (pierwsze sekundy po wejsciu do buildera, odswiezenie sesji).
  // CO PSUJE: `save` w src/lib/builder/globalWidgets.ts:198-213 nie oglada sie
  //   na `tenantId` w ogole. Zapytanie LISTY jest w tym stanie swiadomie
  //   wylaczone (`enabled: Boolean(tenantId)`, :175), ale insert i tak leci.
  // KONSEKWENCJA: wiersz powstaje w obszarze roboczym, ktorego kod jeszcze nie
  //   zna - czyli zapis w ciemno, ktorego autor nie zobaczy w palecie, dopoki
  //   nie trafi z powrotem na ten sam tenant.
  // WYMAGANA POPRAWKA: przy `tenantId === null` `save` zwraca `null` bez
  //   wysylania jakiegokolwiek zapytania, symetrycznie do wylaczonej listy.
  it.fails(
    "DEFEKT: zapis przy nieznanym obszarze roboczym MUSI odmowic bez zapytania",
    async () => {
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
    },
  );

  // DEFEKT: MUTACJE NIE DOMYKAJA FILTRA OBSZARU ROBOCZEGO.
  //
  // WEJSCIE: `rename("g1", ...)` i `remove("g1")` z panelu palety.
  // CO PSUJE: oba zapytania (src/lib/builder/globalWidgets.ts:217 i :225)
  //   filtruja WYLACZNIE `.eq("id", id)`. Lista w tym samym hooku domyka
  //   `.eq("tenant_id", tenantId)` (:181), wiec regula repo "tenant_id w kazdej
  //   kwerendzie" jest zlamana w trzech miejscach jednego modulu.
  // KONSEKWENCJA: identyfikator globala wystarczy, zeby zmienic nazwe albo
  //   skasowac cudzy wiersz - broni tego wylacznie RLS po stronie serwera,
  //   czyli obrona w glab ma jedna warstwe zamiast dwoch. Skasowany global
  //   znika ze wszystkich stron obcej redakcji naraz.
  // WYMAGANA POPRAWKA: obie mutacje domykaja `.eq("tenant_id", tenantId)` obok
  //   `.eq("id", id)`, tym samym tenantem, ktorym filtruje lista.
  it.fails("DEFEKT: zmiana nazwy i usuniecie MUSZA domykac filtr tenant_id obok id", async () => {
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
