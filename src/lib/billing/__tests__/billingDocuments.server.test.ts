// DOKUMENT KSIĘGOWY TRANSAKCJI - 34% linii i 23% gałęzi do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. `billing_documents` to rejestr, z którego klient
// pobiera własne faktury na /profile/plan. Wiersz niesie `user_id` i
// `tenant_id` USTALONE PRZEZ TEN MODUŁ - nie przez payload operatora. Pomyłka
// w ustalaniu właściciela to nie brakująca kolumna, tylko CUDZA FAKTURA
// (dane firmy, kwoty, NIP) w panelu obcej osoby.
//
// Druga reguła pilnowana tutaj to IDEMPOTENCJA: numer faktury nadaje operator,
// czasem dopiero osobnym zdarzeniem `transaction.updated`. Zapis musi więc
// znieść dowolną liczbę powtórzeń tego samego zdarzenia i uzupełniać, a nie
// duplikować ani nie kasować już zapisanych danych.
//
// CO TEN PLIK MIERZY: gałęzie ODMOWY - brak identyfikatora, brak właściciela
// (płatność gościa), awaria odczytu, wyścig dwóch zdarzeń o ten sam dokument,
// aktualizacja bez żadnej zmiany. Ścieżka szczęśliwa jest tu w minimalnej
// dawce - jako kontrakt kształtu zapisu.
//
// GRANICA ATRAP: wyłącznie klient Supabase (rola serwisowa). Sam moduł nie
// wychodzi do sieci, więc nic więcej podmieniać nie trzeba.
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { StripeEnv } from "@/lib/stripe.server";
import {
  ok,
  fail,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
  },
}));

import {
  documentInputFromTransaction,
  recordTransactionDocument,
  type TransactionDocumentInput,
} from "@/lib/billing/billingDocuments.server";

const ENV: StripeEnv = "sandbox";
const TXN = "in_1SyntetycznaFaktura";
const OWNER = { userId: "user-me", tenantId: "tenant-alfa" };
const FOREIGN = { userId: "user-other", tenantId: "tenant-beta" };

let db: SupabaseFromStub;

/** Wejście modułu w kształcie, jaki buduje `documentInputFromTransaction`. */
function input(overrides: Partial<TransactionDocumentInput> = {}): TransactionDocumentInput {
  return {
    transactionId: TXN,
    subscriptionId: null,
    amountCents: 4900,
    currency: "pln",
    invoiceNumber: "FV/2026/08/0001",
    hostedUrl: "https://invoice.example.test/hosted",
    pdfUrl: "https://invoice.example.test/pdf",
    status: "completed",
    issuedAt: "2026-08-18T10:00:00.000Z",
    environment: ENV,
    ...overrides,
  };
}

/** Zawężenie bez rzutowania - wiersze zapisane przez atrapę są nietypowane. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Wiersz przekazany do `insert`/`update` na wskazanej tabeli. */
function writtenRow(table: string, method: "insert" | "update"): Record<string, unknown> {
  const chain = db.chainsFor(table).find((c) => c.has(method));
  const row = chain?.argsOf(method)?.[0];
  if (!isRecord(row)) throw new Error(`test: brak zapisu ${method} na tabeli "${table}"`);
  return row;
}

/**
 * Domyślny stan: transakcja należy do zamówienia `OWNER`, rejestr dokumentów
 * jest pusty, wszystkie zapisy się udają. Każdy test odmowy podmienia
 * DOKŁADNIE JEDNĄ z tych odpowiedzi - to trzyma przyczynę porażki jawną.
 */
function seed(
  options: {
    subscription?: SupabaseResult;
    order?: SupabaseResult;
    document?: SupabaseResult;
    write?: SupabaseResult;
  } = {},
): void {
  db.setResponse("subscriptions", options.subscription ?? ok(null));
  db.setResponse(
    "payment_orders",
    options.order ?? ok({ user_id: OWNER.userId, tenant_id: OWNER.tenantId }),
  );
  db.setResponse("billing_documents", (chain) => {
    if (chain.has("insert") || chain.has("update")) return options.write ?? ok(null);
    return options.document ?? ok(null);
  });
}

beforeEach(() => {
  db = supabaseFromStub();
  h.db.current = { from: (table: string) => db.from(table) };
  seed();
});

describe("recordTransactionDocument - ODMOWY (nic nie zapisujemy)", () => {
  it("pusty identyfikator transakcji nie dotyka bazy W OGÓLE", async () => {
    // Bez identyfikatora nie ma klucza idempotencji, więc każdy zapis byłby
    // duplikatem. Odmowa musi paść przed pierwszym zapytaniem.
    const outcome = await recordTransactionDocument(input({ transactionId: "" }));

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("płatność BEZ WŁAŚCICIELA (gość bez konta) nie zakłada dokumentu", async () => {
    // Gość nie ma panelu, w którym mógłby fakturę zobaczyć - potwierdzenie
    // idzie mailem. Zapis wiersza bez `user_id` złamałby NOT NULL, a zapis
    // z cudzym `user_id` byłby znacznie gorszy.
    seed({ order: ok(null) });

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("billing_documents")).toHaveLength(0);
  });

  it("AWARIA ODCZYTU rejestru kończy się pominięciem, nie ślepym zapisem", async () => {
    // Odczyt rozstrzyga „załóż czy uzupełnij". Gdyby błąd przeleciał dalej,
    // kod wpadłby w gałąź zakładania i zderzył się z unikalnością - albo,
    // gorzej, założył drugi dokument dla tej samej transakcji.
    seed({ document: fail("statement timeout", "57014") });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("billing_documents").some((c) => c.has("insert"))).toBe(false);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("WYŚCIG dwóch zdarzeń o tę samą transakcję jest wynikiem poprawnym", async () => {
    // `transaction.completed` i `transaction.updated` potrafią dojść równolegle.
    // Drugi zapis przegrywa na unikalności `provider_document_id` - to nie jest
    // awaria do ponowienia, tylko dowód, że idempotencja zadziałała. Dlatego
    // ostrzeżenie (`warn`), nie błąd, i `skipped`, nie wyjątek.
    seed({ write: fail("duplicate key value violates unique constraint", "23505") });
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("skipped");
    expect(warnLog).toHaveBeenCalled();
    warnLog.mockRestore();
  });

  it("awaria AKTUALIZACJI istniejącego dokumentu też nie rzuca", async () => {
    // Dokument już jest, dochodzi numer faktury - i zapis pada. Webhook nie
    // może się z tego powodu wywrócić: numer dojdzie kolejnym zdarzeniem.
    seed({
      document: ok({ id: "doc-1", number: null, amount_cents: 4900, status: "paid" }),
      write: fail("permission denied for table billing_documents", "42501"),
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("skipped");
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("aktualizacja BEZ ŻADNEJ ZMIANY nie generuje zapisu", async () => {
    // Powtórzone `transaction.updated` bez nowych danych. Zapis samego
    // `updated_at` podbijałby znacznik dokumentu księgowego bez powodu -
    // a to ten znacznik odpowiada na pytanie „kiedy fakturę ostatnio zmieniono".
    seed({
      document: ok({
        id: "doc-1",
        number: "FV/2026/08/0001",
        amount_cents: 4900,
        status: "paid",
      }),
    });

    const outcome = await recordTransactionDocument(input({ hostedUrl: null, pdfUrl: null }));

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("billing_documents").some((c) => c.has("update"))).toBe(false);
  });
});

describe("recordTransactionDocument - WŁAŚCICIEL dokumentu", () => {
  it("właściciel z SUBSKRYPCJI ma pierwszeństwo przed zamówieniem", async () => {
    // Faktura odnowieniowa nie ma własnego zamówienia - jedynym źródłem
    // właściciela jest wiersz subskrypcji operatora.
    seed({
      subscription: ok({ user_id: OWNER.userId, tenant_id: OWNER.tenantId }),
      order: ok({ user_id: FOREIGN.userId, tenant_id: FOREIGN.tenantId }),
    });

    const outcome = await recordTransactionDocument(input({ subscriptionId: "sub_stripe_1" }));

    expect(outcome).toBe("created");
    const row = writtenRow("billing_documents", "insert");
    expect(row.user_id).toBe(OWNER.userId);
    expect(row.tenant_id).toBe(OWNER.tenantId);
    // Zamówienia nawet nie pytamy, gdy subskrypcja odpowiedziała.
    expect(db.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("subskrypcja jest szukana W TYM SAMYM ŚRODOWISKU co transakcja", async () => {
    // Izolacja sandbox/live: subskrypcja testowa i produkcyjna mogą nosić ten
    // sam identyfikator u operatora. Bez filtra faktura z sandboxa trafiłaby
    // do panelu prawdziwego klienta.
    seed({ subscription: ok(null) });

    await recordTransactionDocument(input({ subscriptionId: "sub_stripe_1", environment: "live" }));

    const chain = db.chainsFor("subscriptions")[0];
    const filters = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(filters).toContainEqual(["provider_subscription_id", "sub_stripe_1"]);
    expect(filters).toContainEqual(["environment", "live"]);
  });

  it("brak subskrypcji schodzi na ZAMÓWIENIE po identyfikatorze intencji", async () => {
    seed({
      subscription: ok(null),
      order: ok({ user_id: OWNER.userId, tenant_id: OWNER.tenantId }),
    });

    const outcome = await recordTransactionDocument(input({ subscriptionId: "sub_nieznana" }));

    expect(outcome).toBe("created");
    expect(db.chainsFor("payment_orders")[0].argsOf("eq")).toEqual(["provider_intent_id", TXN]);
    expect(writtenRow("billing_documents", "insert").user_id).toBe(OWNER.userId);
  });

  it("NAJEMCA faktury pochodzi od właściciela transakcji, nie z payloadu", async () => {
    // Cały payload operatora jest danymi wejściowymi obcego systemu. Tenant
    // wpisywany do dokumentu musi pochodzić WYŁĄCZNIE z naszego wiersza -
    // inaczej faktura mogłaby wylądować w cudzej przestrzeni najemcy.
    seed({ order: ok({ user_id: FOREIGN.userId, tenant_id: FOREIGN.tenantId }) });

    await recordTransactionDocument(input());

    const row = writtenRow("billing_documents", "insert");
    expect(row.tenant_id).toBe(FOREIGN.tenantId);
    expect(row.user_id).toBe(FOREIGN.userId);
    // Wejście nie ma pola tenanta - i nie może go dostać żadną boczną drogą.
    expect(Object.keys(input())).not.toContain("tenantId");
  });
});

describe("recordTransactionDocument - ZAŁOŻENIE dokumentu", () => {
  it("zapisuje komplet pól faktury w kanonicznym kształcie", async () => {
    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("created");
    expect(writtenRow("billing_documents", "insert")).toMatchObject({
      provider: "stripe",
      provider_document_id: TXN,
      kind: "invoice",
      number: "FV/2026/08/0001",
      hosted_url: "https://invoice.example.test/hosted",
      pdf_url: "https://invoice.example.test/pdf",
      amount_cents: 4900,
      // Waluta zawsze wielkimi literami - kolumna jest porównywana wprost.
      currency: "PLN",
      status: "paid",
      issued_at: "2026-08-18T10:00:00.000Z",
    });
  });

  it("status inny niż `completed` jest zapisywany dosłownie, brak statusu to `pending`", async () => {
    seed();
    await recordTransactionDocument(input({ status: "past_due" }));
    expect(writtenRow("billing_documents", "insert").status).toBe("past_due");

    db = supabaseFromStub();
    h.db.current = { from: (table: string) => db.from(table) };
    seed();
    await recordTransactionDocument(input({ status: null }));
    expect(writtenRow("billing_documents", "insert").status).toBe("pending");
  });

  it("brak kwoty zapisuje zero, a nie `null` (kolumna jest NOT NULL)", async () => {
    // Numer i kwotę operator dosyła osobnym zdarzeniem. Dokument ma powstać
    // od razu, żeby klient widział pozycję - kwota dojdzie aktualizacją.
    await recordTransactionDocument(input({ amountCents: null }));

    expect(writtenRow("billing_documents", "insert").amount_cents).toBe(0);
  });

  it("brak waluty schodzi na domyślną, brak daty wystawienia na „teraz”", async () => {
    const before = Date.now();

    await recordTransactionDocument(input({ currency: null, issuedAt: null }));

    const row = writtenRow("billing_documents", "insert");
    expect(row.currency).toBe("EUR");
    expect(typeof row.issued_at).toBe("string");
    expect(Date.parse(String(row.issued_at))).toBeGreaterThanOrEqual(before);
  });
});

describe("recordTransactionDocument - UZUPEŁNIANIE dokumentu", () => {
  it("numer faktury dosłany później trafia do istniejącego wiersza", async () => {
    // Główny powód, dla którego ten zapis w ogóle jest aktualizujący.
    seed({
      document: ok({ id: "doc-1", number: null, amount_cents: 4900, status: "paid" }),
    });

    const outcome = await recordTransactionDocument(input({ hostedUrl: null, pdfUrl: null }));

    expect(outcome).toBe("updated");
    const patch = writtenRow("billing_documents", "update");
    expect(patch.number).toBe("FV/2026/08/0001");
    expect(patch).toHaveProperty("updated_at");
    expect(db.lastChain("billing_documents")!.argsOf("eq")).toEqual(["id", "doc-1"]);
  });

  it("KWOTA ZEROWA nie kasuje kwoty już zapisanej", async () => {
    // Zdarzenie uzupełniające numer bywa bez `totals`. Nadpisanie zapisanej
    // kwoty zerem zamieniłoby fakturę w dokument na 0,00 - to najgorsza
    // możliwa „aktualizacja" dokumentu księgowego.
    seed({
      document: ok({ id: "doc-1", number: "FV/2026/08/0001", amount_cents: 4900, status: "paid" }),
    });

    const outcome = await recordTransactionDocument(
      input({ amountCents: null, hostedUrl: null, pdfUrl: null, status: "open" }),
    );

    expect(outcome).toBe("updated");
    const patch = writtenRow("billing_documents", "update");
    expect(patch).not.toHaveProperty("amount_cents");
    expect(patch.status).toBe("open");
  });

  it("linki do faktury są dopisywane, gdy operator je w końcu wystawi", async () => {
    // `invoice_pdf` bywa gotowy dopiero po chwili - i to jest jedyna rzecz,
    // która zmienia się w tym zdarzeniu.
    seed({
      document: ok({ id: "doc-1", number: "FV/2026/08/0001", amount_cents: 4900, status: "paid" }),
    });

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("updated");
    expect(writtenRow("billing_documents", "update")).toMatchObject({
      hosted_url: "https://invoice.example.test/hosted",
      pdf_url: "https://invoice.example.test/pdf",
    });
  });

  it("zmiana kwoty i statusu jest przenoszona razem", async () => {
    seed({
      document: ok({ id: "doc-1", number: "FV/2026/08/0001", amount_cents: 100, status: "open" }),
    });

    const outcome = await recordTransactionDocument(input({ hostedUrl: null, pdfUrl: null }));

    expect(outcome).toBe("updated");
    expect(writtenRow("billing_documents", "update")).toMatchObject({
      amount_cents: 4900,
      status: "paid",
    });
  });
});

describe("documentInputFromTransaction - odczyt payloadu operatora", () => {
  it("payload bez identyfikatora nie daje wejścia (a nie puste wejście)", () => {
    // `null` na wyjściu jest sygnałem dla `webhookDispatch`, żeby w ogóle nie
    // wołać zapisu. Puste wejście przeszłoby dalej i zaczęło szukać właściciela.
    expect(documentInputFromTransaction(null, ENV)).toBeNull();
    expect(documentInputFromTransaction(undefined, ENV)).toBeNull();
    expect(documentInputFromTransaction({}, ENV)).toBeNull();
    expect(documentInputFromTransaction({ id: "   " }, ENV)).toBeNull();
  });

  it("odczytuje komplet pól faktury z transakcji", () => {
    const result = documentInputFromTransaction(
      {
        id: TXN,
        subscriptionId: "sub_stripe_1",
        currencyCode: "PLN",
        invoiceNumber: "FV/2026/08/0002",
        hostedInvoiceUrl: "https://invoice.example.test/hosted",
        invoicePdf: "https://invoice.example.test/pdf",
        status: "completed",
        billedAt: "2026-08-18T10:00:00.000Z",
        createdAt: "2026-08-17T10:00:00.000Z",
        details: { totals: { grandTotal: "4900" } },
      },
      ENV,
    );

    expect(result).toEqual({
      transactionId: TXN,
      subscriptionId: "sub_stripe_1",
      amountCents: 4900,
      currency: "PLN",
      invoiceNumber: "FV/2026/08/0002",
      hostedUrl: "https://invoice.example.test/hosted",
      pdfUrl: "https://invoice.example.test/pdf",
      status: "completed",
      // `billedAt` ma pierwszeństwo: to data WYSTAWIENIA, nie utworzenia.
      issuedAt: "2026-08-18T10:00:00.000Z",
      environment: ENV,
    });
  });

  it("brak `billedAt` schodzi na datę utworzenia transakcji", () => {
    const result = documentInputFromTransaction(
      { id: TXN, createdAt: "2026-08-17T10:00:00.000Z" },
      ENV,
    );

    expect(result?.issuedAt).toBe("2026-08-17T10:00:00.000Z");
  });

  it("kwota inna niż napis nie jest zgadywana - zostaje `null`", () => {
    // Operator przysyła sumy jako napisy. Liczba, `null` albo brak `details`
    // oznaczają, że kwoty NIE MA - i tak ma to zostać zapisane, bo zerowa
    // kwota na fakturze jest twierdzeniem, a `null` pytaniem.
    expect(documentInputFromTransaction({ id: TXN }, ENV)?.amountCents).toBeNull();
    expect(
      documentInputFromTransaction({ id: TXN, details: { totals: { grandTotal: 4900 } } }, ENV)
        ?.amountCents,
    ).toBeNull();
    expect(
      documentInputFromTransaction({ id: TXN, details: { totals: { grandTotal: "brak" } } }, ENV)
        ?.amountCents,
    ).toBeNull();
  });

  it("białe znaki są traktowane jak brak wartości", () => {
    const result = documentInputFromTransaction(
      { id: TXN, invoiceNumber: "  ", currencyCode: "", subscriptionId: "\t" },
      ENV,
    );

    expect(result?.invoiceNumber).toBeNull();
    expect(result?.currency).toBeNull();
    expect(result?.subscriptionId).toBeNull();
  });

  it("numer faktury jest przycinany, nie przepisywany z odstępami", () => {
    const result = documentInputFromTransaction({ id: `  ${TXN}  ` }, ENV);

    expect(result?.transactionId).toBe(TXN);
  });
});

describe("billingDocuments - DEFEKTY NAPRAWIONE (bramki regresji)", () => {
  // ---------------------------------------------------------------------
  // DEFEKT (naprawiony): fallback po ZAMÓWIENIU nie był zawężony do środowiska.
  //
  // CO BYŁO ZŁE. `ownerFor` szuka właściciela dwiema drogami. Droga
  // subskrypcyjna filtrowała `.eq("environment", input.environment)` (dowodzi
  // tego test wyżej). Droga zamówieniowa filtrowała WYŁĄCZNIE
  // `.eq("provider_intent_id", input.transactionId)` - bez środowiska, choć
  // `payment_orders.environment` jest kolumną NOT NULL i jest wypełniona.
  //
  // JAKIE TO BYŁO RYZYKO. Reguła izolacji sandbox/live jest w tym repo nazwana
  // wprost jako P0 (`oneTimeFulfilment.server`: „realizujemy zamówienie
  // WYŁĄCZNIE zdarzeniem z tego samego środowiska... Bez tego sandboxowy
  // webhook mógłby zrealizować realne zamówienie"). Tu stawka jest inna, ale
  // z tej samej rodziny: zdarzenie z jednego środowiska ustalało WŁAŚCICIELA
  // dokumentu księgowego zapisanego dla drugiego. Skutkiem nie było brakujące
  // pole, tylko faktura wystawiona na cudze `user_id` / `tenant_id` -
  // widoczna w cudzym panelu. Asymetria wewnątrz JEDNEJ funkcji była tu
  // najmocniejszym dowodem, że to przeoczenie, a nie decyzja.
  //
  // JAK NAPRAWIONO. Dołożony `.eq("environment", input.environment)` PO filtrze
  // identyfikatora (kolejność jest częścią kontraktu testu wyżej). Obawa
  // o dane historyczne odpadła po sprawdzeniu migracji
  // `20260731220000_payment_orders_environment_isolation`: kolumna weszła jako
  // `NOT NULL DEFAULT 'live'`, więc zamówienia sprzed niej są 'live' i ruch
  // produkcyjny nadal je znajduje.
  // ---------------------------------------------------------------------
  it("zamówienie-właściciel jest szukane w środowisku transakcji", async () => {
    seed({ subscription: ok(null) });

    await recordTransactionDocument(input({ environment: "live" }));

    const chain = db.chainsFor("payment_orders")[0];
    const filters = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(filters).toContainEqual(["environment", "live"]);
  });
});
