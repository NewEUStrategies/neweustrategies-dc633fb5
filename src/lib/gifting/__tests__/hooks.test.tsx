// Warstwa danych „Udostępnij pełny artykuł" - siedem hooków, przez które
// przechodzi KAŻDY prezent: odczyt ustawień, stan popovera nadawcy, utworzenie
// linku i realizacja kodu przez odbiorcę.
//
// Plik stał na 6% linii i 0 z 17 funkcji, mimo że jedyny test komponentu, który
// go używa (`components/gifting/__tests__/GiftArticleButton.test.tsx`), MOCKUJE
// go w całości. Tamtego mocka nie ruszamy - test komponentu ma dowodzić widoku.
// Tutaj atrapą jest wyłącznie klient Supabase, `useAuth` i router, więc same
// hooki biegną prawdziwe, a `hasRenderableBody` i cały `lib/gifting/model`
// pełnią rolę WYROCZNI (mają własne suity).
//
// CO TEN PLIK DOWODZI.
//   1. SPALONY SLOT PODANY JAKO „ZŁY LINK" (`it.fails`). Najważniejszy defekt
//      całego modułu. RPC `redeem_gift_link` po stronie bazy JUŻ skonsumowało
//      slot budżetu, gdy odpowiada. Jeśli treść przyjdzie nierenderowalna PRZY
//      `row.valid === true`, kod nadpisuje werdykt na
//      `{ body: EMPTY_BODY, valid: false, reason: "invalid" }`
//      (hooks.ts:322-324) - czyli DOKŁADNIE ten sam werdykt, co przy
//      nieprawidłowym kodzie z serwera. Skutek: odbiorca widzi „ten link jest
//      nieprawidłowy" i paywall, slot z budżetu (domyślnie 1 z 5) jest
//      zużyty, miesięczny limit nadawcy o jeden niższy, w audycie
//      `gift_events` leży udana realizacja - a interfejs mówi odbiorcy, że to
//      ON ma zły link. Test rozdziela te dwa przypadki wprost.
//   2. TOŻSAMOŚĆ ODBIORCY JEST CZĘŚCIĄ KLUCZA ZAPYTANIA. Powrót na ten sam
//      artykuł z tej samej przeglądarki NIE pali kolejnego slotu, a zalogowanie
//      się w trakcie czytania przełącza tożsamość (konto zamiast pseudonimu
//      gościa) i NIE dokłada zużycia po cichu.
//   3. REALIZACJA NIE ODŚWIEŻA SIĘ W TLE. `retry: false`,
//      `staleTime: Infinity`, `refetchOnWindowFocus: false` - każde z nich
//      osobno chroni budżet: ponowienie, powrót do karty ani prefetch nie mogą
//      spalić slotu. Asercja czyta OPCJE zapytania z cache, nie skutek.
//   4. `_visitor_id` LECI DO RPC WYŁĄCZNIE DLA GOŚCIA. Dla zalogowanego klucz
//      NIE MOŻE się w argumentach pojawić - serwer rozstrzyga tożsamość
//      z tokenu, a podanie obu byłoby dwiema tożsamościami na jedno żądanie.
//   5. OKNO WDROŻENIOWE NIE GASI PRZYCISKU. `fetchGiftSettings` degraduje się
//      do starszego kształtu kolumn WYŁĄCZNIE dla `42703` (undefined_column);
//      każdy inny kod błędu leci dalej. Test asertuje też NAPISY `select` -
//      degradacja ma czytać WĘŻSZY zestaw kolumn, nie ten sam.
//   6. `remaining: null` TO INNA ODPOWIEDŹ NIŻ `0`. `monthly_limit <= 0` znaczy
//      „bez limitu" i musi dać `null`; `0` znaczy „limit wyczerpany". Zlanie
//      tych dwóch pokazałoby nadawcy „zostało 0" tam, gdzie limitu nie ma.
//   7. IDEMPOTENCJA POPOVERA. `onSuccess` dopisuje do cache stanu kod ORAZ
//      budżet, więc drugie otwarcie popovera nie strzela do `create` i od razu
//      pokazuje prawdziwy licznik „zostało N otwarć".
//   8. `useGiftCodeFromUrl` JEST REAKTYWNY na zmianę adresu. Poddrzewo wpisu
//      jest reużywane przy przejściu wpis -> wpis, więc odczyt „raz na mount"
//      gubiłby kod z nowego URL-a.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `lib/gifting/__tests__/model.test.ts`
// i `admin-model.test.ts` (giftClickBudget, mapGiftError, normalizeRedeemReason,
// parseGiftCode, giftBannerVariant), `lib/access/__tests__` (hasRenderableBody)
// ani `hooks/__tests__/useAuth.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  visitorId: "gosc-abc" as string | null,
  searchStr: "" as string,
}));

const db = await vi.hoisted(async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  return { chain: supabaseFromStub(), rpc: supabaseRpcStub() };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.chain.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => db.rpc.rpc(name, args),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@/lib/access/visitor", () => ({ getVisitorId: () => h.visitorId }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  // Selektor produkcyjny czyta `s.location.searchStr` - podanie samego stringa
  // albo `s.location.search` dałoby fałszywe `null` i test „przechodziłby"
  // na niczym.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { searchStr: h.searchStr } }),
}));

import { ok, fail } from "@/test/supabase";
import { DEFAULT_GIFT_SETTINGS } from "@/lib/gifting/model";
import {
  fetchGiftSettings,
  useCreateGiftLink,
  useGiftArticleState,
  useGiftCodeFromUrl,
  useGiftRedemption,
  useGiftSettings,
} from "@/lib/gifting/hooks";

const SETTINGS_TABLE = "gift_article_settings";
const POST = "11111111-2222-4333-8444-555555555555";
const ME = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** Wiersz ustawień w NOWYM kształcie (po migracji 20260806170000). */
function settingsRow(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    monthly_limit: 10,
    link_ttl_days: 30,
    max_redemptions_per_link: 5,
    eligibility: "registered",
    ...over,
  };
}

/** Wiersz `gift_article_state` - kształt RETURNS TABLE. */
function stateRow(over: Record<string, unknown> = {}) {
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
    ...over,
  };
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  db.chain.reset();
  db.rpc.reset();
  h.session = { user: { id: ME } };
  h.visitorId = "gosc-abc";
  h.searchStr = "";
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
describe("fetchGiftSettings: okno wdrożeniowe nie gasi funkcji", () => {
  it("nowy kształt kolumn czyta pełny zestaw i normalizuje `eligibility`", async () => {
    db.chain.setResponse(SETTINGS_TABLE, ok(settingsRow({ eligibility: "subscribers" })));

    await expect(fetchGiftSettings()).resolves.toEqual({
      enabled: true,
      monthly_limit: 10,
      link_ttl_days: 30,
      max_redemptions_per_link: 5,
      eligibility: "subscribers",
    });
    // Pierwsze podejście czyta kolumnę `eligibility` - to ono ma być domyślne.
    expect(String(db.chain.chainsFor(SETTINGS_TABLE)[0]?.argsOf("select")?.[0])).toContain(
      "eligibility",
    );
  });

  it("`42703` degraduje się do WĘŻSZEGO zestawu kolumn (bez `eligibility`)", async () => {
    let call = 0;
    db.chain.setResponse(SETTINGS_TABLE, () => {
      call += 1;
      return call === 1
        ? fail('column "eligibility" does not exist', "42703")
        : ok({
            enabled: true,
            monthly_limit: 7,
            link_ttl_days: 14,
            max_redemptions_per_link: 3,
          });
    });

    const result = await fetchGiftSettings();
    expect(result.monthly_limit).toBe(7);
    // Brak kolumny w bazie => `eligibility` z bezpiecznej domyślnej.
    expect(result.eligibility).toBe(DEFAULT_GIFT_SETTINGS.eligibility);

    const selects = db.chain
      .chainsFor(SETTINGS_TABLE)
      .map((c) => String(c.argsOf("select")?.[0] ?? ""));
    expect(selects).toHaveLength(2);
    // Sedno degradacji: DRUGI odczyt NIE pyta o kolumnę, której nie ma.
    expect(selects[1]).not.toContain("eligibility");
    expect(selects[1]).toContain("max_redemptions_per_link");
  });

  it("INNY kod błędu NIE jest maskowany jako ustawienia domyślne", async () => {
    // Odmowa uprawnień albo brak tabeli to awaria do zgłoszenia, nie okno
    // wdrożeniowe. Zlanie tego z `42703` ukryłoby realny incydent.
    db.chain.setResponse(SETTINGS_TABLE, fail("permission denied", "42501"));
    await expect(fetchGiftSettings()).rejects.toThrow(/permission denied/);
    expect(db.chain.chainsFor(SETTINGS_TABLE)).toHaveLength(1);
  });

  it("błąd na ŚCIEŻCE LEGACY też leci dalej", async () => {
    let call = 0;
    db.chain.setResponse(SETTINGS_TABLE, () => {
      call += 1;
      return call === 1
        ? fail("undefined column", "42703")
        : fail("relation does not exist", "42P01");
    });
    await expect(fetchGiftSettings()).rejects.toThrow(/relation does not exist/);
    expect(db.chain.chainsFor(SETTINGS_TABLE)).toHaveLength(2);
  });

  it("brak wiersza (`null`) daje DEFAULT_GIFT_SETTINGS", async () => {
    db.chain.setResponse(SETTINGS_TABLE, ok(null));
    await expect(fetchGiftSettings()).resolves.toEqual(DEFAULT_GIFT_SETTINGS);
  });

  it("brakujące `max_redemptions_per_link` schodzi do domyślnej, nie do 0", async () => {
    // `0` w tej domenie znaczy „bez limitu", więc ciche zero byłoby obejściem
    // budżetu kliknięć.
    db.chain.setResponse(SETTINGS_TABLE, ok(settingsRow({ max_redemptions_per_link: null })));
    const result = await fetchGiftSettings();
    expect(result.max_redemptions_per_link).toBe(DEFAULT_GIFT_SETTINGS.max_redemptions_per_link);
  });
});

describe("useGiftSettings: konfiguracja publiczna", () => {
  it("cache 5 minut - widok wpisu nie płaci za odczyt przy każdym renderze", async () => {
    db.chain.setResponse(SETTINGS_TABLE, ok(settingsRow()));
    const qc = freshClient();
    const { result } = renderHook(() => useGiftSettings(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const options = qc.getQueryCache().find({ queryKey: ["gift-settings"] })?.options as {
      staleTime?: number;
    };
    expect(options.staleTime).toBe(5 * 60_000);
  });
});

// ---------------------------------------------------------------------------
describe("useGiftArticleState: kto i kiedy pyta o stan", () => {
  it.each([
    ["popover zamknięty", { enabled: false, postId: POST, logged: true }],
    ["brak wpisu", { enabled: true, postId: null, logged: true }],
    ["gość", { enabled: true, postId: POST, logged: false }],
  ])("%s => ZERO wywołań RPC", async (_label, cfg) => {
    h.session = cfg.logged ? { user: { id: ME } } : null;
    const qc = freshClient();
    renderHook(() => useGiftArticleState(cfg.postId, cfg.enabled), { wrapper: wrapper(qc) });

    // Świadomie NIC nie planujemy: gdyby hook strzelił, atrapa zwróciłaby
    // czytelny błąd testu, a nie ciche `null`.
    await waitFor(() => expect(db.rpc.callsFor("gift_article_state")).toHaveLength(0));
  });

  it("zalogowany z otwartym popoverem pyta RAZ, z argumentem `_post_id`", async () => {
    db.rpc.setData("gift_article_state", [stateRow()]);
    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(db.rpc.callsFor("gift_article_state")).toHaveLength(1);
    expect(db.rpc.lastCall("gift_article_state")?.arg("_post_id")).toBe(POST);
  });

  it("`monthly_limit > 0` przepisuje `remaining` z bazy", async () => {
    db.rpc.setData("gift_article_state", [stateRow({ monthly_limit: 10, remaining: 3 })]);
    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.remaining).toBe(3);
  });

  it("`monthly_limit <= 0` daje `remaining: null` - „bez limitu”, nie „zero”", async () => {
    db.rpc.setData("gift_article_state", [stateRow({ monthly_limit: 0, remaining: 0 })]);
    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Gdyby to było `0`, nadawca zobaczyłby „zostało 0 prezentów" przy
    // wyłączonym limicie miesięcznym.
    expect(result.current.data?.remaining).toBeNull();
  });

  it("`remaining: null` z bazy przy dodatnim limicie schodzi do 0", async () => {
    db.rpc.setData("gift_article_state", [stateRow({ monthly_limit: 10, remaining: null })]);
    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.remaining).toBe(0);
  });

  it("budżet kliknięć liczy się z KOLUMN bazy, gdy są", async () => {
    db.rpc.setData("gift_article_state", [stateRow({ max_redemptions: 4, redemption_count: 3 })]);
    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true, 99), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.budget).toMatchObject({ used: 3, limit: 4, remaining: 1 });
  });

  it("brak kolumn budżetu używa `fallbackCap` tenanta", async () => {
    // Okno wdrożeniowe: RPC jeszcze nie zna kolumn budżetu. Licznik ma pokazać
    // domyślny cap tenanta, a nie „bez limitu".
    const row = stateRow();
    delete (row as Record<string, unknown>).max_redemptions;
    delete (row as Record<string, unknown>).redemption_count;
    db.rpc.setData("gift_article_state", [row]);

    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true, 7), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.budget).toMatchObject({ used: 0, limit: 7, unlimited: false });
  });

  it("pusty zbiór wierszy daje `null`, nie wyjątek", async () => {
    db.rpc.setData("gift_article_state", []);
    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("błąd RPC trafia do stanu błędu zapytania", async () => {
    db.rpc.setError("gift_article_state", "gift_disabled");
    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("klucz zapytania zawiera wpis I tożsamość - zmiana konta nie serwuje cudzego stanu", async () => {
    db.rpc.setData("gift_article_state", [stateRow()]);
    const qc = freshClient();
    const { result } = renderHook(() => useGiftArticleState(POST, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryCache().getAll()[0]?.queryKey).toEqual(["gift-article-state", POST, ME]);
  });
});

// ---------------------------------------------------------------------------
describe("useCreateGiftLink: idempotencja popovera", () => {
  function linkRow(over: Record<string, unknown> = {}) {
    return {
      code: "ABCD1234",
      expires_at: "2026-09-01T00:00:00Z",
      used: 3,
      monthly_limit: 10,
      remaining: 7,
      max_redemptions: 5,
      redemption_count: 0,
      ...over,
    };
  }

  it("sukces dopisuje do cache stanu KOD i BUDŻET", async () => {
    // To jest mechanizm idempotencji popovera: drugie otwarcie czyta kod
    // z cache i nie strzela do `create`.
    db.rpc.setData("gift_article_state", [stateRow({ existing_code: null })]);
    db.rpc.setData("create_gift_link", [linkRow({ redemption_count: 2 })]);

    const qc = freshClient();
    const { result } = renderHook(
      () => ({
        state: useGiftArticleState(POST, true),
        create: useCreateGiftLink(POST),
      }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.state.isSuccess).toBe(true));
    // Stan PRZED mutacją: brak kodu, budżet z kolumn wiersza stanu.
    expect(result.current.state.data?.existingCode).toBeNull();

    await act(async () => {
      await result.current.create.mutation.mutateAsync();
    });

    // Asercja na CACHE, nie na widoku hooka: cache jest tym, co czyta drugie
    // otwarcie popovera, i to on decyduje, czy `create` poleci po raz drugi.
    await waitFor(() => {
      const cached = qc.getQueryState(["gift-article-state", POST, ME])?.data as
        { existingCode: string | null } | undefined;
      expect(cached?.existingCode).toBe("ABCD1234");
    });

    const cached = qc.getQueryState(["gift-article-state", POST, ME])?.data as {
      existingCode: string | null;
      expiresAt: string | null;
      used: number;
      remaining: number | null;
      budget: { used: number; limit: number; remaining: number | null };
    };
    expect(cached.expiresAt).toBe("2026-09-01T00:00:00Z");
    // Licznik „zostało N otwarć" musi być PRAWDZIWY od razu, bez migotania.
    expect(cached.budget).toMatchObject({ used: 2, limit: 5, remaining: 3 });
    expect(cached.used).toBe(3);
    expect(cached.remaining).toBe(7);
  });

  it("drugie otwarcie popovera NIE strzela do `create` - kod jest już w cache", async () => {
    // To jest cel idempotencji: po jednym utworzeniu linku kolejne otwarcia
    // czytają kod ze stanu, więc baza nie dostaje drugiego żądania.
    db.rpc.setData("gift_article_state", [stateRow({ existing_code: null })]);
    db.rpc.setData("create_gift_link", [linkRow()]);

    const qc = freshClient();
    const first = renderHook(
      () => ({ state: useGiftArticleState(POST, true), create: useCreateGiftLink(POST) }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(first.result.current.state.isSuccess).toBe(true));
    await act(async () => {
      await first.result.current.create.mutation.mutateAsync();
    });
    expect(db.rpc.callsFor("create_gift_link")).toHaveLength(1);

    // Ponowne zamontowanie popovera: stan jest świeży (staleTime 60 s), więc
    // nie ma ani nowego odczytu stanu, ani wywołania `create`.
    const second = renderHook(() => useGiftArticleState(POST, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(second.result.current.data?.existingCode).toBe("ABCD1234");
    expect(db.rpc.callsFor("create_gift_link")).toHaveLength(1);
  });

  it("`monthly_limit <= 0` w odpowiedzi create też daje `remaining: null`", async () => {
    db.rpc.setData("create_gift_link", [linkRow({ monthly_limit: 0, remaining: 0 })]);
    const qc = freshClient();
    const { result } = renderHook(() => useCreateGiftLink(POST), { wrapper: wrapper(qc) });

    let res: { remaining: number | null } | undefined;
    await act(async () => {
      res = await result.current.mutation.mutateAsync();
    });
    expect(res?.remaining).toBeNull();
  });

  it("brak wiersza => `gift_post_not_found` zmapowane na klucz i18n", async () => {
    db.rpc.setData("create_gift_link", []);
    const qc = freshClient();
    const { result } = renderHook(() => useCreateGiftLink(POST), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutation.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expect(result.current.errorKey).toBe("notFound");
  });

  it("odmowa bazy jest mapowana na klucz domenowy, nie na surowy komunikat", async () => {
    db.rpc.setError("create_gift_link", "gift_disabled");
    const qc = freshClient();
    const { result } = renderHook(() => useCreateGiftLink(POST), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutation.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expect(result.current.errorKey).toBe("disabled");
  });

  it("nieznany komunikat błędu daje `unknown`, a nie wyciek treści z bazy", async () => {
    db.rpc.setError("create_gift_link", "PG: cokolwiek wewnętrznego 0x41");
    const qc = freshClient();
    const { result } = renderHook(() => useCreateGiftLink(POST), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutation.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.errorKey).toBe("unknown"));
  });

  it("`errorKey` jest `null`, dopóki nic nie padło", () => {
    const qc = freshClient();
    const { result } = renderHook(() => useCreateGiftLink(POST), { wrapper: wrapper(qc) });
    expect(result.current.errorKey).toBeNull();
  });

  it.fails(
    "DEFEKT: `create` bez uprzedniego odczytu stanu NIE MA zatruwać cache wpisem `null`",
    async () => {
      // Oczekiwanie: gdy w cache nie ma jeszcze stanu (`prev === undefined`),
      // `onSuccess` powinien go NIE TWORZYĆ - inaczej powstaje wpis o
      // `data === null` i statusie `success`, czyli „wiemy, że stanu nie ma".
      // Produkcja robi `prev ? {...} : (prev ?? null)`, a updater zwracający
      // `null` NIE jest w react-query no-opem.
      db.rpc.setData("create_gift_link", [linkRow()]);
      const qc = freshClient();
      const { result } = renderHook(() => useCreateGiftLink(POST), { wrapper: wrapper(qc) });

      await act(async () => {
        await result.current.mutation.mutateAsync();
      });

      expect(qc.getQueryState(["gift-article-state", POST, ME])).toBeUndefined();
    },
  );

  it("STAN FAKTYCZNY: `create` bez odczytu stanu TWORZY w cache wpis `null`", async () => {
    // Sprzężony z `it.fails` powyżej - po naprawie usunąć oba. Dziś bez skutku
    // widocznego dla użytkownika (jedyny konsument najpierw czyta stan), ale
    // każdy nowy wywołujący dostanie „stan wczytany i pusty".
    db.rpc.setData("create_gift_link", [linkRow()]);
    const qc = freshClient();
    const { result } = renderHook(() => useCreateGiftLink(POST), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutation.mutateAsync();
    });

    const state = qc.getQueryState(["gift-article-state", POST, ME]);
    expect(state).toBeDefined();
    expect(state?.data).toBeNull();
    expect(state?.status).toBe("success");
  });
});

// ---------------------------------------------------------------------------
describe("useGiftCodeFromUrl: reaktywność na zmianę adresu", () => {
  it("poprawny kod z query stringa", () => {
    h.searchStr = "?gift=ABCD1234";
    const qc = freshClient();
    const { result } = renderHook(() => useGiftCodeFromUrl(), { wrapper: wrapper(qc) });
    expect(result.current).toBe("ABCD1234");
  });

  it("brak parametru daje `null`", () => {
    h.searchStr = "?utm=x";
    const qc = freshClient();
    const { result } = renderHook(() => useGiftCodeFromUrl(), { wrapper: wrapper(qc) });
    expect(result.current).toBeNull();
  });

  it("niepoprawny kształt kodu daje `null`", () => {
    h.searchStr = "?gift=nie-taki-kod!!";
    const qc = freshClient();
    const { result } = renderHook(() => useGiftCodeFromUrl(), { wrapper: wrapper(qc) });
    expect(result.current).toBeNull();
  });

  it("PRZEJŚCIE wpis -> wpis zmienia wynik - odczyt nie jest „raz na mount”", () => {
    // Poddrzewo wpisu jest reużywane przy nawigacji między wpisami, więc
    // odczyt spoza reaktywnego selektora gubiłby kod z nowego adresu i drugi
    // prezent nigdy by się nie zrealizował.
    h.searchStr = "?gift=AAAA1111";
    const qc = freshClient();
    const { result, rerender } = renderHook(() => useGiftCodeFromUrl(), { wrapper: wrapper(qc) });
    expect(result.current).toBe("AAAA1111");

    h.searchStr = "?gift=BBBB2222";
    rerender();
    expect(result.current).toBe("BBBB2222");
  });

  it("przejście na adres BEZ kodu czyści wynik", () => {
    h.searchStr = "?gift=AAAA1111";
    const qc = freshClient();
    const { result, rerender } = renderHook(() => useGiftCodeFromUrl(), { wrapper: wrapper(qc) });
    expect(result.current).toBe("AAAA1111");

    h.searchStr = "";
    rerender();
    expect(result.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("useGiftRedemption: konsumpcja slotu i tożsamość odbiorcy", () => {
  const CODE = "ABCD1234";

  /** Wiersz `redeem_gift_link` z renderowalną treścią. */
  function redeemRow(over: Record<string, unknown> = {}) {
    return {
      valid: true,
      content_pl: "<p>Pełna treść artykułu.</p>",
      content_en: null,
      builder_data: null,
      blocks_data: null,
      reason: "ok",
      ...over,
    };
  }

  function renderRedeem(enabled = true) {
    const qc = freshClient();
    const hook = renderHook(() => useGiftRedemption(POST, CODE, enabled), { wrapper: wrapper(qc) });
    return { ...hook, qc };
  }

  it("ważny kod z renderowalną treścią oddaje body i werdykt `ok`", async () => {
    db.rpc.setData("redeem_gift_link", [redeemRow()]);
    const { result } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));

    expect(result.current.valid).toBe(true);
    expect(result.current.reason).toBe("ok");
    expect(result.current.body?.content_pl).toContain("Pełna treść");
  });

  it.each([
    ["exhausted", "exhausted"],
    ["expired", "expired"],
    ["revoked", "revoked"],
    ["owner", "owner"],
    ["entitled", "entitled"],
  ])("powód serwera `%s` przechodzi NIETKNIĘTY do werdyktu", async (serverReason, expected) => {
    // Odbiorca musi wiedzieć, CZY link był dobry: „wszystkie otwarcia
    // wykorzystano" i „link wygasł" to inne komunikaty i inna droga wyjścia
    // niż „ten link jest nieprawidłowy".
    db.rpc.setData("redeem_gift_link", [
      redeemRow({ valid: false, content_pl: null, reason: serverReason }),
    ]);
    const { result } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.reason).toBe(expected);
  });

  it("brak wiersza = kod nieważny (serwer świadomie nie rozróżnia przypadków)", async () => {
    db.rpc.setData("redeem_gift_link", []);
    const { result } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.valid).toBe(false);
    expect(result.current.reason).toBe("invalid");
    expect(result.current.body).toBeNull();
  });

  it("zapytanie NIE startuje bez wpisu, bez kodu ani przy `enabled: false`", async () => {
    const { result } = renderRedeem(false);
    // `settled` jest `true` od razu - nie ma na co czekać.
    expect(result.current.settled).toBe(true);
    expect(db.rpc.callsFor("redeem_gift_link")).toHaveLength(0);
    expect(result.current.valid).toBeNull();
  });

  it("opcje zapytania chronią budżet: bez ponowień, bez odświeżania w tle", async () => {
    // Każda z tych trzech opcji osobno mogłaby spalić slot: ponowienie po
    // błędzie, powrót do karty, prefetch przeglądarki.
    db.rpc.setData("redeem_gift_link", [redeemRow()]);
    const { result, qc } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));

    const options = qc.getQueryCache().getAll()[0]?.options as {
      retry?: unknown;
      staleTime?: number;
      refetchOnWindowFocus?: boolean;
    };
    expect(options.retry).toBe(false);
    expect(options.staleTime).toBe(Infinity);
    expect(options.refetchOnWindowFocus).toBe(false);
  });

  it("GOŚĆ: `_visitor_id` leci do RPC, a klucz zapytania niesie pseudonim", async () => {
    h.session = null;
    h.visitorId = "gosc-xyz";
    db.rpc.setData("redeem_gift_link", [redeemRow()]);
    const { result, qc } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));

    expect(db.rpc.lastCall("redeem_gift_link")?.arg("_visitor_id")).toBe("gosc-xyz");
    expect(qc.getQueryCache().getAll()[0]?.queryKey).toEqual([
      "gift-redeem",
      POST,
      CODE,
      "gosc-xyz",
    ]);
  });

  it("ZALOGOWANY: klucz `_visitor_id` NIE POJAWIA SIĘ w argumentach", async () => {
    // Dwie tożsamości na jedno żądanie to dwa różne liczniki zużycia.
    // `has()` (hasOwnProperty) jest tu właściwą asercją - `undefined` to inna
    // odpowiedź niż brak klucza.
    h.session = { user: { id: ME } };
    db.rpc.setData("redeem_gift_link", [redeemRow()]);
    const { result, qc } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));

    expect(db.rpc.lastCall("redeem_gift_link")?.has("_visitor_id")).toBe(false);
    expect(qc.getQueryCache().getAll()[0]?.queryKey).toEqual(["gift-redeem", POST, CODE, ME]);
  });

  it("gość BEZ pseudonimu (blokada storage) używa klucza `anon` i nie wysyła identyfikatora", async () => {
    h.session = null;
    h.visitorId = null;
    db.rpc.setData("redeem_gift_link", [redeemRow()]);
    const { result, qc } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));

    expect(db.rpc.lastCall("redeem_gift_link")?.has("_visitor_id")).toBe(false);
    expect(qc.getQueryCache().getAll()[0]?.queryKey).toEqual(["gift-redeem", POST, CODE, "anon"]);
  });

  it("ZALOGOWANIE w trakcie czytania przełącza tożsamość i NIE dokłada zużycia", async () => {
    // Dwa różne klucze = dwa osobne wpisy w cache. Sedno: liczba realnych
    // wywołań RPC ma odpowiadać liczbie TOŻSAMOŚCI, a nie liczbie renderów.
    h.session = null;
    h.visitorId = "gosc-xyz";
    db.rpc.setData("redeem_gift_link", [redeemRow()]);

    const qc = freshClient();
    const { result, rerender } = renderHook(() => useGiftRedemption(POST, CODE, true), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(db.rpc.callsFor("redeem_gift_link")).toHaveLength(1);

    h.session = { user: { id: ME } };
    rerender();
    await waitFor(() => expect(db.rpc.callsFor("redeem_gift_link")).toHaveLength(2));

    // Kolejne rendery na tej samej tożsamości NIE strzelają ponownie
    // (staleTime Infinity) - to jest ta część, która chroni budżet.
    rerender();
    rerender();
    await waitFor(() => expect(db.rpc.callsFor("redeem_gift_link")).toHaveLength(2));
    expect(db.rpc.callsFor("redeem_gift_link")[1]?.has("_visitor_id")).toBe(false);
  });

  it("powrót na ten sam artykuł z tą samą tożsamością nie pali kolejnego slotu", async () => {
    db.rpc.setData("redeem_gift_link", [redeemRow()]);
    const qc = freshClient();
    const first = renderHook(() => useGiftRedemption(POST, CODE, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(first.result.current.settled).toBe(true));

    const second = renderHook(() => useGiftRedemption(POST, CODE, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(second.result.current.settled).toBe(true));

    expect(db.rpc.callsFor("redeem_gift_link")).toHaveLength(1);
  });

  it("argumenty RPC to dokładnie wpis, kod i (dla gościa) pseudonim", async () => {
    h.session = null;
    h.visitorId = "gosc-xyz";
    db.rpc.setData("redeem_gift_link", [redeemRow()]);
    const { result } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));

    expect(db.rpc.lastCall("redeem_gift_link")?.keys().sort()).toEqual([
      "_code",
      "_post_id",
      "_visitor_id",
    ]);
    expect(db.rpc.lastCall("redeem_gift_link")?.arg("_code")).toBe(CODE);
  });
});

// ---------------------------------------------------------------------------
describe("DEFEKT: spalony slot podany odbiorcy jako „zły link”", () => {
  const CODE = "ABCD1234";

  /** Ważny link, ale treść nierenderowalna (pusty wpis / uszkodzone bloki). */
  function unrenderableButValid() {
    return {
      valid: true,
      reason: "ok",
      content_pl: "   ",
      content_en: null,
      builder_data: null,
      blocks_data: [],
    };
  }

  function renderRedeem() {
    const qc = freshClient();
    return renderHook(() => useGiftRedemption(POST, CODE, true), { wrapper: wrapper(qc) });
  }

  it("wyrocznia: taka treść JEST nierenderowalna", async () => {
    // Bez tego kroku test niżej mógłby „przechodzić" na treści, która wcale
    // nie jest pusta. `hasRenderableBody` ma własne testy - tu jest wyrocznią.
    const { hasRenderableBody } = await import("@/lib/access/gating");
    const row = unrenderableButValid();
    expect(
      hasRenderableBody({
        content_pl: row.content_pl,
        content_en: row.content_en,
        builder_data: row.builder_data,
        blocks_data: row.blocks_data,
      }),
    ).toBe(false);
  });

  it.fails(
    "DEFEKT: serwer POTWIERDZIŁ ważność linku (valid:true) i skonsumował slot, " +
      "więc werdykt NIE MOŻE brzmieć `invalid` - odbiorca dostaje komunikat, " +
      "że to on ma zły link, a zapłacił za to slotem nadawcy",
    async () => {
      // Oczekiwanie: przypadek „link był dobry, ale treści nie ma czym
      // wyrenderować" musi być ODRÓŻNIALNY od „kod nieprawidłowy". Dziś oba
      // dają `reason: "invalid"`, więc `giftBannerVariant` pokazuje ten sam
      // baner, a nadawca traci slot bez dostarczenia artykułu.
      db.rpc.setData("redeem_gift_link", [unrenderableButValid()]);
      const { result } = renderRedeem();
      await waitFor(() => expect(result.current.settled).toBe(true));

      expect(result.current.reason).not.toBe("invalid");
    },
  );

  it("STAN FAKTYCZNY: nierenderowalna treść przy `valid:true` daje werdykt `invalid`", async () => {
    // Sprzężony z `it.fails` powyżej - po naprawie usunąć oba.
    db.rpc.setData("redeem_gift_link", [unrenderableButValid()]);
    const { result } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));

    expect(result.current.valid).toBe(false);
    expect(result.current.reason).toBe("invalid");
  });

  it("oba przypadki są dla WERDYKTU nieodróżnialne - dowód zlania", async () => {
    // Serwer mówi „nieprawidłowy kod".
    db.rpc.setData("redeem_gift_link", [
      {
        valid: false,
        reason: "invalid",
        content_pl: null,
        content_en: null,
        builder_data: null,
        blocks_data: null,
      },
    ]);
    const fromServer = renderRedeem();
    await waitFor(() => expect(fromServer.result.current.settled).toBe(true));

    db.rpc.reset();
    // Serwer mówi „ważny", ale treść pusta - slot JUŻ skonsumowany.
    db.rpc.setData("redeem_gift_link", [unrenderableButValid()]);
    const fromBody = renderRedeem();
    await waitFor(() => expect(fromBody.result.current.settled).toBe(true));

    // Para (valid, reason) - jedyne, na czym stoi wybór banera - jest
    // IDENTYCZNA, choć w drugim przypadku nadawca zapłacił slotem.
    expect([fromBody.result.current.valid, fromBody.result.current.reason]).toEqual([
      fromServer.result.current.valid,
      fromServer.result.current.reason,
    ]);
  });

  it("jedyna różnica żyje w `body` - i nikt jej nie czyta jako sygnału", async () => {
    // `body` jest `null` przy odmowie serwera, a `EMPTY_BODY` przy pustej
    // treści. Różnica ISTNIEJE w danych, więc alarm „link zrealizowany, ale
    // artykuł niedostarczony" da się zbudować - to treść zgłoszenia dla
    // człowieka, nie łatka w tym zleceniu.
    db.rpc.setData("redeem_gift_link", [unrenderableButValid()]);
    const { result } = renderRedeem();
    await waitFor(() => expect(result.current.settled).toBe(true));

    expect(result.current.body).not.toBeNull();
    expect(result.current.body).toEqual({
      content_pl: null,
      content_en: null,
      builder_data: null,
      blocks_data: null,
    });
  });
});
