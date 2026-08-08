import { describe, expect, it } from "vitest";
import {
  buildCalendarGrid,
  clubDocumentNeedsUrl,
  groupSchedule,
  groupSearchResults,
  panelBadge,
  parseSnippet,
  toClubWorkspaceError,
  toContributionBars,
  toInsightSeries,
  toLocalIsoDate,
  toWorkspaceSummary,
  visiblePanels,
  EMPTY_WORKSPACE_SUMMARY,
  type ClubThreadMilestoneRow,
  type ClubThreadParticipantRow,
  type ClubWorkspaceSearchRow,
  type ClubWorkspaceSummary,
} from "@/lib/clubs/workspaceTypes";

/** Minimalny wiersz harmonogramu - test interesuje wyłącznie oś czasu. */
function milestone(overrides: Partial<ClubThreadMilestoneRow>): ClubThreadMilestoneRow {
  return {
    id: "m1",
    kind: "milestone",
    status: "planned",
    title: "Termin",
    description: null,
    starts_at: "2026-09-14T09:00:00.000Z",
    ends_at: null,
    all_day: false,
    location: null,
    url: null,
    sort_order: 0,
    event_id: null,
    event_slug: null,
    owner_id: null,
    owner_name: null,
    owner_slug: null,
    created_at: "2026-09-01T00:00:00.000Z",
    can_edit: false,
    ...overrides,
  };
}

function participant(overrides: Partial<ClubThreadParticipantRow>): ClubThreadParticipantRow {
  return {
    participant_key: "user:1",
    user_id: "1",
    display_name: "Anna",
    avatar_url: null,
    profile_slug: null,
    alias: null,
    club_role: null,
    is_thread_author: false,
    reply_count: 0,
    question_count: 0,
    document_count: 0,
    reactions_received: 0,
    stance: null,
    first_at: null,
    last_at: null,
    ...overrides,
  };
}

function hit(overrides: Partial<ClubWorkspaceSearchRow>): ClubWorkspaceSearchRow {
  return {
    section: "reply",
    item_id: "r1",
    title: null,
    snippet: null,
    occurred_at: "2026-09-01T00:00:00.000Z",
    author_label: null,
    rank: 1,
    ...overrides,
  };
}

function summary(overrides: Partial<ClubWorkspaceSummary>): ClubWorkspaceSummary {
  return { ...EMPTY_WORKSPACE_SUMMARY, ...overrides };
}

describe("toWorkspaceSummary", () => {
  it("sprowadza brak wiersza do zer z zamkniętymi uprawnieniami", () => {
    // Brak wiersza znaczy „nie wolno czytać wątku" - nie wolno z tego zrobić
    // przestrzeni, w której cokolwiek da się dopisać.
    const result = toWorkspaceSummary(null);
    expect(result).toEqual(EMPTY_WORKSPACE_SUMMARY);
    expect(result.canContribute).toBe(false);
    expect(result.canCurate).toBe(false);
  });

  it("przepisuje liczniki i flagi z wiersza RPC", () => {
    const result = toWorkspaceSummary({
      thread_id: "t1",
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
    expect(result.documents).toBe(3);
    expect(result.openQuestions).toBe(2);
    expect(result.links).toBe(4);
    expect(result.nextMilestoneAt).toBe("2026-09-14T09:00:00.000Z");
    expect(result.canContribute).toBe(true);
    expect(result.canCurate).toBe(false);
  });
});

describe("panelBadge", () => {
  it("zwraca null dla zera - odznaka z zerem to szum", () => {
    expect(panelBadge("documents", summary({ documents: 0 }))).toBeNull();
    expect(panelBadge("documents", summary({ documents: 4 }))).toBe(4);
  });

  it("nie liczy dyskusji, danych ani wyszukiwarki", () => {
    const full = summary({ replies: 99, participants: 9 });
    expect(panelBadge("discussion", full)).toBeNull();
    expect(panelBadge("insights", full)).toBeNull();
    expect(panelBadge("search", full)).toBeNull();
  });
});

describe("visiblePanels", () => {
  it("pokazuje dyskusję, dane i szukanie zawsze", () => {
    const panels = visiblePanels(EMPTY_WORKSPACE_SUMMARY);
    expect(panels).toEqual(["discussion", "insights", "search"]);
  });

  it("pusty panel bez prawa zapisu nie stoi na belce", () => {
    const panels = visiblePanels(summary({ canContribute: false, canCurate: false }));
    expect(panels).not.toContain("documents");
    expect(panels).not.toContain("schedule");
  });

  it("pusty panel Z prawem zapisu zostaje - to zaproszenie, nie ślepa uliczka", () => {
    const contributor = visiblePanels(summary({ canContribute: true }));
    expect(contributor).toContain("documents");
    expect(contributor).toContain("questions");
    // Harmonogram i głosowania prowadzi moderacja, nie każdy piszący.
    expect(contributor).not.toContain("schedule");
    expect(contributor).not.toContain("polls");

    const curator = visiblePanels(summary({ canCurate: true }));
    expect(curator).toContain("schedule");
    expect(curator).toContain("polls");
    expect(curator).toContain("links");
  });

  it("panel z zawartością stoi także bez uprawnień do zapisu", () => {
    expect(visiblePanels(summary({ milestones: 2 }))).toContain("schedule");
    expect(visiblePanels(summary({ participants: 3 }))).toContain("participants");
  });
});

describe("groupSchedule", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("dzieli na dziś / wkrótce / minione i stawia przyszłość na górze", () => {
    const groups = groupSchedule(
      [
        milestone({ id: "past", starts_at: "2026-09-01T09:00:00.000Z" }),
        milestone({ id: "today", starts_at: "2026-09-14T18:00:00.000Z" }),
        milestone({ id: "future", starts_at: "2026-10-01T09:00:00.000Z" }),
      ],
      now,
    );
    expect(groups.map((group) => group.key)).toEqual(["today", "upcoming", "past"]);
    expect(groups[0].items[0].id).toBe("today");
  });

  it("termin wielodniowy, który jeszcze trwa, należy do dziś", () => {
    // Konsultacje 1-30 września w połowie miesiąca NIE są przeszłością -
    // wcześniejsza wersja wrzucała je tam już drugiego dnia.
    const groups = groupSchedule(
      [
        milestone({
          id: "consult",
          starts_at: "2026-09-01T00:00:00.000Z",
          ends_at: "2026-09-30T23:59:00.000Z",
        }),
      ],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("today");
  });

  it("minione idą od najnowszych", () => {
    const groups = groupSchedule(
      [
        milestone({ id: "older", starts_at: "2026-08-01T09:00:00.000Z" }),
        milestone({ id: "newer", starts_at: "2026-09-10T09:00:00.000Z" }),
      ],
      now,
    );
    expect(groups[0].key).toBe("past");
    expect(groups[0].items.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("pomija wiersz z niepoprawną datą zamiast wywracać podział", () => {
    const groups = groupSchedule([milestone({ starts_at: "nie-data" })], now);
    expect(groups).toHaveLength(0);
  });

  it("nie zwraca pustych grup", () => {
    const groups = groupSchedule([], now);
    expect(groups).toHaveLength(0);
  });
});

describe("buildCalendarGrid", () => {
  const today = new Date(2026, 8, 14); // 14 września 2026, poniedziałek

  it("zwraca pełne tygodnie zaczynające się od poniedziałku", () => {
    const cells = buildCalendarGrid([], new Date(2026, 8, 1), today);
    expect(cells.length % 7).toBe(0);
    // Wrzesień 2026 zaczyna się we wtorek, więc pierwszą komórką jest
    // poniedziałek 31 sierpnia.
    expect(cells[0].inMonth).toBe(false);
    expect(cells[0].day).toBe(31);
  });

  it("oznacza dzisiaj i przypisuje pozycje do właściwego dnia", () => {
    const cells = buildCalendarGrid(
      [milestone({ id: "x", starts_at: new Date(2026, 8, 14, 10, 0).toISOString() })],
      new Date(2026, 8, 1),
      today,
    );
    const cell = cells.find((entry) => entry.iso === "2026-09-14");
    expect(cell?.isToday).toBe(true);
    expect(cell?.items.map((item) => item.id)).toEqual(["x"]);
  });

  it("liczy datę w czasie LOKALNYM - inaczej wieczór przesuwa się o dobę", () => {
    // `toISOString().slice(0,10)` dałby tu 2026-09-14 dla strefy UTC+2.
    const late = new Date(2026, 8, 15, 0, 30);
    expect(toLocalIsoDate(late)).toBe("2026-09-15");
  });
});

describe("toInsightSeries", () => {
  it("liczy sumy, szczyt i sumę całkowitą", () => {
    const series = toInsightSeries([
      {
        bucket_index: 0,
        bucket_start: "2026-09-01T00:00:00.000Z",
        bucket_end: "2026-09-02T00:00:00.000Z",
        replies: 2,
        questions: 1,
        documents: 0,
        milestones: 0,
      },
      {
        bucket_index: 1,
        bucket_start: "2026-09-02T00:00:00.000Z",
        bucket_end: "2026-09-03T00:00:00.000Z",
        replies: 5,
        questions: 0,
        documents: 1,
        milestones: 1,
      },
    ]);
    expect(series.totals).toEqual({ replies: 7, questions: 1, documents: 1, milestones: 1 });
    expect(series.peak).toBe(7);
    expect(series.grandTotal).toBe(10);
    expect(series.bars[0].total).toBe(3);
  });

  it("pusty zbiór ma zerową sumę - widok rysuje wtedy pustkę, nie wykres", () => {
    const series = toInsightSeries([]);
    expect(series.grandTotal).toBe(0);
    expect(series.peak).toBe(0);
  });
});

describe("toContributionBars", () => {
  const label = (row: ClubThreadParticipantRow) => row.display_name ?? "?";

  it("sumuje trzy rodzaje wkładu i liczy udział wobec SZCZYTU", () => {
    const bars = toContributionBars(
      [
        participant({ participant_key: "a", display_name: "A", reply_count: 8 }),
        participant({
          participant_key: "b",
          display_name: "B",
          reply_count: 2,
          question_count: 1,
          document_count: 1,
        }),
      ],
      label,
    );
    expect(bars.map((bar) => bar.value)).toEqual([8, 4]);
    expect(bars[0].ratio).toBe(1);
    expect(bars[1].ratio).toBe(0.5);
  });

  it("pomija osoby bez wkładu i przycina do limitu", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      participant({ participant_key: `p${i}`, display_name: `P${i}`, reply_count: i }),
    );
    const bars = toContributionBars(rows, label, 3);
    // `p0` ma zero wypowiedzi, więc nie jest uczestnikiem tego rozkładu.
    expect(bars).toHaveLength(3);
    expect(bars.map((bar) => bar.value)).toEqual([11, 10, 9]);
  });
});

describe("parseSnippet", () => {
  it("rozbija fragment na tekst i trafienia", () => {
    const parts = parseSnippet("Rozporządzenie <b>DSA</b> weszło w życie");
    expect(parts).toEqual([
      { text: "Rozporządzenie ", hit: false },
      { text: "DSA", hit: true },
      { text: " weszło w życie", hit: false },
    ]);
  });

  it("nie renderuje HTML-a - obcy znacznik zostaje TEKSTEM", () => {
    // To jest cały powód istnienia tej funkcji: gdyby fragment szedł do
    // `dangerouslySetInnerHTML`, poniższe wykonałoby się w przeglądarce.
    const parts = parseSnippet("<img src=x onerror=alert(1)> i <b>trafienie</b>");
    expect(parts[0]).toEqual({ text: "<img src=x onerror=alert(1)> i ", hit: false });
    expect(parts[1]).toEqual({ text: "trafienie", hit: true });
  });

  it("pusty i null dają pustą listę", () => {
    expect(parseSnippet(null)).toEqual([]);
    expect(parseSnippet("")).toEqual([]);
  });
});

describe("groupSearchResults", () => {
  it("grupuje po sekcji w stałej kolejności i pomija puste sekcje", () => {
    const groups = groupSearchResults([
      hit({ section: "question", item_id: "q1" }),
      hit({ section: "reply", item_id: "r1" }),
      hit({ section: "reply", item_id: "r2" }),
    ]);
    expect(groups.map((group) => group.section)).toEqual(["reply", "question"]);
    expect(groups[0].rows).toHaveLength(2);
  });
});

describe("clubDocumentNeedsUrl", () => {
  it("tylko notatka może istnieć bez adresu", () => {
    expect(clubDocumentNeedsUrl("note")).toBe(false);
    expect(clubDocumentNeedsUrl("document")).toBe(true);
    expect(clubDocumentNeedsUrl("dataset")).toBe(true);
    expect(clubDocumentNeedsUrl("link")).toBe(true);
    expect(clubDocumentNeedsUrl("recording")).toBe(true);
  });
});

describe("toClubWorkspaceError", () => {
  it("mapuje literały z bazy na kody słownikowe", () => {
    const cases: [string, string][] = [
      ["clubs: forbidden", "forbidden"],
      ["clubs: document not found", "not_found"],
      ["clubs: anonymous not allowed", "anonymous_not_allowed"],
      ["clubs: answer body required", "answer_required"],
      ["clubs: cannot link thread to itself", "self_link"],
      ["clubs: poll needs 2-8 options", "poll_options"],
      ["clubs: auth required", "auth_required"],
      ['new row violates check constraint "club_thread_documents_url_required"', "url_required"],
    ];
    for (const [message, expected] of cases) {
      expect(toClubWorkspaceError(new Error(message))).toBe(expected);
    }
  });

  it("nieznany komunikat kończy się kodem unknown, nie wyjątkiem", () => {
    expect(toClubWorkspaceError(new Error("boom"))).toBe("unknown");
    expect(toClubWorkspaceError(null)).toBe("unknown");
  });
});
