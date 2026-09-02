// Katalog osób - `shouldEmbedPeopleQuery`, `usePeopleQueryEmbedding`,
// `usePeopleDirectory`, `usePeopleFacets`. Stan wyjściowy: 0/9 funkcji.
//
// CO TU JEST STAWKĄ. Katalog jest jedyną powierzchnią czatu, która wysyła
// frazę użytkownika do BRAMKI AI - i robi to warunkowo. Próg („czy w ogóle
// pytać o wektor") żył w niepokrytej funkcji, więc nic nie pilnowało, żeby
// dwuznakowa fraza albo pusty string nie kosztowały wywołania bramki przy
// każdym naciśnięciu klawisza. Drugą stawką jest kontrakt argumentów
// `search_people`: zgubiona nazwa argumentu to utracone zawężenie, które
// przechodzi przez `tsc` i przez przegląd.
//
// IZOLACJA TENANTA. Zakres wyników liczy SERWER (`search_people` jest
// SECURITY DEFINER i skaluje po tenancie z `auth.uid()`), więc dowód po
// stronie klienta brzmi: hook NIE wysyła żadnego argumentu tenanta ani
// identyfikatora użytkownika (nie ma czego podrobić), a klucz cache'u jest
// per konto, więc przełączenie konta nie pokazuje cudzych wyników.
//
// RODO: profile w atrapach są zmyślone, adresy wyłącznie w `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, supabaseRpcStub } from "@/test/chat/fixtures";
import { PEOPLE_SEMANTIC_MIN_CHARS } from "@/lib/search/peopleSemantic.functions";

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  rpc: null as unknown,
  embedCalls: [] as string[],
  embedding: null as number[] | null,
  embedFails: false,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null }),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const rpc = fixtures.supabaseRpcStub();
  h.rpc = rpc;
  return { supabase: { rpc: rpc.rpc, from: () => ({}) } };
});

// Częściowa atrapa: próg `PEOPLE_SEMANTIC_MIN_CHARS` zostaje PRAWDZIWY (to on
// jest przedmiotem dowodu), podmieniamy wyłącznie wyjście do bramki AI.
vi.mock("@/lib/search/peopleSemantic.functions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/search/peopleSemantic.functions")>();
  return {
    ...real,
    embedPeopleQuery: async ({ data }: { data: { q: string } }) => {
      h.embedCalls.push(data.q);
      if (h.embedFails) throw new Error("gateway down");
      return { embedding: h.embedding };
    },
  };
});

import {
  EMPTY_PEOPLE_FILTERS,
  shouldEmbedPeopleQuery,
  usePeopleDirectory,
  usePeopleFacets,
  usePeopleQueryEmbedding,
  type PeopleFilters,
} from "../usePeopleDirectory";

type RpcStub = ReturnType<typeof supabaseRpcStub>;
const rpc = () => h.rpc as RpcStub;

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Wiersz `search_people` w zakresie, którego dotyka warstwa danych. */
function personHit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "user-peer",
    display_name: "Zofia Testowa",
    total_count: 1,
    ...overrides,
  };
}

function filters(overrides: Partial<PeopleFilters> = {}): PeopleFilters {
  return { ...EMPTY_PEOPLE_FILTERS, ...overrides };
}

beforeEach(() => {
  h.uid = "user-me";
  h.embedCalls = [];
  h.embedding = null;
  h.embedFails = false;
  rpc().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shouldEmbedPeopleQuery", () => {
  it("wyłączony tryb semantyczny NIGDY nie pyta bramki", () => {
    expect(shouldEmbedPeopleQuery("polityka energetyczna", false)).toBe(false);
  });

  it("fraza krótsza niż próg nie idzie do bramki", () => {
    const short = "x".repeat(PEOPLE_SEMANTIC_MIN_CHARS - 1);
    expect(shouldEmbedPeopleQuery(short, true)).toBe(false);
  });

  it("fraza DOKŁADNIE na progu już idzie", () => {
    expect(shouldEmbedPeopleQuery("x".repeat(PEOPLE_SEMANTIC_MIN_CHARS), true)).toBe(true);
  });

  it("pusty string i same białe znaki nie kosztują wywołania bramki", () => {
    expect(shouldEmbedPeopleQuery("", true)).toBe(false);
    expect(shouldEmbedPeopleQuery("     ", true)).toBe(false);
    // Przycięcie liczy się PRZED progiem - „ ab " to dwa znaki, nie cztery.
    expect(shouldEmbedPeopleQuery("  ab  ", true)).toBe(false);
  });

  it("próg jest DŁUGOŚCIĄ, nie sensownością - znaki specjalne przechodzą", () => {
    // Świadoma decyzja, nie przeoczenie: klient nie ocenia treści frazy, bo
    // walidator serwerowy (`InputSchema`) egzekwuje dokładnie ten sam próg
    // długości. Klasyfikowanie „sensowności" po stronie klienta rozjeżdżałoby
    // się z serwerem przy pierwszej zmianie i dawałoby ciche 400 z bramki.
    expect(shouldEmbedPeopleQuery("????", true)).toBe(true);
  });
});

describe("usePeopleQueryEmbedding", () => {
  it("poniżej progu hook jest wyłączony - zero wywołań bramki", async () => {
    const client = makeClient();
    const { result } = renderHook(() => usePeopleQueryEmbedding("ab", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.embedCalls).toEqual([]);
    expect(result.current.data).toBeUndefined();
  });

  it("powyżej progu prosi bramkę o wektor PRZYCIĘTEJ frazy", async () => {
    h.embedding = [0.1, 0.2, 0.3];
    const client = makeClient();
    const { result } = renderHook(() => usePeopleQueryEmbedding("  energia  ", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.data).toEqual([0.1, 0.2, 0.3]));
    expect(h.embedCalls).toEqual(["energia"]);
  });

  it("wielkość liter nie mnoży wywołań - klucz cache'u jest małymi literami", async () => {
    h.embedding = [0.5];
    const client = makeClient();
    const first = renderHook(() => usePeopleQueryEmbedding("Energia", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(first.result.current.data).toEqual([0.5]));

    const second = renderHook(() => usePeopleQueryEmbedding("energia", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(second.result.current.data).toEqual([0.5]));
    expect(h.embedCalls).toHaveLength(1);
  });

  it("bramka bez wektora oddaje null zamiast wywracać katalog", async () => {
    h.embedding = null;
    const client = makeClient();
    const { result } = renderHook(() => usePeopleQueryEmbedding("energia", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("awaria bramki NIE jest ponawiana - katalog ma działać na trigramie", async () => {
    h.embedFails = true;
    const client = makeClient();
    const { result } = renderHook(() => usePeopleQueryEmbedding("energia", true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(h.embedCalls).toHaveLength(1);
  });
});

describe("usePeopleDirectory", () => {
  it("anonim nie odpytuje katalogu", async () => {
    h.uid = null;
    const client = makeClient();
    const { result } = renderHook(() => usePeopleDirectory("energia", filters()), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.people.fetchStatus).toBe("idle"));
    expect(rpc().callsFor("search_people")).toHaveLength(0);
  });

  it("zwykłe wyszukiwanie woła `search_people` z przyciętą frazą i oknem strony", async () => {
    rpc().setData("search_people", [personHit()]);
    const client = makeClient();
    const { result } = renderHook(() => usePeopleDirectory("  energia  ", filters(), 24), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));

    const call = rpc().lastCall("search_people");
    expect(call?.arg("p_query")).toBe("energia");
    expect(call?.arg("p_limit")).toBe(24);
    expect(call?.arg("p_offset")).toBe(0);
  });

  it("puste filtry NIE jadą jako null - serwerowy DEFAULT ma zostać domyślny", async () => {
    rpc().setData("search_people", [personHit()]);
    const client = makeClient();
    const { result } = renderHook(() => usePeopleDirectory("energia", filters()), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));

    const call = rpc().lastCall("search_people");
    expect(call?.arg("p_specialization")).toBeUndefined();
    expect(call?.arg("p_company")).toBeUndefined();
    expect(call?.arg("p_location")).toBeUndefined();
    expect(call?.arg("p_job_title")).toBeUndefined();
    // `false || undefined` - wyłączony przełącznik nie zawęża zbioru.
    expect(call?.arg("p_verified_only")).toBeUndefined();
    expect(call?.arg("p_open_to")).toBeUndefined();
    expect(call?.arg("p_embedding")).toBeUndefined();
  });

  it("ustawione filtry docierają pod WŁAŚCIWYMI nazwami argumentów", async () => {
    rpc().setData("search_people", [personHit()]);
    const client = makeClient();
    const { result } = renderHook(
      () =>
        usePeopleDirectory(
          "energia",
          filters({
            specialization: "Energetyka",
            company: "Firma Testowa",
            location: "Warszawa",
            jobTitle: "Analityk",
            verifiedOnly: true,
            openTo: ["mentoring", "hiring"],
          }),
        ),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));

    const call = rpc().lastCall("search_people");
    expect(call?.arg("p_specialization")).toBe("Energetyka");
    expect(call?.arg("p_company")).toBe("Firma Testowa");
    expect(call?.arg("p_location")).toBe("Warszawa");
    expect(call?.arg("p_job_title")).toBe("Analityk");
    expect(call?.arg("p_verified_only")).toBe(true);
    // Kolejność jest KATALOGOWA, nie zaznaczenia (`normalizeProfileIntents`):
    // ten sam zestaw intencji ma dawać ten sam klucz zapytania niezależnie od
    // tego, w jakiej kolejności użytkownik je kliknął.
    expect(call?.arg("p_open_to")).toEqual(["mentoring", "hiring"]);
  });

  it("hook NIE wysyła tenanta ani identyfikatora użytkownika - nie ma czego podrobić", async () => {
    rpc().setData("search_people", [personHit()]);
    const client = makeClient();
    const { result } = renderHook(() => usePeopleDirectory("energia", filters()), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));

    const keys = rpc().lastCall("search_people")?.keys() ?? [];
    expect(keys.some((k) => /tenant|user|uid|workspace/i.test(k))).toBe(false);
  });

  it("klucz cache'u jest PER KONTO - przełączenie konta nie pokazuje cudzych wyników", async () => {
    const client = makeClient();
    rpc().setData("search_people", [personHit({ id: "user-a", display_name: "Osoba A" })]);
    const first = renderHook(() => usePeopleDirectory("energia", filters()), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(first.result.current.people.isSuccess).toBe(true));

    h.uid = "user-inne-konto";
    rpc().setData("search_people", [personHit({ id: "user-b", display_name: "Osoba B" })]);
    const second = renderHook(() => usePeopleDirectory("energia", filters()), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(second.result.current.people.isSuccess).toBe(true));

    expect(rpc().callsFor("search_people")).toHaveLength(2);
    expect(second.result.current.people.data?.pages[0]?.[0]?.id).toBe("user-b");
  });

  it("kolejna strona rusza dopiero, gdy strona jest PEŁNA i zostało co dociągać", async () => {
    rpc().setData("search_people", [personHit({ total_count: 5 })]);
    const client = makeClient();
    const { result } = renderHook(() => usePeopleDirectory("energia", filters(), 1), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));
    expect(result.current.people.hasNextPage).toBe(true);

    rpc().setData("search_people", []);
    await waitFor(async () => {
      await result.current.people.fetchNextPage();
    });
    await waitFor(() => expect(result.current.people.hasNextPage).toBe(false));
    expect(rpc().callsFor("search_people").at(-1)?.arg("p_offset")).toBe(1);
  });

  it("komplet wyników KOŃCZY paginację, choć strona jest pełna", async () => {
    rpc().setData("search_people", [personHit({ total_count: 1 })]);
    const client = makeClient();
    const { result } = renderHook(() => usePeopleDirectory("energia", filters(), 1), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));
    expect(result.current.people.hasNextPage).toBe(false);
  });

  it("odmowa bazy wypada błędem, a nie pustą listą udającą brak wyników", async () => {
    rpc().setError("search_people", "permission denied", "42501");
    const client = makeClient();
    const { result } = renderHook(() => usePeopleDirectory("energia", filters()), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.people.isError).toBe(true));
  });

  it("tryb semantyczny dokłada wektor i ogłasza się jawnie", async () => {
    h.embedding = [0.1, 0.2];
    rpc().setData("search_people", [personHit()]);
    const client = makeClient();
    const { result } = renderHook(
      () => usePeopleDirectory("energia", filters({ semantic: true })),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(result.current.semanticActive).toBe(true));
    expect(result.current.semanticUnavailable).toBe(false);
    expect(rpc().lastCall("search_people")?.arg("p_embedding")).toEqual([0.1, 0.2]);
  });

  it("tryb włączony, bramka bez wektora - katalog DEGRADUJE się jawnie do trigramu", async () => {
    h.embedding = null;
    rpc().setData("search_people", [personHit()]);
    const client = makeClient();
    const { result } = renderHook(
      () => usePeopleDirectory("energia", filters({ semantic: true })),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));
    expect(result.current.semanticActive).toBe(false);
    expect(result.current.semanticUnavailable).toBe(true);
    expect(rpc().lastCall("search_people")?.arg("p_embedding")).toBeUndefined();
  });

  it("tryb semantyczny przy KRÓTKIEJ frazie nie ogłasza degradacji - bramki nie pytano", async () => {
    rpc().setData("search_people", [personHit()]);
    const client = makeClient();
    const { result } = renderHook(() => usePeopleDirectory("ab", filters({ semantic: true })), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));
    expect(result.current.semanticUnavailable).toBe(false);
    expect(h.embedCalls).toEqual([]);
  });
});

describe("usePeopleFacets", () => {
  it("anonim nie odpytuje faset", async () => {
    h.uid = null;
    const client = makeClient();
    const { result } = renderHook(() => usePeopleFacets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(rpc().callsFor("people_filter_options")).toHaveLength(0);
  });

  it("rozdziela wiersze na cztery pola tekstowe i licznik intencji", async () => {
    rpc().setResponse("people_filter_options", () =>
      ok([
        { field: "specialization", value: "Energetyka", cnt: 12 },
        { field: "company", value: "Firma Testowa", cnt: 3 },
        { field: "location", value: "Warszawa", cnt: 8 },
        { field: "job_title", value: "Analityk", cnt: 5 },
        { field: "open_to", value: "mentoring", cnt: 4 },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => usePeopleFacets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      specialization: [{ value: "Energetyka", cnt: 12 }],
      company: [{ value: "Firma Testowa", cnt: 3 }],
      location: [{ value: "Warszawa", cnt: 8 }],
      job_title: [{ value: "Analityk", cnt: 5 }],
      open_to: [{ value: "mentoring", cnt: 4 }],
    });
  });

  it("kod intencji NIEZNANY klientowi odpada - fasety nie mogą wpisać do URL-a śmiecia", async () => {
    rpc().setResponse("people_filter_options", () =>
      ok([
        { field: "open_to", value: "kod-z-przyszlosci", cnt: 9 },
        { field: "open_to", value: "hiring", cnt: 2 },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => usePeopleFacets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.open_to).toEqual([{ value: "hiring", cnt: 2 }]);
  });

  it("nieznane POLE odpada bez wywracania fasetu", async () => {
    rpc().setResponse("people_filter_options", () =>
      ok([
        { field: "nieznane_pole", value: "x", cnt: 1 },
        { field: "location", value: "Kraków", cnt: 2 },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => usePeopleFacets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.location).toEqual([{ value: "Kraków", cnt: 2 }]);
    expect(result.current.data?.specialization).toEqual([]);
  });

  it("pusta odpowiedź daje puste listy, nie `undefined`", async () => {
    rpc().setResponse("people_filter_options", () => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => usePeopleFacets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      specialization: [],
      company: [],
      location: [],
      job_title: [],
      open_to: [],
    });
  });

  it("odmowa bazy wypada błędem", async () => {
    rpc().setError("people_filter_options", "permission denied", "42501");
    const client = makeClient();
    const { result } = renderHook(() => usePeopleFacets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
