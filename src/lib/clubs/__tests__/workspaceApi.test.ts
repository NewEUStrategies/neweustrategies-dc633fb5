// Przestrzeń robocza klubu (A28) - `workspaceApi.ts` (225 linii, 0/14 funkcji)
// i `threadWorkspaceApi.ts` (307 linii, 0/22 funkcji), obie na okrągłym zerze.
//
// To jest warstwa, przez którą przechodzą DOKUMENTY, KALENDARZ i HARMONOGRAM
// klubu - czyli treść, dla której klub w ogóle istnieje. Tabele modułu nie
// mają grantów dla klienta, więc autoryzacji tu nie ma czego sprawdzać
// (`club_thread_access` w SECURITY DEFINER, pgTAP). Zostają trzy kontrakty
// klienta, wszystkie testowalne bez bazy:
//
//   1. NAZWY ARGUMENTÓW - zgubiony `p_club_id` cicho traci zawężenie;
//   2. KSZTAŁT PATCHA przez `toJsonPayload` - `undefined` znaczy "nie ruszaj",
//      `null` znaczy "wyczyść", a różnica jest widoczna dopiero w bazie;
//   3. RÓŻNICA W OBSŁUDZE BŁĘDU między dwoma plikami. `workspaceApi` rzuca
//      oryginalnym błędem PostgREST, a `threadWorkspaceApi` przepakowuje go
//      w nowy `Error(error.message)` przez `unwrap()`. To NIE jest to samo:
//      kod SQLSTATE ginie po drodze. Test przypina jedno i drugie, żeby
//      rozjazd był widoczny, a nie odkrywany przy pierwszym mapowaniu kodu
//      odmowy na komunikat.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/integrations/supabase/client",
  async () => (await import("@/test/clubs/fixtures")).clubSupabaseMock,
);

import { CLUB_BASE_ISO, CLUB_IDS, clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import {
  deleteClubDocument,
  deleteClubEvent,
  deleteClubMilestone,
  fetchClubActivitySeries,
  fetchClubDocuments,
  fetchClubEvents,
  fetchClubMilestones,
  fetchClubWorkspaceStats,
  registerClubDocumentDownload,
  setClubEventRsvp,
  upsertClubDocument,
  upsertClubEvent,
  upsertClubMilestone,
} from "@/lib/clubs/workspaceApi";
import {
  addClubThreadLink,
  answerClubThreadQuestion,
  askClubThreadQuestion,
  createClubThreadPoll,
  detachClubThreadPoll,
  fetchClubThreadDocuments,
  fetchClubThreadInsights,
  fetchClubThreadLinks,
  fetchClubThreadMilestones,
  fetchClubThreadParticipants,
  fetchClubThreadPolls,
  fetchClubThreadQuestions,
  fetchClubThreadWorkspace,
  removeClubThreadDocument,
  removeClubThreadLink,
  removeClubThreadMilestone,
  searchClubThread,
  upsertClubThreadDocument,
  upsertClubThreadMilestone,
  voteClubThreadQuestion,
} from "@/lib/clubs/threadWorkspaceApi";

beforeEach(() => resetClubRpc());

// ---------------------------------------------------------------------------
// Biblioteka dokumentów klubu
// ---------------------------------------------------------------------------

describe("fetchClubDocuments", () => {
  it("suma pochodzi z window function w wierszu, nie z długości strony", async () => {
    clubRpc.setData("club_documents_list", [{ id: "d1", total_count: 87 }]);

    const page = await fetchClubDocuments({ clubId: CLUB_IDS.club });

    // `total_count` liczy się w oknie PRZED limitem - odsianie po stronie
    // klienta rozjechałoby licznik z listą pod nim.
    expect(page.total).toBe(87);
  });

  it("zawężenie po ZBIORZE rodzajów jedzie jako kopia tablicy", async () => {
    clubRpc.setData("club_documents_list", []);
    const kinds = ["brief", "report"] as const;

    await fetchClubDocuments({ clubId: CLUB_IDS.club, kinds });

    const sent = clubRpc.lastCall("club_documents_list")?.arg("p_kinds");
    expect(sent).toEqual(["brief", "report"]);
    // Kopia, nie referencja: RPC dostaje własną tablicę, więc mutacja po
    // stronie wywołującego nie zmienia tego, co poszło do bazy.
    expect(sent).not.toBe(kinds);
  });

  it("brak zbioru rodzajów (null i undefined) NIE jedzie jako filtr", async () => {
    clubRpc.setData("club_documents_list", []);

    await fetchClubDocuments({ clubId: CLUB_IDS.club, kinds: null });
    expect(clubRpc.lastCall("club_documents_list")?.arg("p_kinds")).toBeUndefined();

    await fetchClubDocuments({ clubId: CLUB_IDS.club });
    expect(clubRpc.lastCall("club_documents_list")?.arg("p_kinds")).toBeUndefined();
  });

  it("PUSTY zbiór rodzajów jedzie jako pusta tablica, nie jako brak filtra", async () => {
    clubRpc.setData("club_documents_list", []);

    await fetchClubDocuments({ clubId: CLUB_IDS.club, kinds: [] });

    // Pusty zbiór to świadomy wybór "żaden rodzaj", a nie "wszystkie".
    expect(clubRpc.lastCall("club_documents_list")?.arg("p_kinds")).toEqual([]);
  });

  it("domyślne limit/offset i komplet nazw argumentów", async () => {
    clubRpc.setData("club_documents_list", []);

    await fetchClubDocuments({ clubId: CLUB_IDS.club });

    expect(clubRpc.lastCall("club_documents_list")?.args).toEqual({
      p_club_id: CLUB_IDS.club,
      p_group_id: undefined,
      p_kind: undefined,
      p_kinds: undefined,
      p_search: undefined,
      p_limit: 50,
      p_offset: 0,
    });
  });

  it("null z bazy daje pustą stronę z sumą zero", async () => {
    clubRpc.setData("club_documents_list", null);
    expect(await fetchClubDocuments({ clubId: CLUB_IDS.club })).toEqual({ rows: [], total: 0 });
  });

  it("rzuca ORYGINALNYM błędem PostgREST (z kodem SQLSTATE)", async () => {
    clubRpc.setError("club_documents_list", "denied", "42501");

    await expect(fetchClubDocuments({ clubId: CLUB_IDS.club })).rejects.toMatchObject({
      message: "denied",
      code: "42501",
    });
  });
});

describe("zapis dokumentów, wydarzeń i kamieni milowych", () => {
  it("upsertClubDocument: patch przez JSON, undefined odsiane, null zachowany", async () => {
    clubRpc.setData("club_document_upsert", "doc-1");

    const id = await upsertClubDocument(CLUB_IDS.club, {
      title_pl: "Brief",
      external_url: null,
      summary_pl: undefined,
    });

    expect(id).toBe("doc-1");
    const payload = clubRpc.lastCall("club_document_upsert")?.arg("p_payload");
    expect(payload).toEqual({ title_pl: "Brief", external_url: null });
    expect(Object.keys(payload as object)).not.toContain("summary_pl");
  });

  it("upsertClubEvent i upsertClubMilestone jadą tym samym trybem", async () => {
    clubRpc.setData("club_event_upsert", "ev-1");
    clubRpc.setData("club_milestone_upsert", "ms-1");

    expect(await upsertClubEvent(CLUB_IDS.club, { title_pl: "Spotkanie" })).toBe("ev-1");
    expect(await upsertClubMilestone(CLUB_IDS.club, { title_pl: "Etap" })).toBe("ms-1");

    expect(clubRpc.lastCall("club_event_upsert")?.arg("p_club_id")).toBe(CLUB_IDS.club);
    expect(clubRpc.lastCall("club_milestone_upsert")?.arg("p_payload")).toEqual({
      title_pl: "Etap",
    });
  });

  it("kasowanie zwraca boolean, a nie 'coś prawdziwego'", async () => {
    clubRpc.setData("club_document_delete", "ok");
    clubRpc.setData("club_event_delete", true);
    clubRpc.setData("club_milestone_delete", true);

    expect(await deleteClubDocument("d")).toBe(false);
    expect(await deleteClubEvent("e")).toBe(true);
    expect(await deleteClubMilestone("m")).toBe(true);
  });
});

describe("registerClubDocumentDownload", () => {
  it("NIE rzuca przy odmowie - licznik nie ma prawa przerwać otwierania pliku", async () => {
    clubRpc.setError("club_document_register_download", "denied", "42501");

    // Odmowa bramki nie może kosztować użytkownika kliknięcia w dokument,
    // który już ma prawo otworzyć. To jedyna funkcja tej warstwy, która
    // świadomie połyka błąd - i dlatego ma tu własny test.
    await expect(registerClubDocumentDownload("doc-1")).resolves.toBeUndefined();
    expect(clubRpc.lastCall("club_document_register_download")?.arg("p_document_id")).toBe("doc-1");
  });

  it("przy powodzeniu też nic nie zwraca", async () => {
    clubRpc.setData("club_document_register_download", true);
    await expect(registerClubDocumentDownload("doc-1")).resolves.toBeUndefined();
  });
});

describe("kalendarz klubu", () => {
  it("zakres domyka się po obu stronach i ma domyślny limit 200", async () => {
    clubRpc.setData("club_events_list", []);

    await fetchClubEvents({
      clubId: CLUB_IDS.club,
      from: CLUB_BASE_ISO,
      to: CLUB_BASE_ISO,
      kind: "meeting",
    });

    expect(clubRpc.lastCall("club_events_list")?.args).toEqual({
      p_club_id: CLUB_IDS.club,
      p_from: CLUB_BASE_ISO,
      p_to: CLUB_BASE_ISO,
      p_kind: "meeting",
      p_limit: 200,
    });
  });

  it("brak zakresu nie zawęża (null schodzi na undefined)", async () => {
    clubRpc.setData("club_events_list", []);

    await fetchClubEvents({ clubId: CLUB_IDS.club, from: null, to: null });

    const call = clubRpc.lastCall("club_events_list");
    expect(call?.arg("p_from")).toBeUndefined();
    expect(call?.arg("p_to")).toBeUndefined();
  });

  it("null z bazy czyta się jak pustą listę", async () => {
    clubRpc.setData("club_events_list", null);
    expect(await fetchClubEvents({ clubId: CLUB_IDS.club })).toEqual([]);
  });

  it("RSVP przekazuje stan i zwraca boolean", async () => {
    clubRpc.setData("club_event_rsvp", true);

    expect(await setClubEventRsvp("ev-1", "going")).toBe(true);
    expect(clubRpc.lastCall("club_event_rsvp")?.arg("p_state")).toBe("going");
  });
});

describe("harmonogram i pomiar", () => {
  it("kamienie milowe: null daje pustą listę", async () => {
    clubRpc.setData("club_milestones_list", null);
    expect(await fetchClubMilestones(CLUB_IDS.club)).toEqual([]);
  });

  it("szereg aktywności przekazuje liczbę dni", async () => {
    clubRpc.setData("club_activity_series", [{ day: CLUB_BASE_ISO, threads: 2, replies: 5 }]);

    const points = await fetchClubActivitySeries(CLUB_IDS.club, 30);

    expect(points).toHaveLength(1);
    expect(clubRpc.lastCall("club_activity_series")?.arg("p_days")).toBe(30);
  });

  it("szereg aktywności: null daje pustą listę", async () => {
    clubRpc.setData("club_activity_series", null);
    expect(await fetchClubActivitySeries(CLUB_IDS.club, 7)).toEqual([]);
  });

  it("statystyki: brak wiersza to null (404, nie 403 - pomiar nie zdradza kształtu klubu)", async () => {
    clubRpc.setData("club_workspace_stats", []);
    expect(await fetchClubWorkspaceStats(CLUB_IDS.club, 30)).toBeNull();

    clubRpc.setData("club_workspace_stats", null);
    expect(await fetchClubWorkspaceStats(CLUB_IDS.club, 30)).toBeNull();
  });

  it("statystyki: pierwszy wiersz jest wynikiem", async () => {
    clubRpc.setData("club_workspace_stats", [{ threads: 12, replies: 40 }]);
    expect(await fetchClubWorkspaceStats(CLUB_IDS.club, 30)).toEqual({ threads: 12, replies: 40 });
  });
});

// ---------------------------------------------------------------------------
// Przestrzeń robocza WĄTKU
// ---------------------------------------------------------------------------

describe("źródła wątku", () => {
  it("lista dokumentów: filtr rodzaju i domyślny limit", async () => {
    clubRpc.setData("club_thread_documents_list", []);

    await fetchClubThreadDocuments({ threadId: CLUB_IDS.thread, kind: "brief", limit: 10 });

    expect(clubRpc.lastCall("club_thread_documents_list")?.args).toEqual({
      p_thread_id: CLUB_IDS.thread,
      p_kind: "brief",
      p_limit: 10,
    });
  });

  it("upsert dokumentu wątku: cały wiersz jedzie jako jsonb", async () => {
    clubRpc.setData("club_thread_document_upsert", "doc-9");

    const id = await upsertClubThreadDocument({
      thread_id: CLUB_IDS.thread,
      kind: "brief",
      title: "Analiza",
      url: null,
      description: null,
      source_label: null,
      published_on: null,
    });

    expect(id).toBe("doc-9");
    expect(clubRpc.lastCall("club_thread_document_upsert")?.arg("p_payload")).toMatchObject({
      thread_id: CLUB_IDS.thread,
      title: "Analiza",
    });
  });

  it("usunięcie dokumentu wątku nic nie zwraca", async () => {
    clubRpc.setData("club_thread_document_remove", null);
    await expect(removeClubThreadDocument("doc-1")).resolves.toBeUndefined();
  });
});

describe("kamienie milowe wątku", () => {
  it("zakres i limit jadą pod swoimi nazwami", async () => {
    clubRpc.setData("club_thread_milestones_list", []);

    await fetchClubThreadMilestones({ threadId: CLUB_IDS.thread, from: CLUB_BASE_ISO, limit: 5 });

    const call = clubRpc.lastCall("club_thread_milestones_list");
    expect(call?.arg("p_from")).toBe(CLUB_BASE_ISO);
    expect(call?.arg("p_limit")).toBe(5);
  });

  it("upsert i usunięcie", async () => {
    clubRpc.setData("club_thread_milestone_upsert", "ms-9");
    clubRpc.setData("club_thread_milestone_remove", null);

    expect(
      await upsertClubThreadMilestone({
        thread_id: CLUB_IDS.thread,
        kind: "meeting",
        status: "planned",
        title: "Etap",
        description: null,
        starts_at: CLUB_BASE_ISO,
        ends_at: null,
        all_day: false,
        location: null,
        url: null,
      }),
    ).toBe("ms-9");
    await expect(removeClubThreadMilestone("ms-9")).resolves.toBeUndefined();
  });
});

describe("pytania do wątku", () => {
  it("lista przekazuje status, sortowanie i limit", async () => {
    clubRpc.setData("club_thread_questions_list", []);

    await fetchClubThreadQuestions({
      threadId: CLUB_IDS.thread,
      status: "open",
      sort: "top",
      limit: 20,
    });

    expect(clubRpc.lastCall("club_thread_questions_list")?.args).toEqual({
      p_thread_id: CLUB_IDS.thread,
      p_status: "open",
      p_sort: "top",
      p_limit: 20,
    });
  });

  it("pytanie anonimowe przekazuje flagę JAWNIE", async () => {
    clubRpc.setData("club_thread_question_ask", "q-1");

    await askClubThreadQuestion({ threadId: CLUB_IDS.thread, body: "Pytanie", anonymous: true });

    expect(clubRpc.lastCall("club_thread_question_ask")?.arg("p_anonymous")).toBe(true);
  });

  it("odpowiedź na pytanie przekazuje status docelowy", async () => {
    clubRpc.setData("club_thread_question_answer", null);

    await answerClubThreadQuestion({
      questionId: "q-1",
      body: "Odpowiedź",
      status: "answered",
    });

    expect(clubRpc.lastCall("club_thread_question_answer")?.arg("p_status")).toBe("answered");
  });

  it("głos: kierunek jedzie jako p_on, zwrotka to liczba głosów", async () => {
    clubRpc.setData("club_thread_question_vote", 7);

    expect(await voteClubThreadQuestion({ questionId: "q-1", on: true })).toBe(7);
    expect(clubRpc.lastCall("club_thread_question_vote")?.arg("p_on")).toBe(true);

    // Cofnięcie głosu to `false`, nie brak argumentu.
    await voteClubThreadQuestion({ questionId: "q-1", on: false });
    expect(clubRpc.lastCall("club_thread_question_vote")?.arg("p_on")).toBe(false);
  });

  it("głos: nieliczbowa zwrotka schodzi na zero", async () => {
    clubRpc.setData("club_thread_question_vote", null);
    expect(await voteClubThreadQuestion({ questionId: "q-1", on: true })).toBe(0);
  });
});

describe("ankiety wątku", () => {
  it("ankieta i krawędź powstają JEDNYM wywołaniem", async () => {
    clubRpc.setData("club_thread_poll_create", "poll-1");

    const id = await createClubThreadPoll({
      threadId: CLUB_IDS.thread,
      questionPl: "Pytanie",
      questionEn: "Question",
      options: ["Tak", "Nie"],
    });

    expect(id).toBe("poll-1");
    // Rozdzielenie na dwa wywołania zostawiałoby przy błędzie ankietę-sierotę
    // bez właściciela.
    expect(clubRpc.callsFor("club_thread_poll_create")).toHaveLength(1);
    expect(clubRpc.lastCall("club_thread_poll_create")?.arg("p_options")).toEqual(["Tak", "Nie"]);
  });

  it("odłączenie ankiety nic nie zwraca", async () => {
    clubRpc.setData("club_thread_poll_detach", null);
    await expect(detachClubThreadPoll("link-1")).resolves.toBeUndefined();
  });

  it("lista ankiet: null daje pustą listę", async () => {
    clubRpc.setData("club_thread_polls_list", null);
    expect(await fetchClubThreadPolls(CLUB_IDS.thread)).toEqual([]);
  });
});

describe("powiązania wątek -> wątek", () => {
  it("dodanie powiązania przekazuje relację i notatkę", async () => {
    clubRpc.setData("club_thread_link_add", "link-1");

    await addClubThreadLink({
      threadId: CLUB_IDS.thread,
      relatedThreadId: "thread-2",
      relation: "duplicates",
      note: "ten sam akt",
    });

    expect(clubRpc.lastCall("club_thread_link_add")?.args).toEqual({
      p_thread_id: CLUB_IDS.thread,
      p_related_thread_id: "thread-2",
      p_relation: "duplicates",
      p_note: "ten sam akt",
    });
  });

  it("usunięcie powiązania nic nie zwraca", async () => {
    clubRpc.setData("club_thread_link_remove", null);
    await expect(removeClubThreadLink("link-1")).resolves.toBeUndefined();
  });
});

describe("uczestnicy, pomiar i wyszukiwanie w wątku", () => {
  it("uczestnicy: limit jedzie do RPC", async () => {
    clubRpc.setData("club_thread_participants", []);

    await fetchClubThreadParticipants({ threadId: CLUB_IDS.thread, limit: 10 });

    expect(clubRpc.lastCall("club_thread_participants")?.arg("p_limit")).toBe(10);
  });

  it("pomiar wątku: liczba kubełków jedzie do RPC", async () => {
    clubRpc.setData("club_thread_insights", []);

    await fetchClubThreadInsights({ threadId: CLUB_IDS.thread, buckets: 12 });

    expect(clubRpc.lastCall("club_thread_insights")?.arg("p_buckets")).toBe(12);
  });

  it("wyszukiwanie w wątku przekazuje frazę i limit", async () => {
    clubRpc.setData("club_thread_search", []);

    await searchClubThread({ threadId: CLUB_IDS.thread, query: "energia", limit: 15 });

    const call = clubRpc.lastCall("club_thread_search");
    expect(call?.arg("p_query")).toBe("energia");
    expect(call?.arg("p_limit")).toBe(15);
  });

  it("przestrzeń robocza: brak wiersza to null", async () => {
    clubRpc.setData("club_thread_workspace", []);
    expect(await fetchClubThreadWorkspace(CLUB_IDS.thread)).toBeNull();
  });

  it("przestrzeń robocza: pierwszy wiersz jest wynikiem", async () => {
    clubRpc.setData("club_thread_workspace", [{ thread_id: CLUB_IDS.thread, documents: 3 }]);

    expect(await fetchClubThreadWorkspace(CLUB_IDS.thread)).toMatchObject({
      thread_id: CLUB_IDS.thread,
    });
  });
});

describe("threadWorkspaceApi: kontrakt błędu", () => {
  // `unwrap()` PRZEPAKOWUJE błąd w nowy `Error(error.message)`, więc kod
  // SQLSTATE ginie - inaczej niż w `workspaceApi`, gdzie leci oryginał.
  // Test przypina obie strony tego rozjazdu; gdyby ktoś chciał mapować kody
  // odmowy na komunikaty, tu jest odpowiedź, dlaczego w tej gałęzi się nie da.
  const cases: ReadonlyArray<readonly [string, string, () => Promise<unknown>]> = [
    [
      "fetchClubThreadDocuments",
      "club_thread_documents_list",
      () => fetchClubThreadDocuments({ threadId: "t" }),
    ],
    [
      "upsertClubThreadDocument",
      "club_thread_document_upsert",
      () =>
        upsertClubThreadDocument({
          thread_id: "t",
          kind: "brief",
          title: "T",
          url: null,
          description: null,
          source_label: null,
          published_on: null,
        }),
    ],
    [
      "removeClubThreadDocument",
      "club_thread_document_remove",
      () => removeClubThreadDocument("d"),
    ],
    [
      "fetchClubThreadMilestones",
      "club_thread_milestones_list",
      () => fetchClubThreadMilestones({ threadId: "t" }),
    ],
    [
      "upsertClubThreadMilestone",
      "club_thread_milestone_upsert",
      () =>
        upsertClubThreadMilestone({
          thread_id: "t",
          kind: "meeting",
          status: "planned",
          title: "T",
          description: null,
          starts_at: CLUB_BASE_ISO,
          ends_at: null,
          all_day: false,
          location: null,
          url: null,
        }),
    ],
    [
      "removeClubThreadMilestone",
      "club_thread_milestone_remove",
      () => removeClubThreadMilestone("m"),
    ],
    [
      "fetchClubThreadQuestions",
      "club_thread_questions_list",
      () => fetchClubThreadQuestions({ threadId: "t" }),
    ],
    [
      "askClubThreadQuestion",
      "club_thread_question_ask",
      () => askClubThreadQuestion({ threadId: "t", body: "B", anonymous: false }),
    ],
    [
      "answerClubThreadQuestion",
      "club_thread_question_answer",
      () => answerClubThreadQuestion({ questionId: "q", body: "B", status: "answered" }),
    ],
    [
      "voteClubThreadQuestion",
      "club_thread_question_vote",
      () => voteClubThreadQuestion({ questionId: "q", on: true }),
    ],
    ["fetchClubThreadPolls", "club_thread_polls_list", () => fetchClubThreadPolls("t")],
    [
      "createClubThreadPoll",
      "club_thread_poll_create",
      () =>
        createClubThreadPoll({ threadId: "t", questionPl: "P", questionEn: "Q", options: ["a"] }),
    ],
    ["detachClubThreadPoll", "club_thread_poll_detach", () => detachClubThreadPoll("l")],
    ["fetchClubThreadLinks", "club_thread_links_list", () => fetchClubThreadLinks("t")],
    [
      "addClubThreadLink",
      "club_thread_link_add",
      () =>
        addClubThreadLink({
          threadId: "t",
          relatedThreadId: "t2",
          relation: "context",
          note: null,
        }),
    ],
    ["removeClubThreadLink", "club_thread_link_remove", () => removeClubThreadLink("l")],
    [
      "fetchClubThreadParticipants",
      "club_thread_participants",
      () => fetchClubThreadParticipants({ threadId: "t" }),
    ],
    [
      "fetchClubThreadInsights",
      "club_thread_insights",
      () => fetchClubThreadInsights({ threadId: "t" }),
    ],
    [
      "searchClubThread",
      "club_thread_search",
      () => searchClubThread({ threadId: "t", query: "q" }),
    ],
    ["fetchClubThreadWorkspace", "club_thread_workspace", () => fetchClubThreadWorkspace("t")],
  ];

  it.each(cases)("%s rzuca, gdy %s odmawia", async (_label, rpcName, run) => {
    clubRpc.setError(rpcName, "odmowa bazy", "42501");
    await expect(run()).rejects.toThrow("odmowa bazy");
  });

  it("workspaceApi: KAŻDA funkcja rzuca przy odmowie (poza licznikiem pobrań)", async () => {
    const cases2: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ["club_documents_list", () => fetchClubDocuments({ clubId: "c" })],
      ["club_document_upsert", () => upsertClubDocument("c", { title_pl: "T" })],
      ["club_document_delete", () => deleteClubDocument("d")],
      ["club_events_list", () => fetchClubEvents({ clubId: "c" })],
      ["club_event_upsert", () => upsertClubEvent("c", { title_pl: "T" })],
      ["club_event_delete", () => deleteClubEvent("e")],
      ["club_event_rsvp", () => setClubEventRsvp("e", "going")],
      ["club_milestones_list", () => fetchClubMilestones("c")],
      ["club_milestone_upsert", () => upsertClubMilestone("c", { title_pl: "T" })],
      ["club_milestone_delete", () => deleteClubMilestone("m")],
      ["club_activity_series", () => fetchClubActivitySeries("c", 7)],
      ["club_workspace_stats", () => fetchClubWorkspaceStats("c", 7)],
    ];
    for (const [rpcName, run] of cases2) {
      clubRpc.setError(rpcName, `odmowa ${rpcName}`, "42501");
      await expect(run()).rejects.toThrow(`odmowa ${rpcName}`);
    }
  });
});
