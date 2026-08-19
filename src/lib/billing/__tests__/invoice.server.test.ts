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
  tables: [] as string[],
  filters: [] as Array<[string, unknown]>,
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
  createStripeClient: () => ({
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
    const link: Record<string, unknown> = {};
    for (const method of ["select", "limit"]) link[method] = () => link;
    link.eq = (column: string, value: unknown) => {
      h.filters.push([column, value]);
      return link;
    };
    link.maybeSingle = () =>
      Promise.resolve({
        data: table === "payment_orders" ? h.orderRow.current : h.subscriptionRow.current,
        error: null,
      });
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
  h.tables.length = 0;
  h.filters.length = 0;
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

  // Ścieżka administratora: `userId: null` POMIJA kontrolę własności. Tak jest
  // zaprojektowana obsługa zgłoszeń (admin dostaje sam numer transakcji od
  // klienta i nie zna jego konta), a dostępu pilnuje middleware
  // `requireAdminEditor` na server fn. Test przypina ten kontrakt, żeby nikt nie
  // przestawił go przypadkiem: wywołanie z `userId` ustawionym MUSI sprawdzać
  // własność, wywołanie z `null` - nie.
  it("ścieżka administratora (`userId: null`) świadomie pomija kontrolę własności", async () => {
    h.owners.current = { customerId: "cus_obcy", subscriptionId: null, userId: "user-other" };

    const result = await invoiceUrlForTransaction({
      transactionId: VALID_ID,
      environment: "sandbox",
      userId: null,
    });

    expect(result).toMatchObject({ ok: true });
    expect(h.tables).toHaveLength(0);
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
