// Kontrakt domenowy PRZESTRZENI ROBOCZEJ WĄTKU - czysta warstwa bez React.
//
// PO CO TEN PLIK ISTNIEJE. `threadWorkspaceTypes` (importowany tu przez
// barrel `workspaceTypes`) jest granicą między tym, co oddaje RPC, a tym, co
// widzi użytkownik: liczniki na belce zakładek, podział harmonogramu na
// dziś/wkrótce/minione, siatka miesiąca, słupki pomiaru, fragmenty
// wyszukiwania i tłumaczenie literałów błędu na KODY. Wszystko to jest czystym
// liczeniem, więc jedynym miejscem, w którym da się udowodnić, że liczba na
// odznace nie kłamie, jest ten test - render pokaże tylko, że „coś się
// wyświetliło".
//
// CO JEST PRZEDMIOTEM DOWODU:
//   1. BEZPIECZNA WARTOŚĆ DOMYŚLNA. SQL nie ma unii literałów, więc rodzaj,
//      status i relacja przychodzą jako `string`. Wartość z NOWSZEJ migracji
//      ma wylądować w gałęzi domyślnej, a nie wywrócić panel na braku ikony.
//   2. ODZNAKA MÓWI PRAWDĘ. Każda zakładka liczy swój zbiór; pytania liczą
//      OTWARTE, nie wszystkie. Zero nie ma odznaki.
//   3. FRAGMENT NIE JEST HTML-em. `ts_headline` oddaje znaczniki `<b>`;
//      parsujemy je na części, bo wstawienie tego przez
//      `dangerouslySetInnerHTML` wykonałoby `<img onerror=...>` z wypowiedzi.
//   4. BŁĄD TO KOD, NIE ZDANIE. Komunikat Postgresa nie jest tłumaczony i nie
//      ma prawa trafić na ekran w polskim interfejsie.
//
// GRANICA DOWODU. Zero atrap i zero czasu systemowego: każda funkcja bierze
// „teraz" jawnym parametrem, więc przypadki są w pełni deterministyczne.
//
// GAŁĘZIE NIEOSIĄGALNE (sufit pokrycia gałęzi dla `threadWorkspaceTypes.ts`:
// 96,77%, 120/124). Cztery gałęzie to zapasy przy indeksowaniu i przy dzieleniu,
// wymuszone przez `noUncheckedIndexedAccess` i pilnowanie zera, a stojące ZA
// strażnikiem, który je wyklucza: `?? 0` w komparatorze `groupSchedule` (wiersze
// bez daty odpadły wcześniej przez `continue`), `peak === 0 ? 0` w
// `toContributionBars` (słupki są już przefiltrowane po `value > 0`, więc przy
// niepustej liście szczyt jest dodatni, a przy pustej `map` nie biegnie) oraz
// `?? []` w `groupSearchResults` (sekcja przeszła przez `filter`, więc kubełek
// istnieje). Nie dobijamy ich rzutowaniem typu.
import { describe, expect, it } from "vitest";
import {
  buildCalendarGrid,
  clubDocumentNeedsUrl,
  toClubDocumentKind,
  toClubMilestoneKind,
  toClubMilestoneStatus,
  toClubQuestionStatus,
  toClubThreadRelation,
  toClubWorkspaceSection,
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

  it("każda zakładka liczy SWÓJ zbiór, nie sumę przestrzeni", () => {
    // Pomyłka w tej kaskadzie nie wywala niczego - po prostu stawia na
    // zakładce cudzą liczbę, a użytkownik wierzy odznace bardziej niż treści.
    const full = summary({
      participants: 7,
      documents: 3,
      milestones: 2,
      questions: 9,
      openQuestions: 4,
      polls: 1,
      links: 5,
    });
    expect(panelBadge("participants", full)).toBe(7);
    expect(panelBadge("documents", full)).toBe(3);
    expect(panelBadge("schedule", full)).toBe(2);
    // Pytania liczą się OTWARTE, nie wszystkie: odznaka jest wezwaniem do
    // działania („cztery czekają na odpowiedź"), a nie archiwum.
    expect(panelBadge("questions", full)).toBe(4);
    expect(panelBadge("polls", full)).toBe(1);
    expect(panelBadge("links", full)).toBe(5);
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

  it("dwa terminy tego samego dnia stoją w JEDNEJ komórce, a wiersz bez daty nigdzie", () => {
    const cells = buildCalendarGrid(
      [
        milestone({ id: "rano", starts_at: new Date(2026, 8, 14, 9, 0).toISOString() }),
        milestone({ id: "popoludniu", starts_at: new Date(2026, 8, 14, 15, 0).toISOString() }),
        milestone({ id: "bez-daty", starts_at: "" }),
      ],
      new Date(2026, 8, 1),
      today,
    );

    const cell = cells.find((entry) => entry.iso === "2026-09-14");
    // Kolejność wejściowa jest zachowana - siatka nie sortuje, bo sortowanie
    // dnia należy do panelu harmonogramu, nie do kalendarza.
    expect(cell?.items.map((item) => item.id)).toEqual(["rano", "popoludniu"]);
    // Termin bez daty nie ma komórki. Wstawienie go do „dziś" byłoby
    // wymyśleniem informacji, której w bazie nie ma.
    expect(cells.some((entry) => entry.items.some((item) => item.id === "bez-daty"))).toBe(false);
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

  it("szczyt zostaje przy MALEJĄCYM szeregu - wysokości liczą się wobec niego", () => {
    const series = toInsightSeries([
      {
        bucket_index: 0,
        bucket_start: "2026-09-01T00:00:00.000Z",
        bucket_end: "2026-09-02T00:00:00.000Z",
        replies: 9,
        questions: 0,
        documents: 0,
        milestones: 0,
      },
      {
        bucket_index: 1,
        bucket_start: "2026-09-02T00:00:00.000Z",
        bucket_end: "2026-09-03T00:00:00.000Z",
        replies: 1,
        questions: 0,
        documents: 0,
        milestones: 0,
      },
    ]);
    // Gdyby `peak` brał OSTATNI słupek zamiast największego, wykres dyskusji,
    // która wygasa, rysowałby się jako rosnący.
    expect(series.peak).toBe(9);
  });

  it("licznik spoza zbioru liczb skończonych schodzi do zera, nie do 'NaN' na ekranie", () => {
    // `numeric` z PostgREST wraca czasem jako napis, a `Number("")` to NaN.
    // Odznaka ma wtedy pokazać zero, a nie „NaN" - to jedyny powód, dla
    // którego `count()` w ogóle istnieje.
    const series = toInsightSeries([
      {
        bucket_index: 0,
        bucket_start: "2026-09-01T00:00:00.000Z",
        bucket_end: "2026-09-02T00:00:00.000Z",
        replies: Number.NaN,
        questions: 2,
        documents: 0,
        milestones: 0,
      },
    ]);
    expect(series.bars[0].replies).toBe(0);
    expect(series.bars[0].total).toBe(2);
    expect(series.grandTotal).toBe(2);
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

  it("trafienie na POCZĄTKU fragmentu nie gubi się i nie dokłada pustego tekstu", () => {
    expect(parseSnippet("<b>DSA</b> wchodzi w życie")).toEqual([
      { text: "DSA", hit: true },
      { text: " wchodzi w życie", hit: false },
    ]);
  });

  it("puste znaczniki `ts_headline` znikają, a tekst wokół nich zostaje sklejony", () => {
    // `ts_headline` potrafi oddać pustą parę znaczników przy trafieniu na
    // granicy słowa. Pusty fragment z `hit: true` wyrenderowałby żółte
    // podświetlenie o zerowej szerokości.
    expect(parseSnippet("koszt <b></b> bilansowania")).toEqual([
      { text: "koszt ", hit: false },
      { text: " bilansowania", hit: false },
    ]);
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

  it("czyta komunikat także z napisu i z obiektu PostgREST, nie tylko z `Error`", () => {
    // Warstwa danych rzuca `new Error(...)`, ale ten sam kod obsługuje wynik
    // `supabase.rpc`, którego `error` jest ZWYKŁYM OBIEKTEM z polem
    // `message` - i bywa przerzucany dalej bez opakowania.
    expect(toClubWorkspaceError("clubs: forbidden")).toBe("forbidden");
    expect(toClubWorkspaceError({ message: "clubs: auth required" })).toBe("auth_required");
  });

  it("kształt bez czytelnego komunikatu daje unknown, a nie napis z bazy na ekranie", () => {
    // Wszystkie te przypadki muszą skończyć się kodem, bo widok tłumaczy KOD.
    // Gdyby przeciekła tu treść z bazy, użytkownik zobaczyłby angielski
    // komunikat Postgresa w polskim interfejsie.
    expect(toClubWorkspaceError({ message: 500 })).toBe("unknown");
    expect(toClubWorkspaceError({ code: "42501" })).toBe("unknown");
    expect(toClubWorkspaceError(500)).toBe("unknown");
    expect(toClubWorkspaceError(undefined)).toBe("unknown");
    expect(toClubWorkspaceError("")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// ZAWĘŻENIA SŁOWNIKOWE
//
// SQL nie ma unii literałów, więc RPC oddaje rodzaj, status i relację jako
// zwykły `string`. Te funkcje są JEDYNYM miejscem, w którym napis z bazy staje
// się wartością słownikową widoku. Przedmiotem dowodu jest ich zachowanie na
// wartości SPOZA słownika: nowsza migracja doda kiedyś rodzaj, którego ta
// wersja aplikacji nie zna, i wtedy panel ma pokazać bezpieczną wartość
// domyślną, a nie wywrócić się na braku ikony.
// ---------------------------------------------------------------------------

describe("zawężenia słownikowe wartości z RPC", () => {
  it("znana wartość przechodzi bez zmiany", () => {
    expect(toClubDocumentKind("dataset")).toBe("dataset");
    expect(toClubMilestoneKind("consultation")).toBe("consultation");
    expect(toClubMilestoneStatus("done")).toBe("done");
    expect(toClubQuestionStatus("answered")).toBe("answered");
    expect(toClubThreadRelation("supersedes")).toBe("supersedes");
    expect(toClubWorkspaceSection("document")).toBe("document");
  });

  it("wartość SPOZA słownika ląduje w bezpiecznej gałęzi domyślnej", () => {
    // To jest scenariusz „migracja poszła przed wdrożeniem front-endu".
    expect(toClubDocumentKind("hologram")).toBe("document");
    expect(toClubMilestoneKind("hologram")).toBe("milestone");
    expect(toClubMilestoneStatus("hologram")).toBe("planned");
    expect(toClubQuestionStatus("hologram")).toBe("open");
    expect(toClubThreadRelation("hologram")).toBe("context");
    expect(toClubWorkspaceSection("hologram")).toBe("reply");
  });

  it("brak wartości (null / undefined) też daje wartość domyślną, nie pustkę", () => {
    // Kolumny są nullowalne w wierszach formularza jeszcze niezapisanego -
    // droplista musi mieć co zaznaczyć od pierwszego renderu.
    expect(toClubDocumentKind(null)).toBe("document");
    expect(toClubDocumentKind(undefined)).toBe("document");
    expect(toClubMilestoneKind(null)).toBe("milestone");
    expect(toClubMilestoneKind(undefined)).toBe("milestone");
    expect(toClubMilestoneStatus(null)).toBe("planned");
    expect(toClubMilestoneStatus(undefined)).toBe("planned");
    expect(toClubQuestionStatus(null)).toBe("open");
    expect(toClubQuestionStatus(undefined)).toBe("open");
    expect(toClubThreadRelation(null)).toBe("context");
    expect(toClubThreadRelation(undefined)).toBe("context");
  });

  it("PUSTY napis nie jest wartością słownikową", () => {
    // Pusta komórka po `COALESCE` w widoku SQL wygląda jak „brak", ale nie
    // jest `null` - bez tego przypadku wpadłaby w `narrow` i wyszła defaultem
    // tylko przez przypadek.
    expect(toClubDocumentKind("")).toBe("document");
    expect(toClubQuestionStatus("")).toBe("open");
    expect(toClubWorkspaceSection("")).toBe("reply");
  });
});
