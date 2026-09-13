// ROZJAZD ROLA/DANE: rola sprawdzana w obszarze WOŁAJĄCEGO, dane czytane
// z obszaru spod HOSTA - jedna asercja dla wszystkich funkcji panelu pieniędzy.
//
// CO BYŁO ZŁE. `assertAdmin` autoryzuje przez `has_role()` -> `current_tenant_id()`
// -> `profiles.tenant_id` wołającego, a warstwa danych rozstrzygała najemcę
// DRUGI RAZ: `resolveTenantIdForHost(currentTenantHost())`. To były dwie różne
// granice. Uwierzytelniony admin obszaru A otwierał publiczną domenę obszaru B
// (albo wołał funkcję serwerową `curl`em z dowolnym `Origin` - `csrfMiddleware`
// nie jest tu żadną przeszkodą, napastnik ma własny token) i przechodził bramkę
// roli w A, a zapytanie szło po B: rejestr wpłat z adresami darczyńców, pełny
// rejestr monetyzacji, eksport audytu rozliczeń.
//
// JAK NAPRAWIONE. Jedno źródło zakresu - profil wołającego. Host jest wyłącznie
// KONTROLĄ SPÓJNOŚCI: gdy wiąże się z innym obszarem, funkcja odmawia; gdy nie
// wiąże się z niczym (dev, podgląd, pusty katalog domen), przepuszcza na
// najemcy profilowym.
//
// DOKTRYNA TEGO PLIKU: odmowa PRZED odczytem. Asercją jest nie tylko rzucony
// wyjątek, ale i to, że warstwa danych NIE ZOSTAŁA WYWOŁANA ani razu.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { callServerFn } from "@/test/serverFnHarness";

/** Obszar wołającego (profil) i obszar spod hosta żądania - celowo różne. */
const TENANT_WOLAJACEGO = "11111111-1111-4111-8111-111111111111";
const TENANT_HOSTA = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  binding: null as { id: string } | null,
  listAdminDonations: vi.fn(),
  loadMonetizationLedger: vi.fn(),
  buildAuditReport: vi.fn(),
  buildAuditExport: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

// Host: samo wiązanie domeny, bez fallbacku na najemcę domyślnego.
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "obcy.example.test",
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveDomainBinding: async () => ({
    tenant: h.binding,
    directoryPopulated: h.binding !== null,
  }),
}));

// WARSTWY DANYCH SĄ ATRAPAMI CELOWO: dowodem jest to, że żadna z nich nie
// została dotknięta. Bramka stoi przed nimi, nie w nich.
vi.mock("@/lib/billing/donationsAdmin.server", () => ({
  listAdminDonations: h.listAdminDonations,
  syncDonationsFromStripe: vi.fn(),
}));
vi.mock("@/lib/admin/monetization/ledger.server", () => ({
  loadMonetizationLedger: h.loadMonetizationLedger,
}));
vi.mock("@/lib/billing/audit.server", () => ({
  buildAuditReport: h.buildAuditReport,
  buildAuditExport: h.buildAuditExport,
}));

const { listDonationRecords } = await import("@/lib/billing/donationsAdmin.functions");
const { listMonetizationLedger } = await import("@/lib/admin/monetization/ledger.functions");
const { getBillingAudit, exportBillingAudit } = await import("@/lib/billing/audit.functions");

/** Klient użytkownika z kontekstu: RPC roli + odczyt własnego profilu. */
let userRpc: SupabaseRpcStub;
let userDb: SupabaseFromStub;
const kontekst = () => ({
  supabase: { rpc: userRpc.rpc, from: (table: string) => userDb.from(table) },
  userId: ADMIN_ID,
});

/** Wszystkie warstwy danych naraz - „ani jedno wywołanie" jest asercją zbiorczą. */
const warstwyDanych = () => [
  h.listAdminDonations,
  h.loadMonetizationLedger,
  h.buildAuditReport,
  h.buildAuditExport,
];

beforeEach(() => {
  vi.clearAllMocks();
  userRpc = supabaseRpcStub();
  // Rola JEST - i to jest sedno: bramka roli przechodzi w obszarze wołającego.
  userRpc.setData("has_role", true);
  userDb = supabaseFromStub();
  userDb.setResponse("profiles", ok({ tenant_id: TENANT_WOLAJACEGO }));
  h.binding = { id: TENANT_HOSTA };
  h.buildAuditReport.mockResolvedValue({ orders: [], webhooks: [] });
  h.buildAuditExport.mockResolvedValue({ fileName: "x.csv", mimeType: "text/csv", body: "" });
  h.loadMonetizationLedger.mockResolvedValue({ donations: [], grants: [], giftLinks: [] });
  h.listAdminDonations.mockResolvedValue([]);
});

const przypadki: Array<[string, () => Promise<unknown>]> = [
  [
    "listDonationRecords",
    () => callServerFn(listDonationRecords, { data: { limit: 50 }, context: kontekst() }),
  ],
  [
    "listMonetizationLedger",
    () =>
      callServerFn(listMonetizationLedger, {
        data: { environment: "all", limit: 50 },
        context: kontekst(),
      }),
  ],
  [
    "getBillingAudit",
    () =>
      callServerFn(getBillingAudit, {
        data: { environment: "live", sinceHours: 24 },
        context: kontekst(),
      }),
  ],
  [
    "exportBillingAudit",
    () =>
      callServerFn(exportBillingAudit, {
        data: { environment: "live", sinceHours: 24, format: "csv" },
        context: kontekst(),
      }),
  ],
];

describe("rola w obszarze wołającego kontra dane z obszaru hosta", () => {
  it.each(przypadki)(
    "%s: host wiążący się z INNYM obszarem = odmowa przed jakimkolwiek odczytem",
    async (_nazwa, wywolaj) => {
      await expect(wywolaj()).rejects.toThrow("TENANT/HOST_MISMATCH");

      for (const warstwa of warstwyDanych()) expect(warstwa).not.toHaveBeenCalled();
    },
  );

  it.each(przypadki)(
    "%s: komunikat odmowy jest JEDNAKOWY i nie zdradza obszaru spod hosta",
    async (_nazwa, wywolaj) => {
      // Różne teksty zamieniłyby odmowę w wyrocznię mapy domena -> obszar
      // roboczy; identyfikator najemcy spod hosta nie może w niej wystąpić.
      await expect(wywolaj()).rejects.toThrow(/^TENANT\/HOST_MISMATCH$/);
      await expect(wywolaj()).rejects.not.toThrow(new RegExp(TENANT_HOSTA));
    },
  );

  it.each(przypadki)(
    "%s: host bez wiązania (dev, podgląd) NIE blokuje pracy we własnym obszarze",
    async (_nazwa, wywolaj) => {
      // ANTYREGRESJA. `resolveTenantForHost` spada dla nieznanego hosta na
      // najemcę domyślnego - gdyby bramka porównywała się z TĄ wartością,
      // każdy admin spoza tego najemcy dostawałby odmowę na localhoście
      // i `*.pages.dev`.
      h.binding = null;

      await expect(wywolaj()).resolves.toBeDefined();
    },
  );

  it("zakres, który dojechał do warstwy danych, to najemca PROFILU", async () => {
    h.binding = null;

    await callServerFn(listDonationRecords, { data: { limit: 7 }, context: kontekst() });
    await callServerFn(listMonetizationLedger, {
      data: { environment: "all", limit: 50 },
      context: kontekst(),
    });
    await callServerFn(getBillingAudit, {
      data: { environment: "live", sinceHours: 24 },
      context: kontekst(),
    });

    expect(h.listAdminDonations).toHaveBeenCalledWith(7, TENANT_WOLAJACEGO);
    expect(h.loadMonetizationLedger).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_WOLAJACEGO }),
    );
    expect(h.buildAuditReport).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_WOLAJACEGO }),
    );
  });

  it("ŻADNEJ gałęzi wyjątku dla `super_admin` - ta sama odmowa", async () => {
    // `is_super_admin()` w bazie ma `AND tenant_id = current_tenant_id()`, więc
    // „super admin pomija porównanie host/profil" odtworzyłoby całą lukę dla
    // każdego, kto ma tę rolę we WŁASNYM obszarze roboczym. Atrapa odpowiada
    // `true` na KAŻDE pytanie o rolę - łącznie z `super_admin`.
    userRpc.setResponse("has_role", () => ok(true));

    await expect(
      callServerFn(listDonationRecords, { data: { limit: 50 }, context: kontekst() }),
    ).rejects.toThrow("TENANT/HOST_MISMATCH");
    expect(h.listAdminDonations).not.toHaveBeenCalled();
  });

  it("profil bez najemcy zamyka ścieżkę, zanim host w ogóle zostanie zapytany", async () => {
    userDb.setResponse("profiles", ok({ tenant_id: null }));

    await expect(
      callServerFn(listDonationRecords, { data: { limit: 50 }, context: kontekst() }),
    ).rejects.toThrow("No tenant for current user");
    expect(h.listAdminDonations).not.toHaveBeenCalled();
  });
});
