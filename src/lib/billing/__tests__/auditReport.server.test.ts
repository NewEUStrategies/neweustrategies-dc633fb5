// AUDYT ROZLICZEŃ - MATERIAŁ DOWODOWY I EKSPORT KSIĘGOWY.
//
// PO CO TEN PLIK. `audit.server.test.ts` dowodzi jednej reguły zapisu CSV
// (cytowanie przecinka). Reszta modułu - czyli to, CO w ogóle wchodzi do
// materiału dowodowego i JAK liczą się sumy - nie była dowodzona wcale, mimo
// że wynik trafia do arkusza księgowego POZA systemem i tam już nikt go nie
// zweryfikuje. Trzy rzeczy mogą tu zaboleć najbardziej: pominięta operacja
// zmieniająca pieniądze, suma przychodu doliczająca kwoty zwrócone i wyniesienie
// danych osobowych kupującego do pliku, który krąży mailem.
//
// GRANICE ATRAPOWANE: klient service_role oraz rozwiązanie najemcy z hosta
// żądania. To drugie jest granicą tego samego rodzaju co pierwsze - wejście
// spoza modułu, którego w teście nie ma (katalog domen chciałby pójść do bazy).
// Zapis CSV (`@/lib/csv/formatCsv`) i generator XLSX zostają PRAWDZIWE - to one
// odpowiadają za plik, który dostaje księgowość.
//
// CZAS: zegar jest zamrożony, bo `sinceIso` i `generatedAt` liczą się od
// „teraz", a nazwa pliku eksportu zawiera dzień. Bez zamrożenia test albo
// pęka o północy, albo nie może niczego stwierdzić.
//
// RODO: żadnych realnych danych osobowych; osobny przypadek dowodzi, że adres
// kupującego zapisany w metadanych zamówienia NIE pojawia się ani w raporcie,
// ani w wyeksportowanym pliku.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/integrations/supabase/types";
import {
  auditToCsv,
  buildAuditExport,
  buildAuditReport,
  type AuditOrderRow,
  type AuditQuery,
  type AuditReport,
} from "@/lib/billing/audit.server";
import {
  BILLING_IDS,
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";

const db = vi.hoisted(() => {
  let active: { from: (table: string) => unknown } | null = null;
  return {
    use(next: { from: (table: string) => unknown }): void {
      active = next;
    },
    from(table: string): unknown {
      if (!active) throw new Error(`test: brak zaplanowanej atrapy Supabase dla "${table}"`);
      return active.from(table);
    },
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

// Najemca żądania. `null` odwzorowuje sytuację „nie wiadomo, czyje to dane"
// (host spoza katalogu domen, praca poza kontekstem żądania) - audyt musi się
// wtedy zamknąć, a nie oddać wszystko.
const tenant = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve("panel.example.com"),
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: () => Promise.resolve(tenant.current),
}));

// --- rzuty kolumn (z wygenerowanych definicji, rozluźnione o `null`) --------
type Nullable<
  T extends keyof Database["public"]["Tables"],
  K extends keyof Database["public"]["Tables"][T]["Row"],
> = { [P in K]: Database["public"]["Tables"][T]["Row"][P] | null };

type OrderProjection = Nullable<
  "payment_orders",
  | "id"
  | "created_at"
  | "updated_at"
  | "status"
  | "kind"
  | "amount_cents"
  | "refunded_amount_cents"
  | "currency"
  | "entity_type"
  | "entity_id"
  | "metadata"
  | "provider_session_id"
  | "provider_payment_intent_id"
  | "provider_customer_id"
  | "provider_charge_id"
>;

type HookProjection = Nullable<
  "payment_webhook_events",
  | "id"
  | "event_id"
  | "event_type"
  | "status"
  | "occurred_at"
  | "processed_at"
  | "duration_ms"
  | "retry_count"
  | "error"
>;

const NOW = new Date("2026-08-18T10:00:00.000Z");

function orderRow(over: Partial<OrderProjection> = {}): OrderProjection {
  return {
    id: "ord-1",
    created_at: "2026-08-17T09:00:00.000Z",
    updated_at: "2026-08-17T09:05:00.000Z",
    status: "paid",
    kind: "subscription",
    amount_cents: 4900,
    refunded_amount_cents: 0,
    currency: "PLN",
    entity_type: null,
    entity_id: null,
    metadata: {},
    provider_session_id: "cs_test_1",
    provider_payment_intent_id: "pi_test_1",
    provider_customer_id: "cus_test_1",
    provider_charge_id: "ch_test_1",
    ...over,
  };
}

/**
 * Wiersz zamówienia ze statusem w kształcie, jaki dopuszcza KONTRAKT MODUŁU:
 * `AuditOrderRow.status` to zwykły `string`, a nie enum bazy. Fabryka
 * `orderRow` celowo trzyma się enuma (to ona pilnuje, żeby zwykłe przypadki
 * nie wymyślały statusów), a to rozluźnienie istnieje wyłącznie dla jednego,
 * opisanego niżej ramienia `partially_refunded`. Rzutowanie zamiotłoby tę
 * różnicę pod dywan - nazwany typ ją POKAZUJE.
 */
type RawStatusOrderRow = Omit<OrderProjection, "status"> & {
  status: AuditOrderRow["status"] | null;
};

function orderRowWithRawStatus(
  status: AuditOrderRow["status"],
  over: Partial<OrderProjection> = {},
): RawStatusOrderRow {
  return { ...orderRow(over), status };
}

function hookRow(over: Partial<HookProjection> = {}): HookProjection {
  return {
    id: "evt-row-1",
    event_id: "evt_1",
    event_type: "checkout.session.completed",
    status: "processed",
    occurred_at: "2026-08-17T09:00:01.000Z",
    processed_at: "2026-08-17T09:00:02.000Z",
    duration_ms: 120,
    retry_count: 0,
    error: null,
    ...over,
  };
}

interface Scenario {
  orders?: RawStatusOrderRow[] | null;
  hooks?: HookProjection[] | null;
  ordersError?: string;
  hooksError?: string;
}

function givenDb(scenario: Scenario = {}): SupabaseFromStub {
  const stub = supabaseFromStub();
  stub.setResponse(
    "payment_orders",
    scenario.ordersError
      ? fail(scenario.ordersError)
      : ok(scenario.orders === undefined ? [] : scenario.orders),
  );
  stub.setResponse(
    "payment_webhook_events",
    scenario.hooksError
      ? fail(scenario.hooksError)
      : ok(scenario.hooks === undefined ? [] : scenario.hooks),
  );
  db.use(stub);
  return stub;
}

const QUERY: AuditQuery = { environment: "sandbox", sinceHours: 24 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  tenant.current = BILLING_IDS.tenant;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("zakres materiału dowodowego", () => {
  it("okno czasowe liczy się wstecz od teraz i wchodzi do obu zapytań", async () => {
    const stub = givenDb();
    const report = await buildAuditReport({ environment: "live", sinceHours: 48 });

    const expected = new Date(NOW.getTime() - 48 * 3600_000).toISOString();
    expect(report.sinceIso).toBe(expected);
    expect(report.generatedAt).toBe(NOW.toISOString());

    const orders = stub.lastChain("payment_orders");
    expect(orders?.argsOf("eq")).toEqual(["environment", "live"]);
    expect(orders?.argsOf("gte")).toEqual(["created_at", expected]);
    expect(orders?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(orders?.argsOf("limit")).toEqual([500]);

    const hooks = stub.lastChain("payment_webhook_events");
    expect(hooks?.argsOf("eq")).toEqual(["environment", "live"]);
    // Dziennik zdarzeń idzie po czasie ZDARZENIA U OPERATORA, nie po czasie
    // zapisu u nas - inaczej opóźniona dostawa webhooka wypadłaby z okna.
    expect(hooks?.argsOf("gte")).toEqual(["occurred_at", expected]);
    expect(hooks?.argsOf("limit")).toEqual([500]);
  });

  it("środowisko sandbox i live to rozłączne zbiory dowodowe", async () => {
    const stub = givenDb();
    await buildAuditReport({ environment: "sandbox", sinceHours: 1 });
    expect(stub.lastChain("payment_orders")?.argsOf("eq")).toEqual(["environment", "sandbox"]);
  });

  it("zawężenie do wydarzenia filtruje po metadanych zamówienia", async () => {
    const stub = givenDb();
    await buildAuditReport({ ...QUERY, eventId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" });

    const eqCalls = stub
      .lastChain("payment_orders")
      ?.calls.filter((c) => c.method === "eq")
      .map((c) => c.args);
    // Zakres bazowy (środowisko + najemca) zostaje, filtr wydarzenia się do
    // niego DOKŁADA - zawężenie nie może żadnego z nich zastąpić.
    expect(eqCalls).toEqual([
      ["environment", "sandbox"],
      ["tenant_id", BILLING_IDS.tenant],
      ["metadata->>event_id", "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"],
    ]);
  });

  it("bez wskazania wydarzenia filtr metadanych nie powstaje", async () => {
    const stub = givenDb();
    await buildAuditReport({ ...QUERY, eventId: null });

    // Zostaje sam zakres bazowy - kolumny wymienione z nazwy, bo sama ich
    // liczba nie odróżniłaby braku filtra metadanych od braku zakresu najemcy.
    const eqColumns = stub
      .lastChain("payment_orders")
      ?.calls.filter((c) => c.method === "eq")
      .map((c) => c.args[0]);
    expect(eqColumns).toEqual(["environment", "tenant_id"]);
  });

  it("błąd odczytu zamówień przerywa audyt z czytelnym komunikatem", async () => {
    // Audyt, który po awarii zwraca PUSTĄ listę zamiast wyjątku, jest gorszy
    // niż brak audytu: księgowość dostaje plik, w którym „nic się nie działo".
    givenDb({ ordersError: "permission denied for table payment_orders" });
    await expect(buildAuditReport(QUERY)).rejects.toThrow(/audyt: zamówienia/);
  });

  it("błąd odczytu dziennika zdarzeń również przerywa audyt", async () => {
    givenDb({ hooksError: "statement timeout" });
    await expect(buildAuditReport(QUERY)).rejects.toThrow(/audyt: zdarzenia/);
  });

  it("brak wierszy daje pusty, ale kompletny raport", async () => {
    givenDb({ orders: null, hooks: null });
    const report = await buildAuditReport(QUERY);

    expect(report.orders).toEqual([]);
    expect(report.webhooks).toEqual([]);
    expect(report.totals).toEqual({
      orders: 0,
      paidCents: 0,
      refundedCents: 0,
      webhooksFailed: 0,
    });
    expect(report.truncated).toBe(false);
  });
});

describe("każda operacja zmieniająca pieniądze zostawia wpis", () => {
  it("zamówienie opłacone, zwrócone, częściowo zwrócone i nieudane są w raporcie i w pliku", async () => {
    // Częściowy zwrot ma w bazie kształt „status `paid` + niezerowe
    // `refunded_amount_cents`": `refunds.server.ts` przy zwrocie częściowym
    // aktualizuje wyłącznie kwotę zwrotu i ZOSTAWIA status
    // (`...(isPartial ? {} : { status: "refunded" })`). Test odwzorowuje ten
    // kształt, a nie wyobrażenie o nim.
    givenDb({
      orders: [
        orderRow({ id: "ord-paid", status: "paid", amount_cents: 4900 }),
        orderRow({
          id: "ord-refunded",
          status: "refunded",
          amount_cents: 9900,
          refunded_amount_cents: 9900,
        }),
        orderRow({
          id: "ord-partial",
          status: "paid",
          amount_cents: 12000,
          refunded_amount_cents: 2000,
        }),
        orderRow({ id: "ord-failed", status: "failed", amount_cents: 1900 }),
      ],
    });
    const report = await buildAuditReport(QUERY);

    expect(report.orders.map((o) => o.id)).toEqual([
      "ord-paid",
      "ord-refunded",
      "ord-partial",
      "ord-failed",
    ]);
    expect(report.totals.orders).toBe(4);

    const csv = auditToCsv(report);
    for (const id of ["ord-paid", "ord-refunded", "ord-partial", "ord-failed"]) {
      expect(csv).toContain(id);
    }
  });

  it("przychód liczy zamówienia opłacone, pełny zwrot NIE jest przychodem", async () => {
    givenDb({
      orders: [
        orderRow({ id: "a", status: "paid", amount_cents: 4900 }),
        orderRow({
          id: "b",
          status: "paid",
          amount_cents: 12000,
          refunded_amount_cents: 2000,
        }),
        orderRow({ id: "c", status: "refunded", amount_cents: 9900, refunded_amount_cents: 9900 }),
        orderRow({ id: "d", status: "pending", amount_cents: 1900 }),
      ],
    });
    const report = await buildAuditReport(QUERY);

    // Zamówienie ze zwrotem CZĘŚCIOWYM zostaje przychodem w pełnej kwocie -
    // kwota zwrotu jest raportowana osobną sumą, a nie odejmowana tutaj.
    // Zamówienie oczekujące (`pending`) nie jest jeszcze przychodem.
    expect(report.totals.paidCents).toBe(4900 + 12000);
    // Suma zwrotów bierze WSZYSTKIE zwroty, niezależnie od statusu zamówienia.
    expect(report.totals.refundedCents).toBe(2000 + 9900);
  });

  it("ramię `partially_refunded` w sumie przychodu jest dziś NIEOSIĄGALNE, ale nadal zlicza", async () => {
    // ZNALEZISKO, nie asercja na życzenie. `audit.server.ts` liczy przychód
    // z `o.status === "paid" || o.status === "partially_refunded"`, ale takiej
    // wartości NIE MA w enumie `order_status`
    // (`pending|processing|paid|failed|refunded|canceled` - wygenerowane
    // `src/integrations/supabase/types.ts`) i żaden zapis jej nie produkuje:
    // zwrot częściowy zostawia `paid` (`refunds.server.ts`). Ramię przechodzi
    // kompilację tylko dlatego, że `AuditOrderRow.status` jest zwykłym
    // `string`-iem, a nie enumem.
    //
    // DLACZEGO TO NIE JEST DEFEKT PIENIĘŻNY: suma i tak wychodzi poprawnie,
    // bo przypadek łapie pierwsze ramię (`paid`). To martwy zapas na wypadek
    // dołożenia wartości do enuma - i właśnie dlatego ma test: gdyby ktoś
    // dodał ten status do bazy i zaczął go zapisywać, przychód MUSI go liczyć,
    // a nie po cichu wypaść z podsumowania.
    givenDb({
      orders: [
        orderRowWithRawStatus("partially_refunded", {
          id: "ord-przyszly",
          amount_cents: 12000,
          refunded_amount_cents: 2000,
        }),
      ],
    });
    const report = await buildAuditReport(QUERY);

    expect(report.totals.paidCents).toBe(12000);
    expect(report.totals.refundedCents).toBe(2000);
  });

  it("zamówienie bez kwoty nie psuje sumy przychodu", async () => {
    givenDb({
      orders: [
        orderRow({ id: "a", status: "paid", amount_cents: null }),
        orderRow({ id: "b", status: "paid", amount_cents: 4900 }),
      ],
    });
    const report = await buildAuditReport(QUERY);

    expect(report.orders[0]?.amountCents).toBeNull();
    expect(report.totals.paidCents).toBe(4900);
  });

  it("kwota niebędąca skończoną liczbą jest odrzucana, a nie przepisywana do arkusza", async () => {
    // `NaN` w kolumnie kwoty trafiłby do CSV jako „NaN" i unieważnił sumę
    // w arkuszu. `num()` zamienia to na puste pole.
    givenDb({
      orders: [orderRow({ amount_cents: Number.NaN, refunded_amount_cents: null })],
      hooks: [hookRow({ duration_ms: Number.POSITIVE_INFINITY, retry_count: null })],
    });
    const report = await buildAuditReport(QUERY);

    expect(report.orders[0]?.amountCents).toBeNull();
    expect(report.orders[0]?.refundedCents).toBe(0);
    expect(report.webhooks[0]?.durationMs).toBeNull();
    expect(report.webhooks[0]?.retryCount).toBe(0);
    expect(report.totals.refundedCents).toBe(0);
  });

  it("puste kolumny opcjonalne mapują się na null, nie na undefined", async () => {
    givenDb({
      orders: [
        orderRow({
          updated_at: null,
          currency: null,
          entity_type: null,
          entity_id: null,
          metadata: null,
          provider_session_id: null,
          provider_payment_intent_id: null,
          provider_customer_id: null,
          provider_charge_id: null,
        }),
      ],
      hooks: [hookRow({ event_id: null, occurred_at: null, processed_at: null, error: null })],
    });
    const report = await buildAuditReport(QUERY);

    expect(report.orders[0]).toMatchObject({
      updatedAt: null,
      currency: null,
      eventId: null,
      entityType: null,
      entityId: null,
      providerSessionId: null,
      providerPaymentIntentId: null,
      providerCustomerId: null,
      providerChargeId: null,
    });
    expect(report.webhooks[0]).toMatchObject({
      eventId: null,
      occurredAt: null,
      processedAt: null,
      error: null,
    });
  });

  it("identyfikator wydarzenia z metadanych wchodzi tylko wtedy, gdy jest napisem", async () => {
    givenDb({
      orders: [
        orderRow({ id: "a", metadata: { event_id: "evt-forum" } }),
        orderRow({ id: "b", metadata: { event_id: 42 } }),
        orderRow({ id: "c", metadata: { inne: "pole" } }),
      ],
    });
    const report = await buildAuditReport(QUERY);

    expect(report.orders.map((o) => o.eventId)).toEqual(["evt-forum", null, null]);
  });

  it("licznik nieudanych zdarzeń liczy tylko status `failed`", async () => {
    givenDb({
      hooks: [
        hookRow({ id: "h1", status: "processed" }),
        hookRow({ id: "h2", status: "failed", error: "signature mismatch" }),
        hookRow({ id: "h3", status: "received" }),
        hookRow({ id: "h4", status: "failed", error: "timeout" }),
      ],
    });
    const report = await buildAuditReport(QUERY);

    expect(report.totals.webhooksFailed).toBe(2);
    expect(report.webhooks).toHaveLength(4);
  });
});

describe("limit wierszy i ostrzeżenie o obcięciu", () => {
  it("komplet 500 zamówień oznacza raport jako obcięty", async () => {
    givenDb({
      orders: Array.from({ length: 500 }, (_, i) => orderRow({ id: `ord-${i}` })),
    });
    const report = await buildAuditReport(QUERY);
    expect(report.truncated).toBe(true);
  });

  it("komplet 500 zdarzeń też oznacza obcięcie, nawet przy garstce zamówień", async () => {
    givenDb({
      orders: [orderRow()],
      hooks: Array.from({ length: 500 }, (_, i) => hookRow({ id: `evt-${i}` })),
    });
    const report = await buildAuditReport(QUERY);
    expect(report.truncated).toBe(true);
  });

  it("wynik poniżej limitu nie straszy operatora obcięciem", async () => {
    givenDb({
      orders: Array.from({ length: 499 }, (_, i) => orderRow({ id: `ord-${i}` })),
      hooks: Array.from({ length: 499 }, (_, i) => hookRow({ id: `evt-${i}` })),
    });
    const report = await buildAuditReport(QUERY);
    expect(report.truncated).toBe(false);
  });
});

describe("RODO - co wolno wynieść z systemu", () => {
  it("dane osobowe kupującego z metadanych NIE trafiają ani do raportu, ani do pliku", async () => {
    // Nagłówek modułu deklaruje: „świadomie nie wynosimy danych osobowych
    // kupującego - eksport trafia do arkusza poza systemem". Ten test jest
    // egzekucją tej deklaracji: zamówienie identyfikujemy naszym `id` oraz
    // identyfikatorami operatora, a nie adresem czy nazwiskiem.
    const buyerEmail = "kupujacy@example.org";
    givenDb({
      orders: [
        orderRow({
          metadata: {
            event_id: "evt-forum",
            receipt_email: buyerEmail,
            buyer_name: "Nazwisko Syntetyczne",
            user_id: "user-me",
          },
        }),
      ],
    });
    const report = await buildAuditReport(QUERY);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(buyerEmail);
    expect(serialized).not.toContain("example.org");
    expect(serialized).not.toContain("Nazwisko Syntetyczne");
    expect(serialized).not.toContain("user-me");
    // Tożsamość zdarzenia zostaje - to identyfikator biznesowy, nie osobowy.
    expect(report.orders[0]?.eventId).toBe("evt-forum");

    const csv = auditToCsv(report);
    expect(csv).not.toContain(buyerEmail);
    expect(csv).not.toContain("Nazwisko Syntetyczne");
    expect(csv).not.toContain("user-me");
  });
});

describe("eksport pliku dla księgowości", () => {
  async function sampleReport(): Promise<AuditReport> {
    givenDb({
      orders: [orderRow({ id: "ord-1", currency: "PLN" })],
      hooks: [hookRow({ id: "evt-row-1", status: "failed", error: "timeout, retry later" })],
    });
    return buildAuditReport(QUERY);
  }

  it("CSV ma znacznik BOM, obie sekcje i nazwę z dniem oraz środowiskiem", async () => {
    const report = await sampleReport();
    const file = await buildAuditExport(report, "csv");

    expect(file.fileName).toBe("rozliczenia-audyt-sandbox-2026-08-18.csv");
    expect(file.mimeType).toBe("text/csv;charset=utf-8");

    const text = Buffer.from(file.base64, "base64").toString("utf-8");
    // BOM: bez niego Excel czyta UTF-8 jako stronę kodową systemu i rozsypuje
    // polskie znaki w nazwach statusów.
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("order_id");
    expect(text).toContain("stripe_event_id");
    expect(text).toContain("ord-1");
    expect(text).toContain('"timeout, retry later"');
  });

  it("XLSX jest prawdziwym skoroszytem z dwiema zakładkami", async () => {
    const report = await sampleReport();
    const file = await buildAuditExport(report, "xlsx");

    expect(file.fileName).toBe("rozliczenia-audyt-sandbox-2026-08-18.xlsx");
    expect(file.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const bytes = Buffer.from(file.base64, "base64");
    // Sygnatura ZIP - XLSX jest archiwum; pusty albo tekstowy ładunek nie
    // otworzyłby się w arkuszu, a błąd wyszedłby dopiero u księgowej.
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const XLSX = await import("xlsx");
    const book = XLSX.read(bytes, { type: "buffer" });
    expect(book.SheetNames).toEqual(["Zamowienia", "Webhooki"]);
  });

  it("nazwa pliku bierze dzień z chwili wygenerowania raportu, nie z okna", async () => {
    const report = await sampleReport();
    const file = await buildAuditExport({ ...report, environment: "live" }, "csv");
    expect(file.fileName).toBe("rozliczenia-audyt-live-2026-08-18.csv");
  });
});

describe("izolacja najemcy w audycie rozliczeń", () => {
  it("oba zapytania są zawężone do najemcy, nie tylko do środowiska", async () => {
    // CO BYŁO ZŁE (defekt naprawiony 31.08.2026). `buildAuditReport` biegnie na
    // kliencie `service_role`, który OMIJA RLS, a jedynym filtrem zakresu było
    // `.eq("environment", ...)`. Kolumna `payment_orders.tenant_id` istnieje
    // i jest NOT NULL, ale nie była ani wybierana, ani filtrowana - tak samo
    // w `payment_webhook_events`. `AuditQuery` nie miał nawet pola na najemcę,
    // więc wywołujący nie miał jak zawęzić zakresu.
    //
    // JAKIE TO BYŁO RYZYKO. Bramka w `audit.functions.ts` to `assertAdmin`,
    // czyli `has_role(user, 'admin')` - rola SPRAWDZANA GLOBALNIE, bez najemcy.
    // W instalacji wielonajemcowej administrator jednego najemcy pobierał więc
    // pełną historię płatności innego: kwoty, statusy, identyfikatory klienta
    // i sesji u operatora, w gotowym pliku CSV/XLSX, który z definicji opuszcza
    // system. To ta sama klasa dziury, którą na poziomie polityk RLS domknęła
    // migracja 20260831060000 - tylko piętro wyżej, w zapytaniu aplikacyjnym.
    //
    // ŻE TO NIE BYŁA ŚWIADOMA DECYZJA „audyt jest instancyjny", widać po
    // bezpośrednim sąsiedzie: `listAdminDonations` w
    // `src/lib/billing/donationsAdmin.server.ts` to również panel admina nad
    // pieniędzmi, również na service_role - i tam zapytanie ma
    // `.eq("tenant_id", tenantId)`, a brak rozwiązanego najemcy zwraca pustą
    // listę (fail-closed). Repozytorium ma też bramkę statyczną dokładnie na
    // tę klasę błędu (`src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts`),
    // ale jej rejestr obejmuje wyłącznie czytniki z `src/lib/server/**`,
    // więc ten plik nigdy nie był przez nią widziany.
    //
    // JAK NAPRAWIONE. Najemca jest rozwiązywany z HOSTA ŻĄDANIA (nie z ładunku,
    // bo wtedy admin podałby po prostu cudzy identyfikator), oba zapytania
    // filtrują po `tenant_id`, a brak rozwiązania zamyka raport - dokładnie
    // wzorem panelu darowizn.
    //
    // ASERCJA jest kontraktem ZAPYTANIA, a nie kształtu wyniku, bo moduł nie
    // wybiera `tenant_id` - po samych danych nie da się odróżnić najemców.
    // To ten sam rodzaj dowodu, jakiego używa bramka service-role wyżej.
    const stub = givenDb({ orders: [orderRow()] });
    await buildAuditReport(QUERY);

    const tenantFilter = (table: string): unknown =>
      (stub.lastChain(table)?.calls ?? []).find(
        (c) => c.method === "eq" && c.args[0] === "tenant_id",
      )?.args[1];

    expect(tenantFilter("payment_orders")).toBe(BILLING_IDS.tenant);
    expect(tenantFilter("payment_webhook_events")).toBe(BILLING_IDS.tenant);
  });

  it("nierozwiązany najemca daje PUSTY raport i ani jednego zapytania", async () => {
    // Fail-closed jak w panelu darowizn: „nie wiem, czyje to dane" nie może
    // znaczyć „oddaj wszystko". Okno czasowe zostaje policzone (raport ma być
    // czytelny w panelu), ale do bazy nie idzie nic.
    tenant.current = null;
    const stub = givenDb({ orders: [orderRow()], hooks: [hookRow()] });

    const report = await buildAuditReport(QUERY);

    expect(report.orders).toEqual([]);
    expect(report.webhooks).toEqual([]);
    expect(report.totals).toEqual({
      orders: 0,
      paidCents: 0,
      refundedCents: 0,
      webhooksFailed: 0,
    });
    expect(stub.chains).toEqual([]);
  });

  it("jawnie podany najemca omija rozwiązywanie z hosta", async () => {
    // Ścieżka dla wywołań spoza kontekstu żądania. Wartość NIGDY nie pochodzi
    // od klienta - schemat funkcji serwerowej jej nie przyjmuje.
    tenant.current = null;
    const stub = givenDb({ orders: [orderRow()] });

    await buildAuditReport({ ...QUERY, tenantId: BILLING_IDS.foreignTenant });

    expect(
      (stub.lastChain("payment_orders")?.calls ?? []).find(
        (c) => c.method === "eq" && c.args[0] === "tenant_id",
      )?.args[1],
    ).toBe(BILLING_IDS.foreignTenant);
  });
});
