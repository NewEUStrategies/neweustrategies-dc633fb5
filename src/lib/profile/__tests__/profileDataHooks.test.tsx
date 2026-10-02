// Cienkie warstwy danych PROFILU, które stały na ZERZE pokrycia. Każda niesie
// osobną gwarancję, a trzy z nich są gwarancjami PRYWATNOŚCI:
//
//   usePublicExposure  - błąd RPC musi dać `null` („nie wiemy”), NIGDY `false`.
//                        Fałszywe „jesteś prywatny” to dokładnie ten błąd,
//                        którego ten moduł miał się pozbyć.
//   useProfileIntent   - jedno zapytanie na intencję I kompletność, wiersz
//                        przez `get_own_profile()` (miernik liczy `location`,
//                        kolumnę BEZ grantu SELECT - select na `profiles`
//                        dawał 42501), zapis zawężony `.eq("id", uid)`, kody
//                        spoza katalogu odsiane.
//   useHeaderProfile   - JEDEN round-trip na cały nagłówek, nigdy `select("*")`
//                        (tabela `profiles` ma kolumnowe granty i kolumny PII).
//   badges             - klucz cache stabilizowany POSORTOWANĄ listą, bo
//                        kolejność wyników wyszukiwarki nie może unieważniać
//                        odznak dla tego samego zestawu osób.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  exposureRow,
  fail,
  ok,
  okCount,
  profileIntentRow,
  PROFILE_IDS,
  supabaseFromStub,
  type SupabaseResult,
} from "@/test/profile/fixtures";

const h = vi.hoisted(() => ({
  auth: { uid: "user-me" as string | null },
  rpc: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  const from = fixtures.supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      rpc: (fn: string, args?: Record<string, unknown>): Promise<SupabaseResult> => h.rpc(fn, args),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.auth.uid ? { id: h.auth.uid } : null }),
}));

// Warstwa intencji ciągnie leniwy słownik czatu przez `usePublicExposure`;
// w teście warstwy danych nie ma czego tłumaczyć.
vi.mock("@/lib/i18n-chat", () => ({}));

import { fetchBadgesForUsers, useBadgesForUsers, useUserBadges } from "../badges";
import { useHeaderProfile } from "../useHeaderProfile";
import { usePublicExposure } from "../usePublicExposure";
import { useIntentToggle, useProfileIntent, useSaveProfileIntent } from "../useProfileIntent";
import { PROFILE_INTENT_MAX, PROFILE_INTENT_TEXT_MAX } from "../intents";
import { PROFILE_COMPLETENESS_WEIGHTS } from "../completeness";

type FromStub = ReturnType<typeof supabaseFromStub>;
const db = () => stubs.from as FromStub;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/**
 * Zaplanuj odpowiedź `get_own_profile()` (SETOF - wiersz w tablicy). Inne RPC
 * dostają jawną odmowę: niezaplanowane wywołanie ma wywalić test, a nie udawać
 * poprawny odczyt.
 */
function planOwnProfile(result: SupabaseResult): void {
  h.rpc.mockImplementation((fn: string) =>
    Promise.resolve(fn === "get_own_profile" ? result : fail(`test: niezaplanowane RPC ${fn}`)),
  );
}

/** Zaplanuj odpowiedzi wszystkich czterech zapytań `useProfileIntent`. */
function planIntent(
  row: ReturnType<typeof profileIntentRow> | null,
  counts: { skills?: number; experiences?: number; education?: number } = {},
): void {
  planOwnProfile(ok(row ? [row] : []));
  db().setResponse("profile_skills", okCount(counts.skills ?? 0));
  db().setResponse("profile_experiences", okCount(counts.experiences ?? 0));
  db().setResponse("profile_education", okCount(counts.education ?? 0));
}

beforeEach(() => {
  h.auth.uid = PROFILE_IDS.me;
  h.rpc.mockReset();
  db().reset();
});

// ── odznaki ────────────────────────────────────────────────────────────────

describe("fetchBadgesForUsers", () => {
  it("dla pustej listy NIE odpytuje bazy", async () => {
    // Katalog osób woła to dla każdej strony wyników; przy pustej stronie
    // round-trip byłby czystym kosztem.
    const map = await fetchBadgesForUsers([]);
    expect(map.size).toBe(0);
    expect(db().chains).toHaveLength(0);
  });

  it("grupuje odznaki po użytkowniku JEDNYM zapytaniem `in`", async () => {
    db().setResponse(
      "profile_badges",
      ok([
        { user_id: PROFILE_IDS.me, badge: "expert" },
        { user_id: PROFILE_IDS.other, badge: "staff" },
        { user_id: PROFILE_IDS.me, badge: "contributor" },
      ]),
    );

    const map = await fetchBadgesForUsers([PROFILE_IDS.me, PROFILE_IDS.other]);

    // Jedno zapytanie na całą partię - inaczej strona katalogu robi N+1.
    expect(db().chainsFor("profile_badges")).toHaveLength(1);
    expect(db().lastChain("profile_badges")?.argsOf("in")).toEqual([
      "user_id",
      [PROFILE_IDS.me, PROFILE_IDS.other],
    ]);
    expect(map.get(PROFILE_IDS.me)).toEqual(["expert", "contributor"]);
    expect(map.get(PROFILE_IDS.other)).toEqual(["staff"]);
  });

  it("odsiewa odznaki spoza katalogu (dryf danych / ręczny wpis)", async () => {
    db().setResponse(
      "profile_badges",
      ok([
        { user_id: PROFILE_IDS.me, badge: "expert" },
        { user_id: PROFILE_IDS.me, badge: "wymyslona-odznaka" },
      ]),
    );

    const map = await fetchBadgesForUsers([PROFILE_IDS.me]);

    expect(map.get(PROFILE_IDS.me)).toEqual(["expert"]);
  });

  it("normalizuje kolejność - ta sama para odznak daje ten sam wynik", async () => {
    // Kolejność wierszy z PostgREST nie jest gwarantowana, a odznaki są
    // renderowane w rzędzie: bez normalizacji ten sam profil migałby innym
    // porządkiem między odświeżeniami.
    db().setResponse(
      "profile_badges",
      ok([
        { user_id: PROFILE_IDS.me, badge: "staff" },
        { user_id: PROFILE_IDS.me, badge: "expert" },
      ]),
    );
    const first = await fetchBadgesForUsers([PROFILE_IDS.me]);

    db().reset();
    db().setResponse(
      "profile_badges",
      ok([
        { user_id: PROFILE_IDS.me, badge: "expert" },
        { user_id: PROFILE_IDS.me, badge: "staff" },
      ]),
    );
    const second = await fetchBadgesForUsers([PROFILE_IDS.me]);

    expect(first.get(PROFILE_IDS.me)).toEqual(second.get(PROFILE_IDS.me));
    // Kolejność jest KATALOGOWA (expert przed staff), nie taka jak w zwrotce.
    expect(first.get(PROFILE_IDS.me)).toEqual(["expert", "staff"]);
  });

  it("podnosi błąd zamiast zwracać pustą mapę", async () => {
    // Cicha pusta mapa znaczy „ten ekspert nie ma odznak” - a to inna
    // informacja niż „nie udało się sprawdzić”.
    db().setResponse("profile_badges", fail("permission denied"));
    await expect(fetchBadgesForUsers([PROFILE_IDS.me])).rejects.toThrow("permission denied");
  });

  it("użytkownik bez odznak nie dostaje wpisu w mapie", async () => {
    db().setResponse("profile_badges", ok([{ user_id: PROFILE_IDS.me, badge: "expert" }]));
    const map = await fetchBadgesForUsers([PROFILE_IDS.me, PROFILE_IDS.other]);
    expect(map.has(PROFILE_IDS.other)).toBe(false);
  });

  it("znosi `data: null` (odpowiedź bez wierszy)", async () => {
    db().setResponse("profile_badges", ok(null));
    const map = await fetchBadgesForUsers([PROFILE_IDS.me]);
    expect(map.size).toBe(0);
  });
});

describe("useBadgesForUsers", () => {
  it("KOLEJNOŚĆ listy nie unieważnia cache - klucz jest sortowany", async () => {
    // To jest właściwy powód sortowania klucza: wyszukiwarka osób zwraca ten
    // sam zestaw ludzi w innej kolejności przy zmianie sortowania wyników.
    // Bez sortowania każda zmiana kolejności to nowe zapytanie o odznaki.
    db().setResponse("profile_badges", ok([{ user_id: PROFILE_IDS.me, badge: "expert" }]));
    const client = makeClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useBadgesForUsers([PROFILE_IDS.me, PROFILE_IDS.other]), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(db().chainsFor("profile_badges")).toHaveLength(1);

    const second = renderHook(() => useBadgesForUsers([PROFILE_IDS.other, PROFILE_IDS.me]), {
      wrapper,
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(db().chainsFor("profile_badges")).toHaveLength(1);
  });

  it("przy pustej liście jest wyłączony", async () => {
    const { result } = renderHook(() => useBadgesForUsers([]), {
      wrapper: wrapperFor(makeClient()),
    });
    await Promise.resolve();
    expect(result.current.isLoading).toBe(false);
    expect(db().chains).toHaveLength(0);
  });
});

describe("useUserBadges", () => {
  it("zwraca odznaki jednej osoby", async () => {
    db().setResponse("profile_badges", ok([{ user_id: PROFILE_IDS.me, badge: "expert" }]));
    const { result } = renderHook(() => useUserBadges(PROFILE_IDS.me), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(["expert"]);
  });

  it("osoba BEZ odznak dostaje pustą listę, nie `undefined`", async () => {
    // `undefined` w widoku odznak to awaria renderu, `[]` to brak odznak.
    db().setResponse("profile_badges", ok([]));
    const { result } = renderHook(() => useUserBadges(PROFILE_IDS.me), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("bez id użytkownika nie odpytuje bazy", async () => {
    renderHook(() => useUserBadges(undefined), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(db().chains).toHaveLength(0);
  });

  it("RĘCZNE odświeżenie bez id też nie odpytuje bazy - pusta lista, nie `in(undefined)`", async () => {
    // `enabled: false` nie blokuje `refetch()` (React Query v5 wykonuje wtedy
    // queryFn mimo wyłączenia). Bez strażnika w samej funkcji zapytania ręczne
    // odświeżenie bez id wysłałoby do bazy `in("user_id", [undefined])`.
    const { result } = renderHook(() => useUserBadges(undefined), {
      wrapper: wrapperFor(makeClient()),
    });

    const refetched = await result.current.refetch();

    expect(refetched.data).toEqual([]);
    expect(refetched.error).toBeNull();
    expect(db().chains).toHaveLength(0);
  });
});

// ── profil nagłówka ────────────────────────────────────────────────────────

describe("useHeaderProfile", () => {
  it("czyta profil JEDNYM zapytaniem zawężonym do id", async () => {
    db().setResponse(
      "profiles",
      ok({ first_name: "Anna", last_name: "Nowak", display_name: "Anna Nowak", avatar_url: null }),
    );
    const { result } = renderHook(() => useHeaderProfile(PROFILE_IDS.me), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.display_name).toBe("Anna Nowak");
    expect(db().chainsFor("profiles")).toHaveLength(1);
    expect(db().lastChain("profiles")?.argsOf("eq")).toEqual(["id", PROFILE_IDS.me]);
  });

  it("NIGDY nie wybiera `*` - `profiles` ma kolumnowe granty i kolumny PII", async () => {
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useHeaderProfile(PROFILE_IDS.me), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const select = String(db().lastChain("profiles")?.argsOf("select")?.[0] ?? "");
    expect(select).not.toContain("*");
    // Nagłówek potrzebuje dokładnie tych SZEŚCIU kolumn - nic więcej. `job_title`
    // i `current_company` doszły razem z kartą profilu widza na stronie
    // wydarzenia (`useViewerCardFacts`), która czyta ten sam hook, żeby nie
    // stawiać drugiego zapytania o ten sam wiersz. Lista jest tu WYPISANA, a nie
    // policzona z kodu produkcyjnego, i to jest celowe: rozszerzenie selekcji
    // `profiles` ma wymagać świadomej zmiany testu, bo każda dołożona kolumna
    // to decyzja o tym, co wychodzi z tabeli z grantami kolumnowymi i PII.
    expect(select).toBe(
      "first_name, last_name, display_name, avatar_url, job_title, current_company",
    );
  });

  it("brak wiersza daje `null`, nie błąd renderu nagłówka", async () => {
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useHeaderProfile(PROFILE_IDS.me), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("bez zalogowanego użytkownika nie odpytuje bazy", async () => {
    renderHook(() => useHeaderProfile(null), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(db().chains).toHaveLength(0);
  });

  it("dwaj konsumenci nagłówka dzielą JEDEN round-trip", async () => {
    // Po co ten hook istnieje: menu konta i silnik powitań czytały ten sam
    // wiersz osobno, więc po hydratacji leciały dwa identyczne zapytania.
    db().setResponse(
      "profiles",
      ok({ first_name: "Anna", last_name: null, display_name: null, avatar_url: null }),
    );
    const wrapper = wrapperFor(makeClient());

    const menu = renderHook(() => useHeaderProfile(PROFILE_IDS.me), { wrapper });
    const greeting = renderHook(() => useHeaderProfile(PROFILE_IDS.me), { wrapper });

    await waitFor(() => expect(menu.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(greeting.result.current.isSuccess).toBe(true));
    expect(db().chainsFor("profiles")).toHaveLength(1);
  });
});

// ── ekspozycja publiczna ───────────────────────────────────────────────────

describe("usePublicExposure", () => {
  it("czyta RPC BEZ podawania jakiegokolwiek id - izolacja jest po stronie bazy", async () => {
    h.rpc.mockResolvedValue(ok([exposureRow({ is_public: true, by_author_profile: true })]));
    const { result } = renderHook(() => usePublicExposure(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("get_my_public_exposure", undefined);
    // Klient, który podaje id, pozwala zapytać o CUDZĄ ekspozycję.
    expect(h.rpc.mock.calls[0][1]).toBeUndefined();
    expect(result.current.data?.isPublic).toBe(true);
    expect(result.current.data?.byAuthorProfile).toBe(true);
  });

  it("BŁĄD RPC daje `null` („nie wiemy”), a NIE `isPublic: false`", async () => {
    // To jest cała racja bytu tego hooka. Nota prywatności zbudowana na
    // zdegradowanym `false` ogłasza użytkownikowi „jesteś prywatny” na
    // podstawie awarii sieci - i to jest błąd, który ten moduł likwiduje.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });

    const { result } = renderHook(() => usePublicExposure(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("PUSTA odpowiedź (konto bez profilu) degraduje się do stanu zachowawczego", async () => {
    h.rpc.mockResolvedValue(ok([]));
    const { result } = renderHook(() => usePublicExposure(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Brak wiersza to NIE `null` - baza odpowiedziała, po prostu nic nie ma.
    expect(result.current.data?.isPublic).toBe(false);
    expect(result.current.data?.discoverable).toBe(false);
  });

  it("czyta PIERWSZY wiersz zwrotki (RPC zwraca zbiór jednoelementowy)", async () => {
    h.rpc.mockResolvedValue(
      ok([exposureRow({ discoverable: true }), exposureRow({ discoverable: false })]),
    );
    const { result } = renderHook(() => usePublicExposure(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.discoverable).toBe(true);
  });

  it("bez zalogowanego użytkownika nie woła RPC", async () => {
    h.auth.uid = null;
    renderHook(() => usePublicExposure(), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("zwrotka BEZ danych (`data: null`) to stan zachowawczy, nie wyjątek i nie `null`", async () => {
    // Baza odpowiedziała bez błędu, tylko bez zbioru - to jest „nic nie ma”,
    // a nie „nie wiemy”. Degradacja do `null` pokazałaby notę neutralną tam,
    // gdzie odpowiedź jest znana.
    h.rpc.mockResolvedValue(ok(null));
    const { result } = renderHook(() => usePublicExposure(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.isPublic).toBe(false);
    expect(result.current.data?.discoverable).toBe(false);
  });

  it("błąd RPC w środowisku BEZ `console` nadal daje `null`, a nie wyjątek zapytania", async () => {
    // Strażnik `typeof console` jest po to, żeby sam LOG nie zamienił
    // zachowawczego „nie wiemy” w błąd zapytania. Pierwszy przebieg idzie przy
    // konsoli (i ją woła), drugi - ręczne odświeżenie - bez niej.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const client = makeClient();
    const { result } = renderHook(() => usePublicExposure(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    const key = ["profile", "public-exposure", PROFILE_IDS.me];
    // Konsola znika WYŁĄCZNIE na czas samego przebiegu zapytania (same
    // mikrozadania) - powiadomienia Reacta idą później, już przy konsoli.
    vi.stubGlobal("console", undefined);
    try {
      await client.refetchQueries({ queryKey: key });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.rpc).toHaveBeenCalledTimes(2);
    const state = client.getQueryState(key);
    expect(state?.status).toBe("success");
    expect(state?.error).toBeNull();
    expect(state?.dataUpdateCount).toBe(2);
    expect(client.getQueryData(key)).toBeNull();
  });
});

// ── intencja + kompletność ─────────────────────────────────────────────────

describe("useProfileIntent", () => {
  it("JEDNO wywołanie hooka obsługuje intencję I kompletność", async () => {
    planIntent(
      profileIntentRow({ open_to: ["consortium", "advisory"], seeking_pl: "x".repeat(60) }),
      { skills: 3, experiences: 2, education: 1 },
    );
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.openTo).toEqual(["consortium", "advisory"]);
    // Ocena kompletności przyszła z TEGO SAMEGO przebiegu, nie z drugiego hooka.
    expect(result.current.data?.status.fields.openTo).toBe(true);
    expect(result.current.data?.status.fields.skills).toBe(true);
    expect(result.current.data?.status.fields.experience).toBe(true);
    expect(result.current.data?.status.fields.education).toBe(true);
  });

  it("LICZNIKI tabel dzieci wchodzą do oceny - i są liczone, nie ściągane", async () => {
    planIntent(profileIntentRow(), { skills: 2, experiences: 0, education: 0 });
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // 2 umiejętności nie przekraczają progu 3 - punktów nie ma.
    expect(result.current.data?.status.fields.skills).toBe(false);
    // `head: true` znaczy „nie pobieraj wierszy”: zapytanie liczące na tabeli
    // umiejętności ściągnięte w całości to setki wierszy na każde wejście.
    const chain = db().lastChain("profile_skills");
    expect(chain?.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
    expect(chain?.argsOf("eq")).toEqual(["user_id", PROFILE_IDS.me]);
  });

  it("brak licznika w odpowiedzi schodzi na zero, nie na NaN w interfejsie", async () => {
    planOwnProfile(ok([profileIntentRow()]));
    // Odpowiedź bez pola `count` (starszy PostgREST / błąd planu zapytania).
    db().setResponse("profile_skills", ok(null));
    db().setResponse("profile_experiences", ok(null));
    db().setResponse("profile_education", ok(null));

    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status.score).toBe(PROFILE_COMPLETENESS_WEIGHTS.name);
    expect(Number.isNaN(result.current.data?.status.score)).toBe(false);
  });

  it("odsiewa kody intencji spoza katalogu", async () => {
    // Kolumna `open_to` jest tablicą tekstów - stary kod albo ręczny UPDATE
    // może w niej zostawić wartość, której faseta katalogu nie zna.
    planIntent(profileIntentRow({ open_to: ["consortium", "nie-ma-takiego"] }));
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.openTo).toEqual(["consortium"]);
  });

  it("pokazuje OBIE liczby: natychmiastową i tę z rankingu katalogu", async () => {
    // Rozjazd `status.score` (policzone u klienta) i `indexedScore` (kolumna
    // stemplowana triggerem) ma być WIDOCZNY. Zwracanie jednej liczby ukryłoby
    // sytuację, w której katalog rankinguje profil inaczej, niż widzi użytkownik.
    planIntent(profileIntentRow({ completeness_score: 42 }));
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.indexedScore).toBe(42);
    expect(result.current.data?.status.score).toBe(PROFILE_COMPLETENESS_WEIGHTS.name);
  });

  it("brak kolumny rankingowej to zero, nie `null` na wykresie", async () => {
    planIntent(profileIntentRow({ completeness_score: null }));
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.indexedScore).toBe(0);
  });

  it("zamienia NULL-e pól tekstowych na puste napisy (formularz nie znosi null)", async () => {
    planIntent(profileIntentRow({ seeking_pl: null, offering_en: "Doradztwo" }));
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.seekingPl).toBe("");
    expect(result.current.data?.seekingEn).toBe("");
    expect(result.current.data?.offeringPl).toBe("");
    expect(result.current.data?.offeringEn).toBe("Doradztwo");
  });

  it("czyta wiersz przez `get_own_profile()` BEZ argumentów, nie selectem na `profiles`", async () => {
    // Miernik kompletności liczy `location` - kolumnę bez grantu SELECT dla
    // `authenticated`. Select z nią PostgREST odrzuca w CAŁOŚCI (42501),
    // a sekcja intencji na błędzie znika - użytkownik tracił miernik po cichu.
    planIntent(profileIntentRow({ location: "Bruksela" }));
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("get_own_profile", undefined);
    expect(db().chainsFor("profiles")).toHaveLength(0);
    // `location` z RPC naprawdę dochodzi do oceny kompletności.
    expect(result.current.data?.status.fields.location).toBe(true);
  });

  it("błąd odczytu profilu podnosi się do wołającego", async () => {
    planOwnProfile(fail("permission denied"));
    db().setResponse("profile_skills", okCount(0));
    db().setResponse("profile_experiences", okCount(0));
    db().setResponse("profile_education", okCount(0));

    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied");
  });

  it("BRAK wiersza profilu to błąd, nie pusty formularz", async () => {
    // Pusty formularz zapisany na koncie bez wiersza wyczyściłby dane, gdyby
    // wiersz pojawił się w międzyczasie.
    planIntent(null);
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Profile row not found");
  });

  it("bez zalogowanego użytkownika nie odpytuje bazy", async () => {
    h.auth.uid = null;
    renderHook(() => useProfileIntent(), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(db().chains).toHaveLength(0);
  });

  it("RĘCZNE odświeżenie po wylogowaniu to jawny błąd, nie zapytanie bez `id`", async () => {
    // `refetch()` omija `enabled: false`. Bez strażnika w funkcji zapytania
    // cztery zapytania poleciałyby z `undefined` w filtrze właściciela, zamiast
    // zatrzymać się na braku sesji z czytelnym powodem.
    h.auth.uid = null;
    const { result } = renderHook(() => useProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    const refetched = await result.current.refetch();

    expect(refetched.isError).toBe(true);
    expect(refetched.error?.message).toBe("Not authenticated");
    expect(db().chains).toHaveLength(0);
  });
});

describe("useSaveProfileIntent", () => {
  const draft = {
    openTo: ["consortium" as const],
    seekingPl: "Szukam partnerów",
    seekingEn: "",
    offeringPl: "",
    offeringEn: "",
  };

  it("zapis jest ZAWĘŻONY do własnego wiersza", async () => {
    // Grant UPDATE na `profiles` ma rolę `authenticated`, nie właściciela -
    // brak `.eq("id", uid)` to zapis na cudzym profilu.
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useSaveProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await result.current.mutateAsync(draft);

    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("eq")).toEqual(["id", PROFILE_IDS.me]);
    expect(chain?.has("update")).toBe(true);
  });

  it("PUSTE pole zapisuje się jako NULL, nie jako pusty napis", async () => {
    // Kolumna ma rozróżniać „nie podano” od „podano nic”; pusty napis
    // przechodzi do wyszukiwarki jako treść.
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useSaveProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await result.current.mutateAsync(draft);

    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch.seeking_en).toBeNull();
    expect(patch.offering_pl).toBeNull();
    expect(patch.seeking_pl).toBe("Szukam partnerów");
  });

  it("pole z samych spacji też schodzi na NULL", async () => {
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useSaveProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await result.current.mutateAsync({ ...draft, seekingPl: "   \n  " });

    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch.seeking_pl).toBeNull();
  });

  it("przycina tekst do sufitu z CHECK-a bazy", async () => {
    // Bez przycięcia u klienta zapis wraca błędem CHECK-a, a użytkownik traci
    // wpisany tekst - przycięcie jest tu formą zachowania danych.
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useSaveProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await result.current.mutateAsync({
      ...draft,
      seekingPl: "x".repeat(PROFILE_INTENT_TEXT_MAX + 50),
    });

    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(String(patch.seeking_pl)).toHaveLength(PROFILE_INTENT_TEXT_MAX);
  });

  it("normalizuje kody intencji także przy ZAPISIE", async () => {
    db().setResponse("profiles", ok(null));
    const { result } = renderHook(() => useSaveProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await result.current.mutateAsync({
      ...draft,
      openTo: ["advisory", "consortium", "advisory"] as never,
    });

    const patch = db().lastChain("profiles")?.argsOf("update")?.[0] as Record<string, unknown>;
    // Odduplikowane i w kolejności katalogu, nie w kolejności klikania.
    expect(patch.open_to).toEqual(["consortium", "advisory"]);
  });

  it("po zapisie unieważnia intencję, edytor profilu I katalog osób", async () => {
    // `open_to` jest fasetą katalogu, a `seeking_*` wchodzi do wyszukiwania -
    // stare listy wyników są po zapisie nieprawdziwe.
    db().setResponse("profiles", ok(null));
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveProfileIntent(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync(draft);

    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["profile-intent", PROFILE_IDS.me]));
    expect(keys).toContain(JSON.stringify(["profile-editor", PROFILE_IDS.me]));
    expect(keys).toContain(JSON.stringify(["people"]));
  });

  it("błąd zapisu podnosi się do wołającego (formularz musi zostać otwarty)", async () => {
    db().setResponse("profiles", fail("check constraint violated"));
    const { result } = renderHook(() => useSaveProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await expect(result.current.mutateAsync(draft)).rejects.toThrow("check constraint violated");
  });

  it("bez zalogowanego użytkownika nie pisze do bazy", async () => {
    h.auth.uid = null;
    const { result } = renderHook(() => useSaveProfileIntent(), {
      wrapper: wrapperFor(makeClient()),
    });

    await expect(result.current.mutateAsync(draft)).rejects.toThrow("Not authenticated");
    expect(db().chains).toHaveLength(0);
  });
});

describe("useIntentToggle", () => {
  it("dokłada kod i utrzymuje kolejność KATALOGU, nie klikania", () => {
    const { result } = renderHook(() => useIntentToggle(["advisory"], PROFILE_INTENT_MAX));
    // `consortium` jest w katalogu przed `advisory`, choć kliknięte później.
    expect(result.current("consortium")).toEqual({
      next: ["consortium", "advisory"],
      rejected: false,
    });
  });

  it("drugie kliknięcie ZDEJMUJE kod", () => {
    const { result } = renderHook(() =>
      useIntentToggle(["consortium", "advisory"], PROFILE_INTENT_MAX),
    );
    expect(result.current("consortium")).toEqual({ next: ["advisory"], rejected: false });
  });

  it("po przekroczeniu sufitu ODMAWIA JAWNIE, nie po cichu", () => {
    // „Cicho nie dodaj” zostawia użytkownika z wrażeniem zepsutego przycisku.
    // Sygnał `rejected` pozwala interfejsowi powiedzieć, o co chodzi.
    const full = ["consortium", "partnership", "advisory"] as const;
    const { result } = renderHook(() => useIntentToggle(full, 3));

    const out = result.current("speaking");

    expect(out.rejected).toBe(true);
    expect(out.next).toEqual([...full]);
  });

  it("zdjęcie kodu na PEŁNEJ liście nie jest odmową", () => {
    const full = ["consortium", "partnership", "advisory"] as const;
    const { result } = renderHook(() => useIntentToggle(full, 3));
    expect(result.current("advisory")).toEqual({
      next: ["consortium", "partnership"],
      rejected: false,
    });
  });

  it("zwraca NOWĄ tablicę - nie mutuje wejścia", () => {
    // Mutacja wejścia rozjechałaby stan formularza z cache'em React Query.
    const codes = ["consortium" as const];
    const { result } = renderHook(() => useIntentToggle(codes, PROFILE_INTENT_MAX));
    result.current("advisory");
    expect(codes).toEqual(["consortium"]);
  });
});
