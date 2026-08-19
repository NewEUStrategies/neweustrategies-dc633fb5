// Hooki katalogów i ściany wpisów - `useClubTopics` (0/10),
// `useClubSpecializations` (0/13), `useClubPosts` (0/15), `useClubsModule`
// (0/2), `useClubLinkPreview` (0/2). Wszystkie na zerze.
//
// TRZY RZECZY, KTÓRE TU REALNIE DECYDUJĄ O TYM, CO WIDZI UŻYTKOWNIK:
//
//   1. LISTA AWARYJNA OBSZARÓW. `useClubTopics` oddaje wbudowany katalog do
//      czasu pierwszej odpowiedzi - pusty select w formularzu wątku wygląda
//      jak awaria, a nie jak ładowanie.
//   2. PRZEŁĄCZNIK MODUŁU. `clubs_enabled` przez lata nie miał ani jednego
//      konsumenta: administrator klikał „wyłącz", panel pokazywał stan
//      wyłączony, a `/club` działało dalej. Przełącznik bez skutku jest gorszy
//      niż jego brak, bo deklaruje coś, czego nie robi.
//   3. KUMULACJA PODPISANYCH ADRESÓW. Doładowanie kolejnej strony wpisów to
//      NOWY klucz zapytania; bez scalania map obrazy już widoczne znikałyby
//      na czas nowego podpisu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// `vi.hoisted` jest tu konieczne, nie kosmetyczne: fabryki `vi.mock` biegną
// przy PIERWSZYM imporcie podmienianego modułu, czyli zanim wykonają się
// deklaracje `const` w ciele pliku. Zwykłe `const` dałoby tu „Cannot access
// before initialization" - błąd zależny od kolejności importów, więc
// pojawiający się i znikający przy niezwiązanych zmianach.
const { topicsApiMock, specializationsApiMock, postsApiMock, communityModules, linkPreviewMock } =
  vi.hoisted(() => ({
    topicsApiMock: {
      fetchActiveClubTopics: vi.fn(),
      fetchAdminClubTopics: vi.fn(),
      upsertClubTopic: vi.fn(),
      setClubTopicActive: vi.fn(),
      deleteClubTopic: vi.fn(),
    },
    specializationsApiMock: {
      fetchPublicClubSpecializations: vi.fn(),
      fetchClubsBySpecialization: vi.fn(),
      fetchAdminClubSpecializations: vi.fn(),
      upsertClubSpecialization: vi.fn(),
      setClubSpecializationActive: vi.fn(),
      deleteClubSpecialization: vi.fn(),
    },
    postsApiMock: {
      fetchClubPosts: vi.fn(),
      createClubPost: vi.fn(),
      deleteClubPost: vi.fn(),
      toggleClubPostLike: vi.fn(),
      signClubMediaUrls: vi.fn(),
    },
    communityModules: { value: { clubs_enabled: true } as Record<string, boolean> },
    linkPreviewMock: { fetchPreview: vi.fn() },
  }));

vi.mock("@/lib/clubs/topicsApi", () => topicsApiMock);
vi.mock("@/lib/clubs/specializationsApi", () => specializationsApiMock);
vi.mock("@/lib/clubs/postsApi", () => postsApiMock);
vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => communityModules.value,
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => linkPreviewMock.fetchPreview,
}));
vi.mock("@/lib/clubs/linkPreview.functions", () => ({
  fetchClubLinkPreview: linkPreviewMock.fetchPreview,
}));

import { CLUB_TOPIC_FALLBACK } from "@/lib/clubs/topicCatalog";
import { clubKeys } from "@/lib/clubs/queryKeys";
import {
  clubTopicKeys,
  useAdminClubTopics,
  useClubTopics,
  useDeleteClubTopic,
  useSetClubTopicActive,
  useUpsertClubTopic,
} from "@/lib/clubs/useClubTopics";
import {
  clubSpecializationKeys,
  useAdminClubSpecializations,
  useClubSpecializations,
  useClubsBySpecialization,
  useDeleteClubSpecialization,
  useSetClubSpecializationActive,
  useUpsertClubSpecialization,
} from "@/lib/clubs/useClubSpecializations";
import {
  useClubMediaUrls,
  useClubPosts,
  useCreateClubPost,
  useDeleteClubPost,
  useToggleClubPostLike,
} from "@/lib/clubs/useClubPosts";
import { useClubsModule } from "@/lib/clubs/useClubsModule";
import { useClubLinkPreview } from "@/lib/clubs/useClubLinkPreview";

const CLUB = "club-1";

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = (filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey);
    return original(filters as Parameters<typeof original>[0]);
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidated };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  for (const mock of [topicsApiMock, specializationsApiMock, postsApiMock, linkPreviewMock]) {
    for (const fn of Object.values(mock)) fn.mockReset();
  }
  communityModules.value = { clubs_enabled: true };
});

// ---------------------------------------------------------------------------
// Obszary tematyczne
// ---------------------------------------------------------------------------

describe("useClubTopics", () => {
  it("PRZED pierwszą odpowiedzią oddaje listę awaryjną, nie pustkę", async () => {
    const { wrapper } = harness();
    topicsApiMock.fetchActiveClubTopics.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useClubTopics(), { wrapper });

    // Pusty select w formularzu wątku wygląda jak awaria, a nie jak ładowanie.
    expect(result.current.topics).toEqual([...CLUB_TOPIC_FALLBACK]);
    expect(result.current.isLoading).toBe(true);
  });

  it("po odpowiedzi oddaje katalog organizacji", async () => {
    const { wrapper } = harness();
    const rows = [{ key: "own", label_pl: "Własny", label_en: "Own", sort_order: 1 }];
    topicsApiMock.fetchActiveClubTopics.mockResolvedValue(rows);

    const { result } = renderHook(() => useClubTopics(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.topics).toEqual(rows);
  });

  it("PUSTY katalog organizacji NIE wraca do listy awaryjnej", async () => {
    const { wrapper } = harness();
    topicsApiMock.fetchActiveClubTopics.mockResolvedValue([]);

    const { result } = renderHook(() => useClubTopics(), { wrapper });

    // Redakcja mogła świadomie wyłączyć wszystkie obszary - podstawianie
    // wtedy listy wbudowanej cofałoby tę decyzję.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.topics).toEqual([]);
  });

  it("enabled=false nie odpytuje, ale nadal daje listę awaryjną", async () => {
    const { wrapper } = harness();

    const { result } = renderHook(() => useClubTopics(false), { wrapper });

    await tick();
    expect(topicsApiMock.fetchActiveClubTopics).not.toHaveBeenCalled();
    expect(result.current.topics).toEqual([...CLUB_TOPIC_FALLBACK]);
  });

  it("lista panelu ma OSOBNY klucz od listy publicznej", async () => {
    const { wrapper } = harness();
    topicsApiMock.fetchAdminClubTopics.mockResolvedValue([]);
    topicsApiMock.fetchActiveClubTopics.mockResolvedValue([]);

    const a = renderHook(() => useClubTopics(), { wrapper });
    const b = renderHook(() => useAdminClubTopics(), { wrapper });

    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(a.result.current.isLoading).toBe(false));
    // Panel widzi także obszary wyłączone - wspólny klucz pokazałby je
    // w publicznym selekcie.
    expect(clubTopicKeys.active()).not.toEqual(clubTopicKeys.admin());
    expect(topicsApiMock.fetchActiveClubTopics).toHaveBeenCalled();
    expect(topicsApiMock.fetchAdminClubTopics).toHaveBeenCalled();
  });

  it("KAŻDA mutacja katalogu unieważnia OBIE listy (wspólny korzeń)", async () => {
    const { wrapper, invalidated } = harness();
    topicsApiMock.upsertClubTopic.mockResolvedValue("t1");
    topicsApiMock.setClubTopicActive.mockResolvedValue(true);
    topicsApiMock.deleteClubTopic.mockResolvedValue(true);

    const up = renderHook(() => useUpsertClubTopic(), { wrapper });
    await up.result.current.mutateAsync({
      key: "k",
      labelPl: "K",
      labelEn: "K",
      sortOrder: 1,
      isActive: true,
    });

    const act = renderHook(() => useSetClubTopicActive(), { wrapper });
    await act.result.current.mutateAsync({ id: "t1", isActive: false });
    expect(topicsApiMock.setClubTopicActive).toHaveBeenCalledWith("t1", false);

    const del = renderHook(() => useDeleteClubTopic(), { wrapper });
    await del.result.current.mutateAsync("t1");

    await waitFor(() => {
      expect(
        invalidated.filter((k) => JSON.stringify(k) === JSON.stringify(clubTopicKeys.all)).length,
      ).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Specjalizacje
// ---------------------------------------------------------------------------

describe("useClubSpecializations", () => {
  it("lista publiczna i panelu mają osobne klucze", async () => {
    const { wrapper } = harness();
    specializationsApiMock.fetchPublicClubSpecializations.mockResolvedValue([]);
    specializationsApiMock.fetchAdminClubSpecializations.mockResolvedValue([]);

    const a = renderHook(() => useClubSpecializations(), { wrapper });
    const b = renderHook(() => useAdminClubSpecializations(), { wrapper });

    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(clubSpecializationKeys.publicList()).not.toEqual(clubSpecializationKeys.admin());
  });

  it("obie listy respektują enabled=false", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubSpecializations(false), { wrapper });
    renderHook(() => useAdminClubSpecializations(false), { wrapper });

    await tick();
    expect(specializationsApiMock.fetchPublicClubSpecializations).not.toHaveBeenCalled();
    expect(specializationsApiMock.fetchAdminClubSpecializations).not.toHaveBeenCalled();
  });

  it("kluby specjalizacji: PUSTY slug nie odpytuje", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubsBySpecialization(""), { wrapper });

    await tick();
    expect(specializationsApiMock.fetchClubsBySpecialization).not.toHaveBeenCalled();
  });

  it("kluby specjalizacji: LIMIT jest częścią klucza", async () => {
    const { wrapper } = harness();
    specializationsApiMock.fetchClubsBySpecialization.mockResolvedValue({ rows: [], total: 0 });

    const a = renderHook(() => useClubsBySpecialization("energetyka", 20), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(() => useClubsBySpecialization("energetyka", 60), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(specializationsApiMock.fetchClubsBySpecialization).toHaveBeenCalledTimes(2);
    expect(specializationsApiMock.fetchClubsBySpecialization).toHaveBeenLastCalledWith(
      "energetyka",
      { limit: 60 },
    );
  });

  it("KAŻDA mutacja unieważnia wspólny korzeń specjalizacji", async () => {
    const { wrapper, invalidated } = harness();
    specializationsApiMock.upsertClubSpecialization.mockResolvedValue("s1");
    specializationsApiMock.setClubSpecializationActive.mockResolvedValue(true);
    specializationsApiMock.deleteClubSpecialization.mockResolvedValue(true);

    const up = renderHook(() => useUpsertClubSpecialization(), { wrapper });
    await up.result.current.mutateAsync({
      slug: "s",
      labelPl: "S",
      labelEn: "S",
      icon: "Globe2",
      sortOrder: 1,
      isActive: true,
    });

    const act = renderHook(() => useSetClubSpecializationActive(), { wrapper });
    await act.result.current.mutateAsync({ id: "s1", isActive: false });
    expect(specializationsApiMock.setClubSpecializationActive).toHaveBeenCalledWith("s1", false);

    const del = renderHook(() => useDeleteClubSpecialization(), { wrapper });
    await del.result.current.mutateAsync("s1");

    await waitFor(() => {
      expect(
        invalidated.filter((k) => JSON.stringify(k) === JSON.stringify(clubSpecializationKeys.all))
          .length,
      ).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Ściana wpisów
// ---------------------------------------------------------------------------

describe("useClubPosts - paginacja kursorem czasowym", () => {
  it("pełna strona oddaje kursor z created_at OSTATNIEGO wpisu", async () => {
    const { wrapper } = harness();
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      created_at: `2026-08-18T10:${String(i).padStart(2, "0")}:00.000Z`,
    }));
    postsApiMock.fetchClubPosts.mockResolvedValue({ rows });

    const { result } = renderHook(() => useClubPosts({ clubId: CLUB }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.hasNextPage).toBe(true);
    await result.current.fetchNextPage();

    await waitFor(() =>
      expect(postsApiMock.fetchClubPosts).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: rows[19]?.created_at }),
      ),
    );
  });

  it("strona KRÓTSZA niż limit kończy paginację", async () => {
    const { wrapper } = harness();
    postsApiMock.fetchClubPosts.mockResolvedValue({ rows: [{ id: "p1", created_at: "x" }] });

    const { result } = renderHook(() => useClubPosts({ clubId: CLUB }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("pusta strona też kończy paginację", async () => {
    const { wrapper } = harness();
    postsApiMock.fetchClubPosts.mockResolvedValue({ rows: [] });

    const { result } = renderHook(() => useClubPosts({ clubId: CLUB }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("bez id klubu i przy enabled=false nie odpytuje", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubPosts({ clubId: undefined }), { wrapper });
    renderHook(() => useClubPosts({ clubId: CLUB, enabled: false }), { wrapper });

    await tick();
    expect(postsApiMock.fetchClubPosts).not.toHaveBeenCalled();
  });

  it("zawężenie do działu i wątku jest częścią klucza ORAZ zapytania", async () => {
    const { wrapper } = harness();
    postsApiMock.fetchClubPosts.mockResolvedValue({ rows: [] });

    const { result } = renderHook(
      () => useClubPosts({ clubId: CLUB, groupId: "g1", threadId: "t1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postsApiMock.fetchClubPosts).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "g1", threadId: "t1", limit: 20, cursor: null }),
    );
  });
});

describe("mutacje ściany wpisów", () => {
  it("nowy wpis dopełnia id klubu i unieważnia poddrzewo klubu", async () => {
    const { wrapper, invalidated } = harness();
    postsApiMock.createClubPost.mockResolvedValue("p1");

    const { result } = renderHook(() => useCreateClubPost(CLUB), { wrapper });
    await result.current.mutateAsync({ body: "Wpis", attachments: [] });

    expect(postsApiMock.createClubPost).toHaveBeenCalledWith({
      body: "Wpis",
      attachments: [],
      clubId: CLUB,
    });
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.club(CLUB)));
  });

  it("usunięcie wpisu unieważnia SAMĄ ścianę, nie cały klub", async () => {
    const { wrapper, invalidated } = harness();
    postsApiMock.deleteClubPost.mockResolvedValue(true);

    const { result } = renderHook(() => useDeleteClubPost(CLUB), { wrapper });
    await result.current.mutateAsync("p1");

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.postsAll(CLUB)));
  });

  it("polubienie NIE unieważnia niczego - przeładowanie ściany przewinęłoby ekran", async () => {
    const { wrapper, invalidated } = harness();
    postsApiMock.toggleClubPostLike.mockResolvedValue({ liked: true, likeCount: 3 });

    const { result } = renderHook(() => useToggleClubPostLike(), { wrapper });
    const outcome = await result.current.mutateAsync("p1");

    // RPC oddaje nowy licznik, więc widok aktualizuje się z odpowiedzi.
    expect(outcome).toEqual({ liked: true, likeCount: 3 });
    expect(invalidated).toHaveLength(0);
  });
});

describe("useClubMediaUrls - kumulacja podpisanych adresów", () => {
  it("pusta lista ścieżek nie odpytuje bazy", async () => {
    const { wrapper } = harness();

    const { result } = renderHook(() => useClubMediaUrls([]), { wrapper });

    await tick();
    expect(postsApiMock.signClubMediaUrls).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });

  it("klucz nie zależy od KOLEJNOŚCI ścieżek - te same pliki to ten sam wpis", async () => {
    const { wrapper } = harness();
    postsApiMock.signClubMediaUrls.mockResolvedValue({ a: "https://s/a" });

    const first = renderHook(() => useClubMediaUrls(["a", "b"]), { wrapper });
    await waitFor(() => expect(Object.keys(first.result.current)).toHaveLength(1));

    const second = renderHook(() => useClubMediaUrls(["b", "a"]), { wrapper });
    await waitFor(() => expect(Object.keys(second.result.current)).toHaveLength(1));

    // Bez sortowania w kluczu druga partia byłaby nowym zapytaniem o te same
    // pliki - i drugim wyjściem po podpis.
    expect(postsApiMock.signClubMediaUrls).toHaveBeenCalledTimes(1);
  });

  it("adresy KUMULUJĄ się między stronami - obrazy nie znikają przy doładowaniu", async () => {
    const { wrapper } = harness();
    postsApiMock.signClubMediaUrls.mockResolvedValueOnce({ a: "https://s/a" });

    const { result, rerender } = renderHook(({ paths }) => useClubMediaUrls(paths), {
      wrapper,
      initialProps: { paths: ["a"] as readonly string[] },
    });
    await waitFor(() => expect(result.current).toEqual({ a: "https://s/a" }));

    // Druga strona to INNY klucz zapytania; bez scalania map adres „a"
    // zniknąłby na czas nowego podpisu i obraz mrugnąłby na ekranie.
    postsApiMock.signClubMediaUrls.mockResolvedValueOnce({ b: "https://s/b" });
    rerender({ paths: ["a", "b"] as readonly string[] });

    await waitFor(() => {
      expect(result.current).toEqual({ a: "https://s/a", b: "https://s/b" });
    });
  });
});

// ---------------------------------------------------------------------------
// Przełącznik modułu
// ---------------------------------------------------------------------------

describe("useClubsModule", () => {
  it("włączony moduł: enabled=true, disabled=false", () => {
    const { wrapper } = harness();
    communityModules.value = { clubs_enabled: true };

    const { result } = renderHook(() => useClubsModule(), { wrapper });

    expect(result.current).toEqual({ enabled: true, disabled: false });
  });

  it("wyłączony moduł: enabled=false, disabled=true", () => {
    const { wrapper } = harness();
    communityModules.value = { clubs_enabled: false };

    const { result } = renderHook(() => useClubsModule(), { wrapper });

    // `disabled` istnieje po to, żeby trasa mogła zrobić czytelny wczesny
    // `return`, a jednocześnie ZGASIĆ zapytania przez `enabled` - ekran
    // „moduł wyłączony", który dalej woła `club_list`, wysyła ruch do bazy
    // za funkcję, której nikt nie zobaczy.
    expect(result.current).toEqual({ enabled: false, disabled: true });
  });
});

// ---------------------------------------------------------------------------
// Podgląd linku
// ---------------------------------------------------------------------------

describe("useClubLinkPreview", () => {
  it("NIE pyta, dopóki ktoś nie najedzie na link", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubLinkPreview("https://example.org", false), { wrapper });

    // Podgląd kosztuje WYJŚCIE NA ŚWIAT z serwera. Pobieranie go dla każdego
    // linku w wątku przy samym renderze zamieniłoby listę wątków w skaner.
    await tick();
    expect(linkPreviewMock.fetchPreview).not.toHaveBeenCalled();
  });

  it("pusty i nieistniejący adres nie uruchamiają zapytania nawet po najechaniu", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubLinkPreview("", true), { wrapper });
    renderHook(() => useClubLinkPreview(null, true), { wrapper });

    await tick();
    expect(linkPreviewMock.fetchPreview).not.toHaveBeenCalled();
  });

  it("po najechaniu pyta RAZ i pakuje adres w kopertę server fn", async () => {
    const { wrapper } = harness();
    linkPreviewMock.fetchPreview.mockResolvedValue({ title: "Tytuł", url: "https://example.org" });

    const { result } = renderHook(() => useClubLinkPreview("https://example.org", true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(linkPreviewMock.fetchPreview).toHaveBeenCalledWith({
      data: { url: "https://example.org" },
    });
  });

  it("adres jest częścią klucza - dwa różne linki to dwa zapytania", async () => {
    const { wrapper } = harness();
    linkPreviewMock.fetchPreview.mockResolvedValue(null);

    const a = renderHook(() => useClubLinkPreview("https://a.example", true), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(() => useClubLinkPreview("https://b.example", true), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(linkPreviewMock.fetchPreview).toHaveBeenCalledTimes(2);
  });
});
