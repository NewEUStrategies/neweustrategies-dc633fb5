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
// Trzecia reguła (audyt INV-04): STAN Z CHECK-A I ALARM ZAMIAST CISZY. Zapis
// przepisywał stan operatora dosłownie (domyślnie `pending`), więc KAŻDY zakup
// jednorazowy (bilet, darowizna, dostęp do treści) padał na CHECK-u tabeli,
// a błąd był logowany jako „wyścig" i pomijany. Teraz: stan idzie przez
// `billingDocumentStatus` (zbiór = CHECK, dowód: `billingDocumentsDbCheck.test`),
// 23505 to jedyny „wyścig", a każdy inny błąd zapisu to `failed` + dzwonek dla
// administratorów najemcy.
//
// Czwarta (audyt INV-07): MIGAWKA STRON z chwili zakupu zapisywana razem
// z dokumentem - z tych samych źródeł, z których czyta kopia PDF.
//
// CO TEN PLIK MIERZY: gałęzie ODMOWY - brak identyfikatora, brak właściciela
// (płatność gościa), awaria odczytu, wyścig dwóch zdarzeń o ten sam dokument,
// aktualizacja bez żadnej zmiany - oraz gałęzie AWARII (alarm) i ścieżkę
// `checkout.session.completed` od zdarzenia operatora do wiersza.
//
// GRANICA ATRAP: klient Supabase (rola serwisowa) i nadawca dzwonka
// (`tenantAdminAlert.server`). Sam moduł nie wychodzi do sieci, więc nic
// więcej podmieniać nie trzeba.
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
  notifyTenantAdmins: vi.fn(async (_input: Record<string, unknown>) => 1),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
  },
}));

vi.mock("@/lib/events/tenantAdminAlert.server", () => ({
  notifyTenantAdmins: h.notifyTenantAdmins,
}));

import {
  documentInputFromTransaction,
  recordTransactionDocument,
  type TransactionDocumentInput,
} from "@/lib/billing/billingDocuments.server";
import { BILLING_DOCUMENT_STATUSES } from "@/lib/billing/billingDocumentStatus";
import { normalizeStripeEvent } from "@/lib/billing/stripeEvents.server";

const ENV: StripeEnv = "sandbox";
const TXN = "in_1SyntetycznaFaktura";
const OWNER = { userId: "user-me", tenantId: "tenant-alfa" };
const FOREIGN = { userId: "user-other", tenantId: "tenant-beta" };
const ORDER_ID = "order-1";

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
    kind: "invoice",
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
 * jest pusty, wszystkie zapisy się udają, a źródła migawki (profil
 * rozliczeniowy, wystawca, ustawienia checkoutu) odpowiadają. Każdy test
 * odmowy podmienia DOKŁADNIE JEDNĄ z tych odpowiedzi - to trzyma przyczynę
 * porażki jawną.
 */
function seed(
  options: {
    subscription?: SupabaseResult;
    order?: SupabaseResult;
    document?: SupabaseResult;
    write?: SupabaseResult;
    checkoutSettings?: SupabaseResult;
  } = {},
): void {
  db.setResponse("subscriptions", options.subscription ?? ok(null));
  db.setResponse(
    "payment_orders",
    options.order ?? ok({ id: ORDER_ID, user_id: OWNER.userId, tenant_id: OWNER.tenantId }),
  );
  db.setResponse("billing_documents", (chain) => {
    if (chain.has("insert") || chain.has("update")) return options.write ?? ok(null);
    return options.document ?? ok(null);
  });
  db.setResponse(
    "billing_profiles",
    ok({
      full_name: "Jan Kowalski",
      company: "Dvořák s.r.o.",
      tax_id: "CZ12345678",
      email: "faktury@example.com",
      address_line1: "Náměstí 1",
      address_line2: null,
      city: "Brno",
      postal_code: "602 00",
      country_code: "CZ",
      is_company: true,
    }),
  );
  db.setResponse("profiles", ok({ email: "konto@example.com" }));
  db.setResponse(
    "site_settings",
    ok({ value: { name: "Fundacja Syntetyczna", tax_id: "PL5260000000", city: "Kraków" } }),
  );
  db.setResponse("checkout_settings", options.checkoutSettings ?? ok(null));
}

beforeEach(() => {
  db = supabaseFromStub();
  h.db.current = { from: (table: string) => db.from(table) };
  h.notifyTenantAdmins.mockClear();
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

  it("AWARIA ODCZYTU rejestru kończy się alarmem, nie ślepym zapisem", async () => {
    // Odczyt rozstrzyga „załóż czy uzupełnij". Gdyby błąd przeleciał dalej,
    // kod wpadłby w gałąź zakładania i zderzył się z unikalnością - albo,
    // gorzej, założył drugi dokument dla tej samej transakcji. Dokumentu
    // jednak NIE MA, więc to nie jest ciche `skipped`, tylko `failed` z alarmem.
    seed({ document: fail("statement timeout", "57014") });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("failed");
    expect(db.chainsFor("billing_documents").some((c) => c.has("insert"))).toBe(false);
    expect(errorLog).toHaveBeenCalled();
    expect(h.notifyTenantAdmins).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it("WYŚCIG dwóch zdarzeń o tę samą transakcję jest wynikiem poprawnym", async () => {
    // `transaction.completed` i `transaction.updated` potrafią dojść równolegle.
    // Drugi zapis przegrywa na unikalności `provider_document_id` - to nie jest
    // awaria do ponowienia, tylko dowód, że idempotencja zadziałała. Dlatego
    // ostrzeżenie (`warn`), nie błąd, i `skipped`, nie wyjątek.
    seed({ write: fail("duplicate key value violates unique constraint", "23505") });
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("skipped");
    expect(warnLog).toHaveBeenCalled();
    // Wyścig to dowód idempotencji - ani błąd w logu, ani dzwonek.
    expect(errorLog).not.toHaveBeenCalled();
    expect(h.notifyTenantAdmins).not.toHaveBeenCalled();
    warnLog.mockRestore();
    errorLog.mockRestore();
  });

  it("awaria AKTUALIZACJI istniejącego dokumentu nie rzuca, ale alarmuje", async () => {
    // Dokument już jest, dochodzi numer faktury - i zapis pada. Webhook nie
    // może się z tego powodu wywrócić, ale zespół musi się dowiedzieć, że
    // dokument w panelu członka jest niekompletny.
    seed({
      document: ok({ id: "doc-1", number: null, amount_cents: 4900, status: "paid" }),
      write: fail("permission denied for table billing_documents", "42501"),
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("failed");
    expect(errorLog).toHaveBeenCalled();
    expect(h.notifyTenantAdmins).toHaveBeenCalledTimes(1);
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

describe('recordTransactionDocument - AWARIA ZAPISU to alarm, nie „wyścig"', () => {
  it("odrzucenie przez CHECK (23514) to `failed` + błąd w logu + dzwonek najemcy", async () => {
    // Dokładnie ten tryb chował zakupy jednorazowe: CHECK odrzucał `pending`,
    // a kod logował `warn` o wyścigu i zwracał `skipped`.
    seed({
      write: fail('new row violates check constraint "billing_documents_status_check"', "23514"),
    });
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("failed");
    expect(warnLog).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "[payments] billing document insert failed",
      TXN,
      expect.objectContaining({ code: "23514" }),
    );
    expect(h.notifyTenantAdmins).toHaveBeenCalledTimes(1);
    warnLog.mockRestore();
    errorLog.mockRestore();
  });

  it("dzwonek idzie do najemcy DOKUMENTU i niesie wyłącznie identyfikatory", async () => {
    seed({
      order: ok({ id: ORDER_ID, user_id: FOREIGN.userId, tenant_id: FOREIGN.tenantId }),
      write: fail("connection reset", "08006"),
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await recordTransactionDocument(input());

    const alert = h.notifyTenantAdmins.mock.calls[0]?.[0] ?? {};
    expect(alert).toMatchObject({
      tenantId: FOREIGN.tenantId,
      kind: "billing",
      href: "/admin/billing",
    });
    expect(String(alert.bodyPl)).toContain(TXN);
    expect(String(alert.bodyPl)).toContain("08006");
    // Żadnych danych nabywcy w treści dzwonka.
    expect(JSON.stringify(alert)).not.toMatch(/Dvořák|faktury@example\.com|CZ12345678/);
    errorLog.mockRestore();
  });

  it('awaria odczytu WŁAŚCICIELA to `failed`, nie cichy „gość" - i bez dzwonka (brak najemcy)', async () => {
    // Wcześniej błąd odczytu zamówienia dawał `data: null`, czyli „płatność
    // gościa" - dokument znikał bez śladu. Bez najemcy nie ma komu dzwonić,
    // więc zostaje log błędu (jak przy sporze bez najemcy).
    seed({ order: fail("JSON object requested, multiple rows", "PGRST116") });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("failed");
    expect(errorLog).toHaveBeenCalled();
    expect(h.notifyTenantAdmins).not.toHaveBeenCalled();
    expect(db.chainsFor("billing_documents")).toHaveLength(0);
    errorLog.mockRestore();
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
    // Odnowienie nie ma zamówienia - powiązanie zostaje puste.
    expect(row.order_id).toBeNull();
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
      // Zamówienie transakcji - bez niego historia płatności pokazałaby zakup
      // dwa razy (dokument + zamówienie „bez dokumentu").
      order_id: ORDER_ID,
    });
  });

  it.each([
    ["completed", "paid"],
    ["paid", "paid"],
    ["no_payment_required", "paid"],
    ["open", "open"],
    ["past_due", "open"],
    ["uncollectible", "open"],
    ["void", "void"],
    ["refunded", "refunded"],
    // Stan nieznany i brak stanu: dokument powstaje, ale NIE twierdzi, że zapłacono.
    ["pending", "open"],
    [null, "open"],
  ] as const)(
    "stan operatora %s zapisuje stan %s ze zbioru CHECK-a",
    async (provider, expected) => {
      await recordTransactionDocument(input({ status: provider }));

      const status = writtenRow("billing_documents", "insert").status;
      expect(status).toBe(expected);
      expect(BILLING_DOCUMENT_STATUSES).toContain(status);
    },
  );

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

describe("recordTransactionDocument - MIGAWKA stron (INV-07)", () => {
  it("nowy dokument niesie migawkę nabywcy, sprzedawcy i płaszczyzny z chwili zakupu", async () => {
    await recordTransactionDocument(input());

    expect(writtenRow("billing_documents", "insert")).toMatchObject({
      buyer_snapshot: {
        name: "Dvořák s.r.o.",
        taxId: "CZ12345678",
        addressLine1: "Náměstí 1",
        addressLine2: null,
        postalCode: "602 00",
        city: "Brno",
        country: "CZ",
        email: "faktury@example.com",
      },
      seller_snapshot: { name: "Fundacja Syntetyczna", taxId: "PL5260000000", city: "Kraków" },
      billing_plane: "managed",
    });
    // Źródła czytane w najemcy WŁAŚCICIELA, nie z payloadu.
    expect(db.lastChain("checkout_settings")?.argsOf("eq")).toEqual(["tenant_id", OWNER.tenantId]);
  });

  it("własny silnik podatkowy najemcy (`automatic_tax`) zapisuje płaszczyznę `merchant`", async () => {
    seed({ checkoutSettings: ok({ automatic_tax: true }) });

    await recordTransactionDocument(input());

    expect(writtenRow("billing_documents", "insert").billing_plane).toBe("merchant");
  });

  it("nieczytelne źródło migawki NIE blokuje dokumentu - zapis idzie bez migawki", async () => {
    // Członek ma zobaczyć zakup od razu; migawkę zamrozi pierwsze pobranie
    // PDF. Zgadywanie płaszczyzny (domyślne `managed`) utrwaliłoby za to
    // fałszywą notę MoR - dlatego brak, a nie wartość domyślna.
    seed({ checkoutSettings: fail("statement timeout", "57014") });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await recordTransactionDocument(input());

    expect(outcome).toBe("created");
    const row = writtenRow("billing_documents", "insert");
    expect(row).not.toHaveProperty("buyer_snapshot");
    expect(row).not.toHaveProperty("billing_plane");
    expect(errorLog).toHaveBeenCalled();
    expect(h.notifyTenantAdmins).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("uzupełnienie istniejącego dokumentu nie dotyka migawki", async () => {
    seed({ document: ok({ id: "doc-1", number: null, amount_cents: 4900, status: "paid" }) });

    await recordTransactionDocument(input());

    expect(writtenRow("billing_documents", "update")).not.toHaveProperty("buyer_snapshot");
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
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

  it("stan NIEZNANY nie cofa opłaconego dokumentu", async () => {
    seed({
      document: ok({ id: "doc-1", number: "FV/2026/08/0001", amount_cents: 4900, status: "paid" }),
    });

    const outcome = await recordTransactionDocument(
      input({ status: "pending", hostedUrl: null, pdfUrl: null }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("billing_documents").some((c) => c.has("update"))).toBe(false);
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
      // Brak `documentKind` (ładunek `transaction.updated`) = faktura.
      kind: "invoice",
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

  it("`documentKind: null` (sesja subskrypcji) nie jest dokumentem; inne wartości spoza zbioru też nie", () => {
    expect(documentInputFromTransaction({ id: "cs_sub", documentKind: null }, ENV)).toBeNull();
    expect(
      documentInputFromTransaction({ id: "cs_x", documentKind: "credit_note" }, ENV),
    ).toBeNull();
    expect(documentInputFromTransaction({ id: "cs_1", documentKind: "receipt" }, ENV)?.kind).toBe(
      "receipt",
    );
  });
});

describe("checkout.session.completed -> wiersz dokumentu (od zdarzenia operatora do zapisu)", () => {
  // Kryterium audytu INV-04: zakup jednorazowy dostaje wiersz w rejestrze,
  // a jego stan należy do zbioru z CHECK-a (parytet zbioru z migracją:
  // `billingDocumentsDbCheck.test.ts`). Ścieżka biegnie przez PRAWDZIWĄ
  // normalizację Stripe, bo to ona gubiła stan.
  function session(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "cs_bilet_1",
      mode: "payment",
      payment_status: "paid",
      amount_total: 12000,
      currency: "pln",
      customer: "cus_1",
      subscription: null,
      payment_intent: "pi_bilet_1",
      metadata: { orderId: ORDER_ID, purpose: "event_ticket" },
      customer_details: { email: "kupujacy@example.com" },
      ...over,
    };
  }

  async function record(type: string, object: Record<string, unknown>) {
    const normalized = normalizeStripeEvent({
      id: `evt_${type}`,
      type,
      created: 1_790_000_000,
      data: { object },
    });
    const documentInput = documentInputFromTransaction(normalized?.data, ENV);
    return documentInput ? recordTransactionDocument(documentInput) : null;
  }

  it.each(["event_ticket", "donation", "content_unlock"])(
    "opłacony zakup jednorazowy (%s) zakłada potwierdzenie płatności `paid`",
    async (purpose) => {
      const outcome = await record(
        "checkout.session.completed",
        session({ metadata: { orderId: ORDER_ID, purpose } }),
      );

      expect(outcome).toBe("created");
      const row = writtenRow("billing_documents", "insert");
      expect(row).toMatchObject({
        provider_document_id: "cs_bilet_1",
        kind: "receipt",
        status: "paid",
        amount_cents: 12000,
        currency: "PLN",
        user_id: OWNER.userId,
        tenant_id: OWNER.tenantId,
        order_id: ORDER_ID,
      });
      expect(BILLING_DOCUMENT_STATUSES).toContain(row.status);
    },
  );

  it("sesja w pełni pokryta kuponem (`no_payment_required`) to dokument opłacony", async () => {
    await record(
      "checkout.session.completed",
      session({ payment_status: "no_payment_required", amount_total: 0 }),
    );

    expect(writtenRow("billing_documents", "insert").status).toBe("paid");
  });

  it("płatność asynchroniczna zapisuje dokument dopiero po `async_payment_succeeded`", async () => {
    // Sesja `unpaid` nie ma jeszcze pieniędzy - normalizacja jej nie przepuszcza.
    expect(
      await record("checkout.session.completed", session({ payment_status: "unpaid" })),
    ).toBeNull();
    expect(db.chainsFor("billing_documents")).toHaveLength(0);

    await record("checkout.session.async_payment_succeeded", session());

    expect(writtenRow("billing_documents", "insert").status).toBe("paid");
  });

  it("sesja SUBSKRYPCJI nie zakłada drugiego dokumentu - dokumentem jest jej faktura", async () => {
    // Ta sama płatność przychodzi też jako `invoice.paid` (`in_...`). Wiersz
    // dla `cs_...` dublowałby te same pieniądze w panelu członka.
    const outcome = await record(
      "checkout.session.completed",
      session({ mode: "subscription", subscription: "sub_stripe_1" }),
    );

    expect(outcome).toBeNull();
    expect(db.chainsFor("billing_documents")).toHaveLength(0);
  });

  it("`invoice.paid` zakłada fakturę `paid` ze stanu faktury operatora", async () => {
    seed({ subscription: ok({ user_id: OWNER.userId, tenant_id: OWNER.tenantId }) });

    const outcome = await record("invoice.paid", {
      id: "in_odnowienie_1",
      status: "paid",
      subscription: "sub_stripe_1",
      currency: "pln",
      amount_paid: 4900,
      total: 4900,
      number: "FV/2026/10/0001",
    });

    expect(outcome).toBe("created");
    expect(writtenRow("billing_documents", "insert")).toMatchObject({
      provider_document_id: "in_odnowienie_1",
      kind: "invoice",
      status: "paid",
      number: "FV/2026/10/0001",
    });
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
