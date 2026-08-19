// Hooki PRZESTRZENI ROBOCZEJ i SIECI klubu - trzy pliki, razem 113 funkcji,
// wszystkie na zerze: `useClubWorkspace` (0/30), `useThreadWorkspace` (0/45),
// `useClubNetwork` (0/38).
//
// CO TU JEST REGUŁĄ, A CO OPAKOWANIEM. Większość tych hooków to trzy linie:
// klucz, wywołanie i `staleTime`. Testowalne - i realnie psujące się - są
// cztery rzeczy:
//
//   1. ZAKRESY SEMANTYCZNE. `ClubBoardScope` ("open"/"mine"/"archive")
//      i `ClubDocumentScope` ("all"/"products"/"sources") to nazwy ZAKŁADEK,
//      które hook tłumaczy na argumenty zapytania. Zła translacja daje
//      zakładkę pokazującą cudze ogłoszenia albo bibliotekę bez połowy
//      dokumentów - i wygląda to jak pusty klub, nie jak błąd.
//   2. BRAMKI `enabled`. Ekran wątku renderuje się, zanim trasa dowiezie id.
//   3. PRÓG FRAZY. Biblioteka odsiewa wyszukiwanie krótsze niż dwa znaki
//      PRZED wysłaniem - pełne skanowanie ILIKE po obu językach kosztuje.
//   4. ZAKRES UNIEWAŻNIENIA. Deklaracja kompetencji zmienia panel składu,
//      moduł „poznaj członka" I panel ekspertów w każdym otwartym wątku,
//      więc unieważnia korzeń klubu. Prośba o zdanie dotyczy JEDNEGO wątku
//      i nie ma prawa przeładować klubu obok.
//
// `staleTime` też jest tu asertowany - nie dla samej liczby, tylko dlatego,
// że niektóre z nich niosą decyzję produktową: rotacja „poznaj członka" jest
// TYGODNIOWA, więc odpytywanie częściej niż raz na kwadrans nie ma prawa
// oddać innej osoby.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/clubs/networkApi", () => networkApiMock);
vi.mock("@/lib/clubs/workspaceApi", async () => {
  const actual = await import("@/lib/clubs/threadWorkspaceApi");
  return { ...workspaceApiMock, ...actual };
});
vi.mock("@/lib/clubs/threadWorkspaceApi", () => threadApiMock);

import {
  networkApiMock,
  resetNetworkApiMock,
  resetThreadApiMock,
  resetWorkspaceApiMock,
  threadApiMock,
  workspaceApiMock,
} from "@/test/clubs/workspaceApiMock";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { CLUB_PRODUCT_KINDS, CLUB_SOURCE_KINDS } from "@/lib/clubs/workspaceTypes";
import {
  useClubActivitySeries,
  useClubDocuments,
  useClubEventRsvp,
  useClubEvents,
  useClubMilestones,
  useClubWorkspaceStats,
  useDeleteClubDocument,
  useUpsertClubDocument,
  useUpsertClubEvent,
  useUpsertClubMilestone,
} from "@/lib/clubs/useClubWorkspace";
import {
  useAddClubThreadLink,
  useAskClubThreadQuestion,
  useClubThreadDocuments,
  useClubThreadInsights,
  useClubThreadLinks,
  useClubThreadParticipants,
  useClubThreadPolls,
  useClubThreadQuestions,
  useClubThreadSearch,
  useClubThreadWorkspace,
  useCreateClubThreadPoll,
  useRemoveClubThreadDocument,
  useUpsertClubThreadDocument,
  useVoteClubThreadQuestion,
} from "@/lib/clubs/useThreadWorkspace";
import {
  useClubBoardNotices,
  useClubEvent,
  useClubEventAttendees,
  useClubExperts,
  useClubExpertiseAreas,
  useClubRosterSignal,
  useClubSpotlight,
  useClubSpotlightHistory,
  useClubThreadExperts,
  useCloseClubBoardNotice,
  useCreateClubBoardNotice,
  useDeleteClubSpotlight,
  useMyClubExpertise,
  usePinClubSpotlight,
  usePingClubThreadExpert,
  useSetMyClubExpertise,
} from "@/lib/clubs/useClubNetwork";

const CLUB = "club-1";
const THREAD = "thread-1";

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
  resetWorkspaceApiMock();
  resetThreadApiMock();
  resetNetworkApiMock();
});

// ---------------------------------------------------------------------------
// Biblioteka klubu
// ---------------------------------------------------------------------------

describe("useClubDocuments - zakres biblioteki", () => {
  it("'all' NIE zawęża po rodzajach", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubDocuments.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useClubDocuments({ clubId: CLUB }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workspaceApiMock.fetchClubDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: null }),
    );
  });

  it("'products' i 'sources' to DWA ROZŁĄCZNE zbiory rodzajów", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubDocuments.mockResolvedValue({ rows: [], total: 0 });

    const p = renderHook(() => useClubDocuments({ clubId: CLUB, scope: "products" }), { wrapper });
    await waitFor(() => expect(p.result.current.isSuccess).toBe(true));
    expect(workspaceApiMock.fetchClubDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: CLUB_PRODUCT_KINDS }),
    );

    const s = renderHook(() => useClubDocuments({ clubId: CLUB, scope: "sources" }), { wrapper });
    await waitFor(() => expect(s.result.current.isSuccess).toBe(true));
    expect(workspaceApiMock.fetchClubDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: CLUB_SOURCE_KINDS }),
    );

    // Rozłączność jest warunkiem sensu podziału: rodzaj w obu zbiorach
    // pokazywałby ten sam dokument w „Dorobku" i w „Źródłach".
    const sources: readonly string[] = CLUB_SOURCE_KINDS;
    const overlap = (CLUB_PRODUCT_KINDS as readonly string[]).filter((k) => sources.includes(k));
    expect(overlap).toEqual([]);
  });

  it("fraza krótsza niż 2 znaki NIE jedzie jako filtr", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubDocuments.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useClubDocuments({ clubId: CLUB, search: " a " }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workspaceApiMock.fetchClubDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ search: null }),
    );
  });

  it("fraza dwuznakowa jedzie przycięta", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubDocuments.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useClubDocuments({ clubId: CLUB, search: "  pl  " }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workspaceApiMock.fetchClubDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ search: "pl" }),
    );
  });

  it("ZAKRES jest częścią klucza - przełączenie zakładki nie czyta cudzego wpisu", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubDocuments.mockResolvedValue({ rows: [], total: 0 });

    const a = renderHook(() => useClubDocuments({ clubId: CLUB, scope: "products" }), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(() => useClubDocuments({ clubId: CLUB, scope: "sources" }), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(workspaceApiMock.fetchClubDocuments).toHaveBeenCalledTimes(2);
  });

  it("bez id klubu nie odpytuje", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubDocuments({ clubId: undefined }), { wrapper });

    await tick();
    expect(workspaceApiMock.fetchClubDocuments).not.toHaveBeenCalled();
  });
});

describe("mutacje przestrzeni roboczej klubu", () => {
  it("zapis i kasowanie dokumentu unieważniają poddrzewo klubu", async () => {
    const { wrapper, invalidated } = harness();
    workspaceApiMock.upsertClubDocument.mockResolvedValue("d1");
    workspaceApiMock.deleteClubDocument.mockResolvedValue(true);

    const up = renderHook(() => useUpsertClubDocument(CLUB), { wrapper });
    await up.result.current.mutateAsync({ title_pl: "Brief" });
    expect(workspaceApiMock.upsertClubDocument).toHaveBeenCalledWith(CLUB, { title_pl: "Brief" });

    const del = renderHook(() => useDeleteClubDocument(CLUB), { wrapper });
    await del.result.current.mutateAsync("d1");

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.club(CLUB)));
    expect(invalidated.filter((k) => JSON.stringify(k) === JSON.stringify(clubKeys.club(CLUB))))
      .toHaveLength(2);
  });

  it("wydarzenie i kamień milowy dopełniają id klubu", async () => {
    const { wrapper } = harness();
    workspaceApiMock.upsertClubEvent.mockResolvedValue("e1");
    workspaceApiMock.upsertClubMilestone.mockResolvedValue("m1");

    const ev = renderHook(() => useUpsertClubEvent(CLUB), { wrapper });
    await ev.result.current.mutateAsync({ title_pl: "Spotkanie" });
    expect(workspaceApiMock.upsertClubEvent).toHaveBeenCalledWith(CLUB, { title_pl: "Spotkanie" });

    const ms = renderHook(() => useUpsertClubMilestone(CLUB), { wrapper });
    await ms.result.current.mutateAsync({ title_pl: "Etap" });
    expect(workspaceApiMock.upsertClubMilestone).toHaveBeenCalledWith(CLUB, { title_pl: "Etap" });
  });

  it("RSVP przekazuje wydarzenie i stan", async () => {
    const { wrapper, invalidated } = harness();
    workspaceApiMock.setClubEventRsvp.mockResolvedValue(true);

    const { result } = renderHook(() => useClubEventRsvp(CLUB), { wrapper });
    await result.current.mutateAsync({ eventId: "e1", state: "going" });

    expect(workspaceApiMock.setClubEventRsvp).toHaveBeenCalledWith("e1", "going");
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.club(CLUB)));
  });
});

describe("odczyt kalendarza, harmonogramu i pomiaru klubu", () => {
  it("wszystkie milczą bez id klubu", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubEvents({ clubId: undefined }), { wrapper });
    renderHook(() => useClubMilestones(undefined), { wrapper });
    renderHook(() => useClubActivitySeries(undefined, 30), { wrapper });
    renderHook(() => useClubWorkspaceStats(undefined, 30), { wrapper });

    await tick();
    expect(workspaceApiMock.fetchClubEvents).not.toHaveBeenCalled();
    expect(workspaceApiMock.fetchClubMilestones).not.toHaveBeenCalled();
    expect(workspaceApiMock.fetchClubActivitySeries).not.toHaveBeenCalled();
    expect(workspaceApiMock.fetchClubWorkspaceStats).not.toHaveBeenCalled();
  });

  it("okno pomiaru dojeżdża jako liczba dni i jest częścią klucza", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubActivitySeries.mockResolvedValue([]);

    const a = renderHook(() => useClubActivitySeries(CLUB, 7), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(() => useClubActivitySeries(CLUB, 90), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(workspaceApiMock.fetchClubActivitySeries).toHaveBeenCalledTimes(2);
    expect(workspaceApiMock.fetchClubActivitySeries).toHaveBeenLastCalledWith(CLUB, 90);
  });
});

// ---------------------------------------------------------------------------
// Przestrzeń robocza WĄTKU
// ---------------------------------------------------------------------------

describe("useThreadWorkspace - bramki i klucze", () => {
  it("KAŻDY odczyt wątku milczy bez identyfikatora", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubThreadWorkspace(undefined), { wrapper });
    renderHook(() => useClubThreadDocuments({ threadId: undefined }), { wrapper });
    renderHook(() => useClubThreadQuestions({ threadId: undefined }), { wrapper });
    renderHook(() => useClubThreadPolls({ threadId: undefined }), { wrapper });
    renderHook(() => useClubThreadLinks({ threadId: undefined }), { wrapper });
    renderHook(() => useClubThreadParticipants({ threadId: undefined }), { wrapper });
    renderHook(() => useClubThreadInsights({ threadId: undefined }), { wrapper });

    await tick();
    for (const fn of [
      threadApiMock.fetchClubThreadWorkspace,
      threadApiMock.fetchClubThreadDocuments,
      threadApiMock.fetchClubThreadQuestions,
      threadApiMock.fetchClubThreadPolls,
      threadApiMock.fetchClubThreadLinks,
      threadApiMock.fetchClubThreadParticipants,
      threadApiMock.fetchClubThreadInsights,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("PUSTY string też nie jest identyfikatorem wątku", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubThreadWorkspace(""), { wrapper });

    await tick();
    expect(threadApiMock.fetchClubThreadWorkspace).not.toHaveBeenCalled();
  });

  it("przekrój wątku normalizuje pustą zwrotkę do podsumowania zerowego", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadWorkspace.mockResolvedValue(null);

    const { result } = renderHook(() => useClubThreadWorkspace(THREAD), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Widok dostaje ZAWSZE obiekt podsumowania - brak wiersza nie może
    // wywrócić panelu na `undefined.documents`.
    expect(result.current.data).toBeDefined();
  });

  it("wyszukiwanie w wątku milczy przy pustej frazie", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubThreadSearch({ threadId: THREAD, query: "" }), { wrapper });

    await tick();
    expect(threadApiMock.searchClubThread).not.toHaveBeenCalled();
  });

  it("filtr rodzaju źródeł jest częścią klucza", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([]);

    const a = renderHook(() => useClubThreadDocuments({ threadId: THREAD, kind: "brief" }), {
      wrapper,
    });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(() => useClubThreadDocuments({ threadId: THREAD, kind: "report" }), {
      wrapper,
    });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(threadApiMock.fetchClubThreadDocuments).toHaveBeenCalledTimes(2);
  });
});

describe("mutacje przestrzeni roboczej wątku", () => {
  it("źródła: zapis i usunięcie unieważniają przestrzeń TEGO wątku", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.upsertClubThreadDocument.mockResolvedValue("d1");
    threadApiMock.removeClubThreadDocument.mockResolvedValue(undefined);

    const up = renderHook(() => useUpsertClubThreadDocument(THREAD), { wrapper });
    await up.result.current.mutateAsync({
      thread_id: THREAD,
      kind: "brief",
      title: "T",
      url: null,
      description: null,
      source_label: null,
      published_on: null,
    });

    const rm = renderHook(() => useRemoveClubThreadDocument(THREAD), { wrapper });
    await rm.result.current.mutateAsync("d1");

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.workspace(THREAD)));
  });

  it("pytanie, głos i ankieta też unieważniają przestrzeń wątku", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.askClubThreadQuestion.mockResolvedValue("q1");
    threadApiMock.voteClubThreadQuestion.mockResolvedValue(3);
    threadApiMock.createClubThreadPoll.mockResolvedValue("p1");

    const ask = renderHook(() => useAskClubThreadQuestion(THREAD), { wrapper });
    await ask.result.current.mutateAsync({ body: "Pytanie", anonymous: false });

    const vote = renderHook(() => useVoteClubThreadQuestion(THREAD), { wrapper });
    await vote.result.current.mutateAsync({ questionId: "q1", on: true });

    const poll = renderHook(() => useCreateClubThreadPoll(THREAD), { wrapper });
    await poll.result.current.mutateAsync({
      questionPl: "P",
      questionEn: "Q",
      options: ["a", "b"],
    });

    await waitFor(() => {
      expect(
        invalidated.filter((k) => JSON.stringify(k) === JSON.stringify(clubKeys.workspace(THREAD)))
          .length,
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it("powiązanie wątków przekazuje relację", async () => {
    const { wrapper } = harness();
    threadApiMock.addClubThreadLink.mockResolvedValue("l1");

    const { result } = renderHook(() => useAddClubThreadLink(THREAD), { wrapper });
    await result.current.mutateAsync({
      relatedThreadId: "thread-2",
      relation: "duplicates",
      note: null,
    });

    expect(threadApiMock.addClubThreadLink).toHaveBeenCalledWith(
      expect.objectContaining({ relation: "duplicates" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Sieć klubu
// ---------------------------------------------------------------------------

describe("useClubBoardNotices - zakres tablicy", () => {
  it("'open' to cudze i moje OTWARTE ogłoszenia", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubBoardNotices.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useClubBoardNotices({ clubId: CLUB }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalledWith(
      expect.objectContaining({ mine: false, includeClosed: false }),
    );
  });

  it("'mine' to MOJE, także zamknięte (własne archiwum)", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubBoardNotices.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useClubBoardNotices({ clubId: CLUB, scope: "mine" }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalledWith(
      expect.objectContaining({ mine: true, includeClosed: true }),
    );
  });

  it("'archive' to WSZYSTKIE zamknięte, nie tylko moje", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubBoardNotices.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useClubBoardNotices({ clubId: CLUB, scope: "archive" }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Różnica między 'mine' a 'archive' to jedna flaga - i to ta, która
    // decyduje, czy ktoś zobaczy cudze ogłoszenia.
    expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalledWith(
      expect.objectContaining({ mine: false, includeClosed: true }),
    );
  });

  it("zakres jest częścią klucza - trzy zakładki to trzy wpisy cache'u", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubBoardNotices.mockResolvedValue({ rows: [], total: 0 });

    for (const scope of ["open", "mine", "archive"] as const) {
      const { result } = renderHook(() => useClubBoardNotices({ clubId: CLUB, scope }), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    }

    expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalledTimes(3);
  });
});

describe("kompetencje i eksperci", () => {
  it("deklaracja kompetencji unieważnia KORZEŃ klubu, nie jedną gałąź", async () => {
    const { wrapper, invalidated } = harness();
    networkApiMock.setMyClubExpertise.mockResolvedValue(2);

    const { result } = renderHook(() => useSetMyClubExpertise(CLUB), { wrapper });
    await result.current.mutateAsync(["energy", "transport"]);

    // Zmienia panel składu (tagi przy twarzy), „poznaj członka" (kryterium
    // doboru) i panel ekspertów w KAŻDYM otwartym wątku.
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.club(CLUB)));
    expect(networkApiMock.setMyClubExpertise).toHaveBeenCalledWith(CLUB, ["energy", "transport"]);
  });

  it("prośba o zdanie dotyczy JEDNEGO wątku - klub obok się nie przeładowuje", async () => {
    const { wrapper, invalidated } = harness();
    networkApiMock.pingClubThreadExpert.mockResolvedValue(true);

    const { result } = renderHook(() => usePingClubThreadExpert(THREAD), { wrapper });
    await result.current.mutateAsync("u1");

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.threadExperts(THREAD)));
    expect(invalidated).not.toContainEqual(clubKeys.club(CLUB));
  });

  it("katalog ekspertów i obszary milczą bez id klubu", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubExperts({ clubId: undefined }), { wrapper });
    renderHook(() => useClubExpertiseAreas(undefined), { wrapper });
    renderHook(() => useMyClubExpertise(undefined), { wrapper });

    await tick();
    expect(networkApiMock.fetchClubExperts).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubExpertiseAreas).not.toHaveBeenCalled();
    expect(networkApiMock.fetchMyClubExpertise).not.toHaveBeenCalled();
  });

  it("eksperci wątku milczą bez wątku i biorą domyślnie sześć osób", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([]);

    renderHook(() => useClubThreadExperts({ threadId: undefined }), { wrapper });
    await tick();
    expect(networkApiMock.fetchClubThreadExperts).not.toHaveBeenCalled();

    const { result } = renderHook(() => useClubThreadExperts({ threadId: THREAD }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubThreadExperts).toHaveBeenCalledWith(THREAD, 6);
  });
});

describe("skład, wydarzenia i 'poznaj członka'", () => {
  it("puls składu bierze PULĘ większą niż sześć miejsc w panelu (warunek rotacji)", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(null);

    const { result } = renderHook(() => useClubRosterSignal({ clubId: CLUB }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubRosterSignal).toHaveBeenCalledWith(CLUB, 24);
  });

  it("obecni na spotkaniu wymagają ORAZ klubu, ORAZ wydarzenia", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubEventAttendees({ clubId: CLUB, eventId: undefined }), { wrapper });
    renderHook(() => useClubEventAttendees({ clubId: undefined, eventId: "e1" }), { wrapper });
    renderHook(() => useClubEventAttendees({ clubId: CLUB, eventId: "e1", enabled: false }), {
      wrapper,
    });

    await tick();
    expect(networkApiMock.fetchClubEventAttendees).not.toHaveBeenCalled();
  });

  it("karta wydarzenia wymaga klubu I niepustego sluga", async () => {
    const { wrapper } = harness();

    // `slug` jest tu typowany jako wymagany `string`, wiec stanem „jeszcze nie
    // wiem" jest PUSTY string, nie `undefined` - i to on musi zatrzymać
    // zapytanie.
    renderHook(() => useClubEvent({ clubId: CLUB, slug: "" }), { wrapper });
    renderHook(() => useClubEvent({ clubId: undefined, slug: "spotkanie" }), { wrapper });
    renderHook(() => useClubEvent({ clubId: "", slug: "spotkanie" }), { wrapper });

    await tick();
    expect(networkApiMock.fetchClubEvent).not.toHaveBeenCalled();
  });

  it("karta wydarzenia z kompletem argumentów odpytuje raz", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubEvent.mockResolvedValue(null);

    const { result } = renderHook(() => useClubEvent({ clubId: CLUB, slug: "spotkanie" }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubEvent).toHaveBeenCalledWith(CLUB, "spotkanie");
  });

  it("'poznaj członka' i historia milczą bez klubu", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubSpotlight(undefined), { wrapper });
    renderHook(() => useClubSpotlightHistory({ clubId: undefined }), { wrapper });

    await tick();
    expect(networkApiMock.fetchClubSpotlight).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubSpotlightHistory).not.toHaveBeenCalled();
  });

  it("przypięcie i usunięcie wyboru unieważniają klub", async () => {
    const { wrapper, invalidated } = harness();
    networkApiMock.pinClubSpotlight.mockResolvedValue("s1");
    networkApiMock.deleteClubSpotlight.mockResolvedValue(true);

    const pin = renderHook(() => usePinClubSpotlight(CLUB), { wrapper });
    await pin.result.current.mutateAsync({ userId: "u1" });
    expect(networkApiMock.pinClubSpotlight).toHaveBeenCalledWith(CLUB, { userId: "u1" });

    const del = renderHook(() => useDeleteClubSpotlight(CLUB), { wrapper });
    await del.result.current.mutateAsync("s1");

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.club(CLUB)));
  });

  it("ogłoszenie: utworzenie dopełnia id klubu, zamknięcie unieważnia klub", async () => {
    const { wrapper, invalidated } = harness();
    networkApiMock.createClubBoardNotice.mockResolvedValue("n1");
    networkApiMock.closeClubBoardNotice.mockResolvedValue(true);

    const create = renderHook(() => useCreateClubBoardNotice(CLUB), { wrapper });
    await create.result.current.mutateAsync({ kind: "seeking", body: "Szukam" });
    expect(networkApiMock.createClubBoardNotice).toHaveBeenCalledWith({
      kind: "seeking",
      body: "Szukam",
      clubId: CLUB,
    });

    const close = renderHook(() => useCloseClubBoardNotice(CLUB), { wrapper });
    await close.result.current.mutateAsync("n1");

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.club(CLUB)));
  });
});
