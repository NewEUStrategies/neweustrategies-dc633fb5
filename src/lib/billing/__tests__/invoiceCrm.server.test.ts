// DANE NABYWCY NA FAKTURZE: wymiana „Pobierz z CRM" / „Zapisz w CRM"
// (`invoiceCrm.server.ts`). Do 2.10.2026 plik nie miał ani jednego testu -
// 0 z 7 funkcji, choć to on decyduje, CZYJ adres i NIP trafia na fakturę.
//
// JAKIE RYZYKO PRZYBIJA TEN PLIK:
//   * IZOLACJA TENANTA. Moduł działa kluczem serwisowym (z pominięciem RLS),
//     więc filtr `tenant_id` w KAŻDYM odczycie i zapisie jest jedynym zamkiem.
//     Bez niego „Pobierz z CRM" podstawiłby na fakturę kartotekę firmy
//     z innego obszaru roboczego, a „Zapisz w CRM" nadpisałby cudzą firmę.
//   * PUSTE NIE KASUJE PEŁNEGO. Pusta rubryka w CRM nie może skasować adresu
//     podanego w checkoucie - i odwrotnie: puste pole w danych do faktury nie
//     może wyczyścić danych, które zespół utrzymuje w CRM.
//   * BRAK FAŁSZYWEGO SUKCESU. Nieudany zapis to błąd, a profil NIE zostaje
//     przepięty na kartotekę, której nie zaktualizowaliśmy.
//   * IDEMPOTENCJA. Drugie kliknięcie nie zakłada drugiej firmy ani drugiego
//     wiersza danych do faktury.
//   * WSPÓLNA KARTOTEKA. Firmę w profilu wybiera się z katalogu, więc dzieli
//     ją wielu członków: „Zapisz w CRM" z danymi INNEJ firmy nie może jej
//     przemianować ani podmienić jej NIP-u.
//   * CUDZA KARTOTEKA (audyt INV-10). Nazwę firmy członek wpisuje sam, więc
//     odczyt nie oddaje firmy znalezionej po samej nazwie (cudzy NIP, e-mail,
//     telefon), a zapis tylko UZUPEŁNIA puste rubryki - jak SQL przy
//     wystawieniu faktury - i nie dotyka firmy o tej nazwie z INNYM NIP-em.
//   * KOD KRAJU. Kraj w CRM to wolny tekst; do `country_code` trafia tylko ISO-2.
//
// GRANICA ATRAP: wyłącznie klient Supabase z rolą serwisową - jako mała baza
// w pamięci, która STOSUJE filtry `eq`/`is`/`ilike`, `order` i `range`
// z łańcucha (pominięty filtr tenanta oddaje wtedy cudzy wiersz i test to
// widzi, skan przycięty do jednej porcji gubi firmę, a warunkowy UPDATE
// naprawdę chybia, gdy rubrykę ktoś w międzyczasie wypełnił) i pilnuje
// unikatu (tenant_id, name_norm) przy INSERT. `memberSync.server`
// (`normalizeCompanyName`, `ensureCrmCompany`) biegnie PRAWDZIWY: to ten sam
// dedup nazw, którego używa synchronizacja członków, i to jego zachowanie
// jest częścią kontraktu.
//
// RODO: dane syntetyczne, adresy w `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BASE_NOW,
  BILLING_IDS,
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
  rpc: {
    calls: [] as { fn: string; args: Record<string, unknown> }[],
    respond: null as ((args: Record<string, unknown>) => { data: unknown; error: unknown }) | null,
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpc.calls.push({ fn, args });
      if (!h.rpc.respond) throw new Error(`test: niezaplanowane wywołanie RPC "${fn}"`);
      return Promise.resolve(h.rpc.respond(args));
    },
  },
}));

import {
  importCrmCompanyToBillingProfile,
  loadCrmCompanyForUser,
  pushBillingProfileToCrm,
} from "@/lib/billing/invoiceCrm.server";
import { normalizeCompanyName } from "@/lib/crm/memberSync.server";

// --- mała baza w pamięci ----------------------------------------------------

interface ProfileRow {
  id: string;
  tenant_id: string | null;
  current_company_id: string | null;
  current_company: string | null;
}

interface BillingRow {
  user_id: string;
  tenant_id: string;
  is_company: boolean;
  company: string | null;
  full_name: string | null;
  tax_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  country_code: string;
  email: string | null;
  phone: string | null;
  region: string | null;
}

interface CompanyRow {
  id: string;
  tenant_id: string;
  name: string;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at?: string;
  created_by?: string | null;
}

type Row = Record<string, unknown>;

interface Scene {
  profiles: ProfileRow[];
  billing: BillingRow[];
  companies: CompanyRow[];
  /** Zapis do danej tabeli kończy się błędem PostgREST. */
  failWrite: { billing_profiles?: boolean; crm_companies?: boolean };
}

const TENANT = BILLING_IDS.tenant;
const FOREIGN_TENANT = BILLING_IDS.foreignTenant;
const ME = BILLING_IDS.me;

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: ME,
    tenant_id: TENANT,
    current_company_id: null,
    current_company: null,
    ...overrides,
  };
}

function billingRow(overrides: Partial<BillingRow> = {}): BillingRow {
  return {
    user_id: ME,
    tenant_id: TENANT,
    is_company: false,
    company: null,
    full_name: "Anna Przykładowa",
    tax_id: "5260250274",
    address_line1: "ul. Checkoutowa 7",
    address_line2: "lok. 3",
    city: "Gdańsk",
    postal_code: "80-001",
    country_code: "DE",
    email: "anna@example.com",
    phone: "+48 600 000 001",
    region: "pomorskie",
    ...overrides,
  };
}

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: "crm-acme",
    tenant_id: TENANT,
    name: "Acme",
    tax_id: null,
    address: null,
    city: null,
    postal_code: null,
    country: null,
    email: null,
    phone: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Filtry `eq` łańcucha - baza stosuje je naprawdę, tak jak PostgREST. */
function eqFilters(chain: RecordedChain): [string, unknown][] {
  return chain.calls
    .filter((call) => call.method === "eq")
    .map((call) => [String(call.args[0]), call.args[1]]);
}

/** Wzorzec ILIKE -> wyrażenie regularne (`%` = dowolny ciąg, `_` = jeden znak). */
function ilikeRegex(pattern: string): RegExp {
  const body = pattern
    .split("")
    .map((char) =>
      char === "%" ? ".*" : char === "_" ? "." : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${body}$`, "is");
}

function matching<T extends object>(rows: T[], chain: RecordedChain): T[] {
  const filters = eqFilters(chain);
  // `is(kolumna, null)` - warunek „rubryka wciąż pusta” warunkowego UPDATE.
  const nulls = chain.calls
    .filter((call) => call.method === "is")
    .map((call) => [String(call.args[0]), call.args[1]] as const);
  const patterns = chain.calls
    .filter((call) => call.method === "ilike")
    .map((call) => [String(call.args[0]), ilikeRegex(String(call.args[1]))] as const);
  return rows.filter(
    (row) =>
      filters.every(([column, value]) => (row as Row)[column] === value) &&
      nulls.every(([column, value]) => ((row as Row)[column] ?? null) === value) &&
      // ILIKE na NULL to w SQL NULL, czyli „nie pasuje” - a nie napis „null”.
      patterns.every(
        ([column, regex]) =>
          (row as Row)[column] != null && regex.test(String((row as Row)[column])),
      ),
  );
}

/** `order` w kolejności wywołań - jak ORDER BY a, b w PostgREST. */
function sorted<T extends object>(rows: T[], chain: RecordedChain): T[] {
  const keys = chain.calls
    .filter((call) => call.method === "order")
    .map((call) => String(call.args[0]));
  if (keys.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const left = String((a as Row)[key]);
      const right = String((b as Row)[key]);
      if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Odczyt: `maybeSingle` -> pierwszy wiersz albo null, inaczej lista po
 * `order`, przycięta `range` i `limit` (bez `order` - kolejność „sterty”,
 * czyli kolejność wierszy w scenie).
 */
function readRows<T extends object>(rows: T[], chain: RecordedChain) {
  const found = sorted(matching(rows, chain), chain);
  if (chain.has("maybeSingle")) return ok(found[0] ?? null);
  const range = chain.argsOf("range");
  const ranged = range ? found.slice(Number(range[0]), Number(range[1]) + 1) : found;
  const limit = chain.argsOf("limit")?.[0];
  return ok(typeof limit === "number" ? ranged.slice(0, limit) : ranged);
}

/** Zapis: z `.select().maybeSingle()` oddaje wiersz PO zmianie (albo null). */
function updateRows<T extends object>(rows: T[], chain: RecordedChain) {
  const patch = chain.argsOf("update")?.[0] as Partial<T>;
  const touched = matching(rows, chain);
  for (const row of touched) Object.assign(row, patch);
  return ok(chain.has("maybeSingle") ? (touched[0] ?? null) : null);
}

let scene: Scene;
let db: SupabaseFromStub;

function install(next: Partial<Scene>): Scene {
  scene = { profiles: [], billing: [], companies: [], failWrite: {}, ...next };
  db = supabaseFromStub();
  db.setResponse("profiles", (chain) =>
    chain.has("update") ? updateRows(scene.profiles, chain) : readRows(scene.profiles, chain),
  );
  db.setResponse("billing_profiles", (chain) => {
    if (!chain.has("upsert")) return readRows(scene.billing, chain);
    if (scene.failWrite.billing_profiles) return fail("billing_profiles: write failed");
    const patch = chain.argsOf("upsert")?.[0] as BillingRow;
    const current = scene.billing.find(
      (row) => row.user_id === patch.user_id && row.tenant_id === patch.tenant_id,
    );
    if (current) Object.assign(current, patch);
    else scene.billing.push({ ...patch });
    return ok(null);
  });
  db.setResponse("crm_companies", crmCompaniesResponder);
  h.db.current = db;
  return scene;
}

/** `name_norm` kartoteki: kolumna generowana `lower(btrim(name))`. */
const nameNorm = (name: string) => name.trim().toLowerCase();

/** Id kartoteki założonej przez INSERT (osobny podmiot o tej samej nazwie). */
const INSERTED_ID = "crm-wstawiona";

/**
 * `crm_companies` w kształcie bazy: odczyt, UPDATE i INSERT pilnujący unikatu
 * `crm_companies_tenant_name_norm_uniq` (tenant_id, name_norm).
 */
function crmCompaniesResponder(chain: RecordedChain) {
  if (chain.has("insert")) {
    if (scene.failWrite.crm_companies) return fail("crm_companies: write failed");
    const draft = chain.argsOf("insert")?.[0] as Partial<CompanyRow> & {
      tenant_id: string;
      name: string;
    };
    const taken = scene.companies.some(
      (row) => row.tenant_id === draft.tenant_id && nameNorm(row.name) === nameNorm(draft.name),
    );
    if (taken) {
      return fail(
        'duplicate key value violates unique constraint "crm_companies_tenant_name_norm_uniq"',
        "23505",
      );
    }
    const created = company({ ...draft, id: INSERTED_ID, created_at: "2026-09-01T00:00:00.000Z" });
    scene.companies.push(created);
    return ok(created);
  }
  if (!chain.has("update")) return readRows(scene.companies, chain);
  if (scene.failWrite.crm_companies) return fail("crm_companies: write failed");
  return updateRows(scene.companies, chain);
}

/**
 * RPC `crm_ensure_member_company` w kształcie bazy: dedup po KLUCZU nazwy
 * (`crm_member_company_key` = `normalizeCompanyName` - forma prawna znika),
 * najstarsza kartoteka w tenancie, a bez trafienia - nowa, bez NIP-u.
 */
function ensureCompanyRpc(newId: string) {
  return (args: Record<string, unknown>) => {
    const tenantId = String(args.p_tenant_id);
    const name = String(args.p_name);
    const [existing] = scene.companies
      .filter(
        (row) =>
          row.tenant_id === tenantId &&
          normalizeCompanyName(row.name) === normalizeCompanyName(name),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    if (existing) return { data: [{ id: existing.id }], error: null };
    scene.companies.push(company({ id: newId, tenant_id: tenantId, name: name.trim() }));
    return { data: [{ id: newId }], error: null };
  };
}

const myProfile = () => scene.profiles.find((row) => row.id === ME);
const myBilling = () => scene.billing.find((row) => row.user_id === ME && row.tenant_id === TENANT);
const companyById = (id: string) => scene.companies.find((row) => row.id === id);
const writes = (table: string, method: "insert" | "update" | "upsert") =>
  db.chainsFor(table).filter((chain) => chain.has(method));

beforeEach(() => {
  h.rpc.calls.length = 0;
  h.rpc.respond = null;
});

afterEach(() => {
  h.db.current = null;
  vi.useRealTimers();
});

// --- odczyt kartoteki --------------------------------------------------------

describe("loadCrmCompanyForUser - kartoteka firmy pokazywana w panelu faktur", () => {
  it.each([
    ["nie ma profilu", [] as ProfileRow[]],
    ["profil nie ma tenanta", [profile({ tenant_id: null, current_company: "Acme" })]],
  ])(
    "gdy %s, zwraca no_tenant i nie zagląda ani do CRM, ani do danych faktury",
    async (_, profiles) => {
      install({ profiles, companies: [company()] });

      await expect(loadCrmCompanyForUser(ME)).resolves.toEqual({ ok: false, error: "no_tenant" });

      expect(db.chainsFor("crm_companies")).toHaveLength(0);
      expect(db.chainsFor("billing_profiles")).toHaveLength(0);
      expect(db.lastChain("profiles")?.argsOf("eq")).toEqual(["id", ME]);
    },
  );

  it("firma powiązana z profilem: czyta kartotekę po id w tenancie właściciela i czyści puste rubryki", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme", current_company: "Acme" })],
      companies: [
        company({
          tax_id: " 5260250274 ",
          address: "   ",
          city: " Warszawa ",
          postal_code: "00-001",
          country: "PL",
          email: "biuro@acme.example.com",
          phone: "",
        }),
      ],
    });

    const result = await loadCrmCompanyForUser(ME);

    expect(result).toEqual({
      ok: true,
      company: {
        companyId: "crm-acme",
        name: "Acme",
        taxId: "5260250274",
        addressLine1: null,
        city: "Warszawa",
        postalCode: "00-001",
        country: "PL",
        email: "biuro@acme.example.com",
        phone: null,
      },
    });
    expect(eqFilters(db.lastChain("crm_companies")!)).toEqual([
      ["id", "crm-acme"],
      ["tenant_id", TENANT],
    ]);
    // Relacja wystarcza - dopasowanie po nazwie w ogóle nie rusza.
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
    expect(db.chainsFor("crm_companies")).toHaveLength(1);
  });

  it("kartoteka spod id z profilu należy do innego tenanta: nie wycieka, wygrywa firma o NIP-ie członka we WŁASNYM tenancie", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-obca", current_company: "Acme" })],
      billing: [billingRow({ tax_id: "5260250274" })],
      companies: [
        company({ id: "crm-obca", tenant_id: FOREIGN_TENANT, tax_id: "5260250274" }),
        company({ id: "crm-acme", tax_id: "PL5260250274" }),
      ],
    });

    const result = await loadCrmCompanyForUser(ME);

    expect(result).toMatchObject({
      ok: true,
      company: { companyId: "crm-acme", taxId: "PL5260250274" },
    });
    const [byId, byTaxId] = db.chainsFor("crm_companies");
    expect(eqFilters(byId)).toContainEqual(["tenant_id", TENANT]);
    expect(eqFilters(byTaxId)).toEqual([["tenant_id", TENANT]]);
  });

  it("INV-10: bez relacji firma o tej samej NAZWIE nie wycieka - ani jej NIP, ani e-mail, ani telefon", async () => {
    // CO BYŁO ZŁE. Bez relacji odczyt dopasowywał kartotekę po nazwie firmy
    // z profilu albo z danych do faktury - tekście, który członek wpisuje sam.
    // Wpisanie „Acme” oddawało NIP, adres, e-mail i telefon cudzej firmy,
    // a „Pobierz z CRM” kopiował je do jego faktury.
    install({
      profiles: [profile({ current_company: "ACME Sp. z o.o." })],
      billing: [billingRow({ company: "Acme", tax_id: "5260250274" })],
      companies: [
        company({
          id: "crm-cudza",
          name: "Acme",
          tax_id: "1132853869",
          address: "ul. Zarządowa 1",
          email: "zarzad@acme.example.com",
          phone: "+48 22 111 11 11",
        }),
      ],
    });

    await expect(loadCrmCompanyForUser(ME)).resolves.toEqual({ ok: false, error: "no_company" });

    // Żadne zapytanie nie odsiewa kandydatów po nazwie - wyłącznie po NIP-ie.
    for (const chain of db.chainsFor("crm_companies")) {
      const columns = chain.calls.filter((call) => call.method === "ilike").map((c) => c.args[0]);
      expect(columns).not.toContain("name");
    }
  });

  it("bez relacji dopasowuje kartotekę po NIP-ie z danych do faktury TEGO tenanta, niezależnie od nazwy", async () => {
    install({
      profiles: [profile({ current_company: "Zupełnie Inna Nazwa" })],
      billing: [
        // Dane do faktury tego samego członka w INNYM tenancie: ich NIP
        // wskazywałby kartotekę „Beta” - nie wolno go użyć.
        billingRow({ tenant_id: FOREIGN_TENANT, tax_id: "1132853869" }),
        billingRow({ company: "Kowalska", tax_id: "526-025-02-74" }),
      ],
      companies: [
        // Ten sam NIP w obcym tenancie stoi PIERWSZY - filtr tenanta go odcina.
        company({ id: "crm-obca", tenant_id: FOREIGN_TENANT, tax_id: "5260250274" }),
        company({ id: "crm-beta", name: "Beta", tax_id: "1132853869" }),
        company({
          id: "crm-kowalska",
          name: "Kowalska Consulting Jan Kowalski",
          tax_id: "PL 526 025 02 74",
          city: "Sopot",
        }),
      ],
    });

    const result = await loadCrmCompanyForUser(ME);

    expect(result).toMatchObject({
      ok: true,
      company: {
        companyId: "crm-kowalska",
        name: "Kowalska Consulting Jan Kowalski",
        city: "Sopot",
      },
    });
    expect(eqFilters(db.lastChain("billing_profiles")!)).toEqual([
      ["user_id", ME],
      ["tenant_id", TENANT],
    ]);
    const search = db.lastChain("crm_companies")!;
    expect(eqFilters(search)).toEqual([["tenant_id", TENANT]]);
    // Kandydatów odsiewa baza (wzorzec po NIP-ie), nie przycięta porcja tenanta.
    expect(search.argsOf("ilike")?.[0]).toBe("tax_id");
    expect(search.has("limit")).toBe(false);
  });

  it.each([
    ["nie ma danych do faktury", [] as BillingRow[]],
    ["dane do faktury nie mają NIP-u", [billingRow({ tax_id: null })]],
    ["NIP to same separatory", [billingRow({ tax_id: " - . " })]],
    ["NIP nie ma ani litery, ani cyfry", [billingRow({ tax_id: "///" })]],
  ])(
    "bez relacji i bez użytecznego NIP-u (%s) -> no_company bez przeszukiwania kartoteki",
    async (_, billing) => {
      install({
        profiles: [profile({ current_company: "Acme" })],
        billing,
        companies: [company({ tax_id: "5260250274" })],
      });

      await expect(loadCrmCompanyForUser(ME)).resolves.toEqual({
        ok: false,
        error: "no_company",
      });
      expect(db.chainsFor("crm_companies")).toHaveLength(0);
    },
  );

  it("NIP nie pasuje do żadnej firmy w tenancie -> no_company (bez podstawiania firmy „najbliższej”)", async () => {
    install({
      profiles: [profile()],
      billing: [billingRow({ tax_id: "5260250274" })],
      companies: [
        company({ id: "crm-obca", tenant_id: FOREIGN_TENANT, tax_id: "5260250274" }),
        // Te same cyfry w tej samej kolejności, ale inny klucz: unijny VAT ID
        // z prefiksem DE i dłuższy numer. Wzorzec bazy je przepuszcza, klucz nie.
        company({ id: "crm-de", tax_id: "DE5260250274" }),
        company({ id: "crm-dluzszy", tax_id: "52602502741" }),
      ],
    });

    await expect(loadCrmCompanyForUser(ME)).resolves.toEqual({ ok: false, error: "no_company" });
  });

  it.each([
    ["myślniki", "526-025-02-74"],
    ["spacje i prefiks PL", "PL 526 025 02 74"],
    ["kropki i prefiks małymi literami", "pl526.025.02.74"],
  ])(
    "wzorzec bazy przepuszcza każdy zapis NIP-u o tym samym kluczu (jak _event_invoice_tax_key): %s",
    async (_, crmTaxId) => {
      install({
        profiles: [profile()],
        billing: [billingRow({ tax_id: "5260250274" })],
        companies: [company({ id: "crm-cel", tax_id: crmTaxId })],
      });

      const result = await loadCrmCompanyForUser(ME);

      expect(result).toMatchObject({
        ok: true,
        company: { companyId: "crm-cel", taxId: crmTaxId },
      });
    },
  );

  it("duży tenant: firma dalej niż pierwsza porcja kandydatów nadal zostaje znaleziona po NIP-ie", async () => {
    // Numery podobne (te same cyfry w tej samej kolejności - wzorzec bazy ich
    // nie odsieje), wszystkie starsze od szukanej firmy: po ORDER BY
    // created_at stoi ona dopiero w trzeciej porcji.
    const lookalikes = Array.from({ length: 1200 }, (_, index) =>
      company({
        id: `crm-podobna-${index}`,
        name: `Podobna ${index}`,
        tax_id: `5260250274${index}`,
      }),
    );
    install({
      profiles: [profile()],
      billing: [billingRow({ tax_id: "5260250274" })],
      companies: [
        ...lookalikes,
        company({
          id: "crm-acme",
          tax_id: "526-025-02-74",
          city: "Poznań",
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      ],
    });

    const result = await loadCrmCompanyForUser(ME);

    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-acme", city: "Poznań" } });
    const searches = db.chainsFor("crm_companies");
    expect(searches).toHaveLength(3);
    for (const search of searches) {
      expect(eqFilters(search)).toEqual([["tenant_id", TENANT]]);
    }
  });

  it("kilka kartotek o tym samym kluczu NIP-u: wybiera najstarszą - tę samą, którą wskazuje _event_invoice_crm_link", async () => {
    install({
      profiles: [profile()],
      billing: [billingRow({ tax_id: "5260250274" })],
      companies: [
        // Kolejność „sterty” stawia nowszy duplikat pierwszy - bez ORDER BY
        // wynik zależałby od tego, jak baza akurat odda wiersze.
        company({ id: "crm-nowszy", tax_id: "5260250274", created_at: "2026-05-01T00:00:00.000Z" }),
        company({
          id: "crm-starszy",
          tax_id: "PL5260250274",
          created_at: "2026-02-01T00:00:00.000Z",
        }),
      ],
    });

    const result = await loadCrmCompanyForUser(ME);

    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-starszy" } });
    const search = db.lastChain("crm_companies")!;
    expect(
      search.calls.filter((call) => call.method === "order").map((call) => call.args[0]),
    ).toEqual(["created_at", "id"]);
  });

  it("kartoteka odpowiada bez wierszy (data: null) -> no_company, nie wyjątek", async () => {
    install({ profiles: [profile()], billing: [billingRow()] });
    db.setResponse("crm_companies", ok(null));

    await expect(loadCrmCompanyForUser(ME)).resolves.toEqual({ ok: false, error: "no_company" });
  });

  it("błąd odczytu kartoteki przerywa operację wyjątkiem, zamiast udawać „brak firmy”", async () => {
    install({ profiles: [profile({ current_company_id: "crm-acme" })], billing: [billingRow()] });
    db.setResponse("crm_companies", fail("crm_companies: read failed"));

    await expect(loadCrmCompanyForUser(ME)).rejects.toThrow("crm_companies: read failed");
  });
});

// --- CRM -> dane do faktury --------------------------------------------------

describe("importCrmCompanyToBillingProfile - „Pobierz z CRM”", () => {
  it("brak kartoteki: zwraca błąd odczytu i niczego nie zapisuje", async () => {
    install({ profiles: [profile({ current_company: "Nieznana" })], billing: [billingRow()] });
    const before = structuredClone(scene.billing);

    await expect(importCrmCompanyToBillingProfile(ME)).resolves.toEqual({
      ok: false,
      error: "no_company",
    });
    expect(writes("billing_profiles", "upsert")).toHaveLength(0);
    expect(writes("profiles", "update")).toHaveLength(0);
    expect(scene.billing).toEqual(before);
  });

  it("INV-10: nie kopiuje do faktury danych firmy znalezionej po samej nazwie i nie przepina na nią profilu", async () => {
    install({
      profiles: [profile({ current_company: "Acme" })],
      billing: [billingRow({ company: "Acme", tax_id: "5260250274" })],
      companies: [
        company({
          id: "crm-cudza",
          name: "Acme",
          tax_id: "1132853869",
          address: "ul. Zarządowa 1",
          email: "zarzad@acme.example.com",
        }),
      ],
    });
    const before = structuredClone(scene.billing);

    await expect(importCrmCompanyToBillingProfile(ME)).resolves.toEqual({
      ok: false,
      error: "no_company",
    });
    expect(scene.billing).toEqual(before);
    expect(writes("billing_profiles", "upsert")).toHaveLength(0);
    expect(myProfile()?.current_company_id).toBeNull();
  });

  it("profil traci tenanta między odczytem kartoteki a zapisem -> no_tenant i zero zapisów", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme" })],
      companies: [company({ tax_id: "5260250274" })],
    });
    let reads = 0;
    db.setResponse("profiles", (chain) => {
      reads += 1;
      return readRows(reads === 1 ? scene.profiles : [], chain);
    });

    await expect(importCrmCompanyToBillingProfile(ME)).resolves.toEqual({
      ok: false,
      error: "no_tenant",
    });
    expect(writes("billing_profiles", "upsert")).toHaveLength(0);
    expect(scene.billing).toEqual([]);
  });

  it("wypełnione rubryki kartoteki wygrywają z danymi z checkoutu, a profil zostaje powiązany z firmą", async () => {
    install({
      profiles: [profile({ current_company: "Acme" })],
      billing: [billingRow({ company: "Acme" })],
      companies: [
        company({
          tax_id: "PL5260250274",
          address: "ul. Firmowa 1",
          city: "Warszawa",
          postal_code: "00-001",
          country: "PL",
          email: "faktury@acme.example.com",
          phone: "+48 22 000 00 00",
        }),
      ],
    });

    const result = await importCrmCompanyToBillingProfile(ME);

    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-acme", name: "Acme" } });
    expect(myBilling()).toEqual({
      user_id: ME,
      tenant_id: TENANT,
      is_company: true,
      company: "Acme",
      tax_id: "PL5260250274",
      address_line1: "ul. Firmowa 1",
      city: "Warszawa",
      postal_code: "00-001",
      country_code: "PL",
      email: "faktury@acme.example.com",
      phone: "+48 22 000 00 00",
      // Pól, których CRM nie zna, import nie rusza.
      full_name: "Anna Przykładowa",
      address_line2: "lok. 3",
      region: "pomorskie",
    });
    const [upsert] = writes("billing_profiles", "upsert");
    expect(upsert.argsOf("upsert")?.[1]).toEqual({ onConflict: "user_id,tenant_id" });
    expect(myProfile()).toMatchObject({ current_company_id: "crm-acme", current_company: "Acme" });
    expect(eqFilters(writes("profiles", "update")[0])).toEqual([
      ["id", ME],
      ["tenant_id", TENANT],
    ]);
  });

  it("puste rubryki kartoteki NIE kasują adresu, NIP-u ani kontaktu podanych w checkoucie", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme" })],
      billing: [billingRow()],
      companies: [company({ name: "Acme", city: "  ", phone: "" })],
    });

    const result = await importCrmCompanyToBillingProfile(ME);

    expect(result.ok).toBe(true);
    expect(myBilling()).toEqual({
      ...billingRow(),
      is_company: true,
      company: "Acme",
    });
  });

  it("pierwszy import bez danych do faktury zakłada je z kartoteki; kraj domyślnie PL", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme" })],
      billing: [],
      companies: [company({ name: "Acme" })],
    });

    const result = await importCrmCompanyToBillingProfile(ME);

    expect(result.ok).toBe(true);
    expect(scene.billing).toEqual([
      {
        user_id: ME,
        tenant_id: TENANT,
        is_company: true,
        company: "Acme",
        full_name: null,
        tax_id: null,
        address_line1: null,
        address_line2: null,
        city: null,
        postal_code: null,
        country_code: "PL",
        email: null,
        phone: null,
        region: null,
      },
    ]);
    // Kartoteka jest źródłem prawdy o nazwie: profil dostaje relację I nazwę z CRM.
    expect(myProfile()).toEqual({
      id: ME,
      tenant_id: TENANT,
      current_company_id: "crm-acme",
      current_company: "Acme",
    });
  });

  it.each([
    ["nazwa kraju („Polska”) nie nadpisuje poprawnego kodu z checkoutu", "Polska", "DE", "DE"],
    ["nazwa kraju („Niemcy”) przy pierwszym imporcie daje domyślne PL", "Niemcy", null, "PL"],
    ["kod ISO zapisany małymi literami jest przyjmowany jako kod", " de ", "PL", "DE"],
  ])(
    "kraj z kartoteki to wolny tekst - do kodu kraju trafia tylko kod ISO: %s",
    async (_, crmCountry, existingCode, expected) => {
      install({
        profiles: [profile({ current_company_id: "crm-acme" })],
        billing: existingCode ? [billingRow({ country_code: existingCode })] : [],
        companies: [company({ country: crmCountry })],
      });

      const result = await importCrmCompanyToBillingProfile(ME);

      expect(result.ok).toBe(true);
      expect(myBilling()?.country_code).toBe(expected);
    },
  );

  it("nieudany zapis danych do faktury -> no_billing_data, a profil NIE zostaje przepięty na kartotekę", async () => {
    install({
      profiles: [profile({ current_company: "Acme" })],
      billing: [billingRow()],
      companies: [company({ tax_id: "5260250274", city: "Warszawa" })],
      failWrite: { billing_profiles: true },
    });

    await expect(importCrmCompanyToBillingProfile(ME)).resolves.toEqual({
      ok: false,
      error: "no_billing_data",
    });
    expect(writes("profiles", "update")).toHaveLength(0);
    expect(myProfile()).toMatchObject({ current_company_id: null, current_company: "Acme" });
    expect(myBilling()?.city).toBe("Gdańsk");
  });

  it("ponowny import jest idempotentny: jeden wiersz, te same dane", async () => {
    install({
      profiles: [profile({ current_company: "Acme" })],
      billing: [billingRow({ company: "Acme" })],
      companies: [company({ tax_id: "5260250274", city: "Warszawa" })],
    });

    await importCrmCompanyToBillingProfile(ME);
    const first = structuredClone(scene.billing);
    const second = await importCrmCompanyToBillingProfile(ME);

    expect(second.ok).toBe(true);
    expect(scene.billing).toEqual(first);
    expect(scene.billing).toHaveLength(1);
    // Po pierwszym imporcie profil jest powiązany - drugi czyta kartotekę po id.
    expect(eqFilters(db.lastChain("crm_companies")!)).toEqual([
      ["id", "crm-acme"],
      ["tenant_id", TENANT],
    ]);
  });
});

// --- dane do faktury -> CRM --------------------------------------------------

describe("pushBillingProfileToCrm - „Zapisz w CRM”", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE_NOW);
  });

  it("bez tenanta zwraca no_tenant i nie czyta danych do faktury", async () => {
    install({ profiles: [], billing: [billingRow({ company: "Acme" })] });

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({ ok: false, error: "no_tenant" });
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("brak danych do faktury -> no_billing_data, nawet gdy profil zna nazwę firmy", async () => {
    install({
      profiles: [profile({ current_company: "Acme" })],
      billing: [billingRow({ tenant_id: FOREIGN_TENANT, company: "Acme" })],
      companies: [company()],
    });

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "no_billing_data",
    });
    expect(h.rpc.calls).toHaveLength(0);
    expect(writes("crm_companies", "update")).toHaveLength(0);
  });

  it("dane do faktury bez firmy i profil bez firmy -> no_billing_data", async () => {
    install({ profiles: [profile()], billing: [billingRow({ company: "  " })] });

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "no_billing_data",
    });
    expect(h.rpc.calls).toHaveLength(0);
  });

  it("profil powiązany z kartoteką: aktualizuje TĘ firmę w tenancie, pomija puste rubryki i stempluje czas", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme", current_company: "Acme" })],
      billing: [
        billingRow({
          company: " Acme ",
          tax_id: "5260250274",
          address_line1: "ul. Nowa 2",
          city: "   ",
          postal_code: null,
          country_code: "PL",
          email: "faktury@acme.example.com",
          phone: "",
        }),
      ],
      companies: [
        company({ city: "Kraków", postal_code: "30-001", phone: "+48 12 000 00 00" }),
        // To samo id w innym tenancie nie może zostać dotknięte.
        company({ id: "crm-acme", tenant_id: FOREIGN_TENANT, name: "Obca", city: "Berlin" }),
      ],
    });

    const result = await pushBillingProfileToCrm(ME);

    const [update] = writes("crm_companies", "update");
    // Bez `name`: nazwę kartoteki utrzymuje zespół, zapis jej nie przepisuje.
    expect(update.argsOf("update")?.[0]).toEqual({
      tax_id: "5260250274",
      address: "ul. Nowa 2",
      country: "PL",
      email: "faktury@acme.example.com",
      updated_at: new Date(BASE_NOW).toISOString(),
    });
    expect(eqFilters(update)).toEqual([
      ["id", "crm-acme"],
      ["tenant_id", TENANT],
    ]);
    expect(h.rpc.calls).toHaveLength(0);
    // Wynik to stan kartoteki PO zapisie: nowe pola + nietknięte miasto i telefon z CRM.
    expect(result).toEqual({
      ok: true,
      company: {
        companyId: "crm-acme",
        name: "Acme",
        taxId: "5260250274",
        addressLine1: "ul. Nowa 2",
        city: "Kraków",
        postalCode: "30-001",
        country: "PL",
        email: "faktury@acme.example.com",
        phone: "+48 12 000 00 00",
      },
    });
    expect(scene.companies.find((row) => row.tenant_id === FOREIGN_TENANT)).toMatchObject({
      name: "Obca",
      city: "Berlin",
    });
    expect(eqFilters(writes("profiles", "update")[0])).toEqual([
      ["id", ME],
      ["tenant_id", TENANT],
    ]);
  });

  it("bez relacji zakłada firmę przez crm_ensure_member_company i podpina ją do profilu", async () => {
    install({
      profiles: [profile()],
      billing: [billingRow({ company: "Nowa Firma", city: "Lublin" })],
      companies: [],
    });
    h.rpc.respond = ensureCompanyRpc("crm-nowa");

    const result = await pushBillingProfileToCrm(ME);

    expect(h.rpc.calls).toEqual([
      {
        fn: "crm_ensure_member_company",
        args: { p_tenant_id: TENANT, p_name: "Nowa Firma", p_actor_id: ME },
      },
    ]);
    expect(companyById("crm-nowa")).toMatchObject({
      tenant_id: TENANT,
      name: "Nowa Firma",
      city: "Lublin",
      tax_id: "5260250274",
    });
    expect(myProfile()).toMatchObject({
      current_company_id: "crm-nowa",
      current_company: "Nowa Firma",
    });
    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-nowa", city: "Lublin" } });
  });

  it("dane do faktury bez nazwy firmy: zapisuje pod nazwą firmy z profilu", async () => {
    install({
      profiles: [profile({ current_company: " Acme " })],
      billing: [billingRow({ company: null })],
      companies: [company()],
    });
    h.rpc.respond = ensureCompanyRpc("crm-nieuzyte");

    const result = await pushBillingProfileToCrm(ME);

    expect(h.rpc.calls[0]?.args.p_name).toBe("Acme");
    expect(writes("crm_companies", "update")[0]?.argsOf("update")?.[0]).not.toHaveProperty("name");
    expect(companyById("crm-acme")).toMatchObject({ name: "Acme", city: "Gdańsk" });
    // Firma już była w kartotece - dedup zwrócił ją, zamiast zakładać duplikat.
    expect(scene.companies).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-acme" } });
  });

  it("nazwa firmy z danych do faktury wygrywa z nazwą z profilu - stara firma z profilu zostaje nietknięta", async () => {
    install({
      profiles: [profile({ current_company: "Stara Firma" })],
      billing: [billingRow({ company: "Nowa Firma" })],
      companies: [company({ id: "crm-stara", name: "Stara Firma" })],
    });
    h.rpc.respond = ensureCompanyRpc("crm-nowa");

    const result = await pushBillingProfileToCrm(ME);

    expect(h.rpc.calls.map((call) => call.args.p_name)).toEqual(["Nowa Firma"]);
    expect(companyById("crm-stara")).toEqual(company({ id: "crm-stara", name: "Stara Firma" }));
    expect(companyById("crm-nowa")).toMatchObject({ name: "Nowa Firma", tax_id: "5260250274" });
    expect(myProfile()).toMatchObject({
      current_company_id: "crm-nowa",
      current_company: "Nowa Firma",
    });
    expect(result).toMatchObject({
      ok: true,
      company: { companyId: "crm-nowa", name: "Nowa Firma" },
    });
  });

  it("kartoteka nie zwraca id firmy (RPC bez wiersza) -> no_company, nic nie aktualizujemy", async () => {
    install({ profiles: [profile()], billing: [billingRow({ company: "Acme" })] });
    h.rpc.respond = () => ({ data: [], error: null });

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "no_company",
    });
    expect(writes("crm_companies", "update")).toHaveLength(0);
    expect(writes("profiles", "update")).toHaveLength(0);
  });

  it("nazwa z samej formy prawnej nie zakłada firmy-widma -> no_company bez wywołania RPC", async () => {
    install({ profiles: [profile()], billing: [billingRow({ company: "Sp. z o.o." })] });

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "no_company",
    });
    expect(h.rpc.calls).toHaveLength(0);
    expect(writes("crm_companies", "update")).toHaveLength(0);
  });

  it("błąd RPC zakładania firmy przerywa operację wyjątkiem - bez zapisu w CRM i w profilu", async () => {
    install({ profiles: [profile()], billing: [billingRow({ company: "Acme" })] });
    const rpcError = new Error("crm_ensure_member_company: permission denied");
    h.rpc.respond = () => ({ data: null, error: rpcError });

    await expect(pushBillingProfileToCrm(ME)).rejects.toBe(rpcError);
    expect(writes("crm_companies", "update")).toHaveLength(0);
    expect(writes("profiles", "update")).toHaveLength(0);
  });

  it("nieudana aktualizacja kartoteki -> no_company, a profil NIE zostaje przepięty", async () => {
    install({
      profiles: [profile()],
      billing: [billingRow({ company: "Acme" })],
      companies: [company({ id: "crm-acme" })],
      failWrite: { crm_companies: true },
    });
    h.rpc.respond = ensureCompanyRpc("crm-nieuzyte");

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "no_company",
    });
    expect(writes("profiles", "update")).toHaveLength(0);
    expect(myProfile()?.current_company_id).toBeNull();
  });

  it("RPC wskazało firmę, której już nie ma (usunięta w międzyczasie) -> no_company bez zapisu, profil NIE zostaje przepięty", async () => {
    // Kartotekę czytamy przed zapisem (NIP i puste rubryki), więc zniknięcie
    // firmy wychodzi jeszcze przed UPDATE.
    install({ profiles: [profile()], billing: [billingRow({ company: "Acme" })], companies: [] });
    h.rpc.respond = () => ({ data: [{ id: "crm-usunieta" }], error: null });

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "no_company",
    });
    expect(writes("crm_companies", "update")).toHaveLength(0);
    expect(writes("profiles", "update")).toHaveLength(0);
    expect(myProfile()?.current_company_id).toBeNull();
  });

  it("aktualizacja nie trafiła w żaden wiersz (firmę usunięto między odczytem a zapisem) -> no_company, profil NIE zostaje przepięty", async () => {
    // Brak błędu PostgREST to jeszcze nie zapis: UPDATE po nieistniejącym id
    // kończy się sukcesem z zerem wierszy.
    install({
      profiles: [profile({ current_company_id: "crm-acme" })],
      billing: [billingRow({ company: "Acme" })],
      companies: [company()],
    });
    db.setResponse("crm_companies", (chain) => {
      if (chain.has("update")) scene.companies = [];
      return crmCompaniesResponder(chain);
    });

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "no_company",
    });
    expect(writes("crm_companies", "update")).toHaveLength(1);
    expect(writes("profiles", "update")).toHaveLength(0);
    expect(myProfile()?.current_company_id).toBe("crm-acme");
  });

  it("profil powiązany ze WSPÓLNĄ firmą, a dane do faktury wskazują INNĄ firmę: kartoteka zespołu zostaje nietknięta", async () => {
    // Firmę w profilu wybiera się z katalogu, więc jedną kartotekę dzieli wielu
    // członków. Członek fakturujący na własną działalność nie może przemianować
    // firmy zespołu ani podmienić jej NIP-u i adresu na swoje.
    const shared = company({
      name: "Acme Sp. z o.o.",
      tax_id: "1132853869",
      address: "ul. Zespołowa 5",
      city: "Warszawa",
      email: "biuro@acme.example.com",
    });
    install({
      profiles: [profile({ current_company_id: "crm-acme", current_company: "Acme Sp. z o.o." })],
      billing: [billingRow({ company: "Kowalska Consulting", city: "Sopot" })],
      companies: [shared, company({ id: "crm-kolega", name: "Beta" })],
    });
    const sharedBefore = structuredClone(shared);
    h.rpc.respond = ensureCompanyRpc("crm-kowalska");

    const result = await pushBillingProfileToCrm(ME);

    expect(companyById("crm-acme")).toEqual(sharedBefore);
    expect(h.rpc.calls.map((call) => call.args.p_name)).toEqual(["Kowalska Consulting"]);
    expect(companyById("crm-kowalska")).toMatchObject({
      name: "Kowalska Consulting",
      tax_id: "5260250274",
      city: "Sopot",
    });
    expect(myProfile()).toMatchObject({
      current_company_id: "crm-kowalska",
      current_company: "Kowalska Consulting",
    });
    expect(result).toMatchObject({
      ok: true,
      company: { companyId: "crm-kowalska", name: "Kowalska Consulting", city: "Sopot" },
    });
  });

  it("nazwa w danych do faktury różni się od kartoteki tylko zapisem: aktualizuje powiązaną firmę bez zmiany jej nazwy", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme", current_company: "ACME Sp. z o.o." })],
      billing: [billingRow({ company: "acme" })],
      companies: [company({ name: "ACME Sp. z o.o." })],
    });

    const result = await pushBillingProfileToCrm(ME);

    expect(h.rpc.calls).toHaveLength(0);
    const [update] = writes("crm_companies", "update");
    expect(update.argsOf("update")?.[0]).not.toHaveProperty("name");
    expect(companyById("crm-acme")).toMatchObject({ name: "ACME Sp. z o.o.", city: "Gdańsk" });
    // Profil niesie nazwę z kartoteki - tak jak przy wyborze firmy z katalogu.
    expect(myProfile()).toMatchObject({
      current_company_id: "crm-acme",
      current_company: "ACME Sp. z o.o.",
    });
    expect(result).toMatchObject({
      ok: true,
      company: { companyId: "crm-acme", name: "ACME Sp. z o.o." },
    });
  });

  it("powiązana kartoteka zniknęła z tenanta: zapis idzie do firmy znalezionej po nazwie, nie w próżnię", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-usunieta", current_company: "Acme" })],
      billing: [billingRow({ company: "Acme" })],
      companies: [company({ id: "crm-usunieta", tenant_id: FOREIGN_TENANT, name: "Acme" })],
    });
    h.rpc.respond = ensureCompanyRpc("crm-acme");

    const result = await pushBillingProfileToCrm(ME);

    expect(h.rpc.calls).toHaveLength(1);
    expect(companyById("crm-usunieta")).toMatchObject({ tenant_id: FOREIGN_TENANT, city: null });
    expect(myProfile()?.current_company_id).toBe("crm-acme");
    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-acme", city: "Gdańsk" } });
  });

  it("drugi „Zapisz w CRM” nie zakłada firmy ponownie - idzie po relacji z profilu", async () => {
    install({ profiles: [profile()], billing: [billingRow({ company: "Acme" })] });
    h.rpc.respond = ensureCompanyRpc("crm-acme");

    const first = await pushBillingProfileToCrm(ME);
    const second = await pushBillingProfileToCrm(ME);

    expect(second).toEqual(first);
    expect(h.rpc.calls).toHaveLength(1);
    expect(scene.companies).toHaveLength(1);
    // Drugi zapis nie ma czego uzupełnić - nie wysyła pustego UPDATE.
    expect(writes("crm_companies", "update")).toHaveLength(1);
  });
});

// --- audyt INV-10: cudza kartoteka ------------------------------------------

describe("pushBillingProfileToCrm - INV-10: zapis tylko uzupełnia i nie scala cudzych firm", () => {
  // CO BYŁO ZŁE. `ensureCrmCompany` zwracał istniejącą firmę o tym samym
  // kluczu nazwy, a UPDATE nadpisywał jej `tax_id`, adres, e-mail i telefon.
  // Członek wpisywał w danych do faktury nazwę cudzej firmy i podmieniał jej
  // NIP w CRM - a ten NIP zasila `_event_invoice_crm_link` (dopasowanie
  // faktur wydarzeń do kartoteki po NIP-ie).
  //
  // KONTRAKT jak SQL przy wystawieniu faktury: relacja, potem NIP, potem
  // nazwa; firma o tej nazwie z INNYM niepustym NIP-em to inny podmiot;
  // uzupełniamy WYŁĄCZNIE puste rubryki.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE_NOW);
  });

  /** Kartoteka cudzej firmy: niepusty NIP i kontakt, część rubryk pusta. */
  const foreign = () =>
    company({
      id: "crm-cudza",
      name: "Acme Sp. z o.o.",
      tax_id: "1132853869",
      address: "ul. Zarządowa 1",
      city: "Warszawa",
      postal_code: null,
      email: "zarzad@acme.example.com",
      phone: null,
    });

  /** Czy jakikolwiek UPDATE celował w daną kartotekę. */
  const updatesOf = (id: string) =>
    writes("crm_companies", "update").filter((chain) =>
      eqFilters(chain).some(([column, value]) => column === "id" && value === id),
    );

  it("firma o tej samej nazwie z INNYM NIP-em zostaje nietknięta - powstaje osobna kartoteka z NIP-em członka", async () => {
    install({
      profiles: [profile()],
      billing: [billingRow({ company: "Acme", tax_id: "5260250274" })],
      companies: [foreign()],
    });
    h.rpc.respond = ensureCompanyRpc("crm-nieuzyte");

    const result = await pushBillingProfileToCrm(ME);

    // Cudza kartoteka bez zmian - także jej PUSTE rubryki (kod, telefon) nie
    // dostały danych członka, bo to nie jego firma.
    expect(companyById("crm-cudza")).toEqual(foreign());
    expect(updatesOf("crm-cudza")).toHaveLength(0);
    // Dedup nazw wskazał cudzą firmę (forma prawna znika z klucza)...
    expect(h.rpc.calls.map((call) => call.args.p_name)).toEqual(["Acme"]);
    // ...a zapis założył OSOBNĄ kartotekę z nazwą i danymi członka.
    const [insert] = writes("crm_companies", "insert");
    expect(insert.argsOf("insert")?.[0]).toEqual({
      tenant_id: TENANT,
      name: "Acme",
      created_by: ME,
      tax_id: "5260250274",
      address: "ul. Checkoutowa 7",
      city: "Gdańsk",
      postal_code: "80-001",
      country: "DE",
      email: "anna@example.com",
      phone: "+48 600 000 001",
    });
    expect(myProfile()).toMatchObject({ current_company_id: INSERTED_ID, current_company: "Acme" });
    expect(result).toMatchObject({
      ok: true,
      company: { companyId: INSERTED_ID, name: "Acme", taxId: "5260250274" },
    });
  });

  it("identyczna nazwa i inny NIP: unikat nazwy nie pozwala na osobną kartotekę -> tax_id_conflict, nic się nie zmienia", async () => {
    const taken = company({
      id: "crm-cudza",
      name: "Acme",
      tax_id: "1132853869",
      email: "zarzad@acme.example.com",
    });
    install({
      profiles: [profile({ current_company: "Moja Stara Firma" })],
      billing: [billingRow({ company: " acme ", tax_id: "5260250274" })],
      companies: [taken],
    });
    const before = structuredClone(scene.companies);
    h.rpc.respond = ensureCompanyRpc("crm-nieuzyte");

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "tax_id_conflict",
    });
    expect(scene.companies).toEqual(before);
    expect(writes("crm_companies", "update")).toHaveLength(0);
    expect(writes("profiles", "update")).toHaveLength(0);
    expect(myProfile()).toMatchObject({
      current_company_id: null,
      current_company: "Moja Stara Firma",
    });
  });

  it("NIP zapisany inaczej (prefiks PL, separatory) to TEN SAM podmiot - uzupełnia jego puste rubryki, bez nowej kartoteki", async () => {
    install({
      profiles: [profile()],
      billing: [billingRow({ company: "Acme", tax_id: "5260250274" })],
      companies: [foreign()],
    });
    scene.companies[0].tax_id = "PL 526-025-02-74";
    h.rpc.respond = ensureCompanyRpc("crm-nieuzyte");

    const result = await pushBillingProfileToCrm(ME);

    // NIP przed nazwą: kartoteka znaleziona po NIP-ie, bez RPC i bez INSERT.
    expect(h.rpc.calls).toHaveLength(0);
    expect(writes("crm_companies", "insert")).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-cudza" } });
  });

  it("firma dopasowana uczciwie (ten sam NIP) dostaje WYŁĄCZNIE puste rubryki - wypełnionych nie nadpisuje", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme", current_company: "Acme Sp. z o.o." })],
      billing: [billingRow({ company: "Acme", tax_id: "5260250274" })],
      companies: [
        company({
          name: "Acme Sp. z o.o.",
          tax_id: "PL5260250274",
          address: "ul. Firmowa 1",
          city: null,
          postal_code: "00-001",
          country: "Polska",
          email: "biuro@acme.example.com",
          // Same białe znaki to też pusta rubryka (jak `NULLIF(btrim(...), '')`).
          phone: "  ",
        }),
      ],
    });

    const result = await pushBillingProfileToCrm(ME);

    const [update] = writes("crm_companies", "update");
    expect(update.argsOf("update")?.[0]).toEqual({
      city: "Gdańsk",
      phone: "+48 600 000 001",
      updated_at: new Date(BASE_NOW).toISOString(),
    });
    // Warunek zapisu: obie rubryki wciąż mają wartość z odczytu.
    expect(update.calls.filter((call) => call.method === "is").map((c) => c.args)).toEqual([
      ["city", null],
    ]);
    expect(eqFilters(update)).toEqual([
      ["id", "crm-acme"],
      ["tenant_id", TENANT],
      ["phone", "  "],
    ]);
    expect(result).toEqual({
      ok: true,
      company: {
        companyId: "crm-acme",
        name: "Acme Sp. z o.o.",
        taxId: "PL5260250274",
        addressLine1: "ul. Firmowa 1",
        city: "Gdańsk",
        postalCode: "00-001",
        country: "Polska",
        email: "biuro@acme.example.com",
        phone: "+48 600 000 001",
      },
    });
  });

  it("NIP przed nazwą: firma o NIP-ie członka wygrywa z firmą o tej samej nazwie, a ta zostaje nietknięta", async () => {
    install({
      profiles: [profile()],
      billing: [billingRow({ company: "Acme", tax_id: "5260250274" })],
      companies: [
        foreign(),
        company({ id: "crm-holding", name: "Acme Holding", tax_id: "526-025-02-74" }),
      ],
    });

    const result = await pushBillingProfileToCrm(ME);

    expect(h.rpc.calls).toHaveLength(0);
    expect(companyById("crm-cudza")).toEqual(foreign());
    expect(companyById("crm-holding")).toMatchObject({
      name: "Acme Holding",
      tax_id: "526-025-02-74",
      city: "Gdańsk",
    });
    expect(myProfile()).toMatchObject({
      current_company_id: "crm-holding",
      current_company: "Acme Holding",
    });
    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-holding" } });
  });

  it("powiązana firma o tej samej nazwie, ale z INNYM NIP-em: nie dopisuje się do niej, tylko zakłada osobną kartotekę", async () => {
    // Członek wybrał w profilu firmę zespołu „Acme”, a fakturuje na inną
    // spółkę „Acme Sp. z o.o.” z własnym NIP-em. Relacja z profilu nie czyni
    // tych dwóch podmiotów jedną kartoteką.
    const linked = company({ id: "crm-acme", name: "Acme", tax_id: "1132853869" });
    install({
      profiles: [profile({ current_company_id: "crm-acme", current_company: "Acme" })],
      billing: [billingRow({ company: "Acme Sp. z o.o.", tax_id: "5260250274" })],
      companies: [linked],
    });
    h.rpc.respond = ensureCompanyRpc("crm-nieuzyte");

    const result = await pushBillingProfileToCrm(ME);

    expect(companyById("crm-acme")).toEqual(linked);
    expect(updatesOf("crm-acme")).toHaveLength(0);
    expect(companyById(INSERTED_ID)).toMatchObject({
      name: "Acme Sp. z o.o.",
      tax_id: "5260250274",
    });
    expect(result).toMatchObject({ ok: true, company: { companyId: INSERTED_ID } });
  });

  it("zespół wypełnił rubrykę między odczytem a zapisem: zapis jej nie nadpisuje, uzupełnia tylko resztę", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme", current_company: "Acme" })],
      billing: [billingRow({ company: "Acme", tax_id: "5260250274" })],
      companies: [
        company({
          tax_id: "5260250274",
          address: "ul. Firmowa 1",
          postal_code: "00-001",
          country: "PL",
          phone: "+48 22 000 00 00",
          // Puste: e-mail i miasto.
        }),
      ],
    });
    let updates = 0;
    db.setResponse("crm_companies", (chain) => {
      // Pierwszy UPDATE wyprzedza zespół: w CRM pojawia się e-mail firmy.
      if (chain.has("update") && ++updates === 1) {
        scene.companies[0].email = "zespol@acme.example.com";
      }
      return crmCompaniesResponder(chain);
    });

    const result = await pushBillingProfileToCrm(ME);

    const [missed, retried] = writes("crm_companies", "update");
    expect(missed.argsOf("update")?.[0]).toMatchObject({
      city: "Gdańsk",
      email: "anna@example.com",
    });
    expect(retried.argsOf("update")?.[0]).toEqual({
      city: "Gdańsk",
      updated_at: new Date(BASE_NOW).toISOString(),
    });
    expect(companyById("crm-acme")).toMatchObject({
      email: "zespol@acme.example.com",
      city: "Gdańsk",
    });
    expect(result).toMatchObject({
      ok: true,
      company: { email: "zespol@acme.example.com", city: "Gdańsk" },
    });
  });

  it("kartoteka zmienia się przy każdej próbie: po wyczerpaniu prób no_company, profil NIE zostaje przepięty", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-acme", current_company: "Acme" })],
      billing: [billingRow({ company: "Acme", tax_id: "5260250274" })],
      companies: [company({ tax_id: "5260250274" })],
    });
    let updates = 0;
    db.setResponse("crm_companies", (chain) => {
      // Rubryka wciąż „pusta”, ale za każdym razem w innym zapisie białych
      // znaków - warunek zapisu chybia, a ponowienie nie może trwać w nieskończoność.
      if (chain.has("update")) scene.companies[0].city = " ".repeat(++updates);
      return crmCompaniesResponder(chain);
    });

    await expect(pushBillingProfileToCrm(ME)).resolves.toEqual({
      ok: false,
      error: "no_company",
    });
    expect(writes("crm_companies", "update")).toHaveLength(3);
    expect(writes("profiles", "update")).toHaveLength(0);
  });

  it("błąd odczytu przy szukaniu po NIP-ie przerywa zapis - bez zakładania duplikatu po nazwie", async () => {
    // „Nie udało się przeczytać” potraktowane jak „nie ma firmy o tym NIP-ie”
    // skierowałoby zapis do dedupu nazw i dało dwie kartoteki tego podmiotu.
    install({ profiles: [profile()], billing: [billingRow({ company: "Acme" })] });
    db.setResponse("crm_companies", (chain) =>
      chain.has("ilike") ? fail("crm_companies: read failed") : crmCompaniesResponder(chain),
    );
    h.rpc.respond = ensureCompanyRpc("crm-duplikat");

    await expect(pushBillingProfileToCrm(ME)).rejects.toThrow("crm_companies: read failed");
    expect(h.rpc.calls).toHaveLength(0);
    expect(writes("crm_companies", "insert")).toHaveLength(0);
    expect(writes("crm_companies", "update")).toHaveLength(0);
  });
});
