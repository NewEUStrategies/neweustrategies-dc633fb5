// OBUDOWA SERVER FN PANELU FAKTUR (`invoices.functions.ts`) - do 2.10.2026
// 0 z 5 funkcji pokrytych. Implementacje (`invoiceDocument.server`,
// `invoiceCrm.server`) robią właściwą pracę, ale TU zapada decyzja, której
// nie widać z żadnej innej warstwy: SKĄD bierze się tożsamość.
//
// JAKIE RYZYKO PRZYBIJA TEN PLIK:
//   * CUDZA FAKTURA. `generateMyInvoicePdf` przyjmuje z ładunku wyłącznie id
//     dokumentu i język - właściciel pochodzi z KONTEKSTU (token sesji).
//     Gdyby obudowa wzięła `userId` z ładunku, dowolny zalogowany pobrałby
//     PDF z NIP-em i adresem innego członka.
//   * WEJŚCIE. Id dokumentu musi być UUID, język tylko `pl`/`en` - to jedyna
//     bramka przed zapytaniem kluczem serwisowym.
//   * BRAMKA. Wszystkie cztery funkcje stoją za `requireSupabaseAuth`
//     (harness nie uruchamia middleware, więc przybijamy to strukturalnie).
//
// GRANICA ATRAP: klient Supabase z rolą serwisową i fabryka `createServerFn`.
// `invoiceDocument.server`, `invoicePdf` i `invoiceCrm.server` biegną
// PRAWDZIWE - test dowodzi, że PDF naprawdę powstaje z dokumentu właściciela.
//
// RODO: dane syntetyczne, adresy w `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  BILLING_IDS,
  isoFromBase,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";
import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    rpc: () => {
      throw new Error("test: obudowa panelu faktur nie powinna wołać RPC w tych scenariuszach");
    },
  },
}));

import {
  fetchMyCrmCompany,
  generateMyInvoicePdf,
  importMyCrmCompany,
  pushMyBillingToCrm,
} from "@/lib/billing/invoices.functions";

/** Właściciel sesji - tożsamość z tokenu, nigdy z ładunku. */
const OWNER = "11111111-1111-4111-8111-111111111111";
/** Inny członek tego samego tenanta. */
const OTHER = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const ISSUED_AT = isoFromBase(-3);

const context = (userId: string) => ({ supabase: {}, userId });

let db: SupabaseFromStub;

const eqArgs = (chain: RecordedChain | undefined) =>
  (chain?.calls ?? []).filter((call) => call.method === "eq").map((call) => call.args);

/** Base64 -> tekst PDF (nasze PDF-y są w 8-bitowym kodowaniu, bez kompresji). */
function pdfText(base64: string): string {
  return Buffer.from(base64, "base64").toString("latin1");
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    user_id: OWNER,
    tenant_id: BILLING_IDS.tenant,
    number: "FV/10/2026",
    kind: "invoice",
    amount_cents: 4900,
    currency: "PLN",
    issued_at: ISSUED_AT,
    pdf_url: null,
    hosted_url: "https://operator.example.com/i/abc",
    provider_document_id: "in_test_1",
    ...overrides,
  };
}

beforeEach(() => {
  db = supabaseFromStub();
  h.db.current = db;
});

afterEach(() => {
  h.db.current = null;
});

describe("invoices.functions - bramka i wejście", () => {
  it.each([
    ["generateMyInvoicePdf", generateMyInvoicePdf],
    ["fetchMyCrmCompany", fetchMyCrmCompany],
    ["importMyCrmCompany", importMyCrmCompany],
    ["pushMyBillingToCrm", pushMyBillingToCrm],
  ])("%s wymaga zalogowanej sesji (requireSupabaseAuth) i idzie metodą POST", (_, fn) => {
    expect(serverFnMiddlewareNames(fn)).toEqual(["requireSupabaseAuth"]);
    expect(asServerFn(fn).method).toBe("POST");
  });

  it("generateMyInvoicePdf przyjmuje UUID dokumentu i język pl/en - i nic więcej z ładunku", () => {
    expect(
      validateServerFnInput(generateMyInvoicePdf, {
        documentId: DOCUMENT_ID,
        locale: "en",
        userId: OTHER,
      }),
    ).toEqual({ documentId: DOCUMENT_ID, locale: "en" });
  });

  it.each([
    ["id dokumentu nie jest UUID", { documentId: "FV/10/2026", locale: "pl" }],
    ["nieobsługiwany język", { documentId: DOCUMENT_ID, locale: "de" }],
    ["brak id dokumentu", { locale: "pl" }],
  ])("odrzuca wejście, gdy %s", (_, input) => {
    expect(() => validateServerFnInput(generateMyInvoicePdf, input)).toThrow(ZodError);
  });
});

describe("generateMyInvoicePdf - kopia faktury z panelu członka", () => {
  it("dokument innego członka -> forbidden, mimo poprawnego id (właściciel z sesji, nie z ładunku)", async () => {
    db.setResponse("billing_documents", ok(documentRow({ user_id: OTHER })));

    const result = await callServerFn(generateMyInvoicePdf, {
      data: { documentId: DOCUMENT_ID, locale: "pl", userId: OTHER },
      context: context(OWNER),
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    // Odmowa zapada przed odczytem danych nabywcy - cudzy NIP nie jest czytany.
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("nieistniejący dokument -> not_found", async () => {
    db.setResponse("billing_documents", ok(null));

    await expect(
      callServerFn(generateMyInvoicePdf, {
        data: { documentId: DOCUMENT_ID, locale: "en" },
        context: context(OWNER),
      }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(eqArgs(db.lastChain("billing_documents"))).toEqual([["id", DOCUMENT_ID]]);
  });

  it("własny dokument -> PDF z numerem, nabywcą z danych do faktury i linkiem operatora", async () => {
    db.setResponse("billing_documents", ok(documentRow()));
    db.setResponse(
      "billing_profiles",
      ok({
        full_name: "Anna Przykladowa",
        company: "Acme",
        tax_id: "5260250274",
        email: "faktury@acme.example.com",
        address_line1: "ul. Firmowa 1",
        address_line2: null,
        city: "Warszawa",
        postal_code: "00-001",
        country_code: "PL",
        is_company: true,
      }),
    );
    db.setResponse("profiles", ok({ email: "anna@example.com" }));
    db.setResponse("site_settings", ok(null));
    db.setResponse("payment_orders", ok({ kind: "subscription" }));

    const result = await callServerFn<{
      ok: true;
      result: { fileName: string; base64: string; number: string; providerUrl: string | null };
    }>(generateMyInvoicePdf, {
      data: { documentId: DOCUMENT_ID, locale: "en" },
      context: context(OWNER),
    });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      fileName: "invoice-FV-10-2026.pdf",
      number: "FV/10/2026",
      providerUrl: "https://operator.example.com/i/abc",
    });
    const text = pdfText(result.result.base64);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("(Number: FV/10/2026)");
    expect(text).toContain("(Acme)");
    expect(text).toContain("5260250274");
    expect(text).toContain("(Membership - billing period fee)");
    expect(text).toContain(`(Issue date: ${ISSUED_AT.slice(0, 10)})`);
    // Dane nabywcy czytane są dla WŁAŚCICIELA SESJI w tenancie dokumentu.
    expect(eqArgs(db.lastChain("billing_profiles"))).toEqual([
      ["user_id", OWNER],
      ["tenant_id", BILLING_IDS.tenant],
    ]);
  });
});

/** Profil właściciela powiązany z kartoteką `crm-acme` w jego tenancie. */
const LINKED_PROFILE = {
  tenant_id: BILLING_IDS.tenant,
  current_company_id: "crm-acme",
  current_company: "Acme",
};

const ACME_CRM_ROW = {
  id: "crm-acme",
  name: "Acme",
  tax_id: "5260250274",
  address: "ul. Firmowa 1",
  city: "Warszawa",
  postal_code: "00-001",
  country: "PL",
  email: "biuro@acme.example.com",
  phone: null,
};

const writesTo = (table: string, method: "update" | "upsert") =>
  db.chainsFor(table).filter((chain) => chain.has(method));

describe("fetch/import/push CRM - tożsamość zawsze z sesji", () => {
  /** Profil bez tenanta: każda z trzech operacji kończy się na `no_tenant`. */
  beforeEach(() => {
    db.setResponse("profiles", ok(null));
  });

  it.each([
    ["fetchMyCrmCompany", fetchMyCrmCompany],
    ["importMyCrmCompany", importMyCrmCompany],
    ["pushMyBillingToCrm", pushMyBillingToCrm],
  ])("%s czyta profil zalogowanego użytkownika i oddaje wynik warstwy CRM", async (_, fn) => {
    const result = await callServerFn(fn, { context: context(OWNER) });

    expect(result).toEqual({ ok: false, error: "no_tenant" });
    expect(eqArgs(db.lastChain("profiles"))).toEqual([["id", OWNER]]);
    expect(db.chainsFor("crm_companies")).toHaveLength(0);
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("fetchMyCrmCompany zwraca kartotekę firmy powiązanej z profilem właściciela", async () => {
    db.setResponse("profiles", ok(LINKED_PROFILE));
    db.setResponse("crm_companies", ok(ACME_CRM_ROW));

    const result = await callServerFn(fetchMyCrmCompany, { context: context(OWNER) });

    expect(result).toEqual({
      ok: true,
      company: {
        companyId: "crm-acme",
        name: "Acme",
        taxId: "5260250274",
        addressLine1: "ul. Firmowa 1",
        city: "Warszawa",
        postalCode: "00-001",
        country: "PL",
        email: "biuro@acme.example.com",
        phone: null,
      },
    });
    expect(eqArgs(db.lastChain("crm_companies"))).toEqual([
      ["id", "crm-acme"],
      ["tenant_id", BILLING_IDS.tenant],
    ]);
  });
});

describe("import/push CRM - każdy przycisk pisze w SWOIM kierunku", () => {
  // Odwrócone podpięcie („Pobierz z CRM" wołające zapis do CRM) nadpisałoby
  // kartotekę zespołu danymi z checkoutu - a scenariusz `no_tenant` wyżej
  // wygląda dla obu kierunków identycznie, więc kierunek przybijamy tu.

  it("importMyCrmCompany zapisuje kartotekę w danych do faktury właściciela i nie rusza CRM", async () => {
    db.setResponse("profiles", (chain) => ok(chain.has("update") ? null : LINKED_PROFILE));
    db.setResponse("crm_companies", ok(ACME_CRM_ROW));
    // Brak dotychczasowych danych do faktury; zapis (upsert) się udaje.
    db.setResponse("billing_profiles", ok(null));

    const result = await callServerFn(importMyCrmCompany, { context: context(OWNER) });

    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-acme", name: "Acme" } });
    const [upsert] = writesTo("billing_profiles", "upsert");
    expect(upsert?.argsOf("upsert")?.[0]).toMatchObject({
      user_id: OWNER,
      tenant_id: BILLING_IDS.tenant,
      company: "Acme",
      tax_id: "5260250274",
      address_line1: "ul. Firmowa 1",
      city: "Warszawa",
    });
    expect(writesTo("crm_companies", "update")).toHaveLength(0);
  });

  it("pushMyBillingToCrm zapisuje dane do faktury właściciela w jego kartotece i nie rusza danych do faktury", async () => {
    db.setResponse("profiles", (chain) => ok(chain.has("update") ? null : LINKED_PROFILE));
    db.setResponse(
      "billing_profiles",
      ok({
        company: "Acme",
        tax_id: "5260250274",
        address_line1: "ul. Nowa 2",
        city: "Kraków",
        postal_code: "30-001",
        country_code: "PL",
        email: "faktury@acme.example.com",
        phone: null,
      }),
    );
    db.setResponse("crm_companies", ok(ACME_CRM_ROW));

    const result = await callServerFn(pushMyBillingToCrm, { context: context(OWNER) });

    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-acme" } });
    const [update] = writesTo("crm_companies", "update");
    // Nazwy kartoteki „Zapisz w CRM" nie przepisuje - utrzymuje ją zespół.
    expect(update?.argsOf("update")?.[0]).not.toHaveProperty("name");
    expect(update?.argsOf("update")?.[0]).toMatchObject({
      address: "ul. Nowa 2",
      city: "Kraków",
      postal_code: "30-001",
      email: "faktury@acme.example.com",
    });
    expect(eqArgs(update)).toEqual([
      ["id", "crm-acme"],
      ["tenant_id", BILLING_IDS.tenant],
    ]);
    // Dane do faktury tylko czytane - właściciela z sesji, w jego tenancie.
    expect(writesTo("billing_profiles", "upsert")).toHaveLength(0);
    expect(eqArgs(db.chainsFor("billing_profiles")[0])).toEqual([
      ["user_id", OWNER],
      ["tenant_id", BILLING_IDS.tenant],
    ]);
  });
});
