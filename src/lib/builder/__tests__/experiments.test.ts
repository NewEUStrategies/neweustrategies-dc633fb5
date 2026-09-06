// SILNIK TESTÓW A/B SEKCJI - trzy warstwy jednego modułu w jednym pliku.
//
// `src/lib/builder/experiments.ts` miesza trzy zupełnie różne rodzaje kodu
// i każdy z nich psuje się inaczej:
//
//   1. ARYTMETYKA (fnv1a, assignVariant, collectExperimentIds,
//      isSectionVisibleForAssignments, conversionRate, zScore) - czysta,
//      wywoływana wprost,
//   2. SKUTKI UBOCZNE W PRZEGLĄDARCE (getVisitorId, recordExperimentEvent,
//      useExperimentAssignments) - magazyn, beacon, fetch,
//   3. WARSTWA DANYCH SUPABASE (useExperimentsAdmin, useExperimentStats) -
//      rejestr eksperymentów i liczniki zdarzeń panelu redakcji.
//
// ── CO TU JEST NAPRAWDĘ DO OBRONY ──────────────────────────────────────────
//
// 1. PODZIAŁ 50/50 MA BYĆ PODZIAŁEM. `assignVariant` liczy kubełek z hasza,
//    a `fnv1a` kończy się `>>> 0`. Bez tej konwersji `% 2` na liczbie ujemnej
//    daje -1, żaden odwiedzający nie trafia do „b" i test A/B mierzy jeden
//    wariant przez cały czas trwania - nie widać tego w żadnym logu.
//
// 2. WIDOCZNOŚĆ SEKCJI NIE MOŻE ZNIKAĆ. `isSectionVisibleForAssignments`
//    z domyślką `?? "a"` gwarantuje, że sekcja oznaczona eksperymentem, dla
//    którego NIE MA przypisania (dokument zmieniony po starcie testu, mapa
//    z innej strony), nadal się pokaże. Bez domyślki strona traci kawałek
//    treści bez śladu w konsoli.
//
// 3. ZDARZENIE LEJKA MA POJECHAĆ RAZ I POJECHAĆ ZAWSZE. Dedup w sessionStorage
//    pilnuje mianownika współczynnika konwersji, a ścieżka `fetch(keepalive)`
//    jest jedynym wyjściem tam, gdzie Beacon API jest wyłączone. Zablokowany
//    magazyn, brak `crypto.randomUUID`, rzucający `Blob` i odrzucony `fetch`
//    NIE MOGĄ wywrócić renderu - śledzenie jest opcjonalne, treść nie.
//
// 4. IZOLACJA NAJEMCY W PANELU. Lista rejestru jest zawężona `tenant_id`,
//    a zapytania nie startują, dopóki najemca jest nieznany. Odmowa odczytu
//    (RLS) MUSI dać stan błędu, a nie pustą listę udającą „nie ma testów".
//
// ── GRANICA DOWODU ─────────────────────────────────────────────────────────
// * Gałąź `typeof window === "undefined"` (getVisitorId i recordExperimentEvent)
//   jest nieosiągalna: środowisko testów to happy-dom, w którym `window`
//   istnieje zawsze. Zachowanie SSR jest tu przykryte pośrednio - przez
//   `assignVariant("exp", "")`, czyli dokładnie ten stan, w który wpada SSR.
// * RENDERER (kiedy sekcja trafia do DOM, kiedy leci ekspozycja przy montażu)
//   ma własny plik: builderRenderer.experiments.test.tsx.
// * TRASA panelu (werdykt, tabela wyników) ma własny plik:
//   adminExperimentsRoute.test.tsx.
// * PRZYJĘCIE zdarzenia po stronie serwera (walidacja, rate limit, insert
//   kluczem service_role) ma własny plik testowy endpointu - tu kończymy
//   na tym, CO wychodzi z przeglądarki.
// * RLS nie jest tu mierzone: atrapa bazy oddaje to, co jej każemy. Testy
//   dowodzą kształtu ZAPYTANIA (zawężenia, kolumny, licznik), nie polityki.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

/**
 * Stan wstrzykiwany do atrap modułów. `vi.hoisted`, bo fabryki `vi.mock`
 * wykonują się PRZED zwykłymi importami pliku.
 */
const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** `null` = jeszcze nie wiadomo, w którym obszarze roboczym jesteśmy. */
  tenantId: null as string | null,
  /** Sesja oddawana przez `supabase.auth.getSession()`. */
  session: null as { user: { id: string } } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
      return h.db.from(table);
    },
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: null }),
    },
  },
}));

// Podmieniamy WYŁĄCZNIE hook najemcy - jego własna droga do `profiles` ma
// osobny test, a tutaj liczy się to, co rejestr robi ze stanem „najemca
// nieznany".
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

import { fail, ok, okCount, supabaseFromStub } from "@/test/supabase";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import {
  assignVariant,
  collectExperimentIds,
  conversionRate,
  fnv1a,
  isSectionVisibleForAssignments,
  recordExperimentEvent,
  useExperimentAssignments,
  useExperimentStats,
  useExperimentsAdmin,
  zScore,
  type AbVariant,
} from "../experiments";
import type { SectionNode } from "../types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TABELA = "builder_experiments";
const TABELA_ZDARZEN = "builder_experiment_events";
const URL_ZDARZENIA = "/api/public/experiment-event";
/** Klucz magazynu podany JAWNIE - jego zmiana rozjeżdża wszystkie sesje. */
const KLUCZ_ODWIEDZAJACEGO = "cms_visitor_id";

const section = (
  id: string,
  abTest?: { experimentId: string; variant: "a" | "b" },
): SectionNode => ({
  id,
  kind: "section",
  children: [],
  ...(abTest ? { advanced: { abTest } } : {}),
});

/** Sekcja z ustawieniami zaawansowanymi, ale BEZ oznaczenia eksperymentu. */
const sectionBezTestu = (id: string): SectionNode => ({
  id,
  kind: "section",
  children: [],
  advanced: { cssClass: "sekcja-bez-testu" },
});

function db(): SupabaseFromStub {
  const stub = h.db;
  if (stub === null) throw new Error("test: atrapa bazy nie została zainicjalizowana");
  return stub;
}

/**
 * Identyfikator odwiedzającego, którego hasz kwalifikuje do zadanego wariantu.
 * Szukamy go PRAWDZIWĄ funkcją przypisania - test nie powtarza arytmetyki
 * kubełkowania i nie zgaduje wyniku.
 */
function odwiedzajacyDlaWariantu(experimentId: string, wariant: AbVariant): string {
  for (let i = 0; i < 500; i++) {
    const kandydat = `odwiedzajacy-${i}`;
    if (assignVariant(experimentId, kandydat) === wariant) return kandydat;
  }
  throw new Error(`test: nie znaleziono identyfikatora dla wariantu ${wariant}`);
}

// ── magazyn przeglądarki ───────────────────────────────────────────────────

const PRAWDZIWY_LOCAL = window.localStorage;
const PRAWDZIWY_SESSION = window.sessionStorage;

function rzucBlokade(): never {
  throw new DOMException("The operation is insecure.", "SecurityError");
}

type MetodaMagazynu = "getItem" | "setItem";

/**
 * Magazyn działający poprawnie POZA jedną metodą - ta rzuca `SecurityError`,
 * dokładnie jak przeglądarka z zablokowanymi danymi witryn. Podmieniamy CAŁĄ
 * właściwość `window.localStorage`, bo w happy-dom jest ona proxy i szpieg
 * założony na `Storage.prototype` w ogóle nie przechwytuje wywołania.
 */
function magazynZAwaria(awaria: MetodaMagazynu): Storage {
  const dane = new Map<string, string>();
  return {
    get length() {
      return dane.size;
    },
    clear: () => dane.clear(),
    key: (index: number) => [...dane.keys()][index] ?? null,
    getItem: (key: string) => (awaria === "getItem" ? rzucBlokade() : (dane.get(key) ?? null)),
    setItem: (key: string, value: string) => {
      if (awaria === "setItem") rzucBlokade();
      dane.set(key, value);
    },
    removeItem: (key: string) => {
      dane.delete(key);
    },
  };
}

function podmienMagazyn(nazwa: "localStorage" | "sessionStorage", magazyn: Storage): void {
  Object.defineProperty(window, nazwa, { configurable: true, get: () => magazyn });
}

function przywrocMagazyny(): void {
  podmienMagazyn("localStorage", PRAWDZIWY_LOCAL);
  podmienMagazyn("sessionStorage", PRAWDZIWY_SESSION);
}

// ── beacon ─────────────────────────────────────────────────────────────────

const ORYGINALNY_BEACON = navigator.sendBeacon;

function ustawBeacon(value: unknown): void {
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, writable: true, value });
}

function szpiegBeaconu() {
  return vi.fn((_url: string, _body?: BodyInit) => true);
}

/** Ładunek n-tego wywołania beaconu, odczytany z przesłanego Blob-a. */
async function ladunekBeaconu(
  beacon: ReturnType<typeof szpiegBeaconu>,
  index = 0,
): Promise<Record<string, unknown>> {
  const body = beacon.mock.calls[index]?.[1];
  if (!(body instanceof Blob)) throw new Error("test: beacon nie dostał ładunku Blob");
  return JSON.parse(await body.text()) as Record<string, unknown>;
}

function szpiegFetcha() {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
}

// ── rejestr eksperymentów ──────────────────────────────────────────────────

/** Wiersz `builder_experiments` w kształcie oddawanym przez PostgREST. */
function wierszEksperymentu(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "exp-1",
    name: "Nagłówek strony głównej",
    status: "running",
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-02T10:00:00.000Z",
    ...over,
  };
}

/**
 * Jedna odpowiedź dla tabeli rejestru rozdzielana po OGNIWIE łańcucha: lista,
 * insert (`.select("id").single()`), update i delete idą tą samą tabelą.
 */
function odpowiedzRejestru(parts: {
  lista?: SupabaseResult;
  wstaw?: SupabaseResult;
  zapis?: SupabaseResult;
}): void {
  db().setResponse(TABELA, (chain: RecordedChain) => {
    if (chain.has("insert")) return parts.wstaw ?? ok({ id: "exp-nowy" });
    if (chain.has("update") || chain.has("delete")) return parts.zapis ?? ok(null);
    return parts.lista ?? ok([]);
  });
}

/**
 * Łańcuch rejestru zawierający dane ogniwo. `lastChain` tu NIE wystarcza:
 * mutacja unieważnia cache, więc zaraz po niej leci jeszcze jeden łańcuch
 * listy i to on byłby „ostatni".
 */
function lancuchZOgniwem(metoda: string): RecordedChain {
  const chain = db()
    .chainsFor(TABELA)
    .find((c) => c.has(metoda));
  if (!chain) throw new Error(`test: żaden łańcuch nie zawiera ogniwa "${metoda}"`);
  return chain;
}

/** Argumenty WSZYSTKICH wystąpień ogniwa - `argsOf` oddaje tylko pierwsze. */
function callArgs(chain: RecordedChain, method: string): ReadonlyArray<unknown>[] {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

/** Wywołania szpiega w kształcie, którego dotyczy odczyt klucza cache. */
type InvalidateSpy = { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } };

/** Korzenie cache, w które trafiło unieważnienie (pierwszy człon klucza). */
function korzenieUniewaznien(spy: InvalidateSpy): string[] {
  return spy.mock.calls.map((call) => {
    const arg = call[0] as { queryKey?: unknown } | undefined;
    const key = Array.isArray(arg?.queryKey) ? arg.queryKey : [];
    return typeof key[0] === "string" ? key[0] : "";
  });
}

/** Klucze zapytań obecne w cache klienta react-query. */
function kluczeCache(queryClient: { getQueryCache(): { getAll(): { queryKey: unknown }[] } }) {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey);
}

// ── zdarzenia eksperymentu ─────────────────────────────────────────────────

/**
 * Cztery równoległe liczniki idą TĄ SAMĄ tabelą - rozróżniamy je wyłącznie po
 * argumentach ogniw `.eq`, dokładnie tak, jak rozróżnia je PostgREST.
 */
function odpowiedzLicznikow(liczniki: { ea: number; eb: number; ca: number; cb: number }): void {
  db().setResponse(TABELA_ZDARZEN, (chain: RecordedChain) => {
    const eq = callArgs(chain, "eq");
    const wartosc = (kolumna: string) => eq.find((a) => a[0] === kolumna)?.[1];
    const wariant = wartosc("variant");
    if (wartosc("event") === "exposure") {
      return okCount(wariant === "a" ? liczniki.ea : liczniki.eb);
    }
    return okCount(wariant === "a" ? liczniki.ca : liczniki.cb);
  });
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  h.session = { user: { id: "redaktor-1" } };
  przywrocMagazyny();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  ustawBeacon(ORYGINALNY_BEACON);
  przywrocMagazyny();
  window.localStorage.clear();
  window.sessionStorage.clear();
  h.db = null;
});

describe("fnv1a", () => {
  it("is deterministic and input-sensitive", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
    expect(fnv1a("")).toBe(0x811c9dc5);
  });

  it("nigdy nie zwraca liczby ujemnej, mimo że mnożenie przepełnia 32 bity", () => {
    // `Math.imul` oddaje liczbę ZE ZNAKIEM, więc bez `>>> 0` (experiments.ts:63)
    // hasz bywałby ujemny, a `% 2` dawałoby wtedy -1 zamiast 1 - wariant „b"
    // przestałby istnieć i test A/B mierzyłby jeden wariant przez cały czas.
    let bylyPonad2Do31 = false;
    for (let i = 0; i < 300; i++) {
      const hash = fnv1a(`exp-1:odwiedzajacy-${i}`);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
      if (hash > 0x7fffffff) bylyPonad2Do31 = true;
    }
    // Gdyby żaden hasz nie przekroczył 2^31, powyższe nic by nie dowodziło:
    // to właśnie te wartości byłyby ujemne bez konwersji bez znaku.
    expect(bylyPonad2Do31).toBe(true);
  });

  it("rozróżnia znaki spoza ASCII, bo czyta jednostki kodowe, a nie bajty", () => {
    expect(fnv1a("ą")).not.toBe(fnv1a("a"));
    expect(fnv1a("Ą")).not.toBe(fnv1a("ą"));
    // Para zastępcza to DWIE jednostki kodowe - hasz musi być inny niż hasz
    // samej pierwszej połowy pary.
    expect(fnv1a("𝄞")).not.toBe(fnv1a("\uD834"));
  });
});

describe("assignVariant", () => {
  it("is stable for the same visitor + experiment", () => {
    const v = assignVariant("exp-1", "visitor-1");
    for (let i = 0; i < 10; i++) expect(assignVariant("exp-1", "visitor-1")).toBe(v);
  });

  it("falls back to variant A without a visitor id (SSR)", () => {
    expect(assignVariant("exp-1", "")).toBe("a");
  });

  it("splits a population roughly 50/50 and independently per experiment", () => {
    let b1 = 0;
    let b2 = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (assignVariant("exp-1", `visitor-${i}`) === "b") b1++;
      if (assignVariant("exp-2", `visitor-${i}`) === "b") b2++;
    }
    expect(b1 / n).toBeGreaterThan(0.4);
    expect(b1 / n).toBeLessThan(0.6);
    expect(b2 / n).toBeGreaterThan(0.4);
    expect(b2 / n).toBeLessThan(0.6);
  });
});

describe("collectExperimentIds", () => {
  it("returns unique experiment ids in document order", () => {
    const sections = [
      section("s1", { experimentId: "x1", variant: "a" }),
      section("s2", { experimentId: "x1", variant: "b" }),
      section("s3"),
      section("s4", { experimentId: "x2", variant: "a" }),
    ];
    expect(collectExperimentIds(sections)).toEqual(["x1", "x2"]);
  });

  it("pusta lista sekcji daje pustą listę identyfikatorów", () => {
    expect(collectExperimentIds([])).toEqual([]);
  });

  it("sekcja z ustawieniami zaawansowanymi, ale bez oznaczenia A/B, nie wnosi identyfikatora", () => {
    expect(collectExperimentIds([sectionBezTestu("s1")])).toEqual([]);
  });

  it("PUSTY experimentId jest pomijany, bo z niczego nie da się zrobić kubełka", () => {
    // Oznaczenie A/B z pustym identyfikatorem powstaje np. po ręcznej edycji
    // dokumentu albo po usunięciu eksperymentu z rejestru. Gdyby trafiło na
    // listę, `useExperimentAssignments` wpisałby do mapy klucz "" i sekcja
    // zaczęłaby migotać między wariantami przy każdym wejściu.
    const sections = [
      section("s1", { experimentId: "", variant: "a" }),
      section("s2", { experimentId: "x1", variant: "b" }),
    ];
    expect(collectExperimentIds(sections)).toEqual(["x1"]);
  });

  it("dziura w liście sekcji nie wywraca zbierania identyfikatorów", () => {
    // Dokument wczytany z bazy bywa niekompletny (nieudana migracja, ręczny
    // JSON). Optional chaining `s?.advanced` ma to przeżyć, bo alternatywą
    // jest wyjątek w trakcie renderu publicznej strony.
    const sections = [
      undefined as unknown as SectionNode,
      section("s2", { experimentId: "x1", variant: "a" }),
    ];
    expect(collectExperimentIds(sections)).toEqual(["x1"]);
  });
});

describe("isSectionVisibleForAssignments", () => {
  const a = section("s1", { experimentId: "x1", variant: "a" });
  const b = section("s2", { experimentId: "x1", variant: "b" });
  const plain = section("s3");

  it("shows untagged sections always", () => {
    expect(isSectionVisibleForAssignments(plain, null)).toBe(true);
    expect(isSectionVisibleForAssignments(plain, new Map([["x1", "b"]]))).toBe(true);
  });

  it("shows variant A until assignments resolve (SSR parity)", () => {
    expect(isSectionVisibleForAssignments(a, null)).toBe(true);
    expect(isSectionVisibleForAssignments(b, null)).toBe(false);
  });

  it("shows exactly the assigned variant", () => {
    const assignments = new Map<string, "a" | "b">([["x1", "b"]]);
    expect(isSectionVisibleForAssignments(a, assignments)).toBe(false);
    expect(isSectionVisibleForAssignments(b, assignments)).toBe(true);
  });

  it("mapa BEZ klucza tej sekcji pokazuje wariant A, a nie ukrywa obu sekcji", () => {
    // Mapa niesie przypisania innych eksperymentów tej samej strony. Domyślka
    // `?? "a"` (experiments.ts:100) jest jedyną rzeczą, która trzyma treść na
    // stronie, gdy dokument zmienił się po starcie testu - bez niej ani „a",
    // ani „b" nie pasuje i sekcja znika bez śladu.
    const inne = new Map<string, AbVariant>([["x9", "b"]]);
    expect(isSectionVisibleForAssignments(a, inne)).toBe(true);
    expect(isSectionVisibleForAssignments(b, inne)).toBe(false);
  });
});

describe("stats helpers", () => {
  it("computes conversion rate with a zero guard", () => {
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(200, 30)).toBeCloseTo(0.15);
  });

  it("returns 0 z-score without exposures and detects a strong winner", () => {
    expect(zScore({ exposures: { a: 0, b: 100 }, conversions: { a: 0, b: 10 } })).toBe(0);
    const strong = zScore({ exposures: { a: 1000, b: 1000 }, conversions: { a: 50, b: 150 } });
    expect(strong).toBeGreaterThan(1.96);
    const inverse = zScore({ exposures: { a: 1000, b: 1000 }, conversions: { a: 150, b: 50 } });
    expect(inverse).toBeLessThan(-1.96);
  });

  it("stays below significance for near-identical variants", () => {
    const z = zScore({ exposures: { a: 500, b: 500 }, conversions: { a: 51, b: 49 } });
    expect(Math.abs(z)).toBeLessThan(1.96);
  });

  it("zerowe ekspozycje po stronie B też dają 0, nie dzielenie przez zero", () => {
    // Drugie ramię warunku z experiments.ts:197. Wariant „b" bez ani jednej
    // ekspozycji zdarza się zaraz po starcie testu - wtedy `pb` byłoby 0/0.
    expect(zScore({ exposures: { a: 100, b: 0 }, conversions: { a: 10, b: 0 } })).toBe(0);
  });

  it("gdy ŻADEN wariant nie konwertuje, werdykt to 0, a nie NaN", () => {
    // p = 0, więc p*(1-p) = 0 i odchylenie standardowe jest zerowe. Gałąź
    // `se > 0` (experiments.ts:202) zamienia to na 0; bez niej panel redakcji
    // pokazałby „NaN" zamiast werdyktu istotności.
    const z = zScore({ exposures: { a: 300, b: 300 }, conversions: { a: 0, b: 0 } });
    expect(z).toBe(0);
    expect(Number.isNaN(z)).toBe(false);
  });

  it("gdy OBA warianty konwertują w 100%, werdykt to 0", () => {
    // Drugi koniec tej samej gałęzi: p = 1, więc p*(1-p) też jest zerem.
    const z = zScore({ exposures: { a: 50, b: 80 }, conversions: { a: 50, b: 80 } });
    expect(z).toBe(0);
    expect(Number.isFinite(z)).toBe(true);
  });
});

describe("zapis zdarzenia eksperymentu", () => {
  it("ekspozycja idzie beaconem pod /api/public/experiment-event z pełnym ładunkiem", async () => {
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);
    window.localStorage.setItem(KLUCZ_ODWIEDZAJACEGO, "odwiedzajacy-7");

    recordExperimentEvent("exp-1", "b", "exposure");

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe(URL_ZDARZENIA);
    // Wszystkie pięć pól: drugą stronę tego kontraktu waliduje endpoint
    // przyjmujący zdarzenie, więc brak któregokolwiek to zdarzenie odrzucone.
    expect(await ladunekBeaconu(beacon)).toEqual({
      experimentId: "exp-1",
      variant: "b",
      event: "exposure",
      visitorId: "odwiedzajacy-7",
      path: window.location.pathname,
    });
  });

  it("drugie wywołanie tego samego zdarzenia w tej samej sesji NIE wysyła niczego", () => {
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);

    recordExperimentEvent("exp-1", "a", "exposure");
    recordExperimentEvent("exp-1", "a", "exposure");

    // Bez dedupu każdy ponowny render podbijałby mianownik współczynnika
    // konwersji i wynik testu byłby systematycznie zaniżony.
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("klucz dedupu jest ROZŁĄCZNY dla rodzaju zdarzenia i dla eksperymentu", () => {
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);

    recordExperimentEvent("exp-1", "a", "exposure");
    recordExperimentEvent("exp-1", "a", "conversion");
    recordExperimentEvent("exp-2", "a", "exposure");

    expect(beacon).toHaveBeenCalledTimes(3);
    // Literały JAWNE: zmiana formatu klucza (experiments.ts:129-130) kasuje
    // dedup wszystkim otwartym sesjom i MUSI boleć w teście.
    expect(window.sessionStorage.getItem("cms_ab_exposure_exp-1")).toBe("1");
    expect(window.sessionStorage.getItem("cms_ab_conversion_exp-1")).toBe("1");
    expect(window.sessionStorage.getItem("cms_ab_exposure_exp-2")).toBe("1");
    expect(window.sessionStorage.getItem("cms_ab_conversion_exp-2")).toBeNull();
  });

  it("identyfikator odwiedzającego powstaje raz i jest ten sam w kolejnych zdarzeniach", async () => {
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);
    expect(window.localStorage.getItem(KLUCZ_ODWIEDZAJACEGO)).toBeNull();

    recordExperimentEvent("exp-1", "a", "exposure");
    recordExperimentEvent("exp-2", "a", "exposure");

    const zapisany = window.localStorage.getItem(KLUCZ_ODWIEDZAJACEGO);
    expect(zapisany).toBeTruthy();
    const pierwszy = await ladunekBeaconu(beacon, 0);
    const drugi = await ladunekBeaconu(beacon, 1);
    expect(pierwszy.visitorId).toBe(zapisany);
    expect(drugi.visitorId).toBe(zapisany);
  });

  it("istniejący identyfikator jest CZYTANY, a nie nadpisywany nowym", async () => {
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);
    window.localStorage.setItem(KLUCZ_ODWIEDZAJACEGO, "odwiedzajacy-stabilny");

    recordExperimentEvent("exp-1", "a", "conversion");

    // Nadpisanie identyfikatora przestawiłoby odwiedzającego do innego kubełka
    // w trakcie trwania testu - a więc pomieszałoby ekspozycje z konwersjami.
    expect(window.localStorage.getItem(KLUCZ_ODWIEDZAJACEGO)).toBe("odwiedzajacy-stabilny");
    expect((await ladunekBeaconu(beacon)).visitorId).toBe("odwiedzajacy-stabilny");
  });

  it("bez crypto.randomUUID identyfikator i tak powstaje oraz zostaje zapisany", async () => {
    // `crypto.randomUUID` nie istnieje w kontekstach niezabezpieczonych (http
    // bez TLS) i w starszych przeglądarkach - wtedy działa gałąź awaryjna
    // Math.random()+Date.now() (experiments.ts:46).
    vi.stubGlobal("crypto", { getRandomValues: () => undefined });
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);

    recordExperimentEvent("exp-1", "a", "exposure");

    const zapisany = window.localStorage.getItem(KLUCZ_ODWIEDZAJACEGO);
    expect(zapisany).toBeTruthy();
    expect(zapisany).not.toContain("undefined");
    expect((await ladunekBeaconu(beacon)).visitorId).toBe(zapisany);
  });

  it("zablokowany localStorage NIE wysyła zdarzenia i nie rzuca wyjątkiem", () => {
    // Tryb prywatny Safari i „blokuj wszystkie pliki cookie" rzucają
    // SecurityError już przy odczycie. Bez identyfikatora nie ma komu
    // przypisać zdarzenia, więc funkcja MUSI wyjść cicho (experiments.ts:153).
    podmienMagazyn("localStorage", magazynZAwaria("getItem"));
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);

    expect(() => recordExperimentEvent("exp-1", "a", "exposure")).not.toThrow();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("niedostępny sessionStorage kasuje wyłącznie dedup, a nie wysyłkę", () => {
    // Komentarz przy `catch` (experiments.ts:150) obiecuje dokładnie to:
    // „storage unavailable - still attempt the insert, just without dedup".
    podmienMagazyn("sessionStorage", magazynZAwaria("getItem"));
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);

    recordExperimentEvent("exp-1", "a", "exposure");
    recordExperimentEvent("exp-1", "a", "exposure");

    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it("bez sendBeacon zdarzenie idzie fetchem z keepalive", async () => {
    // Jedyna droga wysyłki tam, gdzie Beacon API jest wyłączone (Safari
    // z ustawieniem prywatności, rozszerzenia blokujące). `keepalive` jest
    // warunkiem dojścia zdarzenia po kliknięciu w link, czyli w chwili, w
    // której konwersja właśnie się dzieje.
    ustawBeacon(undefined);
    const fetchSpy = szpiegFetcha();
    vi.stubGlobal("fetch", fetchSpy);
    window.localStorage.setItem(KLUCZ_ODWIEDZAJACEGO, "odwiedzajacy-fetch");

    recordExperimentEvent("exp-3", "b", "conversion");
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(URL_ZDARZENIA);
    expect(init?.method).toBe("POST");
    expect(init?.keepalive).toBe(true);
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      experimentId: "exp-3",
      variant: "b",
      event: "conversion",
      visitorId: "odwiedzajacy-fetch",
      path: window.location.pathname,
    });
  });

  it("odrzucony fetch jest połknięty i nie wywraca renderu", async () => {
    ustawBeacon(undefined);
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new Error("test: sieć niedostępna");
    });
    vi.stubGlobal("fetch", fetchSpy);

    expect(() => recordExperimentEvent("exp-1", "a", "exposure")).not.toThrow();
    // Odrzucenie MUSI być obsłużone w tym samym cyklu (`.catch` w :174) -
    // inaczej Node zgłasza nieobsłużone odrzucenie i wywala cały przebieg.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("awaria konstrukcji ładunku nie psuje UX - śledzenie jest opcjonalne", () => {
    class BlobNiedostepny {
      constructor() {
        throw new Error("test: konstrukcja Blob niedostępna");
      }
    }
    vi.stubGlobal("Blob", BlobNiedostepny);
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);

    expect(() => recordExperimentEvent("exp-1", "a", "exposure")).not.toThrow();
    expect(beacon).not.toHaveBeenCalled();
  });

  // DEFEKT: ZNACZNIK DEDUPU POWSTAJE PRZED USTALENIEM, ŻE JEST CO WYSŁAĆ.
  //
  // WEJSCIE: odwiedzający z zablokowanym localStorage (tryb prywatny, „blokuj
  //   wszystkie pliki cookie"), działający sessionStorage, pierwsza ekspozycja
  //   sekcji eksperymentu.
  // CO PSUJE: `recordExperimentEvent` (src/lib/builder/experiments.ts:145-153)
  //   NAJPIERW stawia znacznik `cms_ab_exposure_<id>` w sessionStorage (:148),
  //   a DOPIERO POTEM czyta `getVisitorId()` (:152) i wychodzi, bo
  //   identyfikatora nie ma (:153). Znacznik zostaje.
  // KONSEKWENCJA: żadna kolejna próba w tej sesji nie wyśle już tego zdarzenia
  //   - warunek `if (window.sessionStorage.getItem(key)) return` (:147) uzna
  //   je za wysłane. Ekspozycja przepada na całą sesję, a ponieważ konwersja
  //   ginie tak samo, oba liczniki są zaniżone niesymetrycznie (konwersja jest
  //   rzadsza, więc traci procentowo więcej). Ta sama pułapka działa, gdy
  //   Blob albo beacon rzuci wyjątkiem (:175-177).
  // WYMAGANA POPRAWKA: znacznik dedupu ma powstawać PO ustaleniu, że zdarzenie
  //   naprawdę wyszło (albo przynajmniej po sprawdzeniu, że jest komu je
  //   przypisać) - czyli za blokiem wysyłki, a nie przed nim.
  it.fails("DEFEKT: znacznik dedupu nie może powstawać przed udaną wysyłką", () => {
    podmienMagazyn("localStorage", magazynZAwaria("getItem"));
    const beacon = szpiegBeaconu();
    ustawBeacon(beacon);

    recordExperimentEvent("exp-1", "a", "exposure");

    expect(beacon).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("cms_ab_exposure_exp-1")).toBeNull();
  });
});

describe("useExperimentAssignments", () => {
  const dwaTesty = [
    section("s1", { experimentId: "x1", variant: "a" }),
    section("s2", { experimentId: "x2", variant: "a" }),
  ];

  it("bez włączenia (kanwa buildera) przypisania zostają null", () => {
    // Redaktor pracujący na kanwie widzi WSZYSTKIE warianty naraz i nie może
    // zostać zakubełkowany - inaczej połowa jego pracy znika mu z ekranu.
    const { result } = renderHook(() => useExperimentAssignments(dwaTesty, false));
    expect(result.current).toBeNull();
  });

  it("dokument BEZ testów A/B daje null, a nie pustą mapę", () => {
    // `null` i pusta mapa znaczą co innego dla isSectionVisibleForAssignments:
    // dopiero `null` opisuje stan „jeszcze nie wiadomo".
    const { result } = renderHook(() => useExperimentAssignments([section("s1")], true));
    expect(result.current).toBeNull();
  });

  it("każdy eksperyment na stronie dostaje wariant policzony PRAWDZIWYM assignVariant", () => {
    const odwiedzajacy = odwiedzajacyDlaWariantu("x1", "b");
    window.localStorage.setItem(KLUCZ_ODWIEDZAJACEGO, odwiedzajacy);

    const { result } = renderHook(() => useExperimentAssignments(dwaTesty, true));

    expect(result.current?.size).toBe(2);
    // Oczekiwanie liczone tą samą funkcją, nie przepisaną arytmetyką haszu.
    expect(result.current?.get("x1")).toBe(assignVariant("x1", odwiedzajacy));
    expect(result.current?.get("x2")).toBe(assignVariant("x2", odwiedzajacy));
    // I dowód, że hook nie oddaje po prostu domyślnego „a" dla wszystkiego.
    expect(result.current?.get("x1")).toBe("b");
  });

  it("przerysowanie z NOWĄ tablicą sekcji o tych samych identyfikatorach nie przelicza przypisań", () => {
    window.localStorage.setItem(KLUCZ_ODWIEDZAJACEGO, "odwiedzajacy-stabilny");
    const { result, rerender } = renderHook(
      ({ sekcje }: { sekcje: SectionNode[] }) => useExperimentAssignments(sekcje, true),
      { initialProps: { sekcje: [section("s1", { experimentId: "x1", variant: "a" })] } },
    );
    const pierwsza = result.current;
    expect(pierwsza).not.toBeNull();

    // Inna referencja tablicy, ten sam zestaw identyfikatorów - kluczem efektu
    // jest `idsKey`, a nie tożsamość tablicy. Gdyby efekt biegł co render,
    // wariant migotałby przy każdej zmianie stanu strony.
    rerender({ sekcje: [section("s1-nowe", { experimentId: "x1", variant: "a" })] });

    expect(result.current).toBe(pierwsza);
  });

  it("wyłączenie po fakcie CZYŚCI przypisania do null", () => {
    window.localStorage.setItem(KLUCZ_ODWIEDZAJACEGO, "odwiedzajacy-stabilny");
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useExperimentAssignments(dwaTesty, enabled),
      { initialProps: { enabled: true } },
    );
    expect(result.current).not.toBeNull();

    rerender({ enabled: false });

    expect(result.current).toBeNull();
  });
});

describe("useExperimentsAdmin - rejestr eksperymentów", () => {
  it("gdy najemca jest jeszcze nieznany, zapytanie NIE leci do bazy", async () => {
    h.tenantId = null;
    odpowiedzRejestru({ lista: ok([wierszEksperymentu()]) });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await act(async () => {
      await Promise.resolve();
    });

    // Bez `enabled: Boolean(tenantId)` poleciałoby `tenant_id = ""`, czyli
    // błąd składni uuid w PostgREST i pusty panel z komunikatem o awarii.
    expect(db().chainsFor(TABELA)).toHaveLength(0);
    expect(result.current.items).toEqual([]);
  });

  it("lista jest ZAWĘŻONA najemcą, posortowana od najnowszej i przycięta do 200", async () => {
    odpowiedzRejestru({ lista: ok([wierszEksperymentu()]) });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const chain = lancuchZOgniwem("select");
    expect(chain.argsOf("select")).toEqual(["id, name, status, created_at, updated_at"]);
    expect(chain.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([200]);
  });

  it("klucz cache listy zawiera najemcę, więc przełączenie obszaru nie pokazuje cudzych testów", async () => {
    odpowiedzRejestru({ lista: ok([wierszEksperymentu()]) });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    expect(kluczeCache(queryClient)).toContainEqual(["builder-experiments", TENANT]);
  });

  it("mapowanie bierze DOKŁADNIE pięć pól, nadmiarowe kolumny są odrzucane", async () => {
    odpowiedzRejestru({
      lista: ok([wierszEksperymentu({ created_by: "redaktor-1", tenant_id: TENANT })]),
    });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    expect(result.current.items[0]).toEqual({
      id: "exp-1",
      name: "Nagłówek strony głównej",
      status: "running",
      created_at: "2026-09-01T10:00:00.000Z",
      updated_at: "2026-09-02T10:00:00.000Z",
    });
  });

  it("trzy statusy z enumu bazy przechodzą bez zmiany", async () => {
    odpowiedzRejestru({
      lista: ok([
        wierszEksperymentu({ id: "exp-1", status: "running" }),
        wierszEksperymentu({ id: "exp-2", status: "paused" }),
        wierszEksperymentu({ id: "exp-3", status: "completed" }),
      ]),
    });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    expect(result.current.items.map((x) => x.status)).toEqual(["running", "paused", "completed"]);
  });

  it("NIEZNANY status z bazy jest sprowadzany do 'running'", async () => {
    // Nowa wartość dopisana do enumu w migracji, a niedodana do typu, pokaże
    // ZAKOŃCZONY test jako trwający - i redakcja będzie dalej dzielić ruch.
    odpowiedzRejestru({ lista: ok([wierszEksperymentu({ status: "archived" })]) });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    expect(result.current.items[0].status).toBe("running");
  });

  it("odpowiedź BEZ wierszy (data null) daje pustą listę, a nie wyjątek na mapowaniu", async () => {
    // PostgREST oddaje `data: null` m.in. przy przerwanym połączeniu i przy
    // zapytaniu odciętym przez politykę. Bez `(data ?? [])` (experiments.ts:223)
    // `.map` poleciałby na null i cały panel zamiast listy pokazałby awarię.
    odpowiedzRejestru({ lista: ok(null) });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toEqual([]);
  });

  it("odmowa odczytu NIE udaje pustej listy - hook wchodzi w stan błędu", async () => {
    odpowiedzRejestru({ lista: fail("permission denied for table builder_experiments", "42501") });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => {
      const stan = queryClient.getQueryCache().find({ queryKey: ["builder-experiments", TENANT] });
      expect(stan?.state.status).toBe("error");
    });

    // Pusta lista przy błędzie jest w porządku TYLKO dlatego, że stan błędu
    // jest widoczny obok - inaczej panel mówiłby „nie ma żadnych testów"
    // komuś, kto po prostu nie ma uprawnień.
    expect(result.current.items).toEqual([]);
  });

  it("create wstawia nazwę i autora, po czym unieważnia OBA korzenie cache", async () => {
    odpowiedzRejestru({ lista: ok([]), wstaw: ok({ id: "exp-nowy" }) });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wynik: { id: string | null } = { id: null };
    await act(async () => {
      wynik.id = await result.current.create("Nowy test nagłówka");
    });

    expect(wynik.id).toBe("exp-nowy");
    const chain = lancuchZOgniwem("insert");
    expect(chain.argsOf("insert")?.[0]).toEqual({
      name: "Nowy test nagłówka",
      created_by: "redaktor-1",
    });
    expect(chain.argsOf("select")).toEqual(["id"]);
    expect(chain.has("single")).toBe(true);
    // Statystyki muszą polecieć razem z listą: panel pokazuje je obok siebie.
    expect(korzenieUniewaznien(invalidateSpy)).toEqual([
      "builder-experiments",
      "builder-experiment-stats",
    ]);
  });

  it("create bez sesji zapisuje autora jako null, a nie jako pusty łańcuch", async () => {
    h.session = null;
    odpowiedzRejestru({ lista: ok([]), wstaw: ok({ id: "exp-nowy" }) });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.create("Test bez zalogowanego autora");
    });

    // Kolumna `created_by` jest kluczem obcym do profili - pusty łańcuch
    // byłby niepoprawnym uuid i wywrócił cały insert.
    expect(lancuchZOgniwem("insert").argsOf("insert")?.[0]).toEqual({
      name: "Test bez zalogowanego autora",
      created_by: null,
    });
  });

  it("nieudany create zwraca null i NIE unieważnia cache", async () => {
    odpowiedzRejestru({
      lista: ok([]),
      wstaw: fail("new row violates row-level security policy", "42501"),
    });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wynik: { id: string | null } = { id: "jeszcze-nie-ustawione" };
    await act(async () => {
      wynik.id = await result.current.create("Test, który nie powstanie");
    });

    // `null` jest sygnałem dla buildera, żeby pokazać błąd zamiast oznaczać
    // sekcje wariantami nieistniejącego eksperymentu.
    expect(wynik.id).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("setStatus wysyła UPDATE po identyfikatorze i odświeża listę oraz statystyki", async () => {
    odpowiedzRejestru({ lista: ok([wierszEksperymentu()]) });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.setStatus("exp-1", "paused");
    });

    const chain = lancuchZOgniwem("update");
    expect(chain.argsOf("update")?.[0]).toEqual({ status: "paused" });
    expect(callArgs(chain, "eq")).toContainEqual(["id", "exp-1"]);
    expect(korzenieUniewaznien(invalidateSpy)).toEqual([
      "builder-experiments",
      "builder-experiment-stats",
    ]);
  });

  it("remove wysyła DELETE po identyfikatorze i odświeża listę oraz statystyki", async () => {
    odpowiedzRejestru({ lista: ok([wierszEksperymentu()]) });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.remove("exp-1");
    });

    const chain = lancuchZOgniwem("delete");
    expect(callArgs(chain, "eq")).toContainEqual(["id", "exp-1"]);
    expect(korzenieUniewaznien(invalidateSpy)).toEqual([
      "builder-experiments",
      "builder-experiment-stats",
    ]);
  });

  it("create, setStatus i remove nie zmieniają tożsamości między przerysowaniami", async () => {
    odpowiedzRejestru({ lista: ok([wierszEksperymentu()]) });

    const { result, rerender } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const pierwsze = result.current;

    rerender();

    // Panel buildera trzyma te funkcje w zależnościach efektów; niestabilna
    // referencja przerysowywałaby całą kanwę przy każdym wpisanym znaku.
    expect(result.current.create).toBe(pierwsze.create);
    expect(result.current.setStatus).toBe(pierwsze.setStatus);
    expect(result.current.remove).toBe(pierwsze.remove);
    expect(result.current).toBe(pierwsze);
  });

  // DEFEKT: ZAPIS DO REJESTRU IDZIE BEZ tenant_id.
  //
  // WEJSCIE: redaktor zalogowany w najemcy innym niż domyślny tworzy test A/B
  //   (`create("...")`) - `tenantId` jest w zasięgu funkcji (experiments.ts:209).
  // CO PSUJE: `create` (src/lib/builder/experiments.ts:238-252) wstawia tylko
  //   `{ name, created_by }`. Kolumna `tenant_id` ma DEFAULT
  //   `public.public_tenant_id()` (migracja 20260702085900:108), czyli najemcę
  //   o slugu 'nes', a polityka INSERT wymaga
  //   `tenant_id = public.current_tenant_id()` (tamże :126-128).
  // KONSEKWENCJA: dla pracownika każdego innego najemcy RLS odrzuca wstawienie,
  //   błąd jest połykany (:247), `create` oddaje `null`, a builder
  //   (useBuilderOperations.ts:263-267) pokazuje tylko „builder.ops.abCreateErr"
  //   bez powodu. W najemcy 'nes' jest odwrotnie i gorzej: eksperyment powstaje
  //   CICHO w cudzym najemcy. Łamie to regułę repo „tenant_id w każdej
  //   kwerendzie".
  // WYMAGANA POPRAWKA: `create` wysyła jawnie `tenant_id: tenantId` i odmawia
  //   startu, dopóki najemca jest nieznany.
  it.fails("DEFEKT: create MUSI wysyłać tenant_id, a nie liczyć na DEFAULT kolumny", async () => {
    odpowiedzRejestru({ lista: ok([]), wstaw: ok({ id: "exp-nowy" }) });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.create("Test w moim najemcy");
    });

    expect(lancuchZOgniwem("insert").argsOf("insert")?.[0]).toMatchObject({ tenant_id: TENANT });
  });

  // DEFEKT: MUTACJE REJESTRU NIE ZAWĘŻAJĄ PO NAJEMCY.
  //
  // WEJSCIE: `setStatus("exp-z-cudzego-najemcy", "completed")` albo
  //   `remove("exp-z-cudzego-najemcy")` - identyfikator wzięty z adresu URL
  //   albo z nieodświeżonej listy.
  // CO PSUJE: obie funkcje (src/lib/builder/experiments.ts:254-268) filtrują
  //   wyłącznie `.eq("id", id)`, choć ODCZYT w tym samym pliku (:219) zawęża
  //   po `tenant_id`. Obrony w głąb nie ma - jedyną barierą jest polityka RLS.
  // KONSEKWENCJA: identyfikator z cudzego obszaru roboczego leci do bazy bez
  //   żadnego zawężenia po stronie klienta. Dopóki RLS jest poprawne, kończy
  //   się to zerem zmienionych wierszy (i - patrz defekt niżej - fałszywym
  //   komunikatem sukcesu). Jedna luka w polityce zamienia to w cichą zmianę
  //   cudzych danych.
  // WYMAGANA POPRAWKA: `setStatus` i `remove` dokładają `.eq("tenant_id",
  //   tenantId)`, dokładnie tak jak robi to odczyt obok.
  it.fails("DEFEKT: setStatus i remove MUSZĄ zawężać zapis po tenant_id", async () => {
    odpowiedzRejestru({ lista: ok([wierszEksperymentu()]) });

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.setStatus("exp-1", "completed");
      await result.current.remove("exp-1");
    });

    const zawezenia = [
      callArgs(lancuchZOgniwem("update"), "eq"),
      callArgs(lancuchZOgniwem("delete"), "eq"),
    ];
    for (const eq of zawezenia) expect(eq).toContainEqual(["tenant_id", TENANT]);
  });

  // DEFEKT: NIEUDANY ZAPIS JEST NIEODRÓŻNIALNY OD UDANEGO.
  //
  // WEJSCIE: `remove("exp-1")`, gdy baza odrzuca DELETE (RLS 42501, konflikt
  //   klucza obcego, awaria połączenia).
  // CO PSUJE: `remove` (src/lib/builder/experiments.ts:262-268) w ogóle NIE
  //   CZYTA pola `error` z odpowiedzi i woła `invalidate()` bezwarunkowo. Ten
  //   sam wzorzec ma `setStatus` (:254-260).
  // KONSEKWENCJA: `src/routes/admin.experiments.tsx:34-35` po
  //   `await experiments.remove(...)` pokazuje `toast.success(
  //   "admin.experiments.deleted")` NIEZALEŻNIE od tego, czy baza cokolwiek
  //   usunęła - a unieważnienie cache dociąga z serwera listę, na której
  //   „usunięty" wiersz nadal jest. To ta sama klasa co „odmowa odczytu udaje
  //   pustkę", tylko po stronie zapisu: redakcja dostaje potwierdzenie
  //   operacji, której nie było. Identycznie kończy test A/B
  //   useBuilderOperations.ts:273-274 („abEnded" po nieudanym UPDATE).
  // WYMAGANA POPRAWKA: `setStatus` i `remove` czytają `error`, zgłaszają go
  //   wywołującemu (rzut albo wynik logiczny) i NIE unieważniają cache, gdy
  //   zapis się nie powiódł.
  it.fails("DEFEKT: nieudany remove NIE MOŻE unieważniać cache ani udawać sukcesu", async () => {
    odpowiedzRejestru({
      lista: ok([wierszEksperymentu()]),
      zapis: fail("permission denied for table builder_experiments", "42501"),
    });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.remove("exp-1");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useExperimentStats - liczniki lejka", () => {
  it("bez identyfikatora eksperymentu nie leci ANI JEDNO zapytanie o zdarzenia", async () => {
    odpowiedzLicznikow({ ea: 1, eb: 1, ca: 1, cb: 1 });

    const { result } = renderHookWithQueryClient(() => useExperimentStats(null));
    await act(async () => {
      await Promise.resolve();
    });

    // Panel bez wybranego testu nie ma czego liczyć - cztery puste zapytania
    // COUNT po całej tabeli zdarzeń byłyby najdroższym „niczym" w aplikacji.
    expect(db().chainsFor(TABELA_ZDARZEN)).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });

  it("liczą się cztery osobne kubełki i żaden nie ląduje w cudzej szufladce", async () => {
    odpowiedzLicznikow({ ea: 100, eb: 200, ca: 10, cb: 40 });

    const { result } = renderHookWithQueryClient(() => useExperimentStats("exp-1"));
    await waitFor(() => expect(result.current.data).toBeDefined());

    // Zamiana a/b albo exposure/conversion przestawiłaby publiczną stronę na
    // GORSZY wariant - i nie widać jej nigdzie poza tą asercją.
    expect(result.current.data).toEqual({
      exposures: { a: 100, b: 200 },
      conversions: { a: 10, b: 40 },
    });
    expect(db().chainsFor(TABELA_ZDARZEN)).toHaveLength(4);
  });

  it("zapytanie jest LICZĄCE, nie pobierające wierszy, i zawęża trzema kolumnami", async () => {
    odpowiedzLicznikow({ ea: 1, eb: 2, ca: 3, cb: 4 });

    const { result } = renderHookWithQueryClient(() => useExperimentStats("exp-1"));
    await waitFor(() => expect(result.current.data).toBeDefined());

    for (const chain of db().chainsFor(TABELA_ZDARZEN)) {
      // Pobranie wierszy zamiast licznika ściągnęłoby przy dużym teście setki
      // tysięcy rekordów do przeglądarki redaktora.
      expect(chain.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
      const eq = callArgs(chain, "eq");
      expect(eq).toHaveLength(3);
      expect(eq).toContainEqual(["experiment_id", "exp-1"]);
    }
  });

  it("brak licznika w odpowiedzi daje 0, a nie undefined", async () => {
    // `count: null` oddaje PostgREST m.in. wtedy, gdy zapytanie zostało
    // przycięte. Bez `count ?? 0` (experiments.ts:293) zScore dostałby
    // undefined i oddał NaN, czyli werdykt „NaN" w panelu.
    db().setResponse(TABELA_ZDARZEN, () => ({ data: null, error: null, count: null }));

    const { result } = renderHookWithQueryClient(() => useExperimentStats("exp-1"));
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual({
      exposures: { a: 0, b: 0 },
      conversions: { a: 0, b: 0 },
    });
  });

  it("wynik da się podać wprost do zScore i conversionRate", async () => {
    odpowiedzLicznikow({ ea: 1000, eb: 1000, ca: 50, cb: 150 });

    const { result } = renderHookWithQueryClient(() => useExperimentStats("exp-1"));
    await waitFor(() => expect(result.current.data).toBeDefined());

    const stats = result.current.data;
    if (!stats) throw new Error("test: statystyki nie dojechały");
    // Kontrakt ExperimentStats (:182) musi pasować do zScore (:195) BEZ
    // przepakowywania po drodze - to jedyne miejsce, gdzie oba się spotykają.
    expect(conversionRate(stats.exposures.b, stats.conversions.b)).toBeCloseTo(0.15);
    expect(zScore(stats)).toBeGreaterThan(1.96);
  });

  // DEFEKT: KLUCZ CACHE STATYSTYK NIE ROZRÓŻNIA NAJEMCY.
  //
  // WEJSCIE: redaktor pracujący w dwóch obszarach roboczych przełącza się
  //   między nimi, mając otwarty panel wyników tego samego identyfikatora.
  // CO PSUJE: `useExperimentStats` (src/lib/builder/experiments.ts:298) używa
  //   klucza `["builder-experiment-stats", experimentId ?? ""]`, podczas gdy
  //   lista tuż obok (:213) ma najemcę w kluczu. `countEvents` (:282-294) też
  //   nie zawęża zapytania po `tenant_id` - izolację trzyma wyłącznie polityka
  //   SELECT (migracja 20260702085900:167-174).
  // KONSEKWENCJA: niespójność wewnątrz jednego pliku. Dopóki RLS działa,
  //   drugi najemca dostanie z bazy zera - ale zobaczy je dopiero po
  //   wygaśnięciu `staleTime`, a przez pierwsze 30 sekund patrzy na wpis cache
  //   policzony w POPRZEDNIM obszarze roboczym i podejmuje po nim decyzję,
  //   który wariant zostawić.
  // WYMAGANA POPRAWKA: klucz zawiera najemcę, tak jak `["builder-experiments",
  //   tenantId]`, a `countEvents` zawęża zapytanie po `tenant_id`.
  it.fails("DEFEKT: klucz cache statystyk musi zawierać najemcę", async () => {
    odpowiedzLicznikow({ ea: 1, eb: 1, ca: 0, cb: 0 });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentStats("exp-1"));
    await waitFor(() => expect(result.current.data).toBeDefined());

    const klucz = kluczeCache(queryClient).find(
      (k) => Array.isArray(k) && k[0] === "builder-experiment-stats",
    );
    expect(klucz).toContain(TENANT);
  });
});
