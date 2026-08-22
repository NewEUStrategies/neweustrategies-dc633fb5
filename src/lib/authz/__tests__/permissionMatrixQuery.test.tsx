// WARSTWA DANYCH MACIERZY UPRAWNIEŃ (`authz/permissionMatrixQuery.ts` - 0%).
//
// CO TEN PLIK DOWODZI. Macierz uprawnień to ekran AUDYTU: administrator czyta
// z niego, kto co może w tym obszarze roboczym. Kolumny warstw członkostwa
// pochodzą z `membership_tiers`, a ta tabela jest PER TENANT. Dwa błędy w tej
// warstwie dają skutki, których na ekranie nie da się odróżnić od prawdy:
//
//   1. KLUCZ CACHE BEZ TENANTA. React Query serwowałby wtedy trafienie
//      z poprzedniego obszaru roboczego, czyli audyt pokazywałby warstwy
//      CUDZEGO tenanta pod nazwą bieżącego. To jest wyciek między obszarami
//      roboczymi w interfejsie, nawet gdy baza go nie dopuszcza.
//   2. BRAK JAWNEGO FILTRA `tenant_id`. RLS to zatrzyma (polityki
//      `membership_tiers` mają `tenant_id = current_tenant_id()`), ale filtr
//      po stronie klienta jest DRUGĄ bramką w duchu `lib/tenant.ts` - i to on
//      chroni przed pomyłką w kluczu cache wyżej.
//
// Dowodzone jest też to, czego nie widać w szczęśliwym przebiegu: zapytanie
// NIE WYCHODZI, dopóki tenant nie jest znany (`enabled`), stan „nie wiemy,
// który tenant" jest nieodróżnialny od „wczytujemy" (`isLoading`), a odmowa
// bazy dochodzi do konsumenta jako błąd, nie jako pusta lista warstw.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguł macierzy - `permissionMatrix.ts` ma własny
// test (`permissionMatrix.test.ts`) i to on liczy, co która rola i warstwa
// może. Parytetu ze snapshotem autoryzacji - `authzSnapshotParity.test.ts`
// i bramki `check:authz-snapshot` / `check:permissions-parity`. AUTORYTETU
// bazy (czy RLS na `membership_tiers` faktycznie zawęża do tenanta sesji) -
// pgTAP: `rls_tenant_isolation_test.sql`, `tenant_isolation_three_tenants_test.sql`,
// `security_definer_tenant_scope_test.sql`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Tenant oddawany przez `useCurrentTenantId` - `null` = jeszcze nie wiemy. */
  tenantId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
      return h.db.from(table);
    },
  },
}));

// Podmieniamy WYŁĄCZNIE hook tenanta: jego własna droga do bazy (`profiles`)
// ma osobny test, a tutaj przedmiotem dowodu jest to, co warstwa macierzy robi
// z ODPOWIEDZIĄ - w szczególności ze stanem „tenant nieznany".
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import {
  fetchTenantMembershipTiers,
  permissionMatrixKeys,
  useTenantMembershipTiers,
} from "@/lib/authz/permissionMatrixQuery";

const TABLE = "membership_tiers";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

/** Wiersz warstwy w kształcie, jaki oddaje zapytanie macierzy. */
function tierRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    key: "member",
    rank: 10,
    name_pl: "Członek",
    name_en: "Member",
    features: { expert_request_quota: 3 },
    is_default: true,
    ...over,
  };
}

function db(): SupabaseFromStub {
  const stub = h.db;
  if (stub === null) throw new Error("test: atrapa bazy nie została zainicjalizowana");
  return stub;
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  db().setResponse(TABLE, ok([tierRow()]));
});

// ---------------------------------------------------------------------------
// 1. KLUCZE CACHE - izolacja obszarów roboczych
// ---------------------------------------------------------------------------

describe("permissionMatrixKeys - klucze cache", () => {
  it("klucz warstw NIESIE identyfikator tenanta", () => {
    // Bez tenanta w kluczu React Query oddałby przy przelogowaniu kolumny
    // z poprzedniego obszaru roboczego - i audyt pokazałby cudze warstwy.
    expect(permissionMatrixKeys.tenantTiers(TENANT)).toEqual([
      "authz",
      "permission-matrix",
      "tiers",
      TENANT,
    ]);
  });

  it("dwa tenanty mają RÓŻNE klucze", () => {
    expect(permissionMatrixKeys.tenantTiers(TENANT)).not.toEqual(
      permissionMatrixKeys.tenantTiers(OTHER_TENANT),
    );
  });

  it("klucz z `null` jest osobnym kluczem, nie brakiem klucza", () => {
    // Stan „tenant nieznany" musi mieć własny wpis: sklejenie go z jakimkolwiek
    // tenantem oznaczałoby zapisanie pustej odpowiedzi pod cudzym kluczem.
    expect(permissionMatrixKeys.tenantTiers(null)).toEqual([
      "authz",
      "permission-matrix",
      "tiers",
      null,
    ]);
  });

  it("prefiks inwalidacji jest PREFIKSEM klucza warstw - inaczej nie unieważni niczego", () => {
    // To asercja STRUKTURALNA na relacji między dwoma kluczami, a nie na ich
    // treści: `invalidateQueries({ queryKey: all() })` działa po prefiksie,
    // więc rozjazd pierwszych segmentów zostawiałby stary audyt na ekranie.
    const all = permissionMatrixKeys.all();
    const tiers = permissionMatrixKeys.tenantTiers(TENANT);
    expect(tiers.slice(0, all.length)).toEqual([...all]);
  });
});

// ---------------------------------------------------------------------------
// 2. ZAPYTANIE - kształt łańcucha i mapowanie
// ---------------------------------------------------------------------------

describe("fetchTenantMembershipTiers - kształt zapytania", () => {
  it("łańcuch ma KONTRAKTOWY kształt: kolumny, DWA filtry, kolejność rang", async () => {
    await fetchTenantMembershipTiers(TENANT);

    const chain = db().lastChain(TABLE);
    expect(chain?.calls.map((call) => call.method)).toEqual(["select", "eq", "eq", "order"]);
    expect(chain?.argsOf("order")).toEqual(["rank", { ascending: true }]);
  });

  it("zawężenie TENANTEM jest jawne w zapytaniu - druga bramka obok RLS", async () => {
    await fetchTenantMembershipTiers(TENANT);

    const chain = db().lastChain(TABLE);
    const filters = (chain?.calls ?? [])
      .filter((call) => call.method === "eq")
      .map((call) => call.args);
    expect(filters).toEqual([
      ["tenant_id", TENANT],
      ["active", true],
    ]);
  });

  it("zapytanie czyta DOKŁADNIE kolumny macierzy - nic ponad to", async () => {
    // Lista kolumn jest kontraktem z bazą: `select("*")` przyniósłby na klienta
    // pola, których macierz nie opisuje (m.in. ceny), a te nie mają po co
    // wychodzić z bazy na ekran audytu.
    await fetchTenantMembershipTiers(TENANT);

    expect(db().lastChain(TABLE)?.argsOf("select")).toEqual([
      "key, rank, name_pl, name_en, features, is_default",
    ]);
  });

  it("PUSTA tabela warstw daje pustą listę, nie wyjątek", async () => {
    db().setResponse(TABLE, ok([]));
    await expect(fetchTenantMembershipTiers(TENANT)).resolves.toEqual([]);
  });

  it("`data: null` z PostgREST-a też daje pustą listę (gałąź `?? []`)", async () => {
    db().setResponse(TABLE, ok(null));
    await expect(fetchTenantMembershipTiers(TENANT)).resolves.toEqual([]);
  });

  it("ODMOWA bazy RZUCA - warstwa nie może udawać, że tenant nie ma warstw", async () => {
    // To jest klasa defektu, która w tym repozytorium wystąpiła kilka razy:
    // awaria odczytu pokazana jako „brak danych". W audycie uprawnień znaczyłaby
    // „ten obszar roboczy nie sprzedaje żadnego członkostwa".
    db().setResponse(TABLE, fail("permission denied for table membership_tiers", "42501"));
    await expect(fetchTenantMembershipTiers(TENANT)).rejects.toThrow("permission denied");
  });

  it("mapowanie przepisuje SZEŚĆ pól i NIE przepuszcza kolumn dodatkowych", async () => {
    // Gdyby mapowanie było rozłożeniem (`...row`), kolumna dodana w migracji
    // wchodziłaby do stanu Reacta bez decyzji człowieka.
    db().setResponse(TABLE, ok([tierRow({ price_cents: 9900, stripe_price_id: "price_x" })]));
    const tiers = await fetchTenantMembershipTiers(TENANT);

    expect(tiers).toEqual([
      {
        key: "member",
        rank: 10,
        name_pl: "Członek",
        name_en: "Member",
        features: { expert_request_quota: 3 },
        is_default: true,
      },
    ]);
  });

  it.each([
    { label: "`features` jako null", value: null },
    { label: "`features` jako pusty obiekt", value: {} },
    { label: "`features` z zerem", value: { expert_request_quota: 0 } },
  ])(
    "$label przechodzi BEZ ZMIANY - decyzję podejmuje macierz, nie warstwa danych",
    async ({ value }) => {
      // `0` jest tu wartością FAŁSZYWĄ ALE PRAWIDŁOWĄ: znaczy „zero wniosków",
      // a nie „brak limitu". Warstwa danych nie ma prawa jej podmienić.
      db().setResponse(TABLE, ok([tierRow({ features: value })]));
      const tiers = await fetchTenantMembershipTiers(TENANT);

      expect(tiers[0]?.features).toEqual(value);
    },
  );

  it("kolejność wierszy z bazy jest ZACHOWANA - to baza sortuje po randze", async () => {
    db().setResponse(
      TABLE,
      ok([tierRow({ key: "member", rank: 10 }), tierRow({ key: "partner", rank: 40 })]),
    );
    const tiers = await fetchTenantMembershipTiers(TENANT);

    expect(tiers.map((tier) => tier.key)).toEqual(["member", "partner"]);
  });
});

// ---------------------------------------------------------------------------
// 3. HOOK - stan „tenant nieznany", ładowanie, błąd
// ---------------------------------------------------------------------------

describe("useTenantMembershipTiers - stan dla macierzy", () => {
  function mount() {
    const client = newClient();
    return {
      ...renderHook(() => useTenantMembershipTiers(), { wrapper: wrapper(client) }),
      client,
    };
  }

  it("BEZ znanego tenanta zapytanie NIE WYCHODZI, a stan mówi „wczytywanie”", async () => {
    // `enabled: tenantId !== null` plus `isLoading: tenantId === null || …`.
    // Bez pierwszego warunku poleciałoby zapytanie z `tenant_id = "null"`;
    // bez drugiego macierz wyrenderowałaby się jako „brak warstw" i pokazała
    // audyt bez kolumn członkostwa.
    h.tenantId = null;
    const { result } = mount();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.tiers).toEqual([]);
    expect(result.current.tenantId).toBeNull();
    expect(result.current.error).toBeNull();
    expect(db().chains).toEqual([]);
  });

  it("ze znanym tenantem oddaje warstwy i przestaje się wczytywać", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tiers.map((tier) => tier.key)).toEqual(["member"]);
    expect(result.current.tenantId).toBe(TENANT);
    expect(result.current.error).toBeNull();
    expect(db().chainsFor(TABLE)).toHaveLength(1);
  });

  it("zapytanie idzie po tenancie z hooka, nie po żadnej innej wartości", async () => {
    h.tenantId = OTHER_TENANT;
    const { result } = mount();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(db().lastChain(TABLE)?.argsOf("eq")).toEqual(["tenant_id", OTHER_TENANT]);
  });

  it("ODMOWA bazy dochodzi jako BŁĄD, a lista warstw zostaje pusta", async () => {
    db().setResponse(TABLE, fail("permission denied for table membership_tiers", "42501"));
    const { result } = mount();
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toContain("permission denied");
    expect(result.current.tiers).toEqual([]);
    // Stan pusty i stan błędu są ROZDZIELONE: konsument ma czym odróżnić
    // „tenant nie ma warstw" od „nie udało się ich odczytać".
    expect(result.current.isLoading).toBe(false);
  });

  it("pusta tabela warstw to NIE błąd - macierz rysuje wtedy same role", async () => {
    db().setResponse(TABLE, ok([]));
    const { result } = mount();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tiers).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("dwa tenanty w JEDNYM kliencie nie mieszają się w cache", async () => {
    // Sedno izolacji: ten sam klient React Query, dwa różne tenanty, dwa
    // różne zapytania i dwa różne wyniki. Wspólny klucz dałby tu jeden
    // odczyt i te same kolumny w obu obszarach roboczych.
    db().setResponse(TABLE, (chain) => {
      const tenant = chain.argsOf("eq")?.[1];
      return tenant === OTHER_TENANT
        ? ok([tierRow({ key: "partner", rank: 40 })])
        : ok([tierRow({ key: "member", rank: 10 })]);
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderHook(() => useTenantMembershipTiers(), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(first.result.current.tiers.map((tier) => tier.key)).toEqual(["member"]);

    h.tenantId = OTHER_TENANT;
    const second = renderHook(() => useTenantMembershipTiers(), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));

    expect(second.result.current.tiers.map((tier) => tier.key)).toEqual(["partner"]);
    expect(db().chainsFor(TABLE)).toHaveLength(2);
  });
});
