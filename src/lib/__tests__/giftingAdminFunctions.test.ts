// Pięć funkcji serwerowych panelu „Gift Articles" - ustawienia per najemca,
// statystyki, lista linków, unieważnienie i dziennik audytu.
//
// Plik produkcyjny stał na 0% linii i 0 z 11 funkcji, bo prawdziwa funkcja
// zbudowana przez `createServerFn` nie daje się wywołać poza runtime'em
// TanStack Start. Harness `src/test/serverFnHarness.ts` podmienia fabrykę
// i oddaje SPECYFIKACJĘ `{ validator, handler, middleware }`, więc test
// przechodzi przez PRAWDZIWE ciało handlera.
//
// CZEGO TEN PLIK NIE DOWODZI - i tak wolno czytać jego zieleń.
// Harness NIE URUCHAMIA MIDDLEWARE. Zieleń tego pliku nie mówi nic o tym, czy
// autor bez uprawnień się dostanie - o tym mówią: bramka statyczna
// `check:authz-snapshot`, RLS oraz re-walidacja roli i najemcy WEWNĄTRZ każdego
// SECURITY DEFINER RPC. Tutaj dowodzimy DEKLARACJI middleware (strukturalnie)
// i poprawności logiki handlera.
//
// CO TEN PLIK DOWODZI.
//   1. KAŻDA Z PIĄTKI DEKLARUJE `requireAdminEditor` - i to jako JEDYNE
//      middleware. Funkcja panelu, która zgubi tę deklarację, przechodzi przez
//      `tsc` i przez recenzję, a znaczy „dowolny zalogowany czyta dziennik
//      audytu prezentów wraz z e-mailami nadawców i odbiorców".
//   2. BRAK WIERSZA USTAWIEŃ NIE ZNACZY „WSZYSTKO NA ZERO". `create_gift_link`
//      i `redeem_gift_link` egzekwują wtedy fallbacki 10/30/5 i bramkę
//      rejestracji, więc panel MUSI pokazać właśnie je, z `persisted: false`.
//      Panel pokazujący zera skłoniłby admina do „naprawienia" ustawień, które
//      nie są zepsute - a zapis zer to wyłączenie limitu (0 = bez limitu).
//   3. GRANICE `GIFT_ADMIN_BOUNDS` SĄ LUSTREM CHECK-ów Z BAZY. Test jest
//      parametryzowany po KAŻDYM z trzech pól liczbowych i sprawdza cztery
//      punkty (min-1 odrzucone, min przyjęte, max przyjęte, max+1 odrzucone)
//      plus wartość niecałkowitą. Rozjazd walidatora z CHECK-iem znaczy albo
//      „panel odrzuca wartość, którą baza przyjmuje", albo - groźniej - „panel
//      wysyła wartość, na której baza wywali błąd bez czytelnego komunikatu".
//   4. BRAK NAJEMCY ODCINA ZAPIS PRZED `upsert`. Zapis bez `tenant_id` byłby
//      zapisem do cudzego albo do żadnego najemcy - dowodzimy, że upsert NIE
//      poleciał, a nie tylko że handler rzucił.
//   5. `total` POCHODZI Z `total_count` PIERWSZEGO WIERSZA, a pusta lista daje
//      `0`. To jest kontrakt paginacji: `total` policzony z długości strony
//      pokazywałby „50 linków" na każdej stronie.
//   6. `revokeGiftLinkAdmin` ZWRACA `ok === true`, NIE WARTOŚĆ PRAWDZIWOPODOBNĄ.
//      Odpowiedź `"true"` albo `1` MUSI dać `ok: false` - inaczej panel
//      potwierdza unieważnienie linku, którego baza nie unieważniła.
//   7. `event_type` JEST OTWARTYM STRINGIEM w kształcie wiersza. Dziennik audytu
//      ma pokazać zdarzenie, którego ten build nie zna, ZAMIAST je przekłamać.
//
// PUŁAPKA HARNESSU, udokumentowana tu raz. `getGiftAdminStats` woła
// `context.supabase.rpc(...).maybeSingle()` - to JEDYNE miejsce w module, gdzie
// po `rpc()` stoi ogniwo łańcucha (pozostałe trzy RPC są awaitowane wprost).
// `supabaseRpcStub().rpc()` oddaje GOŁY Promise, więc naiwne podanie go do
// kontekstu daje `TypeError: maybeSingle is not a function` - czyli FAŁSZYWĄ
// czerwień na poprawnym kodzie produkcyjnym. Adapter `rpcWithTerminals` niżej
// dokleja terminale do tego jednego wywołania; wspólnej atrapy w `src/test/`
// świadomie NIE ruszamy, żeby nie ukryć przypadkowego użycia `maybeSingle`
// tam, gdzie produkcja go nie ma.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
// Marker z polem `name`, żeby `serverFnMiddlewareNames` mógł go rozpoznać.
// Prawdziwy moduł woła `createMiddleware` i ciągnie auth-middleware - nie ma po
// co go tu uruchamiać, a middleware i tak nie jest wykonywane.
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdminEditor: { name: "requireAdminEditor" },
}));

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import { ok, fail, supabaseFromStub, supabaseRpcStub } from "@/test/supabase";
import type { SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";
import { DEFAULT_GIFT_ADMIN_SETTINGS, GIFT_ADMIN_BOUNDS } from "@/lib/gifting/admin-model";
import type { GiftAdminLimitField } from "@/lib/gifting/admin-model";
import {
  getGiftAdminSettings,
  getGiftAdminStats,
  listGiftEventsAdmin,
  listGiftLinksAdmin,
  revokeGiftLinkAdmin,
  updateGiftAdminSettings,
} from "@/lib/gifting-admin.functions";

const ME = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TENANT = "11111111-2222-4333-8444-555555555555";
const LINK = "22222222-3333-4444-8555-666666666666";
const POST = "33333333-4444-4555-8666-777777777777";
const SETTINGS_TABLE = "gift_article_settings";

let chain: SupabaseFromStub;
let rpc: SupabaseRpcStub;

/**
 * Kontekst, jaki middleware wstrzyknęłoby handlerowi. `rpc` jest owinięty tak,
 * by obsłużyć jedno produkcyjne `.maybeSingle()` po `rpc()` - patrz nagłówek.
 */
function ctx(userId: string | undefined = ME) {
  const rpcWithTerminals = (name: string, args?: Record<string, unknown>) => {
    const p = rpc.rpc(name, args);
    return Object.assign(p, { maybeSingle: () => p, single: () => p });
  };
  return {
    supabase: { from: (table: string) => chain.from(table), rpc: rpcWithTerminals },
    userId,
  };
}

/** Poprawne, kompletne ustawienia w środku dozwolonych granic. */
const VALID_SETTINGS = {
  enabled: true,
  monthly_limit: 12,
  link_ttl_days: 21,
  max_redemptions_per_link: 4,
  eligibility: "registered" as const,
};

beforeEach(() => {
  chain = supabaseFromStub();
  rpc = supabaseRpcStub();
});

// ---------------------------------------------------------------------------
describe("obudowa: middleware zadeklarowane przy KAŻDEJ funkcji", () => {
  it.each([
    ["getGiftAdminSettings", getGiftAdminSettings],
    ["updateGiftAdminSettings", updateGiftAdminSettings],
    ["getGiftAdminStats", getGiftAdminStats],
    ["listGiftLinksAdmin", listGiftLinksAdmin],
    ["revokeGiftLinkAdmin", revokeGiftLinkAdmin],
    ["listGiftEventsAdmin", listGiftEventsAdmin],
  ])("%s deklaruje `requireAdminEditor` i NIC WIĘCEJ", (_name, fn) => {
    // Dziennik audytu prezentów niesie e-maile nadawców i odbiorców, więc
    // zgubiona deklaracja jest tu wyciekiem danych osobowych, nie niedogodnością.
    expect(serverFnMiddlewareNames(fn)).toEqual(["requireAdminEditor"]);
  });

  it("metoda HTTP odpowiada charakterowi operacji", () => {
    // Odczyt GET-em, zapis POST-em. Zapis wystawiony jako GET byłby wykonywalny
    // z obcej strony przez sam `<img src>`.
    expect(asServerFn(getGiftAdminSettings).method).toBe("GET");
    expect(asServerFn(getGiftAdminStats).method).toBe("GET");
    expect(asServerFn(updateGiftAdminSettings).method).toBe("POST");
    expect(asServerFn(listGiftLinksAdmin).method).toBe("POST");
    expect(asServerFn(revokeGiftLinkAdmin).method).toBe("POST");
    expect(asServerFn(listGiftEventsAdmin).method).toBe("POST");
  });

  it("funkcje odczytu ustawień i statystyk NIE mają walidatora wejścia", () => {
    // Nie przyjmują argumentów - walidator byłby martwym kodem, a jego brak
    // jest tu informacją, że nic z klienta nie wchodzi do zapytania.
    expect(asServerFn(getGiftAdminSettings).validator).toBeUndefined();
    expect(asServerFn(getGiftAdminStats).validator).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("getGiftAdminSettings: brak wiersza != wszystko na zero", () => {
  it("brak wiersza oddaje EFEKTYWNE domyślne bazy z `persisted: false`", async () => {
    chain.setResponse(SETTINGS_TABLE, ok(null));

    const result = await callServerFn(getGiftAdminSettings, { context: ctx() });

    expect(result).toEqual({
      ...DEFAULT_GIFT_ADMIN_SETTINGS,
      updated_at: null,
      updated_by: null,
      persisted: false,
    });
    // Kontrola sensu: domyślne to 10/30/5, a NIE zera.
    expect(DEFAULT_GIFT_ADMIN_SETTINGS.monthly_limit).toBe(10);
    expect(DEFAULT_GIFT_ADMIN_SETTINGS.link_ttl_days).toBe(30);
    expect(DEFAULT_GIFT_ADMIN_SETTINGS.max_redemptions_per_link).toBe(5);
    expect(DEFAULT_GIFT_ADMIN_SETTINGS.enabled).toBe(true);
  });

  it("istniejący wiersz oddaje `persisted: true` i normalizuje `eligibility`", async () => {
    chain.setResponse(
      SETTINGS_TABLE,
      ok({
        enabled: false,
        monthly_limit: 3,
        link_ttl_days: 7,
        max_redemptions_per_link: 2,
        eligibility: "cokolwiek-nieznanego",
        updated_at: "2026-08-01T10:00:00Z",
        updated_by: ME,
      }),
    );

    const result = await callServerFn<{ persisted: boolean; eligibility: string }>(
      getGiftAdminSettings,
      { context: ctx() },
    );

    expect(result.persisted).toBe(true);
    // Nieznana wartość z bazy schodzi do bezpiecznej bramki rejestracji, a nie
    // do „subscribers" (czyli węższej) ani do surowego napisu.
    expect(result.eligibility).toBe("registered");
  });

  it("czyta DOKŁADNIE te kolumny, których potrzebuje panel", async () => {
    chain.setResponse(SETTINGS_TABLE, ok(null));
    await callServerFn(getGiftAdminSettings, { context: ctx() });

    const select = String(chain.lastChain(SETTINGS_TABLE)?.argsOf("select")?.[0] ?? "");
    for (const column of [
      "enabled",
      "monthly_limit",
      "link_ttl_days",
      "max_redemptions_per_link",
      "eligibility",
      "updated_at",
      "updated_by",
    ]) {
      expect(select).toContain(column);
    }
  });

  it("błąd odczytu LECI DALEJ - panel nie ma pokazywać domyślnych jako faktu", async () => {
    // Zlanie awarii z „brak wiersza" pokazałoby adminowi 10/30/5 jako stan
    // najemcy, choć prawdziwych ustawień nie znamy.
    chain.setResponse(SETTINGS_TABLE, fail("permission denied", "42501"));
    await expect(callServerFn(getGiftAdminSettings, { context: ctx() })).rejects.toThrow(
      /permission denied/,
    );
  });

  it("odczyt idzie przez `maybeSingle` - brak wiersza to nie błąd", async () => {
    chain.setResponse(SETTINGS_TABLE, ok(null));
    await callServerFn(getGiftAdminSettings, { context: ctx() });
    expect(chain.lastChain(SETTINGS_TABLE)?.has("maybeSingle")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("SettingsSchema: granice są lustrem CHECK-ów z bazy", () => {
  const FIELDS: GiftAdminLimitField[] = [
    "monthly_limit",
    "link_ttl_days",
    "max_redemptions_per_link",
  ];

  it("zestaw pól liczbowych jest DOKŁADNIE taki, jak w GIFT_ADMIN_BOUNDS", () => {
    // Nowe pole limitu dopisane do bounds bez dopisania do schematu przeszłoby
    // niezauważone - panel wysyłałby wartość, której nikt nie waliduje.
    expect(Object.keys(GIFT_ADMIN_BOUNDS).sort()).toEqual([...FIELDS].sort());
  });

  it.each(FIELDS)("%s: wartość PONIŻEJ minimum jest odrzucona", (field) => {
    const bound = GIFT_ADMIN_BOUNDS[field];
    expect(() =>
      validateServerFnInput(updateGiftAdminSettings, {
        ...VALID_SETTINGS,
        [field]: bound.min - 1,
      }),
    ).toThrow();
  });

  it.each(FIELDS)("%s: DOKŁADNIE minimum jest przyjęte", (field) => {
    const bound = GIFT_ADMIN_BOUNDS[field];
    const parsed = validateServerFnInput<Record<string, unknown>>(updateGiftAdminSettings, {
      ...VALID_SETTINGS,
      [field]: bound.min,
    });
    expect(parsed[field]).toBe(bound.min);
  });

  it.each(FIELDS)("%s: DOKŁADNIE maksimum jest przyjęte", (field) => {
    const bound = GIFT_ADMIN_BOUNDS[field];
    const parsed = validateServerFnInput<Record<string, unknown>>(updateGiftAdminSettings, {
      ...VALID_SETTINGS,
      [field]: bound.max,
    });
    expect(parsed[field]).toBe(bound.max);
  });

  it.each(FIELDS)("%s: wartość POWYŻEJ maksimum jest odrzucona", (field) => {
    const bound = GIFT_ADMIN_BOUNDS[field];
    expect(() =>
      validateServerFnInput(updateGiftAdminSettings, {
        ...VALID_SETTINGS,
        [field]: bound.max + 1,
      }),
    ).toThrow();
  });

  it.each(FIELDS)("%s: wartość NIECAŁKOWITA jest odrzucona", (field) => {
    // Kolumna jest `integer` - 2,5 slotu budżetu nie istnieje, a baza odrzuci
    // to błędem bez czytelnego komunikatu dla admina.
    expect(() =>
      validateServerFnInput(updateGiftAdminSettings, { ...VALID_SETTINGS, [field]: 2.5 }),
    ).toThrow();
  });

  it("`0` jest wartością PRAWIDŁOWĄ dla każdego limitu (znaczy „bez limitu”)", () => {
    // Minimum to 0, nie 1 - i to jest świadome. Test przypina to wprost, bo
    // podniesienie minimum do 1 odebrałoby redakcji wyłącznik limitu.
    for (const field of FIELDS) {
      expect(GIFT_ADMIN_BOUNDS[field].min).toBe(0);
      const parsed = validateServerFnInput<Record<string, unknown>>(updateGiftAdminSettings, {
        ...VALID_SETTINGS,
        [field]: 0,
      });
      expect(parsed[field]).toBe(0);
    }
  });

  it.each([
    ["registered", true],
    ["subscribers", true],
    ["everyone", false],
    ["", false],
  ])("`eligibility` = %s: przyjęte = %s", (value, accepted) => {
    const call = () =>
      validateServerFnInput(updateGiftAdminSettings, { ...VALID_SETTINGS, eligibility: value });
    if (accepted) expect(call()).toBeTruthy();
    else expect(call).toThrow();
  });

  it("`enabled` MUSI być boolean - „false” jako napis nie przechodzi", () => {
    // Napis „false" jest prawdziwopodobny, więc ciche rzutowanie WŁĄCZYŁOBY
    // gifting w chwili, w której admin go wyłącza.
    expect(() =>
      validateServerFnInput(updateGiftAdminSettings, { ...VALID_SETTINGS, enabled: "false" }),
    ).toThrow();
  });

  it("brak któregokolwiek pola jest odrzucony - schemat nie ma domyślnych", () => {
    for (const key of Object.keys(VALID_SETTINGS)) {
      const partial: Record<string, unknown> = { ...VALID_SETTINGS };
      delete partial[key];
      expect(() => validateServerFnInput(updateGiftAdminSettings, partial), key).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
describe("updateGiftAdminSettings: brak najemcy odcina zapis PRZED upsertem", () => {
  it("profil bez `tenant_id` daje `Forbidden: no tenant`, a upsert NIE leci", async () => {
    chain.setResponse("profiles", ok({ tenant_id: null }));
    chain.setResponse(SETTINGS_TABLE, ok(null));

    await expect(
      callServerFn(updateGiftAdminSettings, { data: VALID_SETTINGS, context: ctx() }),
    ).rejects.toThrow(/Forbidden: no tenant/);

    // Sedno: nie tylko rzuciło, ale NIC nie zapisało.
    expect(chain.chainsFor(SETTINGS_TABLE)).toHaveLength(0);
  });

  it("brak wiersza profilu też odcina zapis", async () => {
    chain.setResponse("profiles", ok(null));
    await expect(
      callServerFn(updateGiftAdminSettings, { data: VALID_SETTINGS, context: ctx() }),
    ).rejects.toThrow(/Forbidden: no tenant/);
    expect(chain.chainsFor(SETTINGS_TABLE)).toHaveLength(0);
  });

  it("błąd odczytu profilu leci dalej i nie zapisuje", async () => {
    chain.setResponse("profiles", fail("profiles unavailable", "08006"));
    await expect(
      callServerFn(updateGiftAdminSettings, { data: VALID_SETTINGS, context: ctx() }),
    ).rejects.toThrow(/profiles unavailable/);
    expect(chain.chainsFor(SETTINGS_TABLE)).toHaveLength(0);
  });

  it("tenant jest czytany z profilu WOŁAJĄCEGO, nie z wejścia", async () => {
    // Gdyby `tenant_id` szedł z klienta, panel jednego najemcy przestawiałby
    // ustawienia drugiego.
    chain.setResponse("profiles", ok({ tenant_id: TENANT }));
    chain.setResponse(SETTINGS_TABLE, ok(null));

    await callServerFn(updateGiftAdminSettings, {
      data: { ...VALID_SETTINGS },
      context: ctx(ME),
    });

    const profileChain = chain.lastChain("profiles");
    expect(profileChain?.argsOf("select")).toEqual(["tenant_id"]);
    expect(profileChain?.argsOf("eq")).toEqual(["id", ME]);
  });

  it("upsert jedzie z `onConflict: tenant_id` i pełnym ładunkiem", async () => {
    chain.setResponse("profiles", ok({ tenant_id: TENANT }));
    chain.setResponse(SETTINGS_TABLE, ok(null));

    const result = await callServerFn(updateGiftAdminSettings, {
      data: VALID_SETTINGS,
      context: ctx(),
    });

    const args = chain.lastChain(SETTINGS_TABLE)?.argsOf("upsert") ?? [];
    const payload = args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      tenant_id: TENANT,
      enabled: true,
      monthly_limit: 12,
      link_ttl_days: 21,
      max_redemptions_per_link: 4,
      eligibility: "registered",
      updated_by: ME,
    });
    // Bez `onConflict` upsert wstawiłby DRUGI wiersz dla tego najemcy, a odczyt
    // przez `maybeSingle` zacząłby padać na „więcej niż jeden wiersz".
    expect(args[1]).toEqual({ onConflict: "tenant_id" });
    expect(result).toEqual({ ok: true });
  });

  it("`updated_at` jest znacznikiem ISO, nie pustym polem", async () => {
    chain.setResponse("profiles", ok({ tenant_id: TENANT }));
    chain.setResponse(SETTINGS_TABLE, ok(null));
    await callServerFn(updateGiftAdminSettings, { data: VALID_SETTINGS, context: ctx() });

    const payload = (chain.lastChain(SETTINGS_TABLE)?.argsOf("upsert") ?? [])[0] as Record<
      string,
      unknown
    >;
    expect(String(payload.updated_at)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("błąd upsertu leci dalej - panel nie może pokazać „zapisano”", async () => {
    chain.setResponse("profiles", ok({ tenant_id: TENANT }));
    chain.setResponse(SETTINGS_TABLE, fail("check constraint violated", "23514"));
    await expect(
      callServerFn(updateGiftAdminSettings, { data: VALID_SETTINGS, context: ctx() }),
    ).rejects.toThrow(/check constraint violated/);
  });
});

// ---------------------------------------------------------------------------
describe("getGiftAdminStats: pusty najemca pokazuje zera, nie pustkę", () => {
  it("odpowiedź bazy przechodzi w całości", async () => {
    rpc.setData("get_gift_stats_admin", {
      active_links: 3,
      revoked_links: 1,
      expired_links: 0,
      exhausted_links: 2,
      total_created: 6,
      total_redeemed: 9,
      created_this_month: 4,
      redeemed_this_month: 5,
      unique_gifters: 2,
      unique_recipients: 7,
    });

    const result = await callServerFn<{ active_links: number; unique_recipients: number }>(
      getGiftAdminStats,
      { context: ctx() },
    );
    expect(result.active_links).toBe(3);
    expect(result.unique_recipients).toBe(7);
  });

  it("brak wiersza daje KOMPLET zer, a nie `null`", async () => {
    // Panel z `null` wywaliłby się na odczycie pola; zera są poprawnym
    // stanem „najemca jeszcze nie używał prezentów".
    rpc.setData("get_gift_stats_admin", null);

    const result = await callServerFn<Record<string, number>>(getGiftAdminStats, {
      context: ctx(),
    });
    expect(Object.values(result).every((v) => v === 0)).toBe(true);
    expect(Object.keys(result)).toHaveLength(10);
  });

  it("błąd RPC leci dalej", async () => {
    rpc.setError("get_gift_stats_admin", "forbidden");
    await expect(callServerFn(getGiftAdminStats, { context: ctx() })).rejects.toThrow(/forbidden/);
  });

  it("woła DOKŁADNIE `get_gift_stats_admin`, bez argumentów", async () => {
    rpc.setData("get_gift_stats_admin", null);
    await callServerFn(getGiftAdminStats, { context: ctx() });
    expect(rpc.names()).toEqual(["get_gift_stats_admin"]);
    expect(rpc.lastCall("get_gift_stats_admin")?.args).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("listGiftLinksAdmin: paginacja i filtry", () => {
  function linkRow(over: Record<string, unknown> = {}) {
    return {
      id: LINK,
      post_id: POST,
      post_title: "Reforma rynku energii",
      post_slug: "reforma-rynku-energii",
      created_by: ME,
      creator_name: "Redakcja",
      creator_email: "redakcja@example.com",
      code: "ABCD1234",
      created_at: "2026-08-01T10:00:00Z",
      expires_at: null,
      revoked_at: null,
      redemption_count: 2,
      max_redemptions: 5,
      unique_recipients: 2,
      last_redeemed_at: "2026-08-02T11:00:00Z",
      total_count: 137,
      ...over,
    };
  }

  it("`total` bierze się z `total_count` PIERWSZEGO wiersza, nie z długości strony", async () => {
    rpc.setData("list_gift_links_admin", [linkRow(), linkRow({ id: "inny" })]);

    const result = await callServerFn<{ rows: unknown[]; total: number }>(listGiftLinksAdmin, {
      data: { limit: 50, offset: 0, status: "all" },
      context: ctx(),
    });

    expect(result.rows).toHaveLength(2);
    // Długość strony to 2, a linków jest 137 - paginacja stoi na `total_count`.
    expect(result.total).toBe(137);
  });

  it("pusta lista daje `total: 0` bez czytania nieistniejącego wiersza", async () => {
    rpc.setData("list_gift_links_admin", []);
    const result = await callServerFn<{ rows: unknown[]; total: number }>(listGiftLinksAdmin, {
      data: { limit: 50, offset: 0, status: "all" },
      context: ctx(),
    });
    expect(result).toEqual({ rows: [], total: 0 });
  });

  it("`total_count` jako NAPIS z bazy jest liczbą po konwersji", async () => {
    // `count(*)` w PostgreSQL to `bigint`, a PostgREST oddaje bigint jako
    // NAPIS. Bez `Number()` paginacja porównywałaby napis z liczbą.
    rpc.setData("list_gift_links_admin", [linkRow({ total_count: "137" })]);
    const result = await callServerFn<{ total: number }>(listGiftLinksAdmin, {
      data: { limit: 50, offset: 0, status: "all" },
      context: ctx(),
    });
    expect(result.total).toBe(137);
  });

  it("`null` z bazy daje pustą listę, nie wyjątek", async () => {
    rpc.setData("list_gift_links_admin", null);
    const result = await callServerFn<{ rows: unknown[]; total: number }>(listGiftLinksAdmin, {
      data: { limit: 50, offset: 0, status: "all" },
      context: ctx(),
    });
    expect(result).toEqual({ rows: [], total: 0 });
  });

  it("argumenty RPC są przepisane po NAZWIE", async () => {
    rpc.setData("list_gift_links_admin", []);
    await callServerFn(listGiftLinksAdmin, {
      data: { limit: 25, offset: 75, status: "revoked", post_id: POST },
      context: ctx(),
    });

    const call = rpc.lastCall("list_gift_links_admin");
    expect(call?.arg("_limit")).toBe(25);
    expect(call?.arg("_offset")).toBe(75);
    expect(call?.arg("_status")).toBe("revoked");
    expect(call?.arg("_post_id")).toBe(POST);
  });

  it("brak `post_id` przekazuje `undefined` - baza użyje własnego DEFAULT NULL", async () => {
    // `JSON.stringify` pomija właściwości `undefined`, więc do funkcji nie leci
    // nic i działa serwerowy DEFAULT. Napis "null" albo pusty string byłby
    // wartością, na której RPC by się wywalił.
    rpc.setData("list_gift_links_admin", []);
    await callServerFn(listGiftLinksAdmin, {
      data: { limit: 50, offset: 0, status: "all", post_id: null },
      context: ctx(),
    });
    expect(rpc.lastCall("list_gift_links_admin")?.arg("_post_id")).toBeUndefined();
  });

  it("wartości domyślne to 50 / 0 / all", () => {
    const parsed = validateServerFnInput<Record<string, unknown>>(listGiftLinksAdmin, {});
    expect(parsed).toEqual({ limit: 50, offset: 0, status: "all" });
  });

  it.each([
    ["0 (poniżej minimum)", 0, false],
    ["1 (minimum)", 1, true],
    ["200 (maksimum)", 200, true],
    ["201 (powyżej maksimum)", 201, false],
    ["niecałkowite", 10.5, false],
  ])("limit %s: przyjęty = %s", (_label, limit, accepted) => {
    const call = () => validateServerFnInput(listGiftLinksAdmin, { limit });
    if (accepted) expect(call()).toBeTruthy();
    else expect(call).toThrow();
  });

  it("ujemny `offset` jest odrzucony", () => {
    expect(() => validateServerFnInput(listGiftLinksAdmin, { offset: -1 })).toThrow();
    expect(validateServerFnInput(listGiftLinksAdmin, { offset: 0 })).toBeTruthy();
  });

  it.each(["all", "active", "revoked", "expired"])("status `%s` jest przyjęty", (status) => {
    expect(validateServerFnInput(listGiftLinksAdmin, { status })).toBeTruthy();
  });

  it("nieznany status jest ODRZUCONY - baza nie ma dla niego gałęzi", () => {
    expect(() => validateServerFnInput(listGiftLinksAdmin, { status: "wygasajace" })).toThrow();
  });

  it("`post_id` niebędący UUID-em jest odrzucony", () => {
    expect(() => validateServerFnInput(listGiftLinksAdmin, { post_id: "abc" })).toThrow();
  });

  it("błąd RPC leci dalej", async () => {
    rpc.setError("list_gift_links_admin", "forbidden");
    await expect(
      callServerFn(listGiftLinksAdmin, {
        data: { limit: 50, offset: 0, status: "all" },
        context: ctx(),
      }),
    ).rejects.toThrow(/forbidden/);
  });
});

// ---------------------------------------------------------------------------
describe("revokeGiftLinkAdmin: `ok === true`, nie wartość prawdziwopodobna", () => {
  it("`true` z bazy daje `ok: true`", async () => {
    rpc.setData("revoke_gift_link_admin", true);
    await expect(
      callServerFn(revokeGiftLinkAdmin, { data: { link_id: LINK }, context: ctx() }),
    ).resolves.toEqual({ ok: true });
  });

  it.each([
    ['napis "true"', "true"],
    ["liczba 1", 1],
    ["napis „t”", "t"],
    ["pusty obiekt", {}],
    ["null", null],
    ["false", false],
  ])("%s daje `ok: false` - panel nie potwierdza czegoś, czego nie było", async (_label, value) => {
    // `ok: !!ok` potwierdziłoby unieważnienie linku, którego baza nie ruszyła -
    // a admin zamknąłby zgłoszenie „link odebrany".
    rpc.setData("revoke_gift_link_admin", value);
    const result = await callServerFn<{ ok: boolean }>(revokeGiftLinkAdmin, {
      data: { link_id: LINK },
      context: ctx(),
    });
    expect(result.ok).toBe(false);
  });

  it("argument leci jako `_link_id`", async () => {
    rpc.setData("revoke_gift_link_admin", true);
    await callServerFn(revokeGiftLinkAdmin, { data: { link_id: LINK }, context: ctx() });
    expect(rpc.lastCall("revoke_gift_link_admin")?.arg("_link_id")).toBe(LINK);
    expect(rpc.lastCall("revoke_gift_link_admin")?.keys()).toEqual(["_link_id"]);
  });

  it("`link_id` niebędący UUID-em jest odrzucony PRZED zapytaniem", async () => {
    expect(() => validateServerFnInput(revokeGiftLinkAdmin, { link_id: "1" })).toThrow();
    expect(rpc.calls).toHaveLength(0);
  });

  it("brak `link_id` jest odrzucony", () => {
    expect(() => validateServerFnInput(revokeGiftLinkAdmin, {})).toThrow();
  });

  it("błąd RPC leci dalej", async () => {
    rpc.setError("revoke_gift_link_admin", "gift_link_not_found");
    await expect(
      callServerFn(revokeGiftLinkAdmin, { data: { link_id: LINK }, context: ctx() }),
    ).rejects.toThrow(/gift_link_not_found/);
  });
});

// ---------------------------------------------------------------------------
describe("listGiftEventsAdmin: dziennik audytu nie przekłamuje zdarzeń", () => {
  function eventRow(over: Record<string, unknown> = {}) {
    return {
      id: "evt-1",
      event_type: "redeemed",
      post_id: POST,
      post_title: "Reforma rynku energii",
      actor_id: ME,
      actor_name: "Redakcja",
      actor_email: "redakcja@example.com",
      code: "ABCD1234",
      created_at: "2026-08-02T11:00:00Z",
      total_count: 42,
      ...over,
    };
  }

  it("`total` z `total_count`, pusta lista => 0", async () => {
    rpc.setData("list_gift_events_admin", [eventRow()]);
    const result = await callServerFn<{ total: number }>(listGiftEventsAdmin, {
      data: { limit: 100, offset: 0, event_type: "all" },
      context: ctx(),
    });
    expect(result.total).toBe(42);

    rpc.setData("list_gift_events_admin", []);
    const empty = await callServerFn<{ rows: unknown[]; total: number }>(listGiftEventsAdmin, {
      data: { limit: 100, offset: 0, event_type: "all" },
      context: ctx(),
    });
    expect(empty).toEqual({ rows: [], total: 0 });
  });

  it("zdarzenie NIEZNANE temu buildowi przechodzi NIETKNIĘTE", async () => {
    // `event_type` jest w kształcie wiersza otwartym stringiem z premedytacją:
    // audyt ma pokazać, co się stało, także gdy baza zna zdarzenie, którego ten
    // build nie zna. Zawężenie do enuma przekłamywałoby wpis albo go gubiło.
    rpc.setData("list_gift_events_admin", [eventRow({ event_type: "quarantined_by_abuse_rule" })]);

    const result = await callServerFn<{ rows: Array<{ event_type: string }> }>(
      listGiftEventsAdmin,
      { data: { limit: 100, offset: 0, event_type: "all" }, context: ctx() },
    );
    expect(result.rows[0]?.event_type).toBe("quarantined_by_abuse_rule");
  });

  it("wartości domyślne to 100 / 0 / all", () => {
    const parsed = validateServerFnInput<Record<string, unknown>>(listGiftEventsAdmin, {});
    expect(parsed).toEqual({ limit: 100, offset: 0, event_type: "all" });
  });

  it.each([
    ["0", 0, false],
    ["1", 1, true],
    ["500", 500, true],
    ["501", 501, false],
  ])("limit %s: przyjęty = %s", (_label, limit, accepted) => {
    const call = () => validateServerFnInput(listGiftEventsAdmin, { limit });
    if (accepted) expect(call()).toBeTruthy();
    else expect(call).toThrow();
  });

  it("limit zdarzeń jest WYŻSZY niż limit linków - to dwie różne strony", () => {
    // 500 kontra 200. Zrównanie ich zmniejszyłoby stronę dziennika bez powodu.
    const events = validateServerFnInput<{ limit: number }>(listGiftEventsAdmin, { limit: 500 });
    expect(events.limit).toBe(500);
    expect(() => validateServerFnInput(listGiftLinksAdmin, { limit: 500 })).toThrow();
  });

  it.each(["all", "created", "redeemed", "revoked", "expired", "exhausted"])(
    "filtr `%s` jest przyjęty",
    (event_type) => {
      expect(validateServerFnInput(listGiftEventsAdmin, { event_type })).toBeTruthy();
    },
  );

  it("nieznany FILTR jest odrzucony, choć nieznane ZDARZENIE przechodzi", () => {
    // Asymetria jest zamierzona: filtr to wejście od klienta (musi być znany
    // bazie), a `event_type` w wyniku to fakt z audytu (musi przejść taki, jaki
    // jest). Ten test trzyma obie strony naraz.
    expect(() =>
      validateServerFnInput(listGiftEventsAdmin, { event_type: "quarantined" }),
    ).toThrow();
  });

  it("brak `link_id` przekazuje `undefined`", async () => {
    rpc.setData("list_gift_events_admin", []);
    await callServerFn(listGiftEventsAdmin, {
      data: { limit: 100, offset: 0, event_type: "all", link_id: null },
      context: ctx(),
    });
    expect(rpc.lastCall("list_gift_events_admin")?.arg("_link_id")).toBeUndefined();
  });

  it("argumenty RPC po nazwie", async () => {
    rpc.setData("list_gift_events_admin", []);
    await callServerFn(listGiftEventsAdmin, {
      data: { limit: 10, offset: 20, event_type: "revoked", link_id: LINK },
      context: ctx(),
    });
    const call = rpc.lastCall("list_gift_events_admin");
    expect(call?.arg("_limit")).toBe(10);
    expect(call?.arg("_offset")).toBe(20);
    expect(call?.arg("_event_type")).toBe("revoked");
    expect(call?.arg("_link_id")).toBe(LINK);
  });

  it("błąd RPC leci dalej", async () => {
    rpc.setError("list_gift_events_admin", "forbidden");
    await expect(
      callServerFn(listGiftEventsAdmin, {
        data: { limit: 100, offset: 0, event_type: "all" },
        context: ctx(),
      }),
    ).rejects.toThrow(/forbidden/);
  });
});
