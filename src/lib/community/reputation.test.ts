// PROGI REPUTACJI, ROZBICIE PUNKTÓW I HOOKI TABLICY KONTRYBUTORÓW.
//
// DLACZEGO TEN PLIK ISTNIEJE. Poziom reputacji nie ma widocznego stanu błędu:
// przesunięty próg po prostu NADAJE albo ODBIERA poziom i nikt tego nie
// zgłosi - użytkownik zobaczy „Uczestnik" zamiast „Głos społeczności" i uzna,
// że tak miało być. To awaria cicha w czystej postaci, więc jedyną obroną jest
// tabela przypadków przy KAŻDEJ granicy: dokładnie na progu, o jeden punkt
// poniżej i o jeden powyżej, plus wejścia, których baza nie powinna oddać
// (ujemne, ułamkowe, NaN, nieskończoności).
//
// TABELA JEST WYPROWADZONA Z KATALOGU, NIE PRZEPISANA. Przypadki graniczne
// iterują po `REPUTATION_LEVELS`, a nie po ręcznie wpisanej liście pięciu
// liczb. Dopisanie szóstego poziomu albo zmiana progu istniejącego
// NATYCHMIAST rozszerza zbiór asercji, zamiast przemknąć obok testu, który
// nadal sprawdza stare pięć wartości i świeci na zielono.
//
// CO JEST ATRAPOWANE I DLACZEGO.
//   * `supabase.rpc` - jedyne wyjście na sieć. Atrapa zapisuje NAZWĘ funkcji
//     i ARGUMENTY, bo połowa kontraktu warstwy danych to to, co poszło DO
//     bazy (`p_days`, `p_limit`), a nie tylko to, co wróciło.
//   * NIC WIĘCEJ. `@tanstack/react-query` jest prawdziwy: przedmiotem dowodu
//     są klucze zapytań i flaga `enabled`, więc atrapa react-query skasowałaby
//     dokładnie to, co ma zostać udowodnione.
//
// GRANICA DOWODU. Ten plik NIE dowodzi niczego o samym RPC: wagi punktów,
// opt-in katalogu (`discoverable`), wykluczenie kont redakcyjnych i odmowa dla
// anonima są własnością bazy i mają test pgTAP
// (`supabase/tests/community_reputation_test.sql`). Tutaj dowodzimy warstwy
// klienckiej: przepisania kolumn, zawężenia typu `Json` i tego, o co klient
// NIE pyta, gdy nie ma zalogowanego użytkownika.
//
// `parseBreakdown` jest funkcją modułową (nieeksportowaną) i celowo dosięgamy
// jej przez `fetchMyReputation` / `fetchContributorLeaderboard` - przedmiotem
// dowodu jest kształt, jaki dostaje interfejs, a nie prywatny szczegół modułu.
//
// ŚWIADOMA LUKA W POKRYCIU: gałąź `span <= 0` w `progressToNextLevel` jest
// nieosiągalna, dopóki progi są ściśle rosnące - a tego pilnuje osobny test
// katalogu. Zostaje martwa, zamiast mutować eksportowaną stałą w teście.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, type SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  /** Kolejne wywołania RPC: nazwa funkcji + argumenty, w kolejności. */
  calls: [] as { fn: string; args: unknown }[],
  /** Odpowiedź per nazwa RPC; brak wpisu = `{ data: null, error: null }`. */
  results: new Map<string, SupabaseResult>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      h.calls.push({ fn, args });
      return Promise.resolve(h.results.get(fn) ?? { data: null, error: null });
    },
  },
}));

import {
  REPUTATION_LEVELS,
  fetchContributorLeaderboard,
  fetchMyReputation,
  levelForPoints,
  levelName,
  nextLevelFor,
  progressToNextLevel,
  useContributorLeaderboard,
  useMyReputation,
  type ReputationLevel,
} from "./reputation";

function setRpc(fn: string, result: SupabaseResult): void {
  h.results.set(fn, result);
}

function argsOf(fn: string): Record<string, unknown> {
  const call = h.calls.find((entry) => entry.fn === fn);
  if (!call || typeof call.args !== "object" || call.args === null) {
    throw new Error(`Brak wywołania RPC ${fn} z argumentami`);
  }
  return { ...call.args } as Record<string, unknown>;
}

beforeEach(() => {
  h.calls.length = 0;
  h.results.clear();
});

/**
 * Przypadki graniczne WYPROWADZONE z katalogu: każdy poziom razem ze swoim
 * poprzednikiem (poziom bazowy jest własnym poprzednikiem, bo pod nim nie ma
 * już nic) i następnikiem. Zmiana katalogu zmienia tabelę testów.
 */
const BOUNDARIES: {
  level: ReputationLevel;
  previous: ReputationLevel;
  next: ReputationLevel | null;
}[] = REPUTATION_LEVELS.map((level, index) => ({
  level,
  previous: index === 0 ? REPUTATION_LEVELS[0] : REPUTATION_LEVELS[index - 1],
  next: REPUTATION_LEVELS[index + 1] ?? null,
}));

describe("katalog poziomów - niezmienniki, na których stoi cała reszta", () => {
  it("progi rosną ŚCIŚLE i zaczynają się od zera", () => {
    // Monotoniczność nie jest kosmetyką: `levelForPoints` bierze OSTATNI
    // osiągnięty wpis, więc katalog nieuporządkowany cicho przyznałby poziom
    // niższy niż zasłużony. Ten test jest też strażnikiem martwej gałęzi
    // `span <= 0` w `progressToNextLevel`.
    expect(REPUTATION_LEVELS[0].min).toBe(0);
    for (let i = 1; i < REPUTATION_LEVELS.length; i++) {
      expect(REPUTATION_LEVELS[i].min).toBeGreaterThan(REPUTATION_LEVELS[i - 1].min);
    }
  });

  it("każdy wpis ma nazwę PL i EN oraz unikalny klucz", () => {
    for (const level of REPUTATION_LEVELS) {
      expect(level.pl.length).toBeGreaterThan(0);
      expect(level.en.length).toBeGreaterThan(0);
    }
    const keys = REPUTATION_LEVELS.map((level) => level.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("każdy wpis katalogu odzyskuje SAM SIEBIE: levelForPoints(min).key === key", () => {
    // Dowód wyprowadzony z katalogu - szósty poziom dopisany bez obsługi
    // oblałby ten test, zamiast przejść niezauważony.
    for (const level of REPUTATION_LEVELS) {
      expect(levelForPoints(level.min).key).toBe(level.key);
    }
  });
});

describe("levelForPoints - poziom zmienia się DOKŁADNIE na progu", () => {
  it.each(BOUNDARIES)(
    "$level.key: próg $level.min, punkt niżej to $previous.key",
    ({ level, previous }) => {
      expect(levelForPoints(level.min).key).toBe(level.key);
      expect(levelForPoints(level.min + 1).key).toBe(level.key);
      // Punkt poniżej progu należy jeszcze do poprzednika (dla poziomu
      // bazowego: -1 przycięte do 0, czyli nadal poziom bazowy).
      expect(levelForPoints(level.min - 1).key).toBe(previous.key);
    },
  );

  it.each(BOUNDARIES)("$level.key: ułamek nie awansuje przed progiem", ({ level, previous }) => {
    // Punkty z RPC są całkowite, ale `progressToNextLevel` i przyszłe wagi
    // ułamkowe nie mogą zaokrąglić użytkownika W GÓRĘ do poziomu, którego nie
    // osiągnął - to jest przyznanie odznaki za nic.
    expect(levelForPoints(level.min - 0.01).key).toBe(previous.key);
    expect(levelForPoints(level.min + 0.5).key).toBe(level.key);
  });

  it("zero punktów to poziom bazowy", () => {
    expect(levelForPoints(0).key).toBe("observer");
    expect(levelForPoints(-0).key).toBe("observer");
  });

  it.each<[string, number]>([
    ["NaN", Number.NaN],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["ujemne całkowite", -10],
    ["ujemne ułamkowe", -0.5],
  ])("wejście %s spada na poziom bazowy, nie wybucha", (_label, points) => {
    expect(levelForPoints(points).key).toBe("observer");
  });

  it("Infinity też spada na poziom BAZOWY - awaria idzie w stronę bezpieczną", () => {
    // Kolumna `points` z RPC jest liczbą całkowitą, więc `Infinity` może
    // przyjść wyłącznie z błędu po stronie klienta. Wtedy lepiej pokazać
    // poziom najniższy (nic nie przyznajemy) niż najwyższy (odznaka za nic).
    expect(levelForPoints(Number.POSITIVE_INFINITY).key).toBe("observer");
    expect(nextLevelFor(Number.POSITIVE_INFINITY)?.key).toBe("participant");
  });

  it("punkty daleko ponad ostatnim progiem zostają na szczycie", () => {
    const top = REPUTATION_LEVELS[REPUTATION_LEVELS.length - 1];
    expect(levelForPoints(top.min * 1000).key).toBe(top.key);
  });
});

describe("nextLevelFor - dokąd jeszcze można awansować", () => {
  it.each(BOUNDARIES)("$level.key wskazuje na następny wpis katalogu", ({ level, next }) => {
    expect(nextLevelFor(level.min)?.key ?? null).toBe(next?.key ?? null);
  });

  it("na najwyższym poziomie nie ma dokąd iść", () => {
    const top = REPUTATION_LEVELS[REPUTATION_LEVELS.length - 1];
    expect(nextLevelFor(top.min)).toBeNull();
    expect(nextLevelFor(top.min + 1)).toBeNull();
  });

  it("wejście niepoprawne pyta o pierwszy próg, tak jak zero punktów", () => {
    expect(nextLevelFor(Number.NaN)?.key).toBe("participant");
    expect(nextLevelFor(-99)?.key).toBe("participant");
    expect(nextLevelFor(0)?.key).toBe("participant");
  });
});

describe("progressToNextLevel - pasek postępu nie kłamie", () => {
  it.each(BOUNDARIES)("$level.key: dół przedziału to 0 (albo 1 na szczycie)", ({ level, next }) => {
    expect(progressToNextLevel(level.min)).toBe(next ? 0 : 1);
  });

  it.each(BOUNDARIES.filter((row) => row.next !== null))(
    "$level.key: tuż pod następnym progiem pasek jest BLISKO 1, ale go nie dotyka",
    ({ next }) => {
      // Pasek dobity do 1 przed awansem to obietnica, której poziom nie
      // dotrzyma - użytkownik widzi „pełno" i nadal stary tytuł.
      const value = progressToNextLevel(next!.min - 1);
      expect(value).toBeGreaterThan(0.9);
      expect(value).toBeLessThan(1);
    },
  );

  it.each(BOUNDARIES.filter((row) => row.next !== null))(
    "$level.key: środek przedziału wypada w połowie paska",
    ({ level, next }) => {
      const middle = (level.min + next!.min) / 2;
      expect(progressToNextLevel(middle)).toBeCloseTo(0.5, 5);
    },
  );

  it("wynik nigdy nie wychodzi poza [0,1] - także dla wejść niepoprawnych", () => {
    const samples = [
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      -1000,
      -0.5,
      0,
      0.5,
      49.9,
      50,
      1_000_000,
    ];
    for (const points of samples) {
      const value = progressToNextLevel(points);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("na najwyższym poziomie pasek stoi na 1", () => {
    expect(progressToNextLevel(1000)).toBe(1);
    expect(progressToNextLevel(999999)).toBe(1);
  });
});

describe("levelName - język bez atrapy tłumacza", () => {
  it.each(REPUTATION_LEVELS)("$key ma osobną nazwę PL i EN", (level) => {
    expect(levelName(level, "pl")).toBe(level.pl);
    expect(levelName(level, "en")).toBe(level.en);
  });

  it.each(["", "de", "EN", "en-GB", "pl-PL"])(
    "język %s (nieobsługiwany dosłownie) spada na polski",
    (lang) => {
      // Kontrakt jest celowo dosłowny: chip normalizuje `en-GB` DO „en" po
      // swojej stronie, więc tutaj wszystko poza „en" to polszczyzna.
      expect(levelName(REPUTATION_LEVELS[0], lang)).toBe(REPUTATION_LEVELS[0].pl);
    },
  );
});

// ---------------------------------------------------------------------------
// Warstwa danych: co idzie do RPC i co klient robi z tym, co wróciło.
// ---------------------------------------------------------------------------

interface RawLeaderboardRow {
  board_position: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  slug: string | null;
  points: number;
  breakdown: unknown;
}

function rawRow(over: Partial<RawLeaderboardRow> = {}): RawLeaderboardRow {
  return {
    board_position: 1,
    user_id: "11111111-1111-4111-8111-111111111111",
    display_name: "Uczestniczka Testowa",
    avatar_url: null,
    slug: "uczestniczka-testowa",
    points: 120,
    breakdown: { comments: { count: 4, points: 8 } },
    ...over,
  };
}

describe("fetchContributorLeaderboard - przepisanie kolumn i argumenty RPC", () => {
  it("przepisuje board_position na position i NIE zostawia surowej kolumny", async () => {
    // `position` jest słowem zarezerwowanym w `RETURNS TABLE`, więc RPC oddaje
    // `board_position`. Rozjechanie tego mapowania daje tablicę kontrybutorów
    // z pustą kolumną miejsca - bez błędu, bez pustego stanu, po prostu nic.
    setRpc("get_contributor_leaderboard", ok([rawRow({ board_position: 3 })]));

    const [entry] = await fetchContributorLeaderboard(90);

    expect(entry.position).toBe(3);
    expect(Object.keys(entry)).not.toContain("board_position");
  });

  it("przenosi pozostałe kolumny bez zmiany i parsuje breakdown", async () => {
    setRpc(
      "get_contributor_leaderboard",
      ok([
        rawRow({
          board_position: 2,
          avatar_url: "https://example.com/a.png",
          points: 240,
          breakdown: { qa_answered: { count: 3, points: 30 } },
        }),
      ]),
    );

    const [entry] = await fetchContributorLeaderboard(30, 5);

    expect(entry).toEqual({
      position: 2,
      user_id: "11111111-1111-4111-8111-111111111111",
      display_name: "Uczestniczka Testowa",
      avatar_url: "https://example.com/a.png",
      slug: "uczestniczka-testowa",
      points: 240,
      breakdown: { qa_answered: { count: 3, points: 30 } },
    });
  });

  it("domyślny limit to 20, a okno idzie z argumentu", async () => {
    setRpc("get_contributor_leaderboard", ok([]));

    await fetchContributorLeaderboard(365);

    expect(h.calls[0].fn).toBe("get_contributor_leaderboard");
    expect(argsOf("get_contributor_leaderboard")).toEqual({ p_days: 365, p_limit: 20 });
  });

  it("jawny limit wygrywa z domyślnym", async () => {
    setRpc("get_contributor_leaderboard", ok([]));

    await fetchContributorLeaderboard(7, 3);

    expect(argsOf("get_contributor_leaderboard")).toEqual({ p_days: 7, p_limit: 3 });
  });

  it("brak danych (null) to pusta tablica, a nie wybuch na .map", async () => {
    setRpc("get_contributor_leaderboard", { data: null, error: null });

    await expect(fetchContributorLeaderboard(90)).resolves.toEqual([]);
  });

  it("błąd RPC LECI DALEJ - pusta tablica udawałaby brak kontrybutorów", async () => {
    setRpc("get_contributor_leaderboard", fail("permission denied for function", "42501"));

    await expect(fetchContributorLeaderboard(90)).rejects.toThrow("permission denied for function");
  });
});

describe("fetchMyReputation - zawężenie Json do rekordu", () => {
  it("czyta pełną odpowiedź 1:1", async () => {
    setRpc(
      "get_my_reputation",
      ok({
        points: 190,
        breakdown: { poll_votes: { count: 2, points: 2 } },
        window_days: 30,
        board_visible: true,
        position: 4,
      }),
    );

    await expect(fetchMyReputation(90)).resolves.toEqual({
      points: 190,
      breakdown: { poll_votes: { count: 2, points: 2 } },
      window_days: 30,
      board_visible: true,
      position: 4,
    });
    expect(argsOf("get_my_reputation")).toEqual({ p_days: 90 });
  });

  it.each([
    ["null", null],
    ["tablica", [{ points: 999 }]],
    ["liczba", 7],
    ["napis", "brak"],
    ["boolean", true],
  ])("odpowiedź %s (nie-rekord) daje wartości domyślne, nie wyjątek", async (_label, data) => {
    setRpc("get_my_reputation", { data, error: null });

    await expect(fetchMyReputation(365)).resolves.toEqual({
      points: 0,
      breakdown: {},
      window_days: 365,
      board_visible: false,
      position: null,
    });
  });

  it("window_days spada na argument days, gdy baza go nie poda", async () => {
    // Podpis okna („90 dni") jest rysowany z tej liczby - brak wartości nie
    // może dać „NaN dni" ani okna innego niż wybrane przez użytkownika.
    setRpc("get_my_reputation", ok({ points: 10, window_days: "30" }));

    await expect(fetchMyReputation(90)).resolves.toMatchObject({ window_days: 90, points: 10 });
  });

  it.each([
    ['napis "true"', "true"],
    ["jedynka", 1],
    ["brak pola", undefined],
    ["null", null],
  ])("board_visible = %s to NIE jest zgoda na tablicę", async (_label, board_visible) => {
    // Widoczność w katalogu to zgoda (opt-in). Wartość „prawdziwa" w sensie
    // JS, ale nie dosłowne `true`, nie może włączyć czyjejś obecności
    // w publicznej tablicy kontrybutorów.
    setRpc("get_my_reputation", ok({ board_visible }));

    await expect(fetchMyReputation(90)).resolves.toMatchObject({ board_visible: false });
  });

  it("board_visible === true przechodzi", async () => {
    setRpc("get_my_reputation", ok({ board_visible: true }));

    await expect(fetchMyReputation(90)).resolves.toMatchObject({ board_visible: true });
  });

  it.each([
    ["napis", "4"],
    ["null", null],
    ["brak pola", undefined],
  ])("position typu %s to brak pozycji (null), a nie fałszywe miejsce", async (_l, position) => {
    setRpc("get_my_reputation", ok({ position }));

    await expect(fetchMyReputation(90)).resolves.toMatchObject({ position: null });
  });

  it("position liczbowe (także 0) przechodzi", async () => {
    setRpc("get_my_reputation", ok({ position: 0 }));

    await expect(fetchMyReputation(90)).resolves.toMatchObject({ position: 0 });
  });

  it("błąd RPC LECI DALEJ", async () => {
    setRpc("get_my_reputation", fail("not authenticated", "P0001"));

    await expect(fetchMyReputation(90)).rejects.toThrow("not authenticated");
  });
});

describe("parseBreakdown (przez fetchMyReputation) - rozbicie punktów", () => {
  async function breakdownOf(raw: unknown): Promise<Record<string, unknown>> {
    setRpc("get_my_reputation", ok({ points: 1, breakdown: raw }));
    const mine = await fetchMyReputation(90);
    return mine.breakdown;
  }

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["tablica", [{ comments: { count: 1, points: 1 } }]],
    ["liczba", 42],
    ["napis", "comments"],
    ["boolean", false],
  ])("rozbicie %s (nie-rekord) daje pusty obiekt", async (_label, raw) => {
    await expect(breakdownOf(raw)).resolves.toEqual({});
  });

  it.each([
    ["null", null],
    ["liczba", 5],
    ["napis", "10"],
    ["tablica", [1, 2]],
  ])("wpis %s (nie-obiekt) jest POMIJANY, nie zamieniany na zera", async (_label, entry) => {
    // Różnica jest widoczna: chip rozbicia rysuje się dla każdego KLUCZA,
    // więc wpis zamieniony na `{count:0, points:0}` dołożyłby pusty chip.
    const out = await breakdownOf({ comments: { count: 2, points: 4 }, qa_votes_received: entry });

    expect(out).toEqual({ comments: { count: 2, points: 4 } });
  });

  it("count i points złego typu schodzą do zera zamiast wyciec do interfejsu", async () => {
    // „+null punktów" albo „+undefined" na chipie to widoczna usterka, a te
    // wartości potrafią przyjść z jsonb zbudowanego przez migrację.
    const out = await breakdownOf({
      comments: { count: "4", points: null },
      events_attended: { count: undefined, points: "12" },
      badge_expert: {},
    });

    expect(out).toEqual({
      comments: { count: 0, points: 0 },
      events_attended: { count: 0, points: 0 },
      badge_expert: { count: 0, points: 0 },
    });
  });

  it("liczby ujemne i ułamkowe przechodzą bez zmiany - to nadal liczby", async () => {
    const out = await breakdownOf({ comments: { count: 1.5, points: -3 } });

    expect(out).toEqual({ comments: { count: 1.5, points: -3 } });
  });

  it.fails("DEFEKT: klucz spoza katalogu źródeł nie powinien trafić do wyniku", async () => {
    // KONSEKWENCJA: `ReputationBreakdown` deklaruje wyłącznie klucze
    // `ReputationSourceKey`, a `parseBreakdown` przepuszcza KAŻDY klucz z
    // jsonb. Konsument (`BreakdownChips` w `routes/contributors.tsx`) robi
    // `t("community.reputation.sources." + key)`, więc nowe źródło dodane
    // w migracji przed dodaniem tłumaczenia rysuje użytkownikowi surowy klucz
    // i18n na chipie. Typ mówi jedno, runtime robi drugie.
    const out = await breakdownOf({
      comments: { count: 2, points: 4 },
      mystery_source_from_migration: { count: 9, points: 99 },
    });

    expect(Object.keys(out)).toEqual(["comments"]);
  });

  it("kontrola dodatnia: to samo wejście BEZ intruza przechodzi", async () => {
    // Dowód, że asercja wyżej mierzy filtrowanie kluczy, a nie zepsuty
    // harness - naprawa `parseBreakdown` zgasi `it.fails`, a ten test zostanie
    // zielony.
    const out = await breakdownOf({ comments: { count: 2, points: 4 } });

    expect(Object.keys(out)).toEqual(["comments"]);
  });

  it("rozbicie z RPC tablicy kontrybutorów przechodzi przez ten sam parser", async () => {
    setRpc("get_contributor_leaderboard", ok([rawRow({ breakdown: { comments: "nie-obiekt" } })]));

    const [entry] = await fetchContributorLeaderboard(90);

    expect(entry.breakdown).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Hooki: klucz cache, warunek zapytania i świeżość.
// ---------------------------------------------------------------------------

describe("useContributorLeaderboard - klucz, argumenty i świeżość", () => {
  it("pyta RPC z domyślnym limitem i zapisuje wynik pod kluczem z parametrami", async () => {
    setRpc("get_contributor_leaderboard", ok([rawRow({ board_position: 1 })]));

    const { result, queryClient } = renderHookWithQueryClient(() => useContributorLeaderboard(90));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(argsOf("get_contributor_leaderboard")).toEqual({ p_days: 90, p_limit: 20 });
    expect(queryClient.getQueryData(["contributor-leaderboard", 90, 20])).toEqual(
      result.current.data,
    );
  });

  it("okno i limit są CZĘŚCIĄ klucza - zmiana filtra nie pokazuje cudzych danych", async () => {
    // Przełącznik okna (30/90/365 dni) i limit trafiają do klucza; gdyby ich
    // tam nie było, zmiana filtra rysowałaby poprzedni wynik jako świeży.
    setRpc("get_contributor_leaderboard", ok([rawRow()]));

    const { result, queryClient } = renderHookWithQueryClient(() =>
      useContributorLeaderboard(30, 5),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["contributor-leaderboard", 30, 5])).toBeDefined();
    expect(queryClient.getQueryData(["contributor-leaderboard", 90, 20])).toBeUndefined();
  });

  it("enabled=false NIE strzela do bazy", async () => {
    setRpc("get_contributor_leaderboard", ok([rawRow()]));

    const { result } = renderHookWithQueryClient(() => useContributorLeaderboard(90, 20, false));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(h.calls).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });

  it("trzyma wynik świeży przez minutę", async () => {
    setRpc("get_contributor_leaderboard", ok([rawRow()]));

    const { result, queryClient } = renderHookWithQueryClient(() => useContributorLeaderboard(90));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient
      .getQueryCache()
      .find({ queryKey: ["contributor-leaderboard", 90, 20] });
    expect(query?.options.staleTime).toBe(60_000);
  });

  it("błąd RPC dociera do konsumenta jako stan błędu", async () => {
    setRpc("get_contributor_leaderboard", fail("boom"));

    const { result } = renderHookWithQueryClient(() => useContributorLeaderboard(90));
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useMyReputation - anonim nie pyta o cudzy wynik", () => {
  const USER = "22222222-2222-4222-8222-222222222222";

  it("z userId pyta RPC i zapisuje wynik pod kluczem z tym userId", async () => {
    setRpc("get_my_reputation", ok({ points: 42, window_days: 90 }));

    const { result, queryClient } = renderHookWithQueryClient(() => useMyReputation(90, USER));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(argsOf("get_my_reputation")).toEqual({ p_days: 90 });
    expect(queryClient.getQueryData(["my-reputation", 90, USER])).toMatchObject({ points: 42 });
  });

  it("BEZ userId nie ma żadnego wywołania RPC", async () => {
    // To jest ochrona, a nie optymalizacja: `get_my_reputation` czyta wynik
    // Z SESJI, więc zapytanie puszczone dla anonima albo poleci wyjątkiem
    // z bazy, albo - po zalogowaniu w innej karcie - dopisze do cache wynik
    // przypisany do klucza „anon".
    setRpc("get_my_reputation", ok({ points: 42 }));

    const { result } = renderHookWithQueryClient(() => useMyReputation(90, undefined));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(h.calls).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });

  it('klucz anonima to jawne "anon", a nie undefined w kluczu', async () => {
    const { queryClient } = renderHookWithQueryClient(() => useMyReputation(90, undefined));

    expect(
      queryClient.getQueryCache().find({ queryKey: ["my-reputation", 90, "anon"] }),
    ).toBeDefined();
  });

  it("userId jest częścią klucza - dwa konta nie dzielą wyniku", async () => {
    setRpc("get_my_reputation", ok({ points: 42 }));

    const { result, queryClient } = renderHookWithQueryClient(() => useMyReputation(90, USER));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      queryClient.getQueryData(["my-reputation", 90, "33333333-3333-4333-8333-333333333333"]),
    ).toBeUndefined();
  });

  it("trzyma wynik świeży przez minutę", async () => {
    setRpc("get_my_reputation", ok({ points: 42 }));

    const { result, queryClient } = renderHookWithQueryClient(() => useMyReputation(90, USER));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({ queryKey: ["my-reputation", 90, USER] });
    expect(query?.options.staleTime).toBe(60_000);
  });
});
