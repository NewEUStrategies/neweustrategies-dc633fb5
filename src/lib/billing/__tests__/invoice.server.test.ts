// Pobranie faktury po numerze transakcji - 0 z 5 funkcji pokrytych
// do 18.08.2026, a to bramka WŁASNOŚCI dokumentu księgowego.
//
// Faktur nie trzymamy u siebie: operator wystawia je i udostępnia pod własnym
// adresem. Ten moduł zamienia numer transakcji na taki adres, ale dopiero po
// potwierdzeniu, że transakcja należy do pytającego - i właśnie to jest tu
// przedmiotem testu, bo pomyłka oznacza pokazanie cudzego dokumentu księgowego
// (dane firmy, kwoty, NIP) osobie postronnej.
//
// Własność sprawdzana jest TRZEMA niezależnymi ścieżkami, bo transakcje
// powstają w różnych przepływach: `metadata.userId` z checkoutu, zamówienie
// w naszej bazie i identyfikator klienta z subskrypcji. Każda ma tu swój test,
// razem z przypadkiem, w którym ŻADNA nie potwierdza własności.
//
// Panel administratora (SUB-08 / INV-11) nie ma już wariantu „bez kontroli":
// pyta w zakresie NAJEMCY wołającego, a transakcja obcego najemcy (albo innego
// środowiska) jest dla niego `not_found` - nieodróżnialna od nieistniejącej.
//
// Izolacji tenanta w storage pilnuje pgTAP
// (`tenant_isolation_billing_storage_test.sql`) - tu jest strona TypeScriptu.
//
// ŻADNE żądanie nie wychodzi do Stripe: klient operatora jest atrapą.
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  owners: {
    current: null as {
      customerId: string | null;
      subscriptionId: string | null;
      userId: string | null;
    } | null,
  },
  ownersThrows: { current: false },
  /** Odpowiedzi atrapy PostgREST kolejno dla `payment_orders` i `subscriptions`. */
  orderRow: { current: null as { id: string } | null },
  subscriptionRow: { current: null as { id: string } | null },
  /** Profil z `metadata.userId` (ścieżka najemcy) - `null` = spoza najemcy. */
  profileRow: { current: null as { id: string } | null },
  /** Wszystkie subskrypcje klienta operatora (ścieżka najemcy, bez `maybeSingle`). */
  customerRows: { current: [] as Array<{ tenant_id: string }> },
  tables: [] as string[],
  filters: [] as Array<[string, unknown]>,
  /** Filtry per zapytanie - dla asercji „to KONKRETNE zapytanie miało zakres". */
  queries: [] as Array<{ table: string; eqs: Array<[string, unknown]> }>,
  invoice: {
    current: {
      hosted_invoice_url: "https://invoice.example.test/hosted",
      invoice_pdf: null,
    } as Record<string, unknown> | null,
  },
  session: { current: { invoice: "in_sess", payment_intent: null } as Record<string, unknown> },
  paymentIntent: {
    current: { latest_charge: { receipt_url: "https://receipt.example.test/ch" } } as Record<
      string,
      unknown
    >,
  },
  stripeCalls: [] as string[],
}));

vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: () => ({
    invoices: {
      retrieve: (id: string) => {
        h.stripeCalls.push(`invoices.retrieve:${id}`);
        return Promise.resolve(h.invoice.current);
      },
    },
    checkout: {
      sessions: {
        retrieve: (id: string) => {
          h.stripeCalls.push(`checkout.sessions.retrieve:${id}`);
          return Promise.resolve(h.session.current);
        },
      },
    },
    paymentIntents: {
      retrieve: (id: string) => {
        h.stripeCalls.push(`paymentIntents.retrieve:${id}`);
        return Promise.resolve(h.paymentIntent.current);
      },
    },
  }),
}));

vi.mock("@/lib/billing/transactions.server", () => ({
  retrieveTransactionOwners: () => {
    if (h.ownersThrows.current) return Promise.reject(new Error("stripe padł"));
    return Promise.resolve(h.owners.current);
  },
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const chain = (table: string) => {
    h.tables.push(table);
    const query = { table, eqs: [] as Array<[string, unknown]> };
    h.queries.push(query);
    const link: Record<string, unknown> = {};
    for (const method of ["select", "limit"]) link[method] = () => link;
    link.eq = (column: string, value: unknown) => {
      h.filters.push([column, value]);
      query.eqs.push([column, value]);
      return link;
    };
    link.maybeSingle = () =>
      Promise.resolve({
        data:
          table === "payment_orders"
            ? h.orderRow.current
            : table === "profiles"
              ? h.profileRow.current
              : h.subscriptionRow.current,
        error: null,
      });
    // Odczyt listy (bez ogniwa terminalnego) - subskrypcje klienta operatora.
    link.then = (onFulfilled?: (value: unknown) => unknown) =>
      Promise.resolve({ data: h.customerRows.current, error: null }).then(onFulfilled);
    return link;
  };
  return { supabaseAdmin: { from: (table: string) => chain(table) } };
});

import { invoiceUrlForTransaction } from "@/lib/billing/invoice.server";

const VALID_ID = "in_1SyntetycznyTestowy00";

beforeEach(() => {
  h.owners.current = { customerId: null, subscriptionId: null, userId: null };
  h.ownersThrows.current = false;
  h.orderRow.current = null;
  h.subscriptionRow.current = null;
  h.profileRow.current = null;
  h.customerRows.current = [];
  h.tables.length = 0;
  h.filters.length = 0;
  h.queries.length = 0;
  h.invoice.current = {
    hosted_invoice_url: "https://invoice.example.test/hosted",
    invoice_pdf: null,
  };
  h.session.current = { invoice: "in_sess", payment_intent: null };
  h.paymentIntent.current = { latest_charge: { receipt_url: "https://receipt.example.test/ch" } };
  h.stripeCalls.length = 0;
});

describe("invoiceUrlForTransaction - walidacja numeru", () => {
  it("odrzuca numer o obcym kształcie BEZ pytania operatora", async () => {
    const result = await invoiceUrlForTransaction({
      transactionId: "faktura-2026-08",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "invalid_transaction" });
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("odrzuca pusty numer, nie wywala się na nim", async () => {
    const result = await invoiceUrlForTransaction({
      transactionId: "   ",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "invalid_transaction" });
    expect(h.tables).toHaveLength(0);
  });

  it("transakcja nieznana operatorowi to `not_found`", async () => {
    h.owners.current = null;

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(h.tables).toHaveLength(0);
  });
});

describe("invoiceUrlForTransaction - WŁASNOŚĆ transakcji", () => {
  it("`metadata.userId` z checkoutu potwierdza własność bez pytania bazy", async () => {
    h.owners.current = { customerId: null, subscriptionId: null, userId: "user-me" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({
      ok: true,
      url: "https://invoice.example.test/hosted",
      transactionId: VALID_ID,
    });
    expect(h.tables).toHaveLength(0);
  });

  it("własne zamówienie w bazie potwierdza własność", async () => {
    h.orderRow.current = { id: "order-1" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toMatchObject({ ok: true });
    // Zapytanie filtruje po WŁAŚCICIELU, nie tylko po numerze transakcji.
    expect(h.filters).toContainEqual(["user_id", "user-me"]);
  });

  it("subskrypcja na tym samym kliencie operatora potwierdza własność", async () => {
    h.owners.current = { customerId: "cus_1", subscriptionId: null, userId: null };
    h.subscriptionRow.current = { id: "sub-1" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toMatchObject({ ok: true });
    expect(h.filters).toContainEqual(["provider_customer_id", "cus_1"]);
  });

  it("CUDZA TRANSAKCJA jest odrzucana i adres NIE jest nawet pobierany", async () => {
    h.owners.current = { customerId: "cus_obcy", subscriptionId: null, userId: "user-other" };
    h.orderRow.current = null;
    h.subscriptionRow.current = null;

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    // Najważniejsza asercja tego pliku: żadnego zapytania o dokument.
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("brak identyfikatora klienta u operatora nie omija kontroli własności", async () => {
    h.owners.current = { customerId: null, subscriptionId: null, userId: "user-other" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(h.tables).not.toContain("subscriptions");
  });

  // DEFEKT SUB-08 / INV-11 (naprawiony 12.10.2026). Ten test przypinał
  // wcześniej kontrakt „`userId: null` POMIJA kontrolę własności" - panel
  // administratora dowolnego najemcy pobierał nim fakturę KAŻDEJ transakcji
  // na wspólnym koncie operatora (NIP, adres nabywcy). Teraz wejście bez
  // zakresu jest odmową, i to zanim padnie jakiekolwiek pytanie do operatora.
  it("wejście BEZ zakresu (stare `userId: null`) jest odmową bez pytania operatora", async () => {
    h.owners.current = { customerId: "cus_obcy", subscriptionId: null, userId: "user-other" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: null,
    } as unknown as Parameters<typeof invoiceUrlForTransaction>[0]);

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(h.stripeCalls).toHaveLength(0);
    expect(h.tables).toHaveLength(0);
  });

  it("pusty `userId` też nie jest zakresem", async () => {
    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "",
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(h.stripeCalls).toHaveLength(0);
  });
});

describe("invoiceUrlForTransaction - panel administratora: granica NAJEMCY (SUB-08)", () => {
  const TENANT = "tenant-alfa";

  /** Zapytania do `table` z ich filtrami równościowymi. */
  function queriesOf(table: string): Array<Array<[string, unknown]>> {
    return h.queries.filter((q) => q.table === table).map((q) => q.eqs);
  }

  it("transakcja OBCEGO najemcy to `not_found` i adres dokumentu NIE jest pobierany", async () => {
    // Scenariusz z audytu: edytor najemcy B pyta o transakcję klienta
    // najemcy A. Żadna ścieżka dowodu nie trafia w jego najemcę.
    h.owners.current = { customerId: "cus_obcy", subscriptionId: "sub_obcy", userId: "user-a" };
    h.customerRows.current = [{ tenant_id: "tenant-beta" }];

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    // Najważniejsza asercja: żadnego zapytania o dokument.
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("odmowa jest NIEODRÓŻNIALNA od transakcji, której operator nie zna", async () => {
    h.owners.current = { customerId: "cus_obcy", subscriptionId: null, userId: null };
    const obca = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    h.owners.current = null;
    const nieznana = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    expect(obca).toEqual(nieznana);
  });

  it("zamówienie w bazie NAJEMCY i ŚRODOWISKA potwierdza przynależność", async () => {
    h.owners.current = { customerId: null, subscriptionId: null, userId: null };
    h.orderRow.current = { id: "order-1" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    expect(result).toMatchObject({ ok: true, url: "https://invoice.example.test/hosted" });
    expect(queriesOf("payment_orders")).toEqual([
      [
        ["provider_intent_id", VALID_ID],
        ["tenant_id", TENANT],
        ["environment", "sandbox"],
      ],
    ]);
  });

  it("subskrypcja operatora z transakcji, zapisana w najemcy, potwierdza przynależność", async () => {
    h.owners.current = { customerId: null, subscriptionId: "sub_alfa", userId: null };
    h.subscriptionRow.current = { id: "sub-row-1" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    expect(result).toMatchObject({ ok: true });
    expect(queriesOf("subscriptions")).toEqual([
      [
        ["provider_subscription_id", "sub_alfa"],
        ["tenant_id", TENANT],
        ["environment", "sandbox"],
      ],
    ]);
  });

  it("`metadata.userId` liczy się wyłącznie, gdy PROFIL tej osoby jest w najemcy", async () => {
    h.owners.current = { customerId: null, subscriptionId: null, userId: "user-alfa" };
    h.profileRow.current = { id: "user-alfa" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    expect(result).toMatchObject({ ok: true });
    expect(queriesOf("profiles")).toEqual([
      [
        ["id", "user-alfa"],
        ["tenant_id", TENANT],
      ],
    ]);
  });

  it("klient operatora WSPÓŁDZIELONY z innym najemcą nie przesądza przynależności", async () => {
    // Jedno konto operatora obsługuje wielu najemców, a ten sam klient bywa
    // w obu. Sam identyfikator klienta nie mówi, czyja jest ta płatność.
    h.owners.current = { customerId: "cus_wspolny", subscriptionId: null, userId: null };
    h.customerRows.current = [{ tenant_id: TENANT }, { tenant_id: "tenant-beta" }];

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("klient operatora obecny WYŁĄCZNIE w najemcy wołającego potwierdza przynależność", async () => {
    h.owners.current = { customerId: "cus_alfa", subscriptionId: null, userId: null };
    h.customerRows.current = [{ tenant_id: TENANT }, { tenant_id: TENANT }];

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    expect(result).toMatchObject({ ok: true });
    expect(queriesOf("subscriptions")).toContainEqual([
      ["provider_customer_id", "cus_alfa"],
      ["environment", "sandbox"],
    ]);
  });

  it("transakcja z INNEGO środowiska nie należy do najemcy", async () => {
    // Filtr środowiska jest częścią każdego zapytania ścieżki najemcy:
    // zamówienie z piaskownicy nie potwierdza transakcji produkcyjnej.
    h.owners.current = { customerId: null, subscriptionId: "sub_x", userId: null };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "live",
      tenantId: TENANT,
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    for (const eqs of [...queriesOf("payment_orders"), ...queriesOf("subscriptions")]) {
      expect(eqs).toContainEqual(["environment", "live"]);
    }
  });

  it("klient operatora BEZ żadnej subskrypcji w środowisku to odmowa", async () => {
    h.owners.current = { customerId: "cus_pusty", subscriptionId: null, userId: null };
    h.customerRows.current = [];

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      tenantId: TENANT,
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("invoiceUrlForTransaction - skąd bierze się adres dokumentu", () => {
  beforeEach(() => {
    h.owners.current = { customerId: null, subscriptionId: null, userId: "user-me" };
  });

  it("faktura (`in_`): woli adres hostowany", async () => {
    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toMatchObject({ ok: true, url: "https://invoice.example.test/hosted" });
    expect(h.stripeCalls).toContain(`invoices.retrieve:${VALID_ID}`);
  });

  it("faktura bez adresu hostowanego spada na PDF", async () => {
    h.invoice.current = {
      hosted_invoice_url: null,
      invoice_pdf: "https://invoice.example.test/pdf",
    };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toMatchObject({ ok: true, url: "https://invoice.example.test/pdf" });
  });

  it("faktura bez żadnego adresu to `invoice_unavailable`, nie sukces z pustką", async () => {
    h.invoice.current = { hosted_invoice_url: null, invoice_pdf: null };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "invoice_unavailable" });
    expect(result).not.toMatchObject({ ok: true });
  });

  it("sesja checkoutu (`cs_`) z fakturą schodzi na fakturę", async () => {
    const result = await invoiceUrlForTransaction({
      transactionId: "cs_1SyntetycznyTestowy0",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toMatchObject({ ok: true, url: "https://invoice.example.test/hosted" });
    expect(h.stripeCalls.some((call) => call.startsWith("checkout.sessions.retrieve"))).toBe(true);
  });

  it("sesja checkoutu bez faktury oddaje paragon z płatności", async () => {
    h.session.current = { invoice: null, payment_intent: "pi_x" };

    const result = await invoiceUrlForTransaction({
      transactionId: "cs_1SyntetycznyTestowy0",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toMatchObject({ ok: true, url: "https://receipt.example.test/ch" });
    expect(h.stripeCalls).toContain("paymentIntents.retrieve:pi_x");
  });

  it("sesja bez faktury i bez płatności to `invoice_unavailable`", async () => {
    h.session.current = { invoice: null, payment_intent: null };

    const result = await invoiceUrlForTransaction({
      transactionId: "cs_1SyntetycznyTestowy0",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "invoice_unavailable" });
    expect(h.stripeCalls.some((call) => call.startsWith("paymentIntents"))).toBe(false);
  });

  it("płatność (`pi_`) oddaje adres paragonu z obciążenia", async () => {
    const result = await invoiceUrlForTransaction({
      transactionId: "pi_1SyntetycznyTestowy0",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toMatchObject({ ok: true, url: "https://receipt.example.test/ch" });
    expect(h.stripeCalls).toContain("paymentIntents.retrieve:pi_1SyntetycznyTestowy0");
  });

  it("płatność bez obciążenia nie udaje sukcesu", async () => {
    h.paymentIntent.current = { latest_charge: null };

    const result = await invoiceUrlForTransaction({
      transactionId: "pi_1SyntetycznyTestowy0",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "invoice_unavailable" });
    expect(h.stripeCalls).toHaveLength(1);
  });

  it("obciążenie podane samym identyfikatorem (bez rozwinięcia) nie daje adresu", async () => {
    h.paymentIntent.current = { latest_charge: "ch_1" };

    const result = await invoiceUrlForTransaction({
      transactionId: "pi_1SyntetycznyTestowy0",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "invoice_unavailable" });
    expect(result).not.toMatchObject({ ok: true });
  });

  it("numer o nieobsługiwanym prefiksie (`ch_`) nie ma ścieżki dokumentu", async () => {
    const result = await invoiceUrlForTransaction({
      transactionId: "ch_1SyntetycznyTestowy0",
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "invoice_unavailable" });
    expect(h.stripeCalls).toHaveLength(0);
  });
});

describe("invoiceUrlForTransaction - awarie", () => {
  it("wyjątek po stronie operatora NIE wypływa na zewnątrz", async () => {
    h.ownersThrows.current = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: "user-me",
    });

    expect(result).toEqual({ ok: false, error: "invoice_unavailable" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
