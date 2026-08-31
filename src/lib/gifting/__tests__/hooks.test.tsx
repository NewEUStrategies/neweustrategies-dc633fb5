// Warstwa danych mechaniki "Udostepnij pelny artykul" (react-query + Supabase RPC).
//
// PO CO TEN PLIK ISTNIEJE. To jest CIENKA warstwa nad czterema wywolaniami
// bazy, ale kazde z nich niesie regule, ktorej nie widac w typach:
//
//   1. OKNO WDROZENIOWE. `fetchGiftSettings` czyta kolumny, ktorych moze
//      jeszcze nie byc w bazie (kod na produkcji przed migracja). Postgres
//      odpowiada wtedy 42703 (undefined_column) - i jesli warstwa danych tego
//      NIE obsluzy, przycisk "Udostepnij pelny artykul" gasnie na WSZYSTKICH
//      artykulach naraz, bo `useGiftSettings` wpada w blad. Degradacja do
//      starszego ksztaltu + bezpieczne domyslne jest tu wiec funkcja
//      bezpieczenstwa wdrozenia, a nie ozdobnikiem.
//   2. BRAMA `enabled`. Stan popovera odpytujemy TYLKO dla zalogowanych i
//      TYLKO gdy popover jest otwarty. Zepsuta brama znaczy jedno RPC na
//      kazdy widok wpisu - takze dla gosci i botow.
//   3. PISANIE DO PAMIECI PODRECZNEJ PO MUTACJI. `useCreateGiftLink` wklada
//      kod ORAZ budzet klikniec do klucza stanu. Bez tego kolejne otwarcie
//      popovera strzela do `create_gift_link` jeszcze raz i miga licznikiem
//      "zostalo N otwarc".
//   4. TOZSAMOSC ODBIORCY W KLUCZU ZAPYTANIA. `useGiftRedemption` konsumuje
//      SLOT budzetu jako efekt uboczny odczytu. Klucz bez tozsamosci
//      (konto albo pseudonim goscia) sprawialby, ze powrot na ten sam artykul
//      pali kolejne z pieciu otwarc - czyli link, ktory mial otworzyc tresc
//      pieciu osobom, zuzywa sie na jednej.
//
// ATRAPY: wylacznie GRANICE - klient Supabase, sesja (`useAuth`) i router.
// `@/lib/gifting/model` oraz `@/lib/access/*` biegna PRAWDZIWE: to sasiedzi,
// i to one nosza cala arytmetyke budzetu, normalizacje i mape bledow.
//
// RODO: same UUID-y, zero danych osobowych.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { DEFAULT_GIFT_SETTINGS } from "@/lib/gifting/model";
import type { GiftArticleState } from "@/lib/gifting/model";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  uid: null as string | null,
  searchStr: "",
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.from?.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc?.rpc(name, args),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.uid === null ? null : { user: { id: h.uid } } }),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: <T,>(opts: { select: (state: { location: { searchStr: string } }) => T }) =>
    opts.select({ location: { searchStr: h.searchStr } }),
}));

const {
  fetchGiftSettings,
  useCreateGiftLink,
  useGiftArticleState,
  useGiftCodeFromUrl,
  useGiftRedemption,
  useGiftSettings,
} = await import("@/lib/gifting/hooks");

const POST = "00000000-0000-4000-8000-0000000000p1".replace("p", "a");
const UID = "00000000-0000-4000-8000-00000000u001".replace("u", "0");
const CODE = "abcDEF123_-xyzABC456pqr";
const VISITOR = "11111111-1111-4111-8111-111111111111";

/** Pelny wiersz `gift_article_settings` (ksztalt po migracji 20260806170000). */
function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    monthly_limit: 20,
    link_ttl_days: 14,
    max_redemptions_per_link: 3,
    eligibility: "subscribers",
    ...overrides,
  };
}

/** Wiersz `gift_article_state` (RETURNS TABLE - RPC oddaje TABLICE). */
function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    can_gift: true,
    requires_auth: false,
    requires_subscription: false,
    used: 2,
    monthly_limit: 10,
    remaining: 8,
    existing_code: null,
    expires_at: null,
    eligibility: "registered",
    max_redemptions: 5,
    redemption_count: 1,
    ...overrides,
  };
}

beforeEach(() => {
  h.from = supabaseFromStub();
  h.rpc = supabaseRpcStub();
  h.uid = UID;
  h.searchStr = "";
  window.localStorage.setItem("nes:metering:visitor", VISITOR);
});

// ---------------------------------------------------------------------------
// fetchGiftSettings
// ---------------------------------------------------------------------------

describe("fetchGiftSettings - odczyt ustawien", () => {
  it("mapuje pelny wiersz na model", async () => {
    h.from?.setResponse("gift_article_settings", ok(settingsRow()));
    await expect(fetchGiftSettings()).resolves.toEqual({
      enabled: true,
      monthly_limit: 20,
      link_ttl_days: 14,
      max_redemptions_per_link: 3,
      eligibility: "subscribers",
    });
  });

  it("BRAK wiersza daje bezpieczne domyslne, a nie same zera", async () => {
    // Zera znaczylyby w tej domenie "bez limitu" - czyli dokladnie odwrotnosc
    // tego, co egzekwuje serwer przy braku wiersza (10 / 30 / 5).
    h.from?.setResponse("gift_article_settings", ok(null));
    await expect(fetchGiftSettings()).resolves.toEqual(DEFAULT_GIFT_SETTINGS);
  });

  it("nieznana wartosc `eligibility` degraduje sie do 'registered'", async () => {
    h.from?.setResponse("gift_article_settings", ok(settingsRow({ eligibility: "vip" })));
    const result = await fetchGiftSettings();
    expect(result.eligibility).toBe("registered");
  });

  it("brak kolumny capu spada na domyslny budzet klikniec", async () => {
    h.from?.setResponse(
      "gift_article_settings",
      ok(settingsRow({ max_redemptions_per_link: null })),
    );
    const result = await fetchGiftSettings();
    expect(result.max_redemptions_per_link).toBe(DEFAULT_GIFT_SETTINGS.max_redemptions_per_link);
  });

  it("czyta wiersz przez maybeSingle (singleton per tenant)", async () => {
    h.from?.setResponse("gift_article_settings", ok(settingsRow()));
    await fetchGiftSettings();
    expect(h.from?.lastChain("gift_article_settings")?.has("maybeSingle")).toBe(true);
  });

  it("OKNO WDROZENIOWE: 42703 przelacza odczyt na starszy ksztalt kolumn", async () => {
    // Kod na produkcji przed migracja. Bez tej degradacji przycisk
    // "Udostepnij pelny artykul" gasnie na wszystkich wpisach naraz.
    let call = 0;
    h.from?.setResponse("gift_article_settings", () => {
      call += 1;
      return call === 1
        ? fail("column gift_article_settings.eligibility does not exist", "42703")
        : ok({ enabled: true, monthly_limit: 7, link_ttl_days: 2 });
    });
    const result = await fetchGiftSettings();
    expect(result).toEqual({
      enabled: true,
      monthly_limit: 7,
      link_ttl_days: 2,
      // Kolumn budzetu i bramki jeszcze nie ma - biora sie bezpieczne domyslne.
      max_redemptions_per_link: DEFAULT_GIFT_SETTINGS.max_redemptions_per_link,
      eligibility: "registered",
    });
    expect(h.from?.chainsFor("gift_article_settings")).toHaveLength(2);
  });

  it("odczyt zapasowy prosi o WEZSZY zestaw kolumn", async () => {
    let call = 0;
    h.from?.setResponse("gift_article_settings", () => {
      call += 1;
      return call === 1
        ? fail("undefined column", "42703")
        : ok({ enabled: true, monthly_limit: 7, link_ttl_days: 2 });
    });
    await fetchGiftSettings();
    const chains = h.from?.chainsFor("gift_article_settings") ?? [];
    const first = String(chains[0]?.argsOf("select")?.[0] ?? "");
    const second = String(chains[1]?.argsOf("select")?.[0] ?? "");
    // Roznica jest DOKLADNIE jedna kolumna: `eligibility` z migracji
    // 20260806170000. `max_redemptions_per_link` zostaje, bo pochodzi ze
    // starszej migracji (20260724090600) i w oknie wdrozeniowym juz istnieje.
    expect(first).toContain("eligibility");
    expect(second).not.toContain("eligibility");
    expect(second).toContain("max_redemptions_per_link");
  });

  it("42703 przy BRAKU wiersza w starszym ksztalcie tez daje domyslne", async () => {
    let call = 0;
    h.from?.setResponse("gift_article_settings", () => {
      call += 1;
      return call === 1 ? fail("undefined column", "42703") : ok(null);
    });
    await expect(fetchGiftSettings()).resolves.toEqual(DEFAULT_GIFT_SETTINGS);
  });

  it("blad INNY niz 42703 leci dalej (nie udaje domyslnych)", async () => {
    // Odmowa RLS albo awaria sieci nie moze wygladac jak "tenant bez wiersza" -
    // panel czytelnika pokazalby wtedy przycisk mimo wylaczonej funkcji.
    h.from?.setResponse("gift_article_settings", fail("permission denied", "42501"));
    await expect(fetchGiftSettings()).rejects.toMatchObject({ message: "permission denied" });
    expect(h.from?.chainsFor("gift_article_settings")).toHaveLength(1);
  });

  it("awaria RONWIEZ w odczycie zapasowym leci dalej", async () => {
    let call = 0;
    h.from?.setResponse("gift_article_settings", () => {
      call += 1;
      return call === 1 ? fail("undefined column", "42703") : fail("boom", "08006");
    });
    await expect(fetchGiftSettings()).rejects.toMatchObject({ message: "boom" });
  });
});

// ---------------------------------------------------------------------------
// useGiftSettings
// ---------------------------------------------------------------------------

describe("useGiftSettings", () => {
  it("startuje w stanie ladowania", () => {
    h.from?.setResponse("gift_article_settings", () => new Promise(() => {}) as never);
    const { result } = renderHookWithQueryClient(() => useGiftSettings());
    expect(result.current.isLoading).toBe(true);
  });

  it("oddaje ustawienia po udanym odczycie", async () => {
    h.from?.setResponse("gift_article_settings", ok(settingsRow()));
    const { result } = renderHookWithQueryClient(() => useGiftSettings());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.monthly_limit).toBe(20);
  });

  it("odmowa bazy trafia do stanu bledu", async () => {
    h.from?.setResponse("gift_article_settings", fail("permission denied", "42501"));
    const { result } = renderHookWithQueryClient(() => useGiftSettings());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("siedzi pod publicznym kluczem ['gift-settings']", async () => {
    // Konfiguracja jest PUBLICZNA i wspolna dla calego tenanta - klucz bez
    // tozsamosci to warunek tego, zeby kazdy wpis czytal ja raz.
    h.from?.setResponse("gift_article_settings", ok(settingsRow()));
    const { result, queryClient } = renderHookWithQueryClient(() => useGiftSettings());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["gift-settings"])).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// useGiftArticleState
// ---------------------------------------------------------------------------

describe("useGiftArticleState - brama `enabled`", () => {
  it("NIE pyta bazy, gdy popover jest zamkniety", async () => {
    renderHookWithQueryClient(() => useGiftArticleState(POST, false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.rpc?.calls).toHaveLength(0);
  });

  it("NIE pyta bazy bez identyfikatora wpisu", async () => {
    renderHookWithQueryClient(() => useGiftArticleState(null, true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.rpc?.calls).toHaveLength(0);
  });

  it("NIE pyta bazy dla goscia (faza wynika z samego braku sesji)", async () => {
    // Gosc nie potrzebuje RPC: `resolveGiftPhase` zwraca "requiresAuth"
    // z samego braku sesji. Zapytanie tutaj byloby ruchem na kazdy widok wpisu.
    h.uid = null;
    renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.rpc?.calls).toHaveLength(0);
  });

  it("pyta bazy, gdy popover otwarty, wpis znany i sesja jest", async () => {
    h.rpc?.setData("gift_article_state", [stateRow()]);
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc?.lastCall("gift_article_state")?.arg("_post_id")).toBe(POST);
  });
});

describe("useGiftArticleState - mapowanie wiersza", () => {
  it("przenosi komplet pol na model", async () => {
    h.rpc?.setData("gift_article_state", [
      stateRow({
        existing_code: CODE,
        expires_at: "2026-09-01T00:00:00.000Z",
        eligibility: "subscribers",
      }),
    ]);
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      enabled: true,
      canGift: true,
      requiresAuth: false,
      requiresSubscription: false,
      used: 2,
      monthlyLimit: 10,
      remaining: 8,
      existingCode: CODE,
      expiresAt: "2026-09-01T00:00:00.000Z",
      eligibility: "subscribers",
    });
  });

  it("monthly_limit 0 znaczy 'bez limitu' - `remaining` jest null, nie 0", async () => {
    // 0 w `remaining` czytaloby sie jako "wyczerpany limit" i pokazywaloby
    // czytelnikowi sciane tam, gdzie limitu w ogole nie ma.
    h.rpc?.setData("gift_article_state", [stateRow({ monthly_limit: 0, remaining: null })]);
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.remaining).toBeNull();
  });

  it("limit > 0 z pustym `remaining` daje 0, nie null", async () => {
    h.rpc?.setData("gift_article_state", [stateRow({ monthly_limit: 10, remaining: null })]);
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.remaining).toBe(0);
  });

  it("budzet klikniec liczy sie z kolumn linku", async () => {
    h.rpc?.setData("gift_article_state", [stateRow({ max_redemptions: 5, redemption_count: 4 })]);
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.budget).toMatchObject({
      used: 4,
      limit: 5,
      remaining: 1,
      exhausted: false,
      unlimited: false,
    });
  });

  it("BRAK kolumn budzetu (stare RPC) spada na cap podany przez wolajacego", async () => {
    // Drugie okno wdrozeniowe: RPC bez kolumn budzetu. Bez fallbacku popover
    // obiecywalby "bez limitu otwarc" dla linku, ktory ma cap.
    h.rpc?.setData("gift_article_state", [
      stateRow({ max_redemptions: undefined, redemption_count: undefined }),
    ]);
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true, 9));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.budget).toMatchObject({ used: 0, limit: 9, remaining: 9 });
  });

  it("PUSTY wynik RPC to null, a nie awaria", async () => {
    // Wpis nieopublikowany albo z innego tenanta - popover ma pokazac stan
    // "brak danych", a nie czerwony blad.
    h.rpc?.setData("gift_article_state", []);
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("`null` zamiast tablicy tez daje null", async () => {
    h.rpc?.setData("gift_article_state", null);
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("odmowa RPC trafia do stanu bledu", async () => {
    h.rpc?.setError("gift_article_state", "forbidden");
    const { result } = renderHookWithQueryClient(() => useGiftArticleState(POST, true));
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("klucz zapytania zawiera wpis I tozsamosc (logowanie przelacza stan)", async () => {
    h.rpc?.setData("gift_article_state", [stateRow()]);
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useGiftArticleState(POST, true),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["gift-article-state", POST, UID])).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// useCreateGiftLink
// ---------------------------------------------------------------------------

describe("useCreateGiftLink", () => {
  function linkRow(overrides: Record<string, unknown> = {}) {
    return {
      code: CODE,
      expires_at: "2026-09-01T00:00:00.000Z",
      used: 3,
      monthly_limit: 10,
      remaining: 7,
      max_redemptions: 5,
      redemption_count: 0,
      ...overrides,
    };
  }

  it("sukces oddaje znormalizowany wynik z budzetem klikniec", async () => {
    h.rpc?.setData("create_gift_link", [linkRow()]);
    const { result } = renderHookWithQueryClient(() => useCreateGiftLink(POST));
    act(() => result.current.mutation.mutate());
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(result.current.mutation.data).toMatchObject({
      code: CODE,
      expiresAt: "2026-09-01T00:00:00.000Z",
      used: 3,
      monthlyLimit: 10,
      remaining: 7,
    });
    expect(result.current.mutation.data?.budget).toMatchObject({ limit: 5, remaining: 5 });
  });

  it("wola RPC z identyfikatorem WPISU", async () => {
    h.rpc?.setData("create_gift_link", [linkRow()]);
    const { result } = renderHookWithQueryClient(() => useCreateGiftLink(POST));
    act(() => result.current.mutation.mutate());
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(h.rpc?.lastCall("create_gift_link")?.arg("_post_id")).toBe(POST);
  });

  it("monthly_limit 0 daje `remaining` null (bez limitu)", async () => {
    h.rpc?.setData("create_gift_link", [linkRow({ monthly_limit: 0, remaining: null })]);
    const { result } = renderHookWithQueryClient(() => useCreateGiftLink(POST));
    act(() => result.current.mutation.mutate());
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(result.current.mutation.data?.remaining).toBeNull();
  });

  it("brak kolumn budzetu spada na cap podany przez wolajacego", async () => {
    h.rpc?.setData("create_gift_link", [
      linkRow({ max_redemptions: undefined, redemption_count: undefined }),
    ]);
    const { result } = renderHookWithQueryClient(() => useCreateGiftLink(POST, 4));
    act(() => result.current.mutation.mutate());
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(result.current.mutation.data?.budget).toMatchObject({ limit: 4, used: 0 });
  });

  it("PUSTY wynik RPC konczy sie bledem 'gift_post_not_found'", async () => {
    // Cisza z bazy nie moze wygladac jak sukces bez kodu - popover pokazalby
    // pusty przycisk "kopiuj".
    h.rpc?.setData("create_gift_link", []);
    const { result } = renderHookWithQueryClient(() => useCreateGiftLink(POST));
    act(() => result.current.mutation.mutate());
    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expect(result.current.errorKey).toBe("notFound");
  });

  it.each([
    ["gift_auth_required", "authRequired"],
    ["gift_subscription_required", "subscriptionRequired"],
    ["gift_limit_reached", "limitReached"],
    ["gift_disabled", "disabled"],
    ["gift_post_not_gated", "notGated"],
    ["gift_post_not_found", "notFound"],
    ["cos zupelnie innego", "unknown"],
  ] as const)("blad '%s' mapuje sie na klucz domenowy '%s'", async (message, key) => {
    h.rpc?.setError("create_gift_link", message);
    const { result } = renderHookWithQueryClient(() => useCreateGiftLink(POST));
    act(() => result.current.mutation.mutate());
    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expect(result.current.errorKey).toBe(key);
  });

  it("bez bledu `errorKey` jest null", async () => {
    h.rpc?.setData("create_gift_link", [linkRow()]);
    const { result } = renderHookWithQueryClient(() => useCreateGiftLink(POST));
    expect(result.current.errorKey).toBeNull();
    act(() => result.current.mutation.mutate());
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(result.current.errorKey).toBeNull();
  });

  it("sukces DOPISUJE kod i budzet do pamieci stanu popovera", async () => {
    // Bez tego zapisu ponowne otwarcie popovera strzela do `create_gift_link`
    // jeszcze raz i miga licznikiem "zostalo N otwarc".
    h.rpc?.setData("gift_article_state", [stateRow({ existing_code: null })]);
    h.rpc?.setData("create_gift_link", [linkRow({ used: 4, remaining: 6, redemption_count: 2 })]);
    const { result, queryClient } = renderHookWithQueryClient(() => ({
      state: useGiftArticleState(POST, true),
      create: useCreateGiftLink(POST),
    }));
    await waitFor(() => expect(result.current.state.isSuccess).toBe(true));

    act(() => result.current.create.mutation.mutate());
    await waitFor(() => expect(result.current.create.mutation.isSuccess).toBe(true));

    const cached = queryClient.getQueryData<GiftArticleState | null>([
      "gift-article-state",
      POST,
      UID,
    ]);
    expect(cached).toMatchObject({
      existingCode: CODE,
      expiresAt: "2026-09-01T00:00:00.000Z",
      used: 4,
      remaining: 6,
    });
    expect(cached?.budget).toMatchObject({ used: 2, limit: 5, remaining: 3 });
    // Pola spoza mutacji zostaja nietkniete - to jest MERGE, nie podmiana.
    expect(cached?.monthlyLimit).toBe(10);
    expect(cached?.eligibility).toBe("registered");
  });

  it("brak wpisu w pamieci NIE produkuje protezy stanu (zadnych pol z niczego)", async () => {
    // Zapis "z niczego" wyprodukowalby stan bez `enabled`, `canGift` itd.,
    // czyli obiekt, ktorego macierz faz nie umie zinterpretowac. Tego kod
    // pilnuje poprawnie - po naprawie defektu opisanego nizej NIE zaklada
    // wpisu w ogole (`undefined` = "nie ruszaj pamieci"), a nie wpis `null`.
    h.rpc?.setData("create_gift_link", [linkRow()]);
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateGiftLink(POST));
    act(() => result.current.mutation.mutate());
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["gift-article-state", POST, UID])).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // DEFEKT NAPRAWIONY (zachowanie produkcyjne zmienione swiadomie).
  //
  // CO BYLO ZLE. `onSuccess` dopisywal wynik do pamieci stanu popovera przez
  // `queryClient.setQueryData(giftStateKey(...), (prev) => prev ? {...} : (prev ?? null))`.
  // Gdy wpisu W OGOLE NIE BYLO w pamieci, `prev` jest `undefined`, a `prev ?? null`
  // zamienialo to na `null`. W react-query zwrocenie `undefined` z funkcji
  // aktualizujacej znaczy "nie ruszaj pamieci", natomiast zwrocenie `null`
  // ZAKLADA WPIS o wartosci `null` i stempluje go swiezym `dataUpdatedAt`.
  //
  // DLACZEGO TO BYLO RYZYKO. `useGiftArticleState` ma `staleTime: 60_000`. Wpis
  // zalozony przez mutacje byl wiec przez MINUTE uznawany za swiezy, czyli
  // obserwator zamontowany po mutacji dostawal `data === null` i NIE odpytywal
  // bazy. Dla macierzy faz `state === null` znaczy "loading"
  // (`resolveGiftPhase`: `if (stateLoading || !state) return "loading"`), wiec
  // czytelnik, ktory WLASNIE wygenerowal dzialajacy link, widzial zamiast niego
  // krecacy sie wskaznik - do minuty albo do zamkniecia karty. Sciezka byla
  // realna: wystarczylo, ze odczyt stanu wczesniej sie NIE UDAL (odmowa, chwilowa
  // awaria sieci), a mutacja przeszla - a wlasnie po to `create_gift_link` jest
  // idempotentny, zeby dzialac takze wtedy.
  //
  // JAK NAPRAWIONE. `useCreateGiftLink` zwraca teraz `prev` (czyli `undefined`)
  // zamiast `prev ?? null`, wiec mutacja bez wpisu w pamieci NIE zaklada wpisu.
  // Test wyzej przestawiony z `toBeNull()` na `toBeUndefined()`.
  // ---------------------------------------------------------------------------
  it("KONTROLA: przelaczenie bramy na `true` natychmiast odpytuje baze", () => {
    // Pozytywna kontrola dla testu ponizej. Dowodzi, ze mechanika pomiaru
    // jest poprawna: gdy pamiec stanu jest PUSTA, otwarcie popovera odpala
    // RPC synchronicznie, jeszcze w tym samym przebiegu efektow.
    h.rpc?.setData("gift_article_state", [stateRow()]);
    let otwarty = false;
    const { rerender } = renderHookWithQueryClient(() => useGiftArticleState(POST, otwarty));
    expect(h.rpc?.callsFor("gift_article_state")).toHaveLength(0);
    otwarty = true;
    rerender();
    expect(h.rpc?.callsFor("gift_article_state")).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT NAPRAWIONY (zachowanie produkcyjne zmienione swiadomie).
  //
  // CO BYLO ZLE. `onSuccess` dopisywal wynik do pamieci stanu popovera przez
  // `queryClient.setQueryData(giftStateKey(...), (prev) => prev ? {...} : (prev ?? null))`.
  // Gdy wpisu W OGOLE NIE BYLO w pamieci, `prev` jest `undefined`, a `prev ?? null`
  // zamienialo to na `null`. W react-query zwrocenie `undefined` z funkcji
  // aktualizujacej znaczy "nie ruszaj pamieci", natomiast zwrocenie `null`
  // ZAKLADA WPIS o wartosci `null` i stempluje go swiezym `dataUpdatedAt`.
  //
  // DLACZEGO TO BYLO RYZYKO. `useGiftArticleState` ma `staleTime: 60_000`, wiec
  // taki wpis byl przez MINUTE uznawany za swiezy: obserwator zamontowany po
  // mutacji dostawal `data === null` i NIE odpytywal bazy. Dla macierzy faz
  // `state === null` znaczy "loading" (`resolveGiftPhase`:
  // `if (stateLoading || !state) return "loading"`), wiec czytelnik, ktory
  // WLASNIE wygenerowal dzialajacy link, widzial zamiast niego krecacy sie
  // wskaznik - do minuty albo do zamkniecia karty. Sciezka byla realna:
  // wystarczylo, ze wczesniejszy odczyt stanu sie NIE UDAL (odmowa, chwilowa
  // awaria sieci) albo popover nie byl jeszcze otwarty, a mutacja przeszla -
  // po to `create_gift_link` jest idempotentny, zeby dzialac takze wtedy.
  //
  // JAK NAPRAWIONE. `useCreateGiftLink` zwraca `prev` (czyli `undefined`)
  // zamiast `prev ?? null`, wiec pamiec stanu zostaje nietknieta, a otwarcie
  // popovera po mutacji idzie po swieze dane do bazy.
  // ---------------------------------------------------------------------------
  it("mutacja bez wpisu w pamieci nie moze uciszyc pozniejszego odczytu stanu", async () => {
    h.rpc?.setData("create_gift_link", [linkRow()]);
    h.rpc?.setData("gift_article_state", [stateRow({ existing_code: CODE })]);

    let otwarty = false;
    const { result, rerender } = renderHookWithQueryClient(() => ({
      state: useGiftArticleState(POST, otwarty),
      create: useCreateGiftLink(POST),
    }));

    // Krok 1: popover jeszcze zamkniety - pamiec stanu jest pusta, ale link
    // powstaje (np. z akcji "udostepnij" poza popoverem albo po nieudanym
    // wczesniej odczycie stanu).
    act(() => {
      result.current.create.mutation.mutate();
    });
    await waitFor(() => expect(result.current.create.mutation.isSuccess).toBe(true));
    expect(h.rpc?.callsFor("gift_article_state")).toHaveLength(0);

    // Krok 2: popover sie otwiera. Odczyt stanu MUSI pojsc do bazy - inaczej
    // czytelnik utknie na wskazniku ladowania mimo gotowego kodu.
    otwarty = true;
    rerender();
    expect(h.rpc?.callsFor("gift_article_state")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// useGiftCodeFromUrl
// ---------------------------------------------------------------------------

describe("useGiftCodeFromUrl", () => {
  it("czyta poprawny kod z adresu", () => {
    h.searchStr = `?gift=${CODE}`;
    const { result } = renderHookWithQueryClient(() => useGiftCodeFromUrl());
    expect(result.current).toBe(CODE);
  });

  it("brak parametru daje null", () => {
    h.searchStr = "?utm_source=newsletter";
    const { result } = renderHookWithQueryClient(() => useGiftCodeFromUrl());
    expect(result.current).toBeNull();
  });

  it("pusty adres daje null", () => {
    h.searchStr = "";
    const { result } = renderHookWithQueryClient(() => useGiftCodeFromUrl());
    expect(result.current).toBeNull();
  });

  it.each([
    ["za krotki", "?gift=abc"],
    ["ze znakiem spoza alfabetu kodu", "?gift=abcDEF123$$xyzABC456"],
    ["pusty", "?gift="],
  ])("kod %s daje null (nie odpytujemy RPC smieciem)", (_opis, search) => {
    h.searchStr = search;
    const { result } = renderHookWithQueryClient(() => useGiftCodeFromUrl());
    expect(result.current).toBeNull();
  });

  it("reaguje na NAWIGACJE wpis -> wpis (nie czyta raz na mount)", () => {
    // Poddrzewo wpisu jest reuzywane przy przejsciach miedzy wpisami, wiec
    // odczyt "raz na mount" gubilby zmiane adresu i pokazywal poprzedni kod -
    // czyli probowalby zrealizowac kod OBCEGO artykulu.
    h.searchStr = `?gift=${CODE}`;
    const { result, rerender } = renderHookWithQueryClient(() => useGiftCodeFromUrl());
    expect(result.current).toBe(CODE);
    h.searchStr = "?gift=drugiKod_-abcdefgh";
    rerender();
    expect(result.current).toBe("drugiKod_-abcdefgh");
  });

  it("wyjscie z artykulu podarunkowego czysci kod", () => {
    h.searchStr = `?gift=${CODE}`;
    const { result, rerender } = renderHookWithQueryClient(() => useGiftCodeFromUrl());
    expect(result.current).toBe(CODE);
    h.searchStr = "";
    rerender();
    expect(result.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useGiftRedemption
// ---------------------------------------------------------------------------

describe("useGiftRedemption - brama `enabled`", () => {
  it("NIE konsumuje slotu, gdy wylaczone", async () => {
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.rpc?.calls).toHaveLength(0);
    // "settled" mimo braku zapytania: widok wpisu nie ma na co czekac.
    expect(result.current.settled).toBe(true);
    expect(result.current.valid).toBeNull();
  });

  it("NIE konsumuje slotu bez kodu", async () => {
    renderHookWithQueryClient(() => useGiftRedemption(POST, null, true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.rpc?.calls).toHaveLength(0);
  });

  it("NIE konsumuje slotu bez identyfikatora wpisu", async () => {
    renderHookWithQueryClient(() => useGiftRedemption(null, CODE, true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.rpc?.calls).toHaveLength(0);
  });
});

describe("useGiftRedemption - werdykt i tresc", () => {
  function redeemRow(overrides: Record<string, unknown> = {}) {
    return {
      valid: true,
      content_pl: "<p>Pelna tresc artykulu</p>",
      content_en: null,
      builder_data: null,
      blocks_data: null,
      reason: "ok",
      ...overrides,
    };
  }

  it("wazny kod oddaje tresc i werdykt 'ok'", async () => {
    h.rpc?.setData("redeem_gift_link", [redeemRow()]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.valid).toBe(true);
    expect(result.current.reason).toBe("ok");
    expect(result.current.body?.content_pl).toBe("<p>Pelna tresc artykulu</p>");
  });

  it.each(["owner", "entitled"] as const)(
    "werdykt '%s' tez otwiera tresc (bez konsumpcji slotu)",
    async (reason) => {
      h.rpc?.setData("redeem_gift_link", [redeemRow({ reason })]);
      const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
      await waitFor(() => expect(result.current.settled).toBe(true));
      expect(result.current.valid).toBe(true);
      expect(result.current.reason).toBe(reason);
    },
  );

  it.each(["exhausted", "expired", "revoked", "invalid"] as const)(
    "odmowa '%s' nie oddaje tresci, ale ZACHOWUJE powod",
    async (reason) => {
      // Powod decyduje o wariancie banera: "wykorzystano wszystkie otwarcia"
      // to inna sciezka wyjscia niz "ten link jest nieprawidlowy".
      h.rpc?.setData("redeem_gift_link", [redeemRow({ valid: false, reason, content_pl: null })]);
      const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
      await waitFor(() => expect(result.current.settled).toBe(true));
      expect(result.current.valid).toBe(false);
      expect(result.current.reason).toBe(reason);
      expect(result.current.body).toBeNull();
    },
  );

  it("NIEZNANY powod degraduje sie do 'invalid'", async () => {
    h.rpc?.setData("redeem_gift_link", [redeemRow({ valid: false, reason: "teleported" })]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.reason).toBe("invalid");
  });

  it("stare RPC bez kolumny `reason` odtwarza powod z flagi `valid`", async () => {
    h.rpc?.setData("redeem_gift_link", [redeemRow({ reason: undefined })]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.reason).toBe("ok");
  });

  it("stare RPC bez `reason` przy odmowie daje 'invalid'", async () => {
    h.rpc?.setData("redeem_gift_link", [
      redeemRow({ valid: false, reason: undefined, content_pl: null }),
    ]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.reason).toBe("invalid");
  });

  it("PUSTY wynik traktujemy jak niewazny kod (serwer nie rozroznia przypadkow)", async () => {
    h.rpc?.setData("redeem_gift_link", []);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.valid).toBe(false);
    expect(result.current.reason).toBe("invalid");
  });

  it("PUSTA tresc przy `valid:true` NIE liczy sie jako otwarcie", async () => {
    // Inaczej czytelnik zobaczylby baner "artykul odblokowany" nad pustka.
    h.rpc?.setData("redeem_gift_link", [
      redeemRow({ content_pl: "   ", content_en: null, builder_data: {}, blocks_data: {} }),
    ]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.valid).toBe(false);
    expect(result.current.reason).toBe("invalid");
    expect(result.current.body).toEqual({
      content_pl: null,
      content_en: null,
      builder_data: null,
      blocks_data: null,
    });
  });

  it("tresc w builderze tez jest trescia renderowalna", async () => {
    h.rpc?.setData("redeem_gift_link", [
      redeemRow({ content_pl: null, builder_data: { sections: [{ id: "s1" }] } }),
    ]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.valid).toBe(true);
  });

  it("odmowa RPC nie oddaje ani tresci, ani werdyktu", async () => {
    h.rpc?.setError("redeem_gift_link", "forbidden");
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.valid).toBeNull();
    expect(result.current.body).toBeNull();
    expect(result.current.reason).toBeNull();
  });
});

describe("useGiftRedemption - tozsamosc odbiorcy", () => {
  const OK_ROW = {
    valid: true,
    content_pl: "tresc",
    content_en: null,
    builder_data: null,
    blocks_data: null,
  };

  it("GOSC jedzie z pseudonimem przegladarki (dedup slotu przy odswiezeniu)", async () => {
    h.uid = null;
    h.rpc?.setData("redeem_gift_link", [OK_ROW]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(h.rpc?.lastCall("redeem_gift_link")?.arg("_visitor_id")).toBe(VISITOR);
  });

  it("ZALOGOWANY nie wysyla pseudonimu goscia", async () => {
    // Tozsamosc konta wystarczy; wysylanie obu byloby zbedna dana o czytelniku.
    h.rpc?.setData("redeem_gift_link", [OK_ROW]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(h.rpc?.lastCall("redeem_gift_link")?.has("_visitor_id")).toBe(false);
  });

  it("klucz zapytania zawiera TOZSAMOSC - powrot nie pali kolejnego slotu", async () => {
    h.rpc?.setData("redeem_gift_link", [OK_ROW]);
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useGiftRedemption(POST, CODE, true),
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(queryClient.getQueryData(["gift-redeem", POST, CODE, UID])).toBeTruthy();
  });

  it("gosc i zalogowany maja ROZNE klucze (logowanie nie doklada zuzycia po cichu)", async () => {
    h.uid = null;
    h.rpc?.setData("redeem_gift_link", [OK_ROW]);
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useGiftRedemption(POST, CODE, true),
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(queryClient.getQueryData(["gift-redeem", POST, CODE, VISITOR])).toBeTruthy();
    expect(queryClient.getQueryData(["gift-redeem", POST, CODE, UID])).toBeUndefined();
  });

  it("gosc bez dostepu do storage jedzie jako 'anon' i nie wysyla pseudonimu", async () => {
    // Tryb prywatny z zablokowanym storage: mechanika degraduje sie bezpiecznie,
    // liczac kazde wejscie osobno - ale NIE moze sie wywalic.
    h.uid = null;
    window.localStorage.clear();
    const original = window.crypto.randomUUID;
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        throw new Error("storage blocked");
      },
    });
    h.rpc?.setData("redeem_gift_link", [OK_ROW]);
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useGiftRedemption(POST, CODE, true),
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(queryClient.getQueryData(["gift-redeem", POST, CODE, "anon"])).toBeTruthy();
    expect(h.rpc?.lastCall("redeem_gift_link")?.has("_visitor_id")).toBe(false);
    Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: original });
  });

  it("wola RPC z identyfikatorem wpisu I kodem", async () => {
    h.rpc?.setData("redeem_gift_link", [OK_ROW]);
    const { result } = renderHookWithQueryClient(() => useGiftRedemption(POST, CODE, true));
    await waitFor(() => expect(result.current.settled).toBe(true));
    const call = h.rpc?.lastCall("redeem_gift_link");
    expect(call?.arg("_post_id")).toBe(POST);
    expect(call?.arg("_code")).toBe(CODE);
  });

  it("konsumuje slot DOKLADNIE RAZ dla tej samej pary (wpis, kod)", async () => {
    // `staleTime: Infinity` + brak ponowien: przerysowanie komponentu nie moze
    // strzelic drugi raz, bo kazdy strzal to potencjalnie zuzyty slot budzetu.
    h.rpc?.setData("redeem_gift_link", [OK_ROW]);
    const { result, rerender } = renderHookWithQueryClient(() =>
      useGiftRedemption(POST, CODE, true),
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    rerender();
    rerender();
    expect(h.rpc?.callsFor("redeem_gift_link")).toHaveLength(1);
  });
});
