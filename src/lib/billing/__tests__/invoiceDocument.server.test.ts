// KOPIA FAKTURY PDF Z PANELU CZŁONKA (`invoiceDocument.server`).
//
// Ten moduł składa plik, który członek pobiera z /profile/invoices i oddaje
// księgowości - gdy operator płatności nie wystawił własnego dokumentu albo
// jego link czasowy wygasł. Do tej pory żaden test go nie wykonywał, więc nic
// nie pilnowało trzech rzeczy, które tu są NAPRAWDĘ drogie:
//
//  1. CZYJ JEST PLIK. Dokument innego członka to `forbidden`, nieistniejący to
//     `not_found` - i w OBU przypadkach moduł nie czyta ani profilu
//     rozliczeniowego, ani danych wystawcy. Odmowa po złożeniu PDF-u z cudzymi
//     danymi byłaby odmową tylko z nazwy.
//  2. Z KTÓREGO TENANTA SĄ DANE. Nabywca (`billing_profiles`), wystawca
//     (`site_settings.invoice_issuer`) i opis pozycji (`payment_orders`) są
//     czytane w tenancie DOKUMENTU. Profil firmy z innego portalu na fakturze
//     to błędny dokument księgowy.
//  3. CO WIDAĆ NA DOKUMENCIE, gdy danych brakuje: łańcuch zastępczy nazwy
//     nabywcy (firma / osoba / e-mail konta / „-"), domyślny wystawca,
//     nieparsowalna data, numer operatora zamiast numeru faktury.
//
// GRANICA ATRAP: wyłącznie klient Supabase z rolą serwisową. Generator PDF
// (`invoicePdf`) biegnie PRAWDZIWY - asercje czytają treść gotowego pliku,
// a nie argumenty przekazane do generatora.
//
// ŚWIADOMIE NIE PRZYPIĘTE (zgłoszone jako defekty, nie jako kontrakt):
// błąd odczytu `site_settings` / `billing_profiles` / `profiles` daje dziś
// `ok: true` z PDF-em bez danych wystawcy lub nabywcy, a zamówienie
// `one_time` (bilet, treść) i odnowienie subskrypcji dostają opis domyślny.
//
// RODO: wszystkie dane są syntetyczne, adresy w domenie example.com.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodePdfText, formatInvoiceMoney } from "@/lib/billing/invoicePdf";
import {
  BILLING_IDS,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
}));

// GRANICA: klient roli serwisowej (moduł importuje go dynamicznie).
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
  },
}));

import { buildInvoicePdf, type InvoicePdfResult } from "@/lib/billing/invoiceDocument.server";

freezeClock();

const DOC_ID = "aaaaaaaa-1313-4000-8000-000000000007";

// --- atomy sceny ------------------------------------------------------------

/** Wiersz `billing_documents` w kształcie czytanym przez `buildInvoicePdf`. */
interface DocRow {
  id: string;
  user_id: string;
  tenant_id: string;
  number: string | null;
  kind: string;
  amount_cents: number;
  currency: string;
  issued_at: string;
  pdf_url: string | null;
  hosted_url: string | null;
  provider_document_id: string;
}

function docRow(overrides: Partial<DocRow> = {}): DocRow {
  return {
    id: DOC_ID,
    user_id: BILLING_IDS.me,
    tenant_id: BILLING_IDS.tenant,
    number: "FV/2099/06/0007",
    kind: "invoice",
    amount_cents: 12300,
    currency: "PLN",
    issued_at: relativeIso(-DZIEN),
    pdf_url: "https://invoice.example.com/in_test_7.pdf",
    hosted_url: "https://invoice.example.com/in_test_7",
    provider_document_id: "in_test_7",
    ...overrides,
  };
}

/** Wiersz `billing_profiles` - firma z kompletem danych adresowych. */
function billingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: "Jan Kowalski",
    company: "Zażółć Sp. z o.o.",
    tax_id: "PL1130000000",
    email: "faktury@example.com",
    address_line1: "ul. Syntetyczna 1",
    address_line2: "lok. 2",
    city: "Warszawa",
    postal_code: "00-950",
    country_code: "PL",
    is_company: true,
    ...overrides,
  };
}

interface Scene {
  doc?: DocRow | null;
  billing?: Record<string, unknown> | null;
  accountEmail?: string | null;
  /** `site_settings.value` dla klucza `invoice_issuer`; `null` = brak wiersza. */
  issuer?: unknown;
  orderKind?: string | null;
}

let stub: SupabaseFromStub;

function arrange(scene: Scene = {}): void {
  const doc = scene.doc === undefined ? docRow() : scene.doc;
  stub.setResponse("billing_documents", ok(doc));
  stub.setResponse(
    "billing_profiles",
    ok(scene.billing === undefined ? billingRow() : scene.billing),
  );
  const accountEmail = scene.accountEmail === undefined ? "konto@example.com" : scene.accountEmail;
  stub.setResponse("profiles", ok(accountEmail === null ? null : { email: accountEmail }));
  const issuer =
    scene.issuer === undefined
      ? {
          name: "Fundacja Syntetyczna",
          tax_id: "PL5260000000",
          address_line1: "ul. Testowa 5",
          postal_code: "31-000",
          city: "Kraków",
          country: "PL",
          email: "biuro@example.com",
        }
      : scene.issuer;
  stub.setResponse("site_settings", ok(issuer === null ? null : { value: issuer }));
  const orderKind = scene.orderKind === undefined ? "subscription" : scene.orderKind;
  stub.setResponse("payment_orders", ok(orderKind === null ? null : { kind: orderKind }));
}

beforeEach(() => {
  stub = supabaseFromStub();
  h.db.current = stub;
});

// --- odczyt gotowego pliku --------------------------------------------------

async function issued(
  locale: "pl" | "en" = "pl",
  userId: string = BILLING_IDS.me,
): Promise<InvoicePdfResult> {
  const outcome = await buildInvoicePdf({ userId, documentId: DOC_ID, locale });
  if (!outcome.ok) throw new Error(`test: oczekiwano pliku, jest odmowa ${outcome.error}`);
  return outcome.result;
}

/** Treść PDF jako tekst - strumień treści generatora jest nieskompresowany. */
function pdfText(result: InvoicePdfResult): string {
  return Buffer.from(result.base64, "base64").toString("latin1");
}

/** Literał tekstowy PDF dokładnie w tej postaci, w jakiej generator go zapisuje. */
function literal(value: string): string {
  return `(${encodePdfText(value)})`;
}

/**
 * Blok strony umowy (wystawca: x=56, nabywca: x=320): nazwa pogrubiona 10 pt
 * i wiersze adresowe 9 pt - wyciągnięte jako zakodowane literały z sekcji
 * między pierwszą a drugą linią poziomą dokumentu (tam generator stawia
 * strony; niżej, pod x=56, stoją już pozycje faktury).
 */
function partyBlock(pdf: string, x: 56 | 320): { name: string | null; rows: string[] } {
  const parties = pdf.split(/^0\.85 0\.85 0\.85 RG .* S$/m)[1] ?? "";
  const name = new RegExp(`BT /F2 10 Tf 1 0 0 1 ${x} \\d+ Tm \\((.*?)\\) Tj ET`).exec(parties);
  const rows = [
    ...parties.matchAll(new RegExp(`BT /F1 9 Tf 1 0 0 1 ${x} \\d+ Tm \\((.*?)\\) Tj ET`, "g")),
  ];
  return { name: name?.[1] ?? null, rows: rows.map((m) => m[1] ?? "") };
}

const encoded = (values: string[]): string[] => values.map(encodePdfText);

function eqFilters(chain: RecordedChain | undefined): ReadonlyArray<unknown>[] {
  return (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => [...c.args]);
}

// --- testy ------------------------------------------------------------------

describe("buildInvoicePdf - komu wolno wydać plik", () => {
  it("nieistniejący dokument -> not_found, bez odczytu danych nabywcy i wystawcy", async () => {
    arrange({ doc: null });

    const outcome = await buildInvoicePdf({
      userId: BILLING_IDS.me,
      documentId: DOC_ID,
      locale: "pl",
    });

    expect(outcome).toEqual({ ok: false, error: "not_found" });
    expect(eqFilters(stub.lastChain("billing_documents"))).toEqual([["id", DOC_ID]]);
    expect(stub.chains.map((c) => c.table)).toEqual(["billing_documents"]);
  });

  it("dokument innego członka -> forbidden, a jego profil rozliczeniowy nie jest czytany", async () => {
    // Właściciela sprawdzamy JAWNIE (klient serwisowy widzi każdy wiersz), więc
    // odmowa musi zapaść, zanim zaczniemy zbierać dane do PDF-u.
    arrange({ doc: docRow({ user_id: BILLING_IDS.other }) });

    const outcome = await buildInvoicePdf({
      userId: BILLING_IDS.me,
      documentId: DOC_ID,
      locale: "pl",
    });

    expect(outcome).toEqual({ ok: false, error: "forbidden" });
    expect(stub.chains.map((c) => c.table)).toEqual(["billing_documents"]);
  });
});

describe("buildInvoicePdf - dokument właściciela", () => {
  it("składa polską kopię: wystawca z ustawień tenanta, firma nabywcy, kwota, nota MoR", async () => {
    arrange();

    const result = await issued("pl");
    const pdf = pdfText(result);

    expect(result.number).toBe("FV/2099/06/0007");
    // Ukośniki numeru operatora nie mogą wejść do nazwy pobieranego pliku.
    expect(result.fileName).toBe("faktura-FV-2099-06-0007.pdf");
    expect(result.providerUrl).toBe("https://invoice.example.com/in_test_7.pdf");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);

    expect(pdf).toContain(literal("Faktura / dokument sprzedaży"));
    expect(pdf).toContain(literal("Numer: FV/2099/06/0007"));
    expect(pdf).toContain(literal(`Data wystawienia: ${relativeIso(-DZIEN).slice(0, 10)}`));

    expect(partyBlock(pdf, 56)).toEqual({
      name: encodePdfText("Fundacja Syntetyczna"),
      rows: encoded([
        "ul. Testowa 5",
        "31-000 Kraków",
        "PL",
        "NIP / VAT ID: PL5260000000",
        "biuro@example.com",
      ]),
    });
    // `is_company` => na dokumencie firma, nie osoba z profilu.
    expect(partyBlock(pdf, 320)).toEqual({
      name: encodePdfText("Zażółć Sp. z o.o."),
      rows: encoded([
        "ul. Syntetyczna 1",
        "lok. 2",
        "00-950 Warszawa",
        "PL",
        "NIP / VAT ID: PL1130000000",
        "faktury@example.com",
      ]),
    });
    expect(pdf).not.toContain(literal("Jan Kowalski"));

    expect(pdf).toContain(literal("Członkostwo - opłata za okres rozliczeniowy"));
    // Ta sama kwota w pozycji i w sumie - jedna pozycja, ilość 1.
    expect(pdf.split(literal(formatInvoiceMoney(12300, "PLN"))).length - 1).toBe(2);
    expect(pdf.match(/ Tm \(\d+\) Tj ET/g)).toEqual([" Tm (1) Tj ET"]);
    expect(pdf).toContain(literal("Razem do zapłaty"));
    expect(pdf).toContain(
      literal(
        "Podatek rozlicza operator płatności (Merchant of Record). Kopia dokumentu z panelu członka.",
      ),
    );
  });

  it("dane nabywcy, wystawcy i opisu czyta w tenancie DOKUMENTU, dla właściciela", async () => {
    arrange({ doc: docRow({ tenant_id: BILLING_IDS.foreignTenant }) });

    await issued("pl");

    expect(eqFilters(stub.lastChain("billing_profiles"))).toEqual([
      ["user_id", BILLING_IDS.me],
      ["tenant_id", BILLING_IDS.foreignTenant],
    ]);
    expect(eqFilters(stub.lastChain("site_settings"))).toEqual([
      ["tenant_id", BILLING_IDS.foreignTenant],
      ["key", "invoice_issuer"],
    ]);
    expect(eqFilters(stub.lastChain("profiles"))).toEqual([["id", BILLING_IDS.me]]);
    // Zamówienie TEJ transakcji (identyfikator dokumentu = identyfikator, który
    // realizacja jednorazowa zapisuje w `provider_intent_id`), nie dowolne
    // zamówienie tenanta - bez klucza opis pozycji brałby rodzaj cudzego zakupu.
    expect(eqFilters(stub.lastChain("payment_orders"))).toEqual([
      ["provider_intent_id", "in_test_7"],
      ["tenant_id", BILLING_IDS.foreignTenant],
    ]);
  });

  it("wersja angielska: etykiety, nota i nazwa pliku po angielsku, opis domyślny bez zamówienia", async () => {
    arrange({ orderKind: null, doc: docRow({ pdf_url: null }) });

    const result = await issued("en");
    const pdf = pdfText(result);

    expect(result.fileName).toBe("invoice-FV-2099-06-0007.pdf");
    // Bez pliku PDF operatora UI dostaje stronę hostowaną faktury.
    expect(result.providerUrl).toBe("https://invoice.example.com/in_test_7");
    expect(pdf).toContain(literal("Invoice / sales document"));
    expect(pdf).toContain(literal("Total due"));
    expect(pdf).toContain(literal("Tax ID / VAT ID: PL1130000000"));
    expect(pdf).toContain(literal("New European Strategies digital service"));
    expect(pdf).toContain(
      literal(
        "Tax is settled by the payment provider (Merchant of Record). Member panel copy of the document.",
      ),
    );
    expect(pdf).not.toContain(literal("Razem do zapłaty"));
  });

  it("bez numeru faktury dokument nosi identyfikator operatora - w treści i w nazwie pliku", async () => {
    arrange({ doc: docRow({ number: null, pdf_url: null, hosted_url: null }) });

    const result = await issued("pl");

    expect(result.number).toBe("in_test_7");
    expect(result.fileName).toBe("faktura-in_test_7.pdf");
    expect(result.providerUrl).toBeNull();
    expect(pdfText(result)).toContain(literal("Numer: in_test_7"));
  });

  it("numer od operatora nie przenosi separatorów ścieżki ani znaków spoza ASCII do nazwy pliku", async () => {
    arrange({ doc: docRow({ number: "../../FV 7/ą" }) });

    const result = await issued("pl");

    expect(result.fileName).toBe("faktura--FV-7-.pdf");
    // Na samym dokumencie numer zostaje dosłowny - to on jest cytowany w księgach.
    expect(result.number).toBe("../../FV 7/ą");
  });
});

describe("buildInvoicePdf - data wystawienia", () => {
  it("znacznik czasu z bazy staje się samą datą kalendarzową", async () => {
    arrange({ doc: docRow({ issued_at: relativeIso(-3 * DZIEN) }) });

    const pdf = pdfText(await issued("pl"));

    expect(pdf).toContain(literal(`Data wystawienia: ${relativeIso(-3 * DZIEN).slice(0, 10)}`));
  });

  it("nieparsowalna data nie wywraca generowania (toISOString rzuciłby RangeError)", async () => {
    arrange({ doc: docRow({ issued_at: "brak daty" }) });

    const pdf = pdfText(await issued("en"));

    expect(pdf).toContain(literal("Issue date: brak daty"));
  });
});

describe("buildInvoicePdf - wystawca (site_settings.invoice_issuer)", () => {
  it("bez wpisu w ustawieniach wystawcą jest domyślna nazwa, bez wymyślonych danych", async () => {
    arrange({ issuer: null });

    const pdf = pdfText(await issued("pl"));

    expect(partyBlock(pdf, 56)).toEqual({
      name: encodePdfText("New European Strategies"),
      rows: [],
    });
  });

  it("puste i nie-tekstowe pola ustawień są pomijane, tekst przycięty", async () => {
    arrange({
      issuer: {
        name: "   ",
        tax_id: 5260000000,
        address_line1: "",
        address_line2: "  Budynek B  ",
        postal_code: null,
        city: "  Kraków ",
        country: { code: "PL" },
        email: "  biuro@example.com ",
      },
    });

    const pdf = pdfText(await issued("pl"));

    expect(partyBlock(pdf, 56)).toEqual({
      name: encodePdfText("New European Strategies"),
      rows: encoded(["Budynek B", "Kraków", "biuro@example.com"]),
    });
  });

  it("wartość ustawienia pusta (null) traktowana jak brak danych wystawcy", async () => {
    stub.setResponse("billing_documents", ok(docRow()));
    stub.setResponse("billing_profiles", ok(billingRow()));
    stub.setResponse("profiles", ok({ email: "konto@example.com" }));
    stub.setResponse("site_settings", ok({ value: null }));
    stub.setResponse("payment_orders", ok(null));

    const pdf = pdfText(await issued("pl"));

    expect(partyBlock(pdf, 56)).toEqual({
      name: encodePdfText("New European Strategies"),
      rows: [],
    });
  });
});

describe("buildInvoicePdf - nazwa nabywcy (łańcuch zastępczy)", () => {
  const cases: Array<{
    title: string;
    billing: Record<string, unknown> | null;
    accountEmail: string | null;
    name: string;
  }> = [
    {
      title: "osoba prywatna -> imię i nazwisko, nie firma",
      billing: billingRow({ is_company: false }),
      accountEmail: "konto@example.com",
      name: "Jan Kowalski",
    },
    {
      title: "firma bez nazwy firmy -> osoba z profilu",
      billing: billingRow({ is_company: true, company: "   " }),
      accountEmail: "konto@example.com",
      name: "Jan Kowalski",
    },
    {
      title: "osoba bez imienia i nazwiska -> nazwa firmy",
      billing: billingRow({ is_company: false, full_name: null }),
      accountEmail: "konto@example.com",
      name: "Zażółć Sp. z o.o.",
    },
    {
      title: "profil bez nazw -> e-mail konta",
      billing: billingRow({ company: null, full_name: "" }),
      accountEmail: "konto@example.com",
      name: "konto@example.com",
    },
    {
      title: "profil bez nazw i konto bez e-maila -> myślnik",
      billing: billingRow({ company: null, full_name: null }),
      accountEmail: null,
      name: "-",
    },
    {
      title: "brak profilu rozliczeniowego -> e-mail konta",
      billing: null,
      accountEmail: "konto@example.com",
      name: "konto@example.com",
    },
    {
      title: "brak profilu i e-maila konta -> myślnik",
      billing: null,
      accountEmail: "   ",
      name: "-",
    },
  ];

  it.each(cases)("$title", async ({ billing, accountEmail, name }) => {
    arrange({ billing, accountEmail });

    const pdf = pdfText(await issued("pl"));

    expect(partyBlock(pdf, 320).name).toBe(encodePdfText(name));
  });

  it("brak profilu rozliczeniowego: jedynym wierszem nabywcy jest e-mail konta", async () => {
    arrange({ billing: null, accountEmail: "konto@example.com" });

    const pdf = pdfText(await issued("pl"));

    expect(partyBlock(pdf, 320).rows).toEqual(encoded(["konto@example.com"]));
  });

  it("pusty e-mail w profilu rozliczeniowym zastępuje e-mail konta", async () => {
    arrange({
      billing: billingRow({ email: " ", tax_id: null, address_line2: null }),
      accountEmail: "konto@example.com",
    });

    const pdf = pdfText(await issued("pl"));

    expect(partyBlock(pdf, 320).rows).toEqual(
      encoded(["ul. Syntetyczna 1", "00-950 Warszawa", "PL", "konto@example.com"]),
    );
  });
});
