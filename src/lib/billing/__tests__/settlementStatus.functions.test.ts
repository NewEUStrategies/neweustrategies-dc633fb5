// Server fn STANÓW ROZLICZEŃ I ZWROTÓW (`settlementStatus.functions.ts`) -
// 0% pokrycia do 18.10.2026.
//
// PO CO TEN PLIK ISTNIEJE. To jest ekran, na którym administrator najemcy
// sprawdza, co stało się z pieniędzmi: które zamówienie jest opłacone, które
// zwrócone w całości albo w części i na jakim etapie jest automatyczny zwrot.
// Odczyt idzie spod `service_role`, czyli Z POMINIĘCIEM RLS - jedynym zakresem
// najemcy jest filtr w zapytaniu. Cztery reguły, których pilnuje ten plik:
//
//   1. NAJEMCA Z SESJI. Zakres pochodzi z `assertAdmin` (profil wołającego),
//      nigdy z ładunku - i filtruje OBA zapytania (zamówienia i zlecenia).
//   2. FILTR STANU W SQL, PRZED OKNEM 500 WIERSZY. Filtr nakładany dopiero
//      w pamięci gubił każde zamówienie w wybranym stanie, które leżało za
//      500 najnowszymi zamówieniami WSZYSTKICH stanów.
//   3. ZLECENIA ZWROTU CZYTANE PORCJAMI. Lista `.in(...)` jedzie w adresie
//      żądania GET; 500 identyfikatorów to adres ~19,7 tys. znaków, ponad
//      bufor bramki przed PostgREST-em - raport padał w całości.
//   4. STAN ROZLICZENIA wyprowadzony jedną regułą (`deriveSettlementStatus`):
//      częściowy zwrot opłaconego zamówienia jest osobnym stanem.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness nie uruchamia middleware,
// więc `requireSupabaseAuth` przybijamy STRUKTURALNIE, a odmowę roli tam,
// gdzie da się ją wywołać - przez `assertAdmin`.
//
// Atrapy stoją na GRANICACH: bramka roli (`diagnostics.server`, dotyka bazy)
// i klient serwisowy. Klient serwisowy to tabela w pamięci, która WYKONUJE
// filtry, sortowanie i limit z łańcucha - test widzi wynik zapytania, a nie
// tylko jego kształt. Schemat zod i wyprowadzenie stanu biegną PRAWDZIWE.
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { Constants } from "@/integrations/supabase/types";
import {
  deriveSettlementStatus,
  SETTLEMENT_STATUSES,
  type SettlementRow,
  type SettlementStatus,
} from "@/lib/billing/settlementStatus";
import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabase/chain";

const h = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  db: { current: null as { from: (table: string) => unknown } | null },
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/billing/diagnostics.server", () => ({ assertAdmin: h.assertAdmin }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    rpc: () => {
      throw new Error("test: raport stanów rozliczeń nie woła RPC");
    },
  },
}));

import {
  getSettlementReport,
  type SettlementReport,
} from "@/lib/billing/settlementStatus.functions";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
/** Najemca wołającego - oddaje go bramka, nie ładunek. */
const NAJEMCA = "77777777-7777-4777-8777-777777777777";
const OBCY_NAJEMCA = "99999999-9999-4999-8999-999999999999";
const KLIENT_UZYTKOWNIKA = { marker: "klient-z-kontekstu" };

function kontekst() {
  return { supabase: KLIENT_UZYTKOWNIKA, userId: ADMIN_ID };
}

// --- tabela w pamięci --------------------------------------------------------
//
// Tyle PostgREST-a, ile czyta ten raport: `select` z aliasem i ścieżką JSON
// (`alias:kolumna->klucz`), filtry `eq`/`gt`/`gte`/`lt`/`lte`/`in`, `or(...)`
// z zagnieżdżonym `and(...)`, `order` i `limit`. Nieznane ogniwo RZUCA - cicho
// pominięty filtr dałby test, który przechodzi z niewłaściwego powodu.

type Wiersz = Record<string, unknown>;

/** Podział po przecinkach najwyższego poziomu (nawiasy `and(...)` zostają w całości). */
function rozbij(wyrazenie: string): string[] {
  const out: string[] = [];
  let glebokosc = 0;
  let biezacy = "";
  for (const znak of wyrazenie) {
    if (znak === "(") glebokosc += 1;
    if (znak === ")") glebokosc -= 1;
    if (znak === "," && glebokosc === 0) {
      out.push(biezacy.trim());
      biezacy = "";
    } else biezacy += znak;
  }
  out.push(biezacy.trim());
  return out.filter((p) => p.length > 0);
}

/** Porównanie jak w SQL: NULL nie spełnia żadnego warunku porównania. */
function porownaj(op: string, aktualna: unknown, oczekiwana: unknown): boolean {
  if (aktualna === null || aktualna === undefined) return false;
  const roznica =
    typeof aktualna === "number"
      ? aktualna - Number(oczekiwana)
      : String(aktualna) < String(oczekiwana)
        ? -1
        : String(aktualna) > String(oczekiwana)
          ? 1
          : 0;
  switch (op) {
    case "eq":
      return roznica === 0;
    case "gt":
      return roznica > 0;
    case "gte":
      return roznica >= 0;
    case "lt":
      return roznica < 0;
    case "lte":
      return roznica <= 0;
    default:
      throw new Error(`tabela w pamięci: nieobsłużony operator "${op}"`);
  }
}

/** Jeden człon `or(...)`: `kolumna.op.wartość` albo grupa `and(...)`. */
function spelniaCzlon(wiersz: Wiersz, czlon: string): boolean {
  if (czlon.startsWith("and(") && czlon.endsWith(")")) {
    return rozbij(czlon.slice(4, -1)).every((c) => spelniaCzlon(wiersz, c));
  }
  const [kolumna, op, ...reszta] = czlon.split(".");
  return porownaj(op, wiersz[kolumna], reszta.join("."));
}

/** `select` z aliasem i ścieżką JSON - to, co PostgREST oddaje w wierszu. */
function rzutuj(wiersz: Wiersz, select: string): Wiersz {
  const out: Wiersz = {};
  for (const pozycja of rozbij(select)) {
    const [alias, wyrazenie] = pozycja.includes(":")
      ? (pozycja.split(":") as [string, string])
      : [pozycja, pozycja];
    const [kolumna, klucz] = wyrazenie.split("->");
    const wartosc = wiersz[kolumna];
    if (klucz === undefined) out[alias] = wartosc;
    else
      out[alias] =
        wartosc && typeof wartosc === "object" && !Array.isArray(wartosc)
          ? ((wartosc as Wiersz)[klucz] ?? null)
          : null;
  }
  return out;
}

function tabelaWPamieci(wiersze: readonly Wiersz[]): (chain: RecordedChain) => SupabaseResult {
  return (chain) => {
    let wynik = [...wiersze];
    let select = "*";
    for (const { method, args } of chain.calls) {
      switch (method) {
        case "select":
          select = String(args[0]);
          break;
        case "eq":
        case "gt":
        case "gte":
        case "lt":
        case "lte":
          wynik = wynik.filter((w) => porownaj(method, w[String(args[0])], args[1]));
          break;
        case "in":
          wynik = wynik.filter((w) => (args[1] as unknown[]).includes(w[String(args[0])]));
          break;
        case "or":
          wynik = wynik.filter((w) => rozbij(String(args[0])).some((c) => spelniaCzlon(w, c)));
          break;
        case "order": {
          const kolumna = String(args[0]);
          const rosnaco = (args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
          wynik.sort((a, b) => {
            const r = String(a[kolumna]) < String(b[kolumna]) ? -1 : 1;
            return rosnaco ? r : -r;
          });
          break;
        }
        case "limit":
          wynik = wynik.slice(0, Number(args[0]));
          break;
        default:
          throw new Error(`tabela w pamięci: nieobsłużone ogniwo .${method}()`);
      }
    }
    return ok(select === "*" ? wynik : wynik.map((w) => rzutuj(w, select)));
  };
}

// --- dane --------------------------------------------------------------------

/** Chwila zamówienia `n` minut przed punktem odniesienia - im większe n, tym starsze. */
function chwila(minutPrzed: number): string {
  return new Date(Date.UTC(2026, 8, 30, 12, 0, 0) - minutPrzed * 60_000).toISOString();
}

let sekwencja = 0;
function zamowienie(nadpisz: Wiersz = {}): Wiersz {
  sekwencja += 1;
  const nr = String(sekwencja).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${nr}`,
    tenant_id: NAJEMCA,
    created_at: chwila(sekwencja),
    kind: "one_time",
    status: "paid",
    amount_cents: 4900,
    refunded_amount_cents: 0,
    currency: "PLN",
    environment: "live",
    metadata: {},
    ...nadpisz,
  };
}

function zlecenie(paymentOrderId: string | null, nadpisz: Wiersz = {}): Wiersz {
  return {
    payment_order_id: paymentOrderId,
    tenant_id: NAJEMCA,
    state: "pending",
    last_error: null,
    ...nadpisz,
  };
}

let db: SupabaseFromStub;

function baza(zamowienia: readonly Wiersz[], zlecenia: readonly Wiersz[] = []): void {
  db.setResponse("payment_orders", tabelaWPamieci(zamowienia));
  db.setResponse("event_registration_refund_jobs", tabelaWPamieci(zlecenia));
}

interface Wejscie {
  status?: string;
  fromIso?: string | null;
  toIso?: string | null;
}

async function raport(wejscie: Wejscie = {}): Promise<SettlementReport> {
  return callServerFn<SettlementReport>(getSettlementReport, {
    data: { status: "all", fromIso: null, toIso: null, ...wejscie },
    context: kontekst(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sekwencja = 0;
  db = supabaseFromStub();
  h.db.current = db;
  h.assertAdmin.mockResolvedValue({ tenantId: NAJEMCA });
});

describe("obudowa - bramka i metoda", () => {
  it("deklaruje bramkę uwierzytelnienia", () => {
    // Dowód STRUKTURALNY: harness nie wykonuje middleware. Bez tej deklaracji
    // kwoty i stany zwrotów najemcy byłyby odczytywalne bez sesji.
    expect(serverFnMiddlewareNames(getSettlementReport)).toEqual(["requireSupabaseAuth"]);
  });

  it("idzie metodą POST - zakres dat nie ląduje w adresie", () => {
    expect(asServerFn(getSettlementReport).method).toBe("POST");
  });
});

describe("walidator", () => {
  const poprawne = { status: "all", fromIso: null, toIso: null };

  it("każdy stan rozliczenia i „all” są wybieralne, a pisownia „cancelled” odpada", () => {
    for (const status of ["all", ...SETTLEMENT_STATUSES]) {
      expect(validateServerFnInput<Wejscie>(getSettlementReport, { ...poprawne, status })).toEqual({
        ...poprawne,
        status,
      });
    }
    for (const zle of ["cancelled", "PAID", "", "done", null]) {
      expect(() =>
        validateServerFnInput(getSettlementReport, { ...poprawne, status: zle }),
      ).toThrow(ZodError);
    }
  });

  it("każdy status enuma `order_status` ma swój stan rozliczenia", () => {
    // `deriveSettlementStatus` oddaje status bazy bez zmian (poza zwrotem na
    // opłaconym), więc status spoza listy stanów byłby niewybieralny w filtrze.
    for (const status of Constants.public.Enums.order_status) {
      expect(SETTLEMENT_STATUSES).toContain(status);
    }
  });

  it("granice zakresu to pełne chwile ISO albo null - sama data jest odrzucana", () => {
    // Klient zamienia LOKALNE dni na chwile (`dateRangeToIso`). Sama data
    // przyjęta przez serwer byłaby północą UTC - przesunięciem o godzinę-dwie.
    const iso = "2026-09-30T22:00:00.000Z";
    expect(
      validateServerFnInput<Wejscie>(getSettlementReport, {
        ...poprawne,
        fromIso: iso,
        toIso: iso,
      }),
    ).toEqual({ ...poprawne, fromIso: iso, toIso: iso });
    for (const zle of ["2026-10-01", "jutro", "", 1_727_740_800_000]) {
      expect(() =>
        validateServerFnInput(getSettlementReport, { ...poprawne, fromIso: zle }),
      ).toThrow(ZodError);
      expect(() => validateServerFnInput(getSettlementReport, { ...poprawne, toIso: zle })).toThrow(
        ZodError,
      );
    }
  });

  it("pola są obowiązkowe (null to jawny brak granicy), a obcy najemca z ładunku jest odcinany", () => {
    expect(() => validateServerFnInput(getSettlementReport, { status: "all" })).toThrow(ZodError);
    expect(() => validateServerFnInput(getSettlementReport, undefined)).toThrow(ZodError);
    expect(
      validateServerFnInput(getSettlementReport, { ...poprawne, tenantId: OBCY_NAJEMCA }),
    ).toEqual(poprawne);
  });
});

describe("handler - najemca z sesji", () => {
  it("bramka dostaje klienta i użytkownika z kontekstu, a oba zapytania filtrują po JEJ najemcy", async () => {
    const moje = zamowienie();
    const cudze = zamowienie({ tenant_id: OBCY_NAJEMCA });
    baza(
      [moje, cudze],
      [
        zlecenie(String(moje.id), { state: "completed" }),
        // Ten sam identyfikator zamówienia u obcego najemcy (uszkodzone dane):
        // filtr najemcy na zleceniach nie może go dokleić do mojego wiersza.
        zlecenie(String(moje.id), { tenant_id: OBCY_NAJEMCA, state: "failed", last_error: "x" }),
      ],
    );

    const wynik = await raport();

    expect(h.assertAdmin).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, ADMIN_ID);
    expect(wynik.rows.map((r) => r.id)).toEqual([moje.id]);
    expect(wynik.rows[0]).toMatchObject({ refundJobState: "completed", refundJobError: null });
    expect(db.lastChain("payment_orders")?.argsOf("eq")).toEqual(["tenant_id", NAJEMCA]);
    for (const chain of db.chainsFor("event_registration_refund_jobs")) {
      expect(chain.argsOf("eq")).toEqual(["tenant_id", NAJEMCA]);
    }
  });

  it("odmowa bramki kończy wywołanie, zanim padnie jakiekolwiek zapytanie", async () => {
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));
    baza([zamowienie()]);

    await expect(raport()).rejects.toThrow("forbidden");
    expect(db.chains).toHaveLength(0);
  });
});

describe("handler - zakres dat i okno", () => {
  it("granice idą do SQL: od - włącznie, do - wyłącznie", async () => {
    const przed = zamowienie({ created_at: "2026-09-30T21:59:59.999Z" });
    const pierwsze = zamowienie({ created_at: "2026-09-30T22:00:00.000Z" });
    const ostatnie = zamowienie({ created_at: "2026-10-31T22:59:59.999Z" });
    const po = zamowienie({ created_at: "2026-10-31T23:00:00.000Z" });
    baza([przed, pierwsze, ostatnie, po]);

    const wynik = await raport({
      fromIso: "2026-09-30T22:00:00.000Z",
      toIso: "2026-10-31T23:00:00.000Z",
    });

    expect(wynik.rows.map((r) => r.id)).toEqual([ostatnie.id, pierwsze.id]);
  });

  it("bez granic zapytanie nie ma filtra daty, a wiersze idą od najnowszego", async () => {
    const starsze = zamowienie({ created_at: "2026-01-01T10:00:00.000Z" });
    const nowsze = zamowienie({ created_at: "2026-09-01T10:00:00.000Z" });
    baza([starsze, nowsze]);

    const wynik = await raport();

    expect(wynik.rows.map((r) => r.id)).toEqual([nowsze.id, starsze.id]);
    const chain = db.lastChain("payment_orders");
    expect(chain?.has("gte")).toBe(false);
    expect(chain?.has("lt")).toBe(false);
  });

  it("501 kandydatów: 500 najnowszych i flaga obcięcia; 500 kandydatów: bez flagi", async () => {
    const zamowienia = Array.from({ length: 501 }, () => zamowienie());
    baza(zamowienia);

    const obciety = await raport();
    expect(obciety.truncated).toBe(true);
    expect(obciety.rows).toHaveLength(500);
    expect(obciety.rows.at(-1)?.id).toBe(zamowienia[499].id);

    baza(zamowienia.slice(0, 500));
    const pelny = await raport();
    expect(pelny.truncated).toBe(false);
    expect(pelny.rows).toHaveLength(500);
  });
});

describe("handler - filtr stanu przed oknem 500 wierszy", () => {
  it("zwrócone zamówienia starsze niż 500 najnowszych opłaconych są w wyniku", async () => {
    // Scenariusz z życia: najemca ma setki zwykłych sprzedaży, a księgowość
    // pyta o zwroty bez zakresu dat. Filtr nakładany w pamięci widział tylko
    // 500 najnowszych zamówień (same opłacone) i oddawał „brak rozliczeń".
    const swieze = Array.from({ length: 600 }, () => zamowienie());
    const zwrocone = [
      zamowienie({ status: "refunded", refunded_amount_cents: 4900 }),
      // Pełny zwrot zapisany na opłaconym zamówieniu - też „zwrócone".
      zamowienie({ status: "paid", refunded_amount_cents: 4900 }),
    ];
    baza([...swieze, ...zwrocone]);

    const wynik = await raport({ status: "refunded" });

    expect(wynik.rows.map((r) => r.id)).toEqual(zwrocone.map((z) => z.id));
    expect(wynik.rows.every((r) => r.status === "refunded")).toBe(true);
    expect(wynik.truncated).toBe(false);
  });

  it("dla KAŻDEGO stanu wynik to dokładnie zamówienia, którym reguła nadaje ten stan", async () => {
    // Zawężenie w SQL nie może zgubić wiersza ani dołożyć cudzego: stany
    // zwrotu zależą od porównania kwot, którego PostgREST nie wyrazi, więc SQL
    // bierze kandydatów, a podział robi ta sama reguła, która nadaje etykietę.
    const zamowienia = [
      ...Constants.public.Enums.order_status.map((status) => zamowienie({ status })),
      zamowienie({ status: "paid", refunded_amount_cents: 1000 }),
      zamowienie({ status: "paid", refunded_amount_cents: 4900 }),
      zamowienie({ status: "paid", refunded_amount_cents: 6000 }),
      zamowienie({ status: "paid", amount_cents: 0, refunded_amount_cents: 100 }),
      zamowienie({ status: "refunded", refunded_amount_cents: 2000 }),
      zamowienie({ status: "pending", refunded_amount_cents: 500 }),
      zamowienie({ status: "failed", refunded_amount_cents: 500 }),
    ];
    baza(zamowienia);

    for (const stan of SETTLEMENT_STATUSES) {
      const oczekiwane = zamowienia
        .filter(
          (z) =>
            deriveSettlementStatus(
              z.status as (typeof Constants.public.Enums.order_status)[number],
              Number(z.amount_cents),
              Number(z.refunded_amount_cents),
            ) === stan,
        )
        .map((z) => z.id);
      const wynik = await raport({ status: stan });
      expect(
        wynik.rows.map((r) => r.id),
        stan,
      ).toEqual(oczekiwane);
      expect(oczekiwane.length, `${stan}: zbiór danych bez przypadku`).toBeGreaterThan(0);
    }
  });

  it("stany wprost z bazy filtrują jednym `eq` na statusie", async () => {
    baza([zamowienie({ status: "failed" })]);

    await raport({ status: "failed" });

    expect(db.lastChain("payment_orders")?.calls.filter((c) => c.method === "eq")).toEqual([
      { method: "eq", args: ["tenant_id", NAJEMCA] },
      { method: "eq", args: ["status", "failed"] },
    ]);
  });
});

describe("handler - zlecenia zwrotu", () => {
  it("bez zamówień nie ma drugiego zapytania", async () => {
    baza([]);

    const wynik = await raport();

    expect(wynik).toEqual({ rows: [], truncated: false });
    expect(db.chainsFor("event_registration_refund_jobs")).toHaveLength(0);
  });

  it("500 zamówień: zlecenia czytane porcjami, z których każda mieści się w adresie żądania", async () => {
    // `.in(...)` jedzie w adresie GET. Długość liczy PRAWDZIWY postgrest-js
    // (bez sieci); bramka przed PostgREST-em odcina wiersz żądania powyżej
    // 8 KB odpowiedzią 414 - wcześniej jedna lista 500 identyfikatorów
    // (~19,7 tys. znaków) wywracała cały raport.
    const zamowienia = Array.from({ length: 500 }, () => zamowienie());
    const zIndeksu = (i: number) => String(zamowienia[i].id);
    baza(zamowienia, [
      zlecenie(zIndeksu(0), { state: "completed" }),
      zlecenie(zIndeksu(150), { state: "needs_review" }),
      zlecenie(zIndeksu(499), { state: "failed", last_error: "card_declined" }),
    ]);

    const wynik = await raport();

    const porcje = db
      .chainsFor("event_registration_refund_jobs")
      .map((c) => c.argsOf("in")?.[1] as string[]);
    // Prawdziwy klient z podmienionym `fetch` (granica sieci): ten sam
    // adres, który poszedłby do bramki, bez wychodzenia z procesu.
    const adresy: string[] = [];
    const klient = createClient("https://abcdefghijklmnopqrst.supabase.co", "klucz", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          adresy.push(String(input));
          return new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    });
    for (const porcja of porcje) {
      await klient
        .from("event_registration_refund_jobs")
        .select("payment_order_id, state, last_error")
        .eq("tenant_id", NAJEMCA)
        .in("payment_order_id", porcja);
    }
    expect(adresy).toHaveLength(porcje.length);
    for (const adres of adresy) expect(adres.length).toBeLessThan(8000);
    expect(porcje.flat().sort()).toEqual(zamowienia.map((z) => z.id).sort());

    const stany = new Map(wynik.rows.map((r) => [r.id, [r.refundJobState, r.refundJobError]]));
    expect(stany.get(zIndeksu(0))).toEqual(["completed", null]);
    expect(stany.get(zIndeksu(150))).toEqual(["needs_review", null]);
    expect(stany.get(zIndeksu(499))).toEqual(["failed", "card_declined"]);
    expect(stany.get(zIndeksu(1))).toEqual([null, null]);
  });

  it("błąd odczytu zamówień i błąd odczytu zleceń są błędem wywołania, nie pustą listą", async () => {
    db.setResponse("payment_orders", fail("permission denied for table payment_orders"));
    await expect(raport()).rejects.toThrow("permission denied for table payment_orders");

    db.setResponse("payment_orders", tabelaWPamieci([zamowienie()]));
    db.setResponse("event_registration_refund_jobs", fail("statement timeout"));
    await expect(raport()).rejects.toThrow("statement timeout");
  });
});

describe("handler - wiersz raportu", () => {
  it("niesie kwoty, walutę, środowisko, stan i zlecenie - bez całych metadanych zamówienia", async () => {
    const czesciowy = zamowienie({
      kind: "subscription",
      amount_cents: 12000,
      refunded_amount_cents: 2000,
      currency: "EUR",
      environment: "sandbox",
      metadata: { needs_manual_review: true, receipt_email: "kupujacy@example.test" },
    });
    baza([czesciowy], [zlecenie(String(czesciowy.id), { state: "submitted" })]);

    const [wiersz] = (await raport()).rows;

    expect(wiersz).toEqual({
      id: String(czesciowy.id),
      createdAt: String(czesciowy.created_at),
      kind: "subscription",
      status: "partially_refunded",
      amountCents: 12000,
      refundedCents: 2000,
      currency: "EUR",
      environment: "sandbox",
      refundJobState: "submitted",
      refundJobError: null,
      needsReview: true,
    } satisfies SettlementRow);
    // Metadane zamówienia (adres paragonu, dane kasy) nie są potrzebne do
    // znacznika - zapytanie bierze z nich jeden klucz.
    expect(db.lastChain("payment_orders")?.argsOf("select")?.[0]).not.toMatch(/metadata(,|$)/);
  });

  it("znacznik „do sprawdzenia” tylko dla logicznego `true` w metadanych", async () => {
    const zamowienia = [
      zamowienie({ metadata: { needs_manual_review: true } }),
      zamowienie({ metadata: { needs_manual_review: "true" } }),
      zamowienie({ metadata: { needs_manual_review: false } }),
      zamowienie({ metadata: {} }),
      zamowienie({ metadata: ["needs_manual_review"] }),
    ];
    baza(zamowienia);

    const wynik = await raport();

    expect(wynik.rows.map((r) => r.needsReview)).toEqual([true, false, false, false, false]);
  });

  it("stan wyprowadzony per wiersz: opłacone, zwrot częściowy, zwrot całkowity", async () => {
    const stany: Array<[Wiersz, SettlementStatus]> = [
      [zamowienie({ status: "paid", refunded_amount_cents: 0 }), "paid"],
      [zamowienie({ status: "paid", refunded_amount_cents: 100 }), "partially_refunded"],
      [zamowienie({ status: "paid", refunded_amount_cents: 4900 }), "refunded"],
      [zamowienie({ status: "canceled" }), "canceled"],
    ];
    baza(stany.map(([z]) => z));

    const wynik = await raport();

    expect(wynik.rows.map((r) => r.status)).toEqual(stany.map(([, s]) => s));
  });
});
