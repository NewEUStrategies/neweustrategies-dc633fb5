// KATALOG CZŁONKÓW - WARSTWA SERWEROWA (`src/lib/admin/membersDirectory.functions.ts`).
//
// Do tego pliku warstwa stała na ZERZE (133 linie, 31 funkcji, 187 gałęzi):
// jedyny test obszaru (`membersDirectoryPanel.test.tsx`) mockuje cały moduł
// pustymi obiektami, więc nie wykonywał ani jednej linii handlera.
//
// PRZEDMIOT DOWODU - to, na czym operator podejmuje decyzję o człowieku:
//   1. ROZSTRZYGNIĘCIE WARSTWY z trzech źródeł (nadanie > subskrypcja > próg
//      domyślny) - z regułą rang, dat i statusów;
//   2. PIENIĄDZE - suma wpłat, ostatnia wpłata, liczba; kwoty w RÓŻNYCH
//      walutach nie są dodawane (naprawa tej kampanii);
//   3. GRANICA NAJEMCY - klient serwisowy omija RLS, więc KAŻDE zapytanie musi
//      nieść `tenant_id` WOŁAJĄCEGO, nigdy celu;
//   4. AWARIA ODCZYTU NIE UDAJE PUSTKI - wcześniej padnięty odczyt
//      `payment_orders` rysował „0,00 zł" i „nigdy", a padnięty odczyt nadań -
//      plan domyślny (naprawa tej kampanii);
//   5. NADANIE i COFNIĘCIE - wygaszenie poprzedniego nadania, termin w miesiącach
//      kalendarzowych, ślad audytowy, który mówi prawdę.
//
// CZEGO TEN HARNESS NIE UDAJE: middleware `requireAdmin` (patrz nagłówek
// `@/test/serverFnHarness`). Jego obecność jest sprawdzana strukturalnie
// w sekcji 0; o tym, kto przechodzi bramkę, rozstrzyga sama bramka i jej testy.
//
// RODO: wyłącznie adresy `example.com` / `example.org`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  syncCalls: [] as Record<string, unknown>[],
  /** Odpowiedź `syncMemberToCrm` - `null` = synchronizacja nie doszła do skutku. */
  syncSnapshot: { leadId: "lead-1", companyCreated: false } as {
    leadId: string;
    companyCreated: boolean;
  } | null,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));
vi.mock("@/lib/crm/memberSync.server", () => ({
  syncMemberToCrm: async (_admin: unknown, input: Record<string, unknown>) => {
    h.syncCalls.push(input);
    return h.syncSnapshot;
  },
}));

import {
  addCalendarMonthsUtc,
  getMemberBilling,
  listMembers,
  revokeMemberTier,
  setMemberTier,
  syncMembersWithCrm,
  type MemberBillingResult,
  type MemberDirectoryResult,
} from "@/lib/admin/membersDirectory.functions";

const T = {
  caller: "11111111-1111-4111-8111-111111111111",
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ana: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  bob: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
  cyd: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
  grant: "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4",
} as const;

/** Zegar testu - stały, żeby reguły dat nie zależały od dnia uruchomienia. */
const NOW = new Date("2026-06-15T12:00:00.000Z");
const PAST = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

/** Kontekst wołającego. Bramka najemcy czyta `profiles` przez klienta UŻYTKOWNIKA. */
function context(tenantId: string | null = T.tenant): ServerFnContext {
  const user = supabaseFromStub();
  user.setResponse("profiles", ok(tenantId === null ? null : { tenant_id: tenantId }));
  return { supabase: { from: user.from }, userId: T.caller };
}

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
  return h.db;
}

/** Każdy łańcuch klienta serwisowego MUSI nieść `tenant_id` wołającego. */
function expectEveryChainTenantScoped(): void {
  for (const chain of db().chains) {
    const scoped = chain.calls.some(
      (call) =>
        (call.method === "eq" && call.args[0] === "tenant_id" && call.args[1] === T.tenant) ||
        (call.method === "insert" &&
          (call.args[0] as { tenant_id?: string } | undefined)?.tenant_id === T.tenant),
    );
    expect(scoped, `łańcuch ${chain.table} bez zawężenia do najemcy`).toBe(true);
  }
}

interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  job_title: string | null;
  current_company: string | null;
  created_at: string;
}

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    email: `${id.slice(0, 4)}@example.com`,
    display_name: `Osoba ${id.slice(0, 4)}`,
    job_title: null,
    current_company: null,
    created_at: PAST,
    ...overrides,
  };
}

const TIERS = [
  {
    key: "reader",
    name_pl: "Czytelnik",
    name_en: "Reader",
    rank: 0,
    is_default: true,
    active: true,
  },
  {
    key: "member",
    name_pl: "Członek",
    name_en: "Member",
    rank: 10,
    is_default: false,
    active: true,
  },
  { key: "pro", name_pl: "", name_en: "Pro", rank: 30, is_default: false, active: true },
];

interface Plan {
  tiers?: SupabaseResult | ((chain: RecordedChain) => SupabaseResult);
  profiles?: Profile[];
  count?: number | null;
  profilesError?: string;
  grants?: unknown[];
  subs?: unknown[];
  plans?: unknown[];
  orders?: unknown[];
  leads?: unknown[];
  companies?: unknown[];
  errorOn?: string;
}

function plan(p: Plan = {}): void {
  const d = db();
  d.setResponse("membership_tiers", p.tiers ?? ok(TIERS));
  d.setResponse("profiles", () =>
    p.profilesError
      ? fail(p.profilesError)
      : {
          data: p.profiles ?? [],
          error: null,
          count: p.count === undefined ? (p.profiles ?? []).length : p.count,
        },
  );
  const table = (name: string, rows: unknown[] | undefined) =>
    d.setResponse(name, p.errorOn === name ? fail("permission denied") : ok(rows ?? []));
  table("membership_grants", p.grants);
  table("user_subscriptions", p.subs);
  table("access_plans", p.plans);
  table("payment_orders", p.orders);
  table("crm_leads", p.leads);
  table("crm_companies", p.companies);
}

async function list(input: unknown = {}, ctx = context()): Promise<MemberDirectoryResult> {
  return callServerFn<MemberDirectoryResult>(listMembers, { data: input, context: ctx });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.db = supabaseFromStub();
  h.syncCalls = [];
  h.syncSnapshot = { leadId: "lead-1", companyCreated: false };
  return () => vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 0. OBUDOWA
// ---------------------------------------------------------------------------

describe("katalog członków - obudowa server functions", () => {
  it.each([
    ["listMembers", listMembers],
    ["getMemberBilling", getMemberBilling],
    ["setMemberTier", setMemberTier],
    ["revokeMemberTier", revokeMemberTier],
    ["syncMembersWithCrm", syncMembersWithCrm],
  ])("%s stoi za bramką `requireAdmin`", (_name, fn) => {
    expect(serverFnMiddlewareNames(fn)).toEqual(["requireAdmin"]);
  });

  it("walidator listy: wartości domyślne, przycinanie, granice strony i długości", () => {
    expect(validateServerFnInput(listMembers, undefined)).toEqual({
      search: null,
      tierKey: null,
      page: 1,
    });
    expect(validateServerFnInput(listMembers, { search: "  ana  " })).toMatchObject({
      search: "ana",
    });
    expect(() => validateServerFnInput(listMembers, { page: 0 })).toThrow(ZodError);
    expect(() => validateServerFnInput(listMembers, { page: 401 })).toThrow(ZodError);
    expect(() => validateServerFnInput(listMembers, { search: "x".repeat(161) })).toThrow(ZodError);
  });

  it("walidator nadania: UUID, niepusta warstwa, miesiące 1-120 albo bezterminowo", () => {
    const base = { userId: T.ana, tierKey: "pro" };
    expect(validateServerFnInput(setMemberTier, base)).toEqual({
      ...base,
      months: null,
      note: null,
    });
    expect(() => validateServerFnInput(setMemberTier, { ...base, userId: "x" })).toThrow(ZodError);
    expect(() => validateServerFnInput(setMemberTier, { ...base, tierKey: "  " })).toThrow(
      ZodError,
    );
    expect(() => validateServerFnInput(setMemberTier, { ...base, months: 0 })).toThrow(ZodError);
    expect(() => validateServerFnInput(setMemberTier, { ...base, months: 121 })).toThrow(ZodError);
    expect(() => validateServerFnInput(revokeMemberTier, { grantId: "x" })).toThrow(ZodError);
    expect(() => validateServerFnInput(getMemberBilling, { userId: "x" })).toThrow(ZodError);
    expect(validateServerFnInput(syncMembersWithCrm, undefined)).toEqual({
      cursor: null,
      batchSize: 25,
    });
    expect(() => validateServerFnInput(syncMembersWithCrm, { batchSize: 101 })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// 1. GRANICA NAJEMCY
// ---------------------------------------------------------------------------

describe("katalog członków - granica najemcy", () => {
  it("wołający bez najemcy dostaje odmowę, a baza nie jest pytana WCALE", async () => {
    plan({ profiles: [profile(T.ana)] });
    await expect(list({}, context(null))).rejects.toThrow("Forbidden: missing tenant");
    expect(db().chains).toHaveLength(0);
  });

  it("KAŻDE zapytanie listy jest zawężone do najemcy WOŁAJĄCEGO", async () => {
    plan({
      profiles: [profile(T.ana, { email: "Ana@Example.com" })],
      leads: [
        {
          id: "lead-1",
          email_norm: "ana@example.com",
          stage: "won",
          company_id: "co-1",
          company: null,
        },
      ],
      companies: [{ id: "co-1", name: "Nowak Consulting" }],
    });
    await list();
    expect(
      db()
        .chains.map((chain) => chain.table)
        .sort(),
    ).toEqual(
      [
        "access_plans",
        "crm_companies",
        "crm_leads",
        "membership_grants",
        "membership_tiers",
        "payment_orders",
        "profiles",
        "user_subscriptions",
      ].sort(),
    );
    expectEveryChainTenantScoped();
  });
});

// ---------------------------------------------------------------------------
// 2. ROZSTRZYGNIĘCIE WARSTWY
// ---------------------------------------------------------------------------

describe("katalog członków - rozstrzygnięcie warstwy", () => {
  it("bez nadań i subskrypcji obowiązuje warstwa DOMYŚLNA, a katalog warstw idzie po randze", async () => {
    plan({
      tiers: ok([TIERS[2], TIERS[0], TIERS[1]]),
      profiles: [profile(T.ana)],
    });
    const result = await list();
    expect(result.rows[0]).toMatchObject({
      tierKey: "reader",
      tierName: "Czytelnik",
      tierSource: "default",
      grantId: null,
      subscriptionStatus: null,
    });
    expect(result.tiers.map((tier) => tier.key)).toEqual(["reader", "member", "pro"]);
    // Nazwa: PL, potem EN, potem klucz - pusta nazwa polska nie jest nazwą.
    expect(result.tiers[2].name).toBe("Pro");
  });

  it("bez znacznika domyślnej - pierwsza warstwa; bez katalogu warstw - `reader`", async () => {
    plan({
      tiers: ok([{ key: "basic", name_pl: null, name_en: null, rank: null, is_default: false }]),
      profiles: [profile(T.ana)],
    });
    let result = await list();
    expect(result.rows[0]).toMatchObject({ tierKey: "basic", tierName: "basic" });
    expect(result.tiers).toEqual([{ key: "basic", name: "basic", rank: 0 }]);

    h.db = supabaseFromStub();
    plan({ tiers: ok(null), profiles: [profile(T.ana)] });
    result = await list();
    expect(result.rows[0]).toMatchObject({ tierKey: "reader", tierName: "reader" });
  });

  it("aktywne nadanie wygrywa z subskrypcją RÓWNEJ rangi; najwyższa ranga wygrywa wśród nadań", async () => {
    plan({
      profiles: [profile(T.ana)],
      grants: [
        {
          id: "g-low",
          user_id: T.ana,
          tier_key: "member",
          starts_at: PAST,
          expires_at: null,
          revoked_at: null,
        },
        {
          id: "g-high",
          user_id: T.ana,
          tier_key: "pro",
          starts_at: PAST,
          expires_at: FUTURE,
          revoked_at: null,
        },
        {
          id: "g-dup",
          user_id: T.ana,
          tier_key: "member",
          starts_at: PAST,
          expires_at: null,
          revoked_at: null,
        },
      ],
      subs: [{ user_id: T.ana, plan_id: "p-pro", status: "active", current_period_end: FUTURE }],
      plans: [{ id: "p-pro", tier_key: "pro" }],
    });
    const [row] = (await list()).rows;
    expect(row).toMatchObject({
      tierKey: "pro",
      tierSource: "grant",
      grantId: "g-high",
      grantExpiresAt: FUTURE,
      // Subskrypcja jest widoczna obok, choć nie ona decyduje.
      subscriptionStatus: "active",
      subscriptionPeriodEnd: FUTURE,
    });
  });

  it("subskrypcja WYŻSZEJ rangi wygrywa z nadaniem; nadanie nie jest wtedy pokazywane jako źródło", async () => {
    plan({
      profiles: [profile(T.ana)],
      grants: [
        {
          id: "g-1",
          user_id: T.ana,
          tier_key: "member",
          starts_at: PAST,
          expires_at: null,
          revoked_at: null,
        },
      ],
      subs: [
        { user_id: T.ana, plan_id: "p-mem", status: "active", current_period_end: FUTURE },
        { user_id: T.ana, plan_id: "p-pro", status: "active", current_period_end: FUTURE },
        { user_id: T.ana, plan_id: "p-mem", status: "active", current_period_end: FUTURE },
      ],
      plans: [
        { id: "p-mem", tier_key: "member" },
        { id: "p-pro", tier_key: "pro" },
      ],
    });
    const [row] = (await list()).rows;
    expect(row).toMatchObject({
      tierKey: "pro",
      tierSource: "subscription",
      grantId: null,
      grantExpiresAt: null,
    });
  });

  it("nadanie cofnięte, przyszłe albo wygasłe nie liczy się wcale", async () => {
    plan({
      profiles: [profile(T.ana)],
      grants: [
        {
          id: "g-rev",
          user_id: T.ana,
          tier_key: "pro",
          starts_at: PAST,
          expires_at: null,
          revoked_at: PAST,
        },
        {
          id: "g-fut",
          user_id: T.ana,
          tier_key: "pro",
          starts_at: FUTURE,
          expires_at: null,
          revoked_at: null,
        },
        {
          id: "g-exp",
          user_id: T.ana,
          tier_key: "pro",
          starts_at: PAST,
          expires_at: PAST,
          revoked_at: null,
        },
        {
          id: "g-now",
          user_id: T.ana,
          tier_key: "pro",
          starts_at: PAST,
          expires_at: NOW.toISOString(),
          revoked_at: null,
        },
      ],
    });
    expect((await list()).rows[0]).toMatchObject({ tierSource: "default", tierKey: "reader" });
  });

  it("subskrypcja: `active` bez końca okresu liczy się, `pending` bez końca nie, wygasła i anulowana nie", async () => {
    const people = [T.ana, T.bob, T.cyd].map((id) => profile(id));
    const extra = "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5";
    plan({
      profiles: [...people, profile(extra)],
      subs: [
        { user_id: T.ana, plan_id: "p", status: "active", current_period_end: null },
        { user_id: T.bob, plan_id: "p", status: "pending", current_period_end: null },
        { user_id: T.cyd, plan_id: "p", status: "active", current_period_end: PAST },
        { user_id: extra, plan_id: "p", status: "canceled", current_period_end: FUTURE },
      ],
      plans: [{ id: "p", tier_key: "member" }],
    });
    const rows = (await list()).rows;
    expect(rows.map((row) => row.tierSource)).toEqual([
      "subscription",
      "default",
      "default",
      "default",
    ]);
  });

  it("`pending` z przyszłym końcem okresu liczy się; plan bez warstwy i nieznany plan - nie", async () => {
    plan({
      profiles: [profile(T.ana), profile(T.bob)],
      subs: [
        { user_id: T.ana, plan_id: "p-mem", status: "pending", current_period_end: FUTURE },
        { user_id: T.bob, plan_id: "p-none", status: "active", current_period_end: FUTURE },
        { user_id: T.bob, plan_id: "p-unknown", status: "active", current_period_end: FUTURE },
      ],
      plans: [
        { id: "p-mem", tier_key: "member" },
        { id: "p-none", tier_key: null },
      ],
    });
    const rows = (await list()).rows;
    expect(rows[0]).toMatchObject({
      tierKey: "member",
      tierSource: "subscription",
      subscriptionStatus: "pending",
    });
    expect(rows[1]).toMatchObject({ tierSource: "default", subscriptionStatus: null });
  });

  it("warstwa spoza katalogu (nadanie na usunięty klucz) zostaje kluczem i nazwą, z rangą zero", async () => {
    plan({
      profiles: [profile(T.ana)],
      grants: [
        {
          id: "g-1",
          user_id: T.ana,
          tier_key: "legacy",
          starts_at: PAST,
          expires_at: null,
          revoked_at: null,
        },
      ],
      subs: [{ user_id: T.ana, plan_id: "p", status: "active", current_period_end: FUTURE }],
      plans: [{ id: "p", tier_key: "gone" }],
    });
    // Ranga 0 nadania >= ranga 0 subskrypcji -> nadanie.
    expect((await list()).rows[0]).toMatchObject({
      tierKey: "legacy",
      tierName: "legacy",
      tierSource: "grant",
    });
  });
});

// ---------------------------------------------------------------------------
// 3. PIENIĄDZE
// ---------------------------------------------------------------------------

describe("katalog członków - wpłaty", () => {
  it("sumuje kwoty jednej waluty, liczy wpłaty i bierze NAJPÓŹNIEJSZĄ datę", async () => {
    plan({
      profiles: [profile(T.ana)],
      orders: [
        {
          user_id: T.ana,
          amount_cents: 10000,
          currency: "PLN",
          paid_at: "2026-02-01T00:00:00Z",
          status: "paid",
        },
        {
          user_id: T.ana,
          amount_cents: 4900,
          currency: "PLN",
          paid_at: "2026-05-01T00:00:00Z",
          status: "paid",
        },
        { user_id: T.ana, amount_cents: null, currency: "PLN", paid_at: null, status: "paid" },
        { user_id: null, amount_cents: 999999, currency: "PLN", paid_at: PAST, status: "paid" },
      ],
    });
    expect((await list()).rows[0]).toMatchObject({
      paidCents: 14900,
      currency: "PLN",
      paidOther: [],
      paymentsCount: 3,
      lastPaymentAt: "2026-05-01T00:00:00Z",
    });
    // Odczyt wpłat pyta WYŁĄCZNIE o opłacone zamówienia.
    expect(db().lastChain("payment_orders")?.calls).toContainEqual({
      method: "eq",
      args: ["status", "paid"],
    });
  });

  it("NAPRAWA: kwoty w różnych walutach NIE są dodawane - waluta główna to waluta ostatniej wpłaty", async () => {
    // Wcześniej: 100 PLN + 50 EUR + 20 EUR = „170,00 zł" w kolumnie „Zapłacono".
    plan({
      profiles: [profile(T.ana)],
      orders: [
        {
          user_id: T.ana,
          amount_cents: 10000,
          currency: "PLN",
          paid_at: "2026-01-10T00:00:00Z",
          status: "paid",
        },
        {
          user_id: T.ana,
          amount_cents: 5000,
          currency: "EUR",
          paid_at: "2026-03-10T00:00:00Z",
          status: "paid",
        },
        {
          user_id: T.ana,
          amount_cents: 2000,
          currency: "EUR",
          paid_at: "2026-02-10T00:00:00Z",
          status: "paid",
        },
        {
          user_id: T.ana,
          amount_cents: 300,
          currency: "USD",
          paid_at: "2026-01-01T00:00:00Z",
          status: "paid",
        },
      ],
    });
    expect((await list()).rows[0]).toMatchObject({
      paidCents: 7000,
      currency: "EUR",
      paidOther: [
        { cents: 10000, currency: "PLN" },
        { cents: 300, currency: "USD" },
      ],
      paymentsCount: 4,
    });
  });

  it("brak waluty w zamówieniu to PLN; osoba bez wpłat ma zero, PLN i „nigdy”", async () => {
    plan({
      profiles: [profile(T.ana), profile(T.bob)],
      orders: [
        { user_id: T.ana, amount_cents: 500, currency: null, paid_at: null, status: "paid" },
      ],
    });
    const rows = (await list()).rows;
    expect(rows[0]).toMatchObject({ paidCents: 500, currency: "PLN", lastPaymentAt: null });
    expect(rows[1]).toMatchObject({
      paidCents: 0,
      currency: "PLN",
      paidOther: [],
      paymentsCount: 0,
      lastPaymentAt: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. CRM, WYSZUKIWANIE, STRONICOWANIE
// ---------------------------------------------------------------------------

describe("katalog członków - CRM, wyszukiwanie i strony", () => {
  it("kontakt CRM jest dopasowany po adresie BEZ wielkości liter i spacji; firma z katalogu wygrywa z tekstem", async () => {
    plan({
      profiles: [
        profile(T.ana, { email: "  Ana@Example.com " }),
        profile(T.bob, { email: "bob@example.org" }),
        profile(T.cyd, { email: "cyd@example.org" }),
      ],
      leads: [
        {
          id: "lead-a",
          email_norm: "ana@example.com",
          stage: "won",
          company_id: "co-1",
          company: "stara nazwa",
        },
        {
          id: "lead-b",
          email_norm: "bob@example.org",
          stage: "new",
          company_id: null,
          company: "Bob Sp. z o.o.",
        },
        {
          id: "lead-c",
          email_norm: "cyd@example.org",
          stage: "new",
          company_id: "co-missing",
          company: "Tekst",
        },
      ],
      companies: [{ id: "co-1", name: "Nowak Consulting" }],
    });
    const rows = (await list()).rows;
    expect(rows[0]).toMatchObject({
      crmLeadId: "lead-a",
      crmStage: "won",
      crmCompanyId: "co-1",
      crmCompanyName: "Nowak Consulting",
    });
    expect(rows[1]).toMatchObject({
      crmLeadId: "lead-b",
      crmCompanyId: null,
      crmCompanyName: "Bob Sp. z o.o.",
    });
    expect(rows[2]).toMatchObject({ crmCompanyName: "Tekst" });
    expect(db().lastChain("crm_leads")?.argsOf("in")).toEqual([
      "email_norm",
      ["ana@example.com", "bob@example.org", "cyd@example.org"],
    ]);
    expect(db().lastChain("crm_companies")?.argsOf("in")).toEqual(["id", ["co-1", "co-missing"]]);
  });

  it("bez adresów nie ma zapytania do CRM; bez firm - nie ma zapytania o firmy", async () => {
    plan({ profiles: [profile(T.ana, { email: null })] });
    const [row] = (await list()).rows;
    expect(row).toMatchObject({ email: "", crmLeadId: null, crmCompanyName: null });
    expect(db().chainsFor("crm_leads")).toHaveLength(0);
    expect(db().chainsFor("crm_companies")).toHaveLength(0);
  });

  it("fraza jest oczyszczana ze znaków składni filtra PostgREST i szuka w trzech kolumnach", async () => {
    plan({ profiles: [] });
    await list({ search: "  ana,(nowak)%  " });
    expect(db().lastChain("profiles")?.argsOf("or")).toEqual([
      "email.ilike.%ana  nowak%,display_name.ilike.%ana  nowak%,current_company.ilike.%ana  nowak%",
    ]);
  });

  it("fraza złożona WYŁĄCZNIE ze znaków składni nie zawęża listy", async () => {
    plan({ profiles: [] });
    await list({ search: "%,()" });
    expect(db().lastChain("profiles")?.has("or")).toBe(false);
  });

  it("strona N czyta okno 25 wierszy od (N-1)*25, najnowsze najpierw", async () => {
    plan({ profiles: [profile(T.ana)], count: 120 });
    const result = await list({ page: 3 });
    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("range")).toEqual([50, 74]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(result).toMatchObject({ total: 120, page: 3, pageSize: 25 });
  });

  it("pusta strona oddaje licznik bazy i katalog warstw w TEJ SAMEJ kolejności co pełna", async () => {
    plan({ tiers: ok([TIERS[2], TIERS[0]]), profiles: [], count: 7 });
    const result = await list({ page: 2 });
    expect(result).toEqual({
      rows: [],
      total: 7,
      page: 2,
      pageSize: 25,
      tiers: [
        { key: "reader", name: "Czytelnik", rank: 0 },
        { key: "pro", name: "Pro", rank: 30 },
      ],
    });
    // Strona bez osób nie pyta o nadania, subskrypcje ani pieniądze.
    expect(db().chainsFor("membership_grants")).toHaveLength(0);
  });

  it("brak licznika w odpowiedzi: pusta strona daje 0, pełna - liczbę wierszy", async () => {
    plan({ profiles: [], count: null });
    expect((await list()).total).toBe(0);
    h.db = supabaseFromStub();
    plan({ profiles: [profile(T.ana), profile(T.bob)], count: null });
    expect((await list()).total).toBe(2);
  });

  it.fails(
    "DEFEKT: filtr warstwy jest pomijany przez serwer - działa tylko na bieżącej stronie",
    async () => {
      // CO: `ListSchema` przyjmuje `tierKey`, ale handler go nie czyta: zapytanie
      // `profiles` nie jest zawężone, a `total` liczy WSZYSTKIE profile. Panel
      // filtruje wynik po stronie klienta (`rows.filter(row => row.tierKey ===
      // tier)`), więc „Pro" na stronie 1 pokazuje tylko tych z pierwszych 25
      // osób, a stronicowanie obiecuje stron tyle, ile ma cały katalog.
      // DLACZEGO NIE NAPRAWIONE TUTAJ: warstwa nie jest kolumną, tylko wynikiem
      // rozstrzygnięcia z trzech tabel - poprawny filtr ze stronicowaniem wymaga
      // funkcji SQL (zbiór `user_id` per warstwa), a nie `.in()` z listą
      // identyfikatorów, która przy setkach członków rozsadza długość adresu.
      plan({ profiles: [profile(T.ana)], count: 120 });
      await list({ tierKey: "pro" });
      expect(db().lastChain("profiles")?.has("in")).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// 5. AWARIA ODCZYTU NIE UDAJE PUSTKI (naprawa tej kampanii)
// ---------------------------------------------------------------------------

describe("katalog członków - awaria odczytu jest błędem, nie pustką", () => {
  it("odmowa odczytu profili to błąd, nie „brak członków”", async () => {
    plan({ profilesError: "statement timeout" });
    await expect(list()).rejects.toThrow("profiles: statement timeout");
  });

  it("odmowa odczytu katalogu warstw to błąd, nie „wszyscy na planie reader”", async () => {
    plan({ tiers: fail("permission denied"), profiles: [profile(T.ana)] });
    await expect(list()).rejects.toThrow("membership_tiers: permission denied");
  });

  it.each([
    "membership_grants",
    "user_subscriptions",
    "access_plans",
    "payment_orders",
    "crm_leads",
    "crm_companies",
  ])("odmowa odczytu `%s` przerywa listę zamiast rysować zera i plan domyślny", async (table) => {
    plan({
      profiles: [profile(T.ana)],
      leads: [
        {
          id: "lead-a",
          email_norm: profile(T.ana).email,
          stage: "new",
          company_id: "co-1",
          company: null,
        },
      ],
      errorOn: table,
    });
    await expect(list()).rejects.toThrow(`${table}: permission denied`);
  });
});

// ---------------------------------------------------------------------------
// 6. HISTORIA ROZLICZEŃ CZŁONKA
// ---------------------------------------------------------------------------

describe("getMemberBilling - historia wpłat i nadań", () => {
  async function billing(): Promise<MemberBillingResult> {
    return callServerFn<MemberBillingResult>(getMemberBilling, {
      data: { userId: T.ana },
      context: context(),
    });
  }

  it("mapuje wpłaty i nadania, zawężając OBA odczyty do najemcy i osoby", async () => {
    db().setResponse(
      "payment_orders",
      ok([
        {
          id: "o-1",
          kind: "subscription",
          status: "paid",
          amount_cents: 4900,
          currency: "EUR",
          paid_at: "2026-02-02T00:00:00Z",
          created_at: "2026-02-01T00:00:00Z",
          provider: "stripe",
          invoice_url: "https://example.com/inv",
          environment: "live",
        },
        {
          id: "o-2",
          kind: "donation",
          status: "pending",
          amount_cents: null,
          currency: null,
          paid_at: null,
          created_at: "2026-03-01T00:00:00Z",
          provider: null,
          invoice_url: null,
          environment: null,
        },
      ]),
    );
    db().setResponse(
      "membership_grants",
      ok([
        {
          id: "g-1",
          tier_key: "pro",
          source: "manual",
          note: "barter",
          starts_at: PAST,
          expires_at: FUTURE,
          revoked_at: null,
          created_at: PAST,
        },
      ]),
    );
    const result = await billing();
    expect(result.payments).toEqual([
      {
        id: "o-1",
        kind: "subscription",
        status: "paid",
        amountCents: 4900,
        currency: "EUR",
        date: "2026-02-02T00:00:00Z",
        provider: "stripe",
        invoiceUrl: "https://example.com/inv",
        environment: "live",
      },
      {
        id: "o-2",
        kind: "donation",
        status: "pending",
        amountCents: 0,
        currency: "PLN",
        // Niezapłacone zamówienie datujemy chwilą utworzenia.
        date: "2026-03-01T00:00:00Z",
        provider: null,
        invoiceUrl: null,
        environment: null,
      },
    ]);
    expect(result.grants).toEqual([
      {
        id: "g-1",
        tierKey: "pro",
        source: "manual",
        note: "barter",
        startsAt: PAST,
        expiresAt: FUTURE,
        revokedAt: null,
        createdAt: PAST,
      },
    ]);
    expectEveryChainTenantScoped();
    for (const chain of db().chains) {
      expect(chain.calls).toContainEqual({ method: "eq", args: ["user_id", T.ana] });
      expect(chain.argsOf("limit")).toEqual([100]);
    }
  });

  it("puste odpowiedzi dają puste listy", async () => {
    db().setResponse("payment_orders", ok(null));
    db().setResponse("membership_grants", ok(null));
    await expect(billing()).resolves.toEqual({ payments: [], grants: [] });
  });

  it.each(["payment_orders", "membership_grants"])(
    "NAPRAWA: odmowa odczytu `%s` jest błędem, nie pustą historią",
    async (table) => {
      db().setResponse("payment_orders", ok([]));
      db().setResponse("membership_grants", ok([]));
      db().setResponse(table, fail("permission denied"));
      await expect(billing()).rejects.toThrow(`${table}: permission denied`);
    },
  );
});

// ---------------------------------------------------------------------------
// 7. NADANIE RĘCZNE
// ---------------------------------------------------------------------------

describe("setMemberTier - ręczne nadanie warstwy", () => {
  function planGrant(
    over: { target?: unknown; tier?: unknown; revokeError?: string; insert?: SupabaseResult } = {},
  ) {
    db().setResponse("profiles", ok(over.target === undefined ? { id: T.ana } : over.target));
    db().setResponse("membership_grants", (chain) => {
      if (chain.has("update")) return over.revokeError ? fail(over.revokeError) : ok(null);
      return over.insert ?? ok({ id: T.grant });
    });
    db().setResponse("membership_tiers", ok(over.tier === undefined ? { key: "pro" } : over.tier));
    db().setResponse("audit_log", ok(null));
  }

  async function grant(input: Record<string, unknown> = {}) {
    return callServerFn<{ grantId: string; crmSynced: boolean }>(setMemberTier, {
      data: { userId: T.ana, tierKey: "pro", ...input },
      context: context(),
    });
  }

  it("wygasza poprzednie nadania, wstawia nowe, pisze audyt i synchronizuje CRM", async () => {
    planGrant();
    await expect(grant({ months: 12, note: "  barter  " })).resolves.toEqual({
      grantId: T.grant,
      crmSynced: true,
    });
    const chains = db().chainsFor("membership_grants");
    expect(chains[0].argsOf("update")).toEqual([{ revoked_at: NOW.toISOString() }]);
    expect(chains[0].calls).toContainEqual({ method: "is", args: ["revoked_at", null] });
    expect(chains[1].argsOf("insert")).toEqual([
      {
        tenant_id: T.tenant,
        user_id: T.ana,
        tier_key: "pro",
        source: "manual",
        note: "barter",
        granted_by: T.caller,
        starts_at: NOW.toISOString(),
        expires_at: "2027-06-15T12:00:00.000Z",
      },
    ]);
    expect(db().lastChain("audit_log")?.argsOf("insert")).toEqual([
      {
        tenant_id: T.tenant,
        actor_id: T.caller,
        action: "membership.manual_grant",
        entity_type: "membership_grant",
        entity_id: T.grant,
        metadata: { tier_key: "pro", months: 12, user_id: T.ana },
      },
    ]);
    expect(h.syncCalls).toEqual([
      {
        userId: T.ana,
        tenantId: T.tenant,
        tierKey: "pro",
        actorId: T.caller,
        reason: "manual_grant",
      },
    ]);
    expectEveryChainTenantScoped();
  });

  it("bezterminowo = `expires_at: null`; nieudana synchronizacja CRM jest zgłaszana, nie ukrywana", async () => {
    planGrant();
    h.syncSnapshot = null;
    await expect(grant()).resolves.toEqual({ grantId: T.grant, crmSynced: false });
    expect(db().chainsFor("membership_grants")[1].argsOf("insert")?.[0]).toMatchObject({
      expires_at: null,
      note: null,
    });
  });

  it("osoba spoza najemcy wołającego - odmowa bez żadnego zapisu", async () => {
    planGrant({ target: null });
    await expect(grant()).rejects.toThrow("Forbidden: user outside tenant");
    expect(db().chainsFor("membership_grants")).toHaveLength(0);
    expect(db().chainsFor("audit_log")).toHaveLength(0);
  });

  it("warstwa spoza katalogu najemcy - odmowa bez żadnego zapisu", async () => {
    planGrant({ tier: null });
    await expect(grant()).rejects.toThrow("Unknown membership tier");
    expect(db().chainsFor("membership_grants")).toHaveLength(0);
  });

  it("NAPRAWA: odmowa wygaszenia poprzednich nadań PRZERYWA nadanie - nie powstaje drugie aktywne", async () => {
    planGrant({ revokeError: "permission denied" });
    await expect(grant()).rejects.toThrow("membership_grants: permission denied");
    const chains = db().chainsFor("membership_grants");
    expect(chains).toHaveLength(1);
    expect(chains[0].has("insert")).toBe(false);
    expect(h.syncCalls).toHaveLength(0);
  });

  it("odmowa wstawienia oddaje komunikat bazy; brak wiersza bez błędu - komunikat zastępczy", async () => {
    planGrant({ insert: fail("duplicate key") });
    await expect(grant()).rejects.toThrow("duplicate key");
    h.db = supabaseFromStub();
    planGrant({ insert: ok(null) });
    await expect(grant()).rejects.toThrow("Grant failed");
    expect(db().chainsFor("audit_log")).toHaveLength(0);
  });
});

describe("addCalendarMonthsUtc - termin nadania w miesiącach kalendarzowych", () => {
  it("zwykły dzień: ta sama data i godzina N miesięcy później, przez granicę roku", () => {
    expect(addCalendarMonthsUtc(new Date("2026-06-15T12:34:56Z"), 1).toISOString()).toBe(
      "2026-07-15T12:34:56.000Z",
    );
    expect(addCalendarMonthsUtc(new Date("2026-11-10T00:00:00Z"), 3).toISOString()).toBe(
      "2027-02-10T00:00:00.000Z",
    );
  });

  it("NAPRAWA: koniec miesiąca jest PRZYCINANY, a nie przelewany na następny miesiąc", () => {
    // Wcześniej 31 stycznia + 1 miesiąc = 3 marca (Date.UTC przelewa 31 lutego).
    expect(addCalendarMonthsUtc(new Date("2026-01-31T09:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T09:00:00.000Z",
    );
    expect(addCalendarMonthsUtc(new Date("2028-01-31T09:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T09:00:00.000Z",
    );
    expect(addCalendarMonthsUtc(new Date("2026-08-31T09:00:00Z"), 1).toISOString()).toBe(
      "2026-09-30T09:00:00.000Z",
    );
    expect(addCalendarMonthsUtc(new Date("2026-01-31T09:00:00Z"), 120).toISOString()).toBe(
      "2036-01-31T09:00:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// 8. COFNIĘCIE NADANIA
// ---------------------------------------------------------------------------

describe("revokeMemberTier - cofnięcie ręcznego nadania", () => {
  async function revoke() {
    return callServerFn<{ ok: true; crmSynced: boolean }>(revokeMemberTier, {
      data: { grantId: T.grant },
      context: context(),
    });
  }

  it("cofa AKTYWNE nadanie w najemcy, pisze audyt i synchronizuje osobę z CRM", async () => {
    db().setResponse("membership_grants", ok({ user_id: T.ana }));
    db().setResponse("audit_log", ok(null));
    await expect(revoke()).resolves.toEqual({ ok: true, crmSynced: true });
    const chain = db().lastChain("membership_grants");
    expect(chain?.argsOf("update")).toEqual([{ revoked_at: NOW.toISOString() }]);
    expect(chain?.calls).toContainEqual({ method: "eq", args: ["id", T.grant] });
    expect(chain?.calls).toContainEqual({ method: "is", args: ["revoked_at", null] });
    expect(db().lastChain("audit_log")?.argsOf("insert")?.[0]).toMatchObject({
      action: "membership.manual_revoke",
      entity_id: T.grant,
      actor_id: T.caller,
    });
    expect(h.syncCalls).toEqual([
      {
        userId: T.ana,
        tenantId: T.tenant,
        tierKey: null,
        actorId: T.caller,
        reason: "manual_revoke",
      },
    ]);
    expectEveryChainTenantScoped();
  });

  it("nieudana synchronizacja CRM po cofnięciu jest zgłaszana", async () => {
    db().setResponse("membership_grants", ok({ user_id: T.ana }));
    db().setResponse("audit_log", ok(null));
    h.syncSnapshot = null;
    await expect(revoke()).resolves.toEqual({ ok: true, crmSynced: false });
  });

  it("cofnięty wiersz bez osoby nie jest synchronizowany - i to nie jest porażka CRM", async () => {
    db().setResponse("membership_grants", ok({ user_id: null }));
    db().setResponse("audit_log", ok(null));
    await expect(revoke()).resolves.toEqual({ ok: true, crmSynced: true });
    expect(h.syncCalls).toHaveLength(0);
  });

  it("odmowa bazy oddaje jej komunikat i nie pisze audytu", async () => {
    db().setResponse("membership_grants", fail("permission denied"));
    db().setResponse("audit_log", ok(null));
    await expect(revoke()).rejects.toThrow("permission denied");
    expect(db().chainsFor("audit_log")).toHaveLength(0);
  });

  it("NAPRAWA: nadanie już cofnięte albo cudze - odmowa, BEZ fałszywego wpisu audytu „cofnięto”", async () => {
    db().setResponse("membership_grants", ok(null));
    db().setResponse("audit_log", ok(null));
    await expect(revoke()).rejects.toThrow("Grant not found or already revoked");
    expect(db().chainsFor("audit_log")).toHaveLength(0);
    expect(h.syncCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. PEŁNA SYNCHRONIZACJA Z CRM
// ---------------------------------------------------------------------------

describe("syncMembersWithCrm - partia synchronizacji", () => {
  async function sync(input: Record<string, unknown> = {}) {
    return callServerFn<{
      people: number;
      nextCursor: string | null;
      done: boolean;
      skipped: number;
    }>(syncMembersWithCrm, { data: input, context: context() });
  }

  it("pierwsza partia: profile najemcy po `id` rosnąco, bez kursora, z limitem +1 na sprawdzenie końca", async () => {
    db().setResponse(
      "profiles",
      ok([
        { id: T.ana, email: "ana@example.com" },
        { id: T.bob, email: "   " },
      ]),
    );
    const result = await sync({ batchSize: 5 });
    expect(result).toMatchObject({ people: 1, skipped: 1, nextCursor: T.bob, done: true });
    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("order")).toEqual(["id", { ascending: true }]);
    expect(chain?.argsOf("limit")).toEqual([6]);
    expect(chain?.has("gt")).toBe(false);
    expect(h.syncCalls).toEqual([
      { userId: T.ana, tenantId: T.tenant, tierKey: null, actorId: T.caller, reason: "backfill" },
    ]);
    expectEveryChainTenantScoped();
  });

  it("kolejna partia czyta od kursora; pusta odpowiedź kończy synchronizację", async () => {
    db().setResponse("profiles", ok(null));
    const result = await sync({ cursor: T.ana });
    expect(result).toMatchObject({ people: 0, nextCursor: T.ana, done: true });
    expect(db().lastChain("profiles")?.argsOf("gt")).toEqual(["id", T.ana]);
  });

  it("odmowa odczytu profili przerywa partię błędem", async () => {
    db().setResponse("profiles", fail("permission denied"));
    await expect(sync()).rejects.toThrow("permission denied");
  });
});
