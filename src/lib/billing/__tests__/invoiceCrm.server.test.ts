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
//
// GRANICA ATRAP: wyłącznie klient Supabase z rolą serwisową - jako mała baza
// w pamięci, która STOSUJE filtry `eq` z łańcucha (pominięty filtr tenanta
// oddaje wtedy cudzy wiersz i test to widzi). `memberSync.server`
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
  updated_at?: string;
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
    ...overrides,
  };
}

/** Filtry `eq` łańcucha - baza stosuje je naprawdę, tak jak PostgREST. */
function eqFilters(chain: RecordedChain): [string, unknown][] {
  return chain.calls
    .filter((call) => call.method === "eq")
    .map((call) => [String(call.args[0]), call.args[1]]);
}

function matching<T extends object>(rows: T[], chain: RecordedChain): T[] {
  const filters = eqFilters(chain);
  return rows.filter((row) => filters.every(([column, value]) => (row as Row)[column] === value));
}

/** Odczyt: `maybeSingle` -> pierwszy wiersz albo null, inaczej lista z limitem. */
function readRows<T extends object>(rows: T[], chain: RecordedChain) {
  const found = matching(rows, chain);
  if (chain.has("maybeSingle")) return ok(found[0] ?? null);
  const limit = chain.argsOf("limit")?.[0];
  return ok(typeof limit === "number" ? found.slice(0, limit) : found);
}

function updateRows<T extends object>(rows: T[], chain: RecordedChain) {
  const patch = chain.argsOf("update")?.[0] as Partial<T>;
  for (const row of matching(rows, chain)) Object.assign(row, patch);
  return ok(null);
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
  db.setResponse("crm_companies", (chain) => {
    if (!chain.has("update")) return readRows(scene.companies, chain);
    if (scene.failWrite.crm_companies) return fail("crm_companies: write failed");
    return updateRows(scene.companies, chain);
  });
  h.db.current = db;
  return scene;
}

/** RPC `crm_ensure_member_company` w kształcie bazy: dedup po nazwie w tenancie. */
function ensureCompanyRpc(newId: string) {
  return (args: Record<string, unknown>) => {
    const tenantId = String(args.p_tenant_id);
    const name = String(args.p_name);
    const existing = scene.companies.find(
      (row) => row.tenant_id === tenantId && row.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return { data: [{ id: existing.id }], error: null };
    scene.companies.push(company({ id: newId, tenant_id: tenantId, name }));
    return { data: [{ id: newId }], error: null };
  };
}

const myProfile = () => scene.profiles.find((row) => row.id === ME);
const myBilling = () => scene.billing.find((row) => row.user_id === ME && row.tenant_id === TENANT);
const companyById = (id: string) => scene.companies.find((row) => row.id === id);
const writes = (table: string, method: "update" | "upsert") =>
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

  it("kartoteka spod id z profilu należy do innego tenanta: nie wycieka, wygrywa firma o tej nazwie we WŁASNYM tenancie", async () => {
    install({
      profiles: [profile({ current_company_id: "crm-obca", current_company: "Acme" })],
      billing: [],
      companies: [
        company({ id: "crm-obca", tenant_id: FOREIGN_TENANT, tax_id: "OBCY-NIP" }),
        company({ id: "crm-acme", tax_id: "5260250274" }),
      ],
    });

    const result = await loadCrmCompanyForUser(ME);

    expect(result).toMatchObject({
      ok: true,
      company: { companyId: "crm-acme", taxId: "5260250274" },
    });
    const [byId, byName] = db.chainsFor("crm_companies");
    expect(eqFilters(byId)).toContainEqual(["tenant_id", TENANT]);
    expect(eqFilters(byName)).toEqual([["tenant_id", TENANT]]);
  });

  it("bez relacji dopasowuje firmę po nazwie z profilu tym samym dedupem co synchronizacja członków", async () => {
    install({
      profiles: [profile({ current_company: "  ACME Sp. z o.o. " })],
      billing: [billingRow({ company: "Inna Nazwa z Checkoutu" })],
      companies: [
        // Ta sama nazwa w obcym tenancie stoi PIERWSZA - filtr tenanta ją odcina.
        company({ id: "crm-obca", tenant_id: FOREIGN_TENANT, name: "Acme" }),
        company({ id: "crm-beta", name: "Beta" }),
        company({ id: "crm-acme", name: "acme, sp. z o.o.", city: "Poznań" }),
      ],
    });

    const result = await loadCrmCompanyForUser(ME);

    expect(result).toMatchObject({
      ok: true,
      company: { companyId: "crm-acme", name: "acme, sp. z o.o.", city: "Poznań" },
    });
    // Dane do faktury czytane są wyłącznie w tenancie właściciela.
    expect(eqFilters(db.lastChain("billing_profiles")!)).toEqual([
      ["user_id", ME],
      ["tenant_id", TENANT],
    ]);
    const search = db.lastChain("crm_companies")!;
    expect(eqFilters(search)).toEqual([["tenant_id", TENANT]]);
    expect(search.has("limit")).toBe(true);
  });

  it("gdy profil nie ma nazwy firmy, bierze ją z danych do faktury TEGO tenanta", async () => {
    install({
      profiles: [profile({ current_company: "   " })],
      billing: [
        billingRow({ tenant_id: FOREIGN_TENANT, company: "Delta" }),
        billingRow({ company: " Gamma S.A. " }),
      ],
      companies: [
        company({ id: "crm-delta", name: "Delta" }),
        company({ id: "crm-gamma", name: "Gamma" }),
      ],
    });

    const result = await loadCrmCompanyForUser(ME);

    expect(result).toMatchObject({ ok: true, company: { companyId: "crm-gamma", name: "Gamma" } });
  });

  it.each([
    ["nie ma danych do faktury", [] as BillingRow[]],
    ["dane do faktury mają pustą firmę", [billingRow({ company: "   " })]],
  ])(
    "brak nazwy firmy (profil pusty, %s) -> no_company bez przeszukiwania kartoteki",
    async (_, billing) => {
      install({ profiles: [profile()], billing, companies: [company()] });

      await expect(loadCrmCompanyForUser(ME)).resolves.toEqual({
        ok: false,
        error: "no_company",
      });
      expect(db.chainsFor("crm_companies")).toHaveLength(0);
    },
  );

  it("nazwa nie pasuje do żadnej firmy w tenancie -> no_company (bez podstawiania firmy „najbliższej”)", async () => {
    install({
      profiles: [profile({ current_company: "Omega" })],
      companies: [
        company({ id: "crm-obca", tenant_id: FOREIGN_TENANT, name: "Omega" }),
        company({ id: "crm-beta", name: "Omega Plus" }),
      ],
    });

    await expect(loadCrmCompanyForUser(ME)).resolves.toEqual({ ok: false, error: "no_company" });
  });

  it("kartoteka odpowiada bez wierszy (data: null) -> no_company, nie wyjątek", async () => {
    install({ profiles: [profile({ current_company: "Acme" })] });
    db.setResponse("crm_companies", ok(null));

    await expect(loadCrmCompanyForUser(ME)).resolves.toEqual({ ok: false, error: "no_company" });
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

  it("nieudany zapis danych do faktury -> no_billing_data, a profil NIE zostaje przepięty na kartotekę", async () => {
    install({
      profiles: [profile({ current_company: "Acme" })],
      billing: [billingRow()],
      companies: [company({ city: "Warszawa" })],
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
      billing: [],
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
    expect(update.argsOf("update")?.[0]).toEqual({
      name: "Acme",
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
    expect(writes("crm_companies", "update")[0]?.argsOf("update")?.[0]).toMatchObject({
      name: "Acme",
    });
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

  it("drugi „Zapisz w CRM” nie zakłada firmy ponownie - idzie po relacji z profilu", async () => {
    install({ profiles: [profile()], billing: [billingRow({ company: "Acme" })] });
    h.rpc.respond = ensureCompanyRpc("crm-acme");

    const first = await pushBillingProfileToCrm(ME);
    const second = await pushBillingProfileToCrm(ME);

    expect(second).toEqual(first);
    expect(h.rpc.calls).toHaveLength(1);
    expect(scene.companies).toHaveLength(1);
  });
});
