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
  threadDocumentRow,
  threadInsightRow,
  threadLinkRow,
  threadMilestoneRow,
  threadParticipantRow,
  threadPollRow,
  threadQuestionRow,
  workspaceSearchRow,
} from "@/test/clubs/threadWorkspaceFixtures";
import {
  useClubActivitySeries,
  useClubDocuments,
  useClubEventRsvp,
  useClubEvents,
  useClubMilestones,
  useClubWorkspaceStats,
  useDeleteClubDocument,
  useDeleteClubEvent,
  useDeleteClubMilestone,
  useUpsertClubDocument,
  useUpsertClubEvent,
  useUpsertClubMilestone,
} from "@/lib/clubs/useClubWorkspace";
import {
  useAddClubThreadLink,
  useAnswerClubThreadQuestion,
  useAskClubThreadQuestion,
  useClubThreadDocuments,
  useClubThreadInsights,
  useClubThreadLinks,
  useClubThreadMilestones,
  useClubThreadParticipants,
  useClubThreadPolls,
  useClubThreadQuestions,
  useClubThreadSearch,
  useClubThreadWorkspace,
  useCreateClubThreadPoll,
  useDetachClubThreadPoll,
  useRemoveClubThreadDocument,
  useRemoveClubThreadLink,
  useRemoveClubThreadMilestone,
  useUpsertClubThreadDocument,
  useUpsertClubThreadMilestone,
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
    expect(
      invalidated.filter((k) => JSON.stringify(k) === JSON.stringify(clubKeys.club(CLUB))),
    ).toHaveLength(2);
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

// ---------------------------------------------------------------------------
// ODCZYTY PRZESTRZENI ROBOCZEJ Z ISTNIEJĄCYM KLUBEM
//
// Warunki wyżej dowodzą bramek: bez klubu nie ma zapytania. Bramka to jednak
// tylko połowa kontraktu - druga połowa jest w tym, CO dojeżdża do warstwy
// danych, gdy klub JEST. Bramka `clubId !== undefined && clubId !== ""` ma
// dwa człony, bo trasa panelu podstawia PUSTY NAPIS (parametr ścieżki, który
// jeszcze nie dojechał), a `Boolean("")` i `"" !== undefined` to dwie różne
// odpowiedzi - bez drugiego członu każde wejście w zakładkę zaczynałoby się
// od zapytania o klub o pustym identyfikatorze.
// ---------------------------------------------------------------------------

describe("kalendarz, harmonogram i pomiar - odczyt z identyfikatorem klubu", () => {
  it("kalendarz przekazuje okno dat, rodzaj i limit", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubEvents.mockResolvedValue([]);

    const { result } = renderHook(
      () =>
        useClubEvents({
          clubId: CLUB,
          from: "2026-09-01",
          to: "2026-09-30",
          kind: "meeting",
          limit: 25,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workspaceApiMock.fetchClubEvents).toHaveBeenCalledWith({
      clubId: CLUB,
      from: "2026-09-01",
      to: "2026-09-30",
      kind: "meeting",
      limit: 25,
    });
  });

  it("kalendarz bez zawężeń jedzie z domyślnym limitem i pustym oknem", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubEvents.mockResolvedValue([]);

    const { result } = renderHook(() => useClubEvents({ clubId: CLUB }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workspaceApiMock.fetchClubEvents).toHaveBeenCalledWith({
      clubId: CLUB,
      from: null,
      to: null,
      kind: null,
      limit: 200,
    });
  });

  it("harmonogram i przekrój czytają po identyfikatorze klubu", async () => {
    const { wrapper } = harness();
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([]);
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(null);

    const milestones = renderHook(() => useClubMilestones(CLUB), { wrapper });
    await waitFor(() => expect(milestones.result.current.isSuccess).toBe(true));
    expect(workspaceApiMock.fetchClubMilestones).toHaveBeenCalledWith(CLUB);

    const stats = renderHook(() => useClubWorkspaceStats(CLUB), { wrapper });
    await waitFor(() => expect(stats.result.current.isSuccess).toBe(true));
    // Domyślne okno przekroju to 30 dni - dłuższe niż domyślne 90 dni serii,
    // bo to dwa różne pytania: „ile się dzieje teraz" i „jak szedł kwartał".
    expect(workspaceApiMock.fetchClubWorkspaceStats).toHaveBeenCalledWith(CLUB, 30);
  });

  it("PUSTY identyfikator klubu też nie odpytuje - trasa podstawia go przed dojechaniem", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubDocuments({ clubId: "" }), { wrapper });
    renderHook(() => useClubEvents({ clubId: "" }), { wrapper });
    renderHook(() => useClubMilestones(""), { wrapper });
    renderHook(() => useClubActivitySeries("", 30), { wrapper });
    renderHook(() => useClubWorkspaceStats("", 30), { wrapper });

    await tick();
    expect(workspaceApiMock.fetchClubDocuments).not.toHaveBeenCalled();
    expect(workspaceApiMock.fetchClubEvents).not.toHaveBeenCalled();
    expect(workspaceApiMock.fetchClubMilestones).not.toHaveBeenCalled();
    expect(workspaceApiMock.fetchClubActivitySeries).not.toHaveBeenCalled();
    expect(workspaceApiMock.fetchClubWorkspaceStats).not.toHaveBeenCalled();
  });

  it("wymuszony refetch bez klubu posyła PUSTY NAPIS, nie `undefined`", async () => {
    // `refetch()` omija bramkę `enabled` - robi tak każdy przycisk „odśwież"
    // wpięty w wynik hooka. Wtedy o argumencie decyduje zapas `?? ""`, a nie
    // bramka. `undefined` znika przy serializacji i RPC dostaje wywołanie bez
    // parametru zamiast pustego wyniku.
    const { wrapper } = harness();
    workspaceApiMock.fetchClubDocuments.mockResolvedValue({ rows: [], total: 0 });
    workspaceApiMock.fetchClubEvents.mockResolvedValue([]);
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([]);
    workspaceApiMock.fetchClubActivitySeries.mockResolvedValue([]);
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(null);

    const documents = renderHook(() => useClubDocuments({ clubId: undefined }), { wrapper });
    await documents.result.current.refetch();
    expect(workspaceApiMock.fetchClubDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: "" }),
    );

    const events = renderHook(() => useClubEvents({ clubId: undefined }), { wrapper });
    await events.result.current.refetch();
    expect(workspaceApiMock.fetchClubEvents).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: "" }),
    );

    const milestones = renderHook(() => useClubMilestones(undefined), { wrapper });
    await milestones.result.current.refetch();
    expect(workspaceApiMock.fetchClubMilestones).toHaveBeenCalledWith("");

    const series = renderHook(() => useClubActivitySeries(undefined), { wrapper });
    await series.result.current.refetch();
    // Domyślne okno serii to 90 dni - kwartał, bo wykres aktywności poniżej
    // kwartału nie pokazuje trendu, tylko szum.
    expect(workspaceApiMock.fetchClubActivitySeries).toHaveBeenCalledWith("", 90);

    const stats = renderHook(() => useClubWorkspaceStats(undefined), { wrapper });
    await stats.result.current.refetch();
    expect(workspaceApiMock.fetchClubWorkspaceStats).toHaveBeenCalledWith("", 30);
  });
});

// ---------------------------------------------------------------------------
// KASOWANIE W PRZESTRZENI ROBOCZEJ
//
// Kasowanie wydarzenia i etapu to operacje NISZCZĄCE: nie ma po nich cofnięcia
// w interfejsie. Przedmiotem dowodu są dwie rzeczy: (1) unieważniany jest
// KORZEŃ klubu, bo przekrój `club_workspace_stats` liczy wydarzenia i etapy -
// punktowa inwalidacja zostawiłaby skasowane wydarzenie w kafelku pomiaru;
// (2) ODMOWA bazy nie unieważnia NICZEGO, więc lista nie przeładowuje się tak,
// jakby usunięcie się powiodło.
// ---------------------------------------------------------------------------

describe("kasowanie wydarzenia i etapu", () => {
  it("usunięcie wydarzenia idzie po identyfikatorze i unieważnia korzeń klubu", async () => {
    const { wrapper, invalidated } = harness();
    workspaceApiMock.deleteClubEvent.mockResolvedValue(true);

    const { result } = renderHook(() => useDeleteClubEvent(CLUB), { wrapper });
    await result.current.mutateAsync("event-1");

    // `mutationFn` przekazana wprost - react-query dokłada drugi argument.
    expect(workspaceApiMock.deleteClubEvent.mock.calls[0]?.[0]).toBe("event-1");
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.club(CLUB)));
  });

  it("usunięcie etapu ma ten sam skutek - harmonogram też jest liczony w przekroju", async () => {
    const { wrapper, invalidated } = harness();
    workspaceApiMock.deleteClubMilestone.mockResolvedValue(true);

    const { result } = renderHook(() => useDeleteClubMilestone(CLUB), { wrapper });
    await result.current.mutateAsync("milestone-1");

    expect(workspaceApiMock.deleteClubMilestone.mock.calls[0]?.[0]).toBe("milestone-1");
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.club(CLUB)));
  });

  it("ODMOWA bazy nie unieważnia niczego - kalendarz nie udaje, że skasował", async () => {
    const { wrapper, invalidated } = harness();
    workspaceApiMock.deleteClubEvent.mockRejectedValue(new Error("forbidden"));

    const { result } = renderHook(() => useDeleteClubEvent(CLUB), { wrapper });
    await expect(result.current.mutateAsync("event-1")).rejects.toThrow("forbidden");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated).toEqual([]);
    expect(result.current.isSuccess).toBe(false);
  });

  it("ODMOWA przy kasowaniu etapu również zostawia cache nietknięty", async () => {
    const { wrapper, invalidated } = harness();
    workspaceApiMock.deleteClubMilestone.mockRejectedValue(new Error("forbidden"));

    const { result } = renderHook(() => useDeleteClubMilestone(CLUB), { wrapper });
    await expect(result.current.mutateAsync("milestone-1")).rejects.toThrow("forbidden");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// HARMONOGRAM, PYTANIA, ANKIETY I POWIĄZANIA WĄTKU - DRUGA POŁOWA KONTRAKTU
//
// Warunki wyżej dowodzą bramek: bez identyfikatora wątku nie ma zapytania.
// Bramka to jednak tylko połowa umowy. Druga połowa jest w tym, CO dojeżdża
// do RPC, gdy wątek JEST, i co się dzieje, gdy baza ODMAWIA.
//
// Odpięcie ankiety, usunięcie etapu i zerwanie powiązania to operacje
// NISZCZĄCE - interfejs nie ma dla nich cofnięcia. Dowodem nie jest więc to,
// że „się wywołało", tylko to, że po ODMOWIE nie unieważniono NICZEGO: panel
// nie przeładowuje się tak, jakby usunięcie się powiodło, a wynik mutacji
// nie mówi „gotowe".
// ---------------------------------------------------------------------------

describe("harmonogram wątku - okno dat", () => {
  it("okno dat jedzie do RPC, a jego brak jako jawne `null`", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);

    const bare = renderHook(() => useClubThreadMilestones({ threadId: THREAD }), { wrapper });
    await waitFor(() => expect(bare.result.current.isSuccess).toBe(true));
    // `null`, nie `undefined`: brak zawężenia ma dojechać jako WARTOŚĆ, bo
    // pominięty argument RPC i argument pusty to w PostgREST dwa różne
    // wywołania.
    expect(threadApiMock.fetchClubThreadMilestones).toHaveBeenCalledWith({
      threadId: THREAD,
      from: null,
      to: null,
    });
    expect(bare.result.current.data?.[0]?.id).toBe("milestone-1");

    const windowed = renderHook(
      () => useClubThreadMilestones({ threadId: THREAD, from: "2026-09-01", to: "2026-09-30" }),
      { wrapper },
    );
    await waitFor(() => expect(windowed.result.current.isSuccess).toBe(true));
    expect(threadApiMock.fetchClubThreadMilestones).toHaveBeenLastCalledWith({
      threadId: THREAD,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    // Okno jest częścią klucza - inaczej przełączenie miesiąca w kalendarzu
    // pokazywałoby etapy z poprzedniego.
    expect(threadApiMock.fetchClubThreadMilestones).toHaveBeenCalledTimes(2);
  });

  it("harmonogram milczy bez identyfikatora wątku", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubThreadMilestones({ threadId: undefined }), { wrapper });

    await tick();
    expect(threadApiMock.fetchClubThreadMilestones).not.toHaveBeenCalled();
  });

  it("zapis etapu unieważnia CAŁĄ przestrzeń wątku, nie samą listę etapów", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.upsertClubThreadMilestone.mockResolvedValue("milestone-9");

    const { result } = renderHook(() => useUpsertClubThreadMilestone(THREAD), { wrapper });
    const id = await result.current.mutateAsync({
      thread_id: THREAD,
      kind: "meeting",
      status: "planned",
      title: "Posiedzenie zespołu",
      description: null,
      starts_at: "2026-09-14T09:00:00.000Z",
      ends_at: null,
      all_day: false,
      location: null,
      url: null,
    });

    expect(id).toBe("milestone-9");
    // `mutationFn` przekazana wprost - react-query dokłada drugi argument.
    expect(threadApiMock.upsertClubThreadMilestone.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ thread_id: THREAD, kind: "meeting" }),
    );
    // Belka zakładek liczy etapy - punktowa inwalidacja zostawiłaby na niej
    // starą liczbę.
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.workspace(THREAD)));
  });

  it("usunięcie etapu unieważnia przestrzeń wątku", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.removeClubThreadMilestone.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRemoveClubThreadMilestone(THREAD), { wrapper });
    await result.current.mutateAsync("milestone-1");

    expect(threadApiMock.removeClubThreadMilestone.mock.calls[0]?.[0]).toBe("milestone-1");
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.workspace(THREAD)));
  });

  it("ODMOWA przy usuwaniu etapu nie unieważnia niczego", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.removeClubThreadMilestone.mockRejectedValue(new Error("clubs: forbidden"));

    const { result } = renderHook(() => useRemoveClubThreadMilestone(THREAD), { wrapper });
    await expect(result.current.mutateAsync("milestone-1")).rejects.toThrow("clubs: forbidden");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated).toEqual([]);
    expect(result.current.isSuccess).toBe(false);
  });
});

describe("pytania, ankiety i powiązania - skutek i odmowa", () => {
  it("odpowiedź na pytanie niesie treść ORAZ status i unieważnia przestrzeń", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.answerClubThreadQuestion.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAnswerClubThreadQuestion(THREAD), { wrapper });
    await result.current.mutateAsync({
      questionId: "question-1",
      body: "Koszt bilansowania liczymy z krzywej obciążenia.",
      status: "answered",
    });

    // Status jedzie razem z treścią: odpowiedź BEZ przestawienia statusu
    // zostawiłaby pytanie na liście „bez odpowiedzi".
    expect(threadApiMock.answerClubThreadQuestion.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ questionId: "question-1", status: "answered" }),
    );
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.workspace(THREAD)));
  });

  it("ODMOWA przy odpowiadaniu nie zostawia interfejsu w stanie 'odpowiedziane'", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.answerClubThreadQuestion.mockRejectedValue(new Error("clubs: forbidden"));

    const { result } = renderHook(() => useAnswerClubThreadQuestion(THREAD), { wrapper });
    await expect(
      result.current.mutateAsync({ questionId: "question-1", body: "x" }),
    ).rejects.toThrow("clubs: forbidden");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated).toEqual([]);
    expect(result.current.isSuccess).toBe(false);
  });

  it("odpięcie ankiety idzie po identyfikatorze powiązania i unieważnia przestrzeń", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.detachClubThreadPoll.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDetachClubThreadPoll(THREAD), { wrapper });
    await result.current.mutateAsync("thread-poll-1");

    // Odpinamy WPIS ankiety w wątku, nie samą ankietę - `thread-poll-1`, nie
    // `poll-1`. Pomyłka skasowałaby głosowanie razem z oddanymi głosami.
    expect(threadApiMock.detachClubThreadPoll.mock.calls[0]?.[0]).toBe("thread-poll-1");
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.workspace(THREAD)));
  });

  it("ODMOWA przy odpinaniu ankiety nie unieważnia niczego", async () => {
    const { wrapper, invalidated } = harness();
    threadApiMock.detachClubThreadPoll.mockRejectedValue(new Error("clubs: forbidden"));

    const { result } = renderHook(() => useDetachClubThreadPoll(THREAD), { wrapper });
    await expect(result.current.mutateAsync("thread-poll-1")).rejects.toThrow("clubs: forbidden");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated).toEqual([]);
  });

  it("zerwanie powiązania unieważnia przestrzeń, a odmowa - nie", async () => {
    const ok = harness();
    threadApiMock.removeClubThreadLink.mockResolvedValue(undefined);
    const removed = renderHook(() => useRemoveClubThreadLink(THREAD), { wrapper: ok.wrapper });
    await removed.result.current.mutateAsync("link-1");
    expect(threadApiMock.removeClubThreadLink.mock.calls[0]?.[0]).toBe("link-1");
    await waitFor(() => expect(ok.invalidated).toContainEqual(clubKeys.workspace(THREAD)));

    const denied = harness();
    threadApiMock.removeClubThreadLink.mockRejectedValue(new Error("clubs: forbidden"));
    const failed = renderHook(() => useRemoveClubThreadLink(THREAD), { wrapper: denied.wrapper });
    await expect(failed.result.current.mutateAsync("link-1")).rejects.toThrow("clubs: forbidden");
    await waitFor(() => expect(failed.result.current.isError).toBe(true));
    expect(denied.invalidated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ODCZYTY WĄTKU Z IDENTYFIKATOREM - CO DOJEŻDŻA DO RPC I CO WRACA
// ---------------------------------------------------------------------------

describe("odczyty przestrzeni wątku z identyfikatorem", () => {
  it("przekrój przepisuje liczniki wiersza na podsumowanie belki", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadWorkspace.mockResolvedValue({
      thread_id: THREAD,
      document_count: 3,
      milestone_count: 2,
      upcoming_count: 1,
      question_count: 5,
      open_question_count: 2,
      poll_count: 1,
      open_poll_count: 1,
      link_count: 4,
      participant_count: 7,
      reply_count: 12,
      next_milestone_at: "2026-09-14T09:00:00.000Z",
      can_contribute: true,
      can_curate: false,
    });

    const { result } = renderHook(() => useClubThreadWorkspace(THREAD), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(threadApiMock.fetchClubThreadWorkspace).toHaveBeenCalledWith(THREAD);
    expect(result.current.data?.openQuestions).toBe(2);
    expect(result.current.data?.canContribute).toBe(true);
    expect(result.current.data?.canCurate).toBe(false);
  });

  it("pytania: domyślny porządek to 'top', a status i porządek są częścią klucza", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([threadQuestionRow()]);

    const bare = renderHook(() => useClubThreadQuestions({ threadId: THREAD }), { wrapper });
    await waitFor(() => expect(bare.result.current.isSuccess).toBe(true));
    // „Najczęściej pytane" na wejściu, bo lista pytań ma pokazywać to, co
    // powtarza kilka osób, a nie ostatnie zdanie ostatniej osoby.
    expect(threadApiMock.fetchClubThreadQuestions).toHaveBeenCalledWith({
      threadId: THREAD,
      status: null,
      sort: "top",
    });
    expect(bare.result.current.data?.[0]?.id).toBe("question-1");

    const sorted = renderHook(
      () => useClubThreadQuestions({ threadId: THREAD, status: "open", sort: "newest" }),
      { wrapper },
    );
    await waitFor(() => expect(sorted.result.current.isSuccess).toBe(true));
    expect(threadApiMock.fetchClubThreadQuestions).toHaveBeenLastCalledWith({
      threadId: THREAD,
      status: "open",
      sort: "newest",
    });
    expect(threadApiMock.fetchClubThreadQuestions).toHaveBeenCalledTimes(2);
  });

  it("ankiety, powiązania i skład czytają po identyfikatorze wątku", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([threadPollRow()]);
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([threadLinkRow()]);
    threadApiMock.fetchClubThreadParticipants.mockResolvedValue([threadParticipantRow()]);

    const polls = renderHook(() => useClubThreadPolls({ threadId: THREAD }), { wrapper });
    await waitFor(() => expect(polls.result.current.isSuccess).toBe(true));
    expect(threadApiMock.fetchClubThreadPolls).toHaveBeenCalledWith(THREAD);
    expect(polls.result.current.data?.[0]?.poll_id).toBe("poll-1");

    const links = renderHook(() => useClubThreadLinks({ threadId: THREAD }), { wrapper });
    await waitFor(() => expect(links.result.current.isSuccess).toBe(true));
    expect(threadApiMock.fetchClubThreadLinks).toHaveBeenCalledWith(THREAD);
    expect(links.result.current.data?.[0]?.relation).toBe("continues");

    const people = renderHook(() => useClubThreadParticipants({ threadId: THREAD, limit: 50 }), {
      wrapper,
    });
    await waitFor(() => expect(people.result.current.isSuccess).toBe(true));
    expect(threadApiMock.fetchClubThreadParticipants).toHaveBeenCalledWith({
      threadId: THREAD,
      limit: 50,
    });
  });

  it("pomiar bierze domyślnie 24 przedziały, a liczba przedziałów jest w kluczu", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadInsights.mockResolvedValue([threadInsightRow()]);

    const bare = renderHook(() => useClubThreadInsights({ threadId: THREAD }), { wrapper });
    await waitFor(() => expect(bare.result.current.isSuccess).toBe(true));
    // 24 słupki - tyle, ile rysuje widżet. Zmiana tej liczby zmienia WYKRES,
    // więc musi zmieniać też klucz.
    expect(threadApiMock.fetchClubThreadInsights).toHaveBeenCalledWith({
      threadId: THREAD,
      buckets: 24,
    });

    const coarse = renderHook(() => useClubThreadInsights({ threadId: THREAD, buckets: 6 }), {
      wrapper,
    });
    await waitFor(() => expect(coarse.result.current.isSuccess).toBe(true));
    expect(threadApiMock.fetchClubThreadInsights).toHaveBeenLastCalledWith({
      threadId: THREAD,
      buckets: 6,
    });
    expect(threadApiMock.fetchClubThreadInsights).toHaveBeenCalledTimes(2);
  });

  it("wyszukiwarka odpala się od dwóch znaków i wysyła frazę PRZYCIĘTĄ", async () => {
    const { wrapper } = harness();
    threadApiMock.searchClubThread.mockResolvedValue([workspaceSearchRow()]);

    const short = renderHook(() => useClubThreadSearch({ threadId: THREAD, query: " a " }), {
      wrapper,
    });
    await tick();
    expect(short.result.current.isPending).toBe(true);
    expect(threadApiMock.searchClubThread).not.toHaveBeenCalled();

    const { result } = renderHook(
      () => useClubThreadSearch({ threadId: THREAD, query: "  bilansowanie  " }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(threadApiMock.searchClubThread).toHaveBeenCalledWith({
      threadId: THREAD,
      query: "bilansowanie",
    });
    expect(result.current.data?.[0]?.section).toBe("reply");
  });

  it("źródła: filtr rodzaju i limit dojeżdżają razem", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);

    const { result } = renderHook(
      () => useClubThreadDocuments({ threadId: THREAD, kind: "dataset", limit: 5 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(threadApiMock.fetchClubThreadDocuments).toHaveBeenCalledWith({
      threadId: THREAD,
      kind: "dataset",
      limit: 5,
    });
    expect(result.current.data?.[0]?.id).toBe("doc-1");
  });
});

// ---------------------------------------------------------------------------
// WYMUSZONY REFETCH BEZ WĄTKU
//
// `refetch()` OMIJA bramkę `enabled` - robi tak każdy przycisk „odśwież"
// wpięty w wynik hooka, a także `queryClient.refetchQueries`. O tym, co wtedy
// dojedzie do warstwy danych, decyduje zapas `?? ""`, a nie bramka.
// `undefined` znika przy serializacji ciała RPC, więc PostgREST dostaje
// wywołanie BEZ parametru (i błąd „function does not exist") zamiast pustego
// wyniku. Pusty napis jest tu jedynym bezpiecznym argumentem.
// ---------------------------------------------------------------------------

describe("wymuszony refetch bez identyfikatora wątku", () => {
  it("każdy odczyt wątku posyła PUSTY NAPIS, nie `undefined`", async () => {
    const { wrapper } = harness();
    threadApiMock.fetchClubThreadWorkspace.mockResolvedValue(null);
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([]);
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([]);
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([]);
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([]);
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([]);
    threadApiMock.fetchClubThreadParticipants.mockResolvedValue([]);
    threadApiMock.fetchClubThreadInsights.mockResolvedValue([]);
    threadApiMock.searchClubThread.mockResolvedValue([]);

    const summary = renderHook(() => useClubThreadWorkspace(undefined), { wrapper });
    await summary.result.current.refetch();
    expect(threadApiMock.fetchClubThreadWorkspace).toHaveBeenCalledWith("");

    const documents = renderHook(() => useClubThreadDocuments({ threadId: undefined }), {
      wrapper,
    });
    await documents.result.current.refetch();
    expect(threadApiMock.fetchClubThreadDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "" }),
    );

    const milestones = renderHook(() => useClubThreadMilestones({ threadId: undefined }), {
      wrapper,
    });
    await milestones.result.current.refetch();
    expect(threadApiMock.fetchClubThreadMilestones).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "" }),
    );

    const questions = renderHook(() => useClubThreadQuestions({ threadId: undefined }), {
      wrapper,
    });
    await questions.result.current.refetch();
    expect(threadApiMock.fetchClubThreadQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "" }),
    );

    const polls = renderHook(() => useClubThreadPolls({ threadId: undefined }), { wrapper });
    await polls.result.current.refetch();
    expect(threadApiMock.fetchClubThreadPolls).toHaveBeenCalledWith("");

    const links = renderHook(() => useClubThreadLinks({ threadId: undefined }), { wrapper });
    await links.result.current.refetch();
    expect(threadApiMock.fetchClubThreadLinks).toHaveBeenCalledWith("");

    const people = renderHook(() => useClubThreadParticipants({ threadId: undefined }), {
      wrapper,
    });
    await people.result.current.refetch();
    expect(threadApiMock.fetchClubThreadParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "" }),
    );

    const insights = renderHook(() => useClubThreadInsights({ threadId: undefined }), { wrapper });
    await insights.result.current.refetch();
    expect(threadApiMock.fetchClubThreadInsights).toHaveBeenCalledWith({
      threadId: "",
      buckets: 24,
    });

    const search = renderHook(
      () => useClubThreadSearch({ threadId: undefined, query: "energia" }),
      {
        wrapper,
      },
    );
    await search.result.current.refetch();
    expect(threadApiMock.searchClubThread).toHaveBeenCalledWith({
      threadId: "",
      query: "energia",
    });
  });

  it("wątek bez identyfikatora ma WŁASNY klucz 'none' - nie podszywa się pod cudzy", async () => {
    const { wrapper, queryClient } = harness();
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([]);
    threadApiMock.searchClubThread.mockResolvedValue([]);

    const polls = renderHook(() => useClubThreadPolls({ threadId: undefined }), { wrapper });
    await polls.result.current.refetch();
    const search = renderHook(
      () => useClubThreadSearch({ threadId: undefined, query: "energia" }),
      {
        wrapper,
      },
    );
    await search.result.current.refetch();

    // Gdyby zapas był pustym napisem także w KLUCZU, wynik odświeżenia
    // „bez wątku" wpadłby do wpisu wątku o pustym identyfikatorze i mógłby
    // zostać podany innemu ekranowi.
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => JSON.stringify(entry.queryKey));
    expect(keys).toContain(JSON.stringify(clubKeys.threadPolls("none")));
    expect(keys).toContain(JSON.stringify(clubKeys.workspaceSearch("none", "energia")));
  });
});

// ---------------------------------------------------------------------------
// SIEĆ KLUBU - ODCZYTY Z IDENTYFIKATOREM
//
// Bramka każdego z tych hooków ma DWA człony: `clubId !== undefined` ORAZ
// `clubId !== ""`. Drugi nie jest zdobieniem - trasa panelu podstawia PUSTY
// NAPIS jako parametr ścieżki, zanim router go rozwiąże, a `"" !== undefined`
// jest prawdą. Bez drugiego członu każde wejście na ekran zaczynałoby się od
// zapytania o klub o pustym identyfikatorze. Warunki poniżej dowodzą OBU
// członów: z prawdziwym klubem zapytanie jedzie, z pustym - nie.
// ---------------------------------------------------------------------------

describe("sieć klubu - odczyty z identyfikatorem", () => {
  it("moje kompetencje, obszary i katalog ekspertów czytają po klubie", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchMyClubExpertise.mockResolvedValue(["energy"]);
    networkApiMock.fetchClubExpertiseAreas.mockResolvedValue([
      { topic: "energy", experts: 4, is_mine: true },
    ]);
    networkApiMock.fetchClubExperts.mockResolvedValue({ rows: [], total: 0 });

    const mine = renderHook(() => useMyClubExpertise(CLUB), { wrapper });
    await waitFor(() => expect(mine.result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchMyClubExpertise).toHaveBeenCalledWith(CLUB);
    expect(mine.result.current.data).toEqual(["energy"]);

    const areas = renderHook(() => useClubExpertiseAreas(CLUB), { wrapper });
    await waitFor(() => expect(areas.result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubExpertiseAreas).toHaveBeenCalledWith(CLUB);
    expect(areas.result.current.data?.[0]?.topic).toBe("energy");

    const experts = renderHook(() => useClubExperts({ clubId: CLUB }), { wrapper });
    await waitFor(() => expect(experts.result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubExperts).toHaveBeenCalledWith({
      clubId: CLUB,
      topic: null,
      search: "",
      limit: 24,
      offset: 0,
    });
  });

  it("katalog ekspertów: klucz nosi frazę PRZYCIĘTĄ, a filtr i stronicowanie dzielą wpisy", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubExperts.mockResolvedValue({ rows: [], total: 0 });

    const padded = renderHook(() => useClubExperts({ clubId: CLUB, search: "  hydro  " }), {
      wrapper,
    });
    await waitFor(() => expect(padded.result.current.isSuccess).toBe(true));
    // Fraza jedzie do RPC SUROWA (przycina ją `websearch_to_tsquery`), ale do
    // klucza - przycięta: dopisanie spacji nie ma odpalać nowego zapytania.
    expect(networkApiMock.fetchClubExperts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "  hydro  " }),
    );

    const trimmed = renderHook(() => useClubExperts({ clubId: CLUB, search: "hydro" }), {
      wrapper,
    });
    await waitFor(() => expect(trimmed.result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubExperts).toHaveBeenCalledTimes(1);

    const paged = renderHook(
      () => useClubExperts({ clubId: CLUB, topic: "energy", offset: 24, limit: 12 }),
      { wrapper },
    );
    await waitFor(() => expect(paged.result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubExperts).toHaveBeenLastCalledWith({
      clubId: CLUB,
      topic: "energy",
      search: "",
      limit: 12,
      offset: 24,
    });
  });

  it("'poznaj członka', archiwum i sygnał składu czytają po klubie z własnymi limitami", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubSpotlight.mockResolvedValue(null);
    networkApiMock.fetchClubSpotlightHistory.mockResolvedValue([]);
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(null);

    const spotlight = renderHook(() => useClubSpotlight(CLUB), { wrapper });
    await waitFor(() => expect(spotlight.result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubSpotlight).toHaveBeenCalledWith(CLUB);

    const history = renderHook(() => useClubSpotlightHistory({ clubId: CLUB }), { wrapper });
    await waitFor(() => expect(history.result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubSpotlightHistory).toHaveBeenCalledWith(CLUB, 12);

    const roster = renderHook(() => useClubRosterSignal({ clubId: CLUB, limit: 8 }), { wrapper });
    await waitFor(() => expect(roster.result.current.isSuccess).toBe(true));
    expect(networkApiMock.fetchClubRosterSignal).toHaveBeenCalledWith(CLUB, 8);
  });

  it("obecni na spotkaniu jadą po WYDARZENIU, choć bramka pyta też o klub", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubEventAttendees.mockResolvedValue([]);

    const { result } = renderHook(
      () => useClubEventAttendees({ clubId: CLUB, eventId: "event-1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Klub jest w KLUCZU (dwa kluby nie dzielą wpisu), ale RPC pyta wyłącznie
    // o wydarzenie - to ono nosi listę zgłoszeń.
    expect(networkApiMock.fetchClubEventAttendees).toHaveBeenCalledWith("event-1", 12);
  });

  it("PUSTY identyfikator zatrzymuje każdy odczyt sieci - trasa podstawia go przed dojechaniem", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubBoardNotices({ clubId: "" }), { wrapper });
    renderHook(() => useMyClubExpertise(""), { wrapper });
    renderHook(() => useClubExperts({ clubId: "" }), { wrapper });
    renderHook(() => useClubExpertiseAreas(""), { wrapper });
    renderHook(() => useClubSpotlight(""), { wrapper });
    renderHook(() => useClubSpotlightHistory({ clubId: "" }), { wrapper });
    renderHook(() => useClubRosterSignal({ clubId: "" }), { wrapper });
    renderHook(() => useClubThreadExperts({ threadId: "" }), { wrapper });
    renderHook(() => useClubEventAttendees({ clubId: CLUB, eventId: "" }), { wrapper });

    await tick();
    expect(networkApiMock.fetchClubBoardNotices).not.toHaveBeenCalled();
    expect(networkApiMock.fetchMyClubExpertise).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubExperts).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubExpertiseAreas).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubSpotlight).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubSpotlightHistory).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubRosterSignal).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubThreadExperts).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubEventAttendees).not.toHaveBeenCalled();
  });

  it("tablica ogłoszeń bez klubu milczy i trzyma własny klucz 'none'", async () => {
    const { wrapper, queryClient } = harness();

    renderHook(() => useClubBoardNotices({ clubId: undefined }), { wrapper });

    await tick();
    expect(networkApiMock.fetchClubBoardNotices).not.toHaveBeenCalled();
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => JSON.stringify(entry.queryKey));
    expect(keys).toContain(JSON.stringify(clubKeys.board("none", null, null, "open", 0, 8)));
  });
});

describe("wymuszony refetch bez identyfikatora klubu - warstwa sieci", () => {
  it("każdy odczyt sieci posyła PUSTY NAPIS zamiast `undefined`", async () => {
    const { wrapper } = harness();
    networkApiMock.fetchClubBoardNotices.mockResolvedValue({ rows: [], total: 0 });
    networkApiMock.fetchMyClubExpertise.mockResolvedValue([]);
    networkApiMock.fetchClubExperts.mockResolvedValue({ rows: [], total: 0 });
    networkApiMock.fetchClubExpertiseAreas.mockResolvedValue([]);
    networkApiMock.fetchClubSpotlight.mockResolvedValue(null);
    networkApiMock.fetchClubSpotlightHistory.mockResolvedValue([]);
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(null);
    networkApiMock.fetchClubThreadExperts.mockResolvedValue([]);
    networkApiMock.fetchClubEvent.mockResolvedValue(null);
    networkApiMock.fetchClubEventAttendees.mockResolvedValue([]);

    const board = renderHook(() => useClubBoardNotices({ clubId: undefined }), { wrapper });
    await board.result.current.refetch();
    expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: "", mine: false, includeClosed: false }),
    );

    const mine = renderHook(() => useMyClubExpertise(undefined), { wrapper });
    await mine.result.current.refetch();
    expect(networkApiMock.fetchMyClubExpertise).toHaveBeenCalledWith("");

    const experts = renderHook(() => useClubExperts({ clubId: undefined }), { wrapper });
    await experts.result.current.refetch();
    expect(networkApiMock.fetchClubExperts).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: "" }),
    );

    const areas = renderHook(() => useClubExpertiseAreas(undefined), { wrapper });
    await areas.result.current.refetch();
    expect(networkApiMock.fetchClubExpertiseAreas).toHaveBeenCalledWith("");

    const spotlight = renderHook(() => useClubSpotlight(undefined), { wrapper });
    await spotlight.result.current.refetch();
    expect(networkApiMock.fetchClubSpotlight).toHaveBeenCalledWith("");

    const history = renderHook(() => useClubSpotlightHistory({ clubId: undefined }), { wrapper });
    await history.result.current.refetch();
    expect(networkApiMock.fetchClubSpotlightHistory).toHaveBeenCalledWith("", 12);

    const roster = renderHook(() => useClubRosterSignal({ clubId: undefined }), { wrapper });
    await roster.result.current.refetch();
    expect(networkApiMock.fetchClubRosterSignal).toHaveBeenCalledWith("", 24);

    const threadExperts = renderHook(() => useClubThreadExperts({ threadId: undefined }), {
      wrapper,
    });
    await threadExperts.result.current.refetch();
    expect(networkApiMock.fetchClubThreadExperts).toHaveBeenCalledWith("", 6);

    const event = renderHook(() => useClubEvent({ clubId: undefined, slug: "spotkanie" }), {
      wrapper,
    });
    await event.result.current.refetch();
    expect(networkApiMock.fetchClubEvent).toHaveBeenCalledWith("", "spotkanie");

    const attendees = renderHook(
      () => useClubEventAttendees({ clubId: CLUB, eventId: undefined }),
      { wrapper },
    );
    await attendees.result.current.refetch();
    expect(networkApiMock.fetchClubEventAttendees).toHaveBeenCalledWith("", 12);
  });
});
