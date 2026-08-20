// Dwa panele, które NIE mają własnej tabeli: „Dane” (`ClubThreadInsightsPanel`)
// i „Szukaj” (`ClubThreadFinderPanel`). Oba liczą się na żywo z RPC.
//
// CO TEN PLIK DOWODZI.
//
//   1. WYKRES, KTÓREGO NIE DA SIĘ PRZECZYTAĆ INACZEJ NIŻ WZROKIEM, JEST OZDOBĄ.
//      Panel „Dane” rysuje gołe słupki, ale obok stoi `role="img"` z pełnym
//      opisem ORAZ tabela z tymi samymi liczbami. Test sprawdza, że tabela
//      niesie te same wartości, co słupki - inaczej dostępność rozjechałaby
//      się z obrazkiem przy pierwszej zmianie serii.
//   2. WYSOKOŚĆ SŁUPKA LICZY SIĘ WOBEC SZCZYTU, nie wobec sumy: słupki mają
//      porównywać się MIĘDZY SOBĄ. Kubełek pusty dostaje kreskę, a nie zero
//      wysokości - inaczej dziura w osi czasu wyglądałaby jak brak danych.
//   3. SERIA O ZEROWEJ WARTOŚCI NIE WCHODZI DO SŁUPKA. Segment o zerowej
//      wysokości to węzeł, który nic nie znaczy, a psuje odstępy.
//   4. ZERO AKTYWNOŚCI TO PUSTKA, NIE WYKRES PŁASKI. Wykres czterech serii po
//      zerze wygląda jak awaria pomiaru.
//   5. SZUKANIE MA CZTERY STANY PRZED WYNIKIEM, każdy z inną odpowiedzią:
//      bezczynność, fraza za krótka (poniżej dwóch znaków NIE idzie do bazy),
//      zapytanie w locie i awaria. Piąty - „nic nie znaleziono” - musi
//      powtórzyć FRAZĘ, bo bez niej czytelnik nie wie, czego nie znaleziono.
//   6. LICZBA WYNIKÓW JEST OGŁASZANA GRZECZNIE (`aria-live="polite"`), więc
//      czytnik ekranu dowiaduje się o wyniku bez przerywania pisania.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `toInsightSeries`, `groupSearchResults`, `parseSnippet`: czyste funkcje
//   z tabelami przypadków w zakresie `threadWorkspaceTypes`. Tutaj dowodzimy,
//   że panele je WOŁAJĄ i respektują wynik.
// - PROGU FRAZY W WARSTWIE DANYCH: `useClubThreadSearch` odcina zapytanie
//   krótsze niż dwa znaki i ma to udowodnione w `clubWorkspaceHooks.test.tsx`.
//   Tutaj patrzymy na to, CO panel pokazuje w tym stanie.
// - MOLEKUŁY `ClubSnippet`: renderuje się PRAWDZIWA, bo `<mark>` jest jedynym
//   nośnikiem trafienia bez koloru i panel nie ma innego sposobu go pokazać.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/lib/clubs/threadWorkspaceApi", () => threadApiMock);

// KOLEJNOŚĆ IMPORTÓW JEST ZNACZĄCA - patrz `clubThreadPanels.test.tsx`.
import { resetThreadApiMock, threadApiMock } from "@/test/clubs/workspaceApiMock";
import {
  WS_BASE_ISO,
  threadInsightRow,
  workspaceSearchRow,
  wsIsoOffset,
} from "@/test/clubs/threadWorkspaceFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ClubThreadFinderPanel } from "@/components/clubs/organisms/ClubThreadFinderPanel";
import { ClubThreadInsightsPanel } from "@/components/clubs/organisms/ClubThreadInsightsPanel";
import { formatDateShort } from "@/lib/i18n/format";

const THREAD = "thread-1";
const TYDZIEN = 60 * 24 * 7;

const wLocie = () => new Promise<never>(() => {});
const odmowa = () => Promise.reject(new Error("club_thread_forbidden"));

beforeEach(() => {
  resetThreadApiMock();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

describe("ClubThreadInsightsPanel", () => {
  const renderPanel = () =>
    renderWithQueryClient(<ClubThreadInsightsPanel threadId={THREAD} lang="pl" />);

  /** Trzy kubełki: pusty, szczytowy (dwie serie) i pojedyncza odpowiedź. */
  const SERIA = [
    threadInsightRow({ bucket_index: 0 }),
    threadInsightRow({
      bucket_index: 1,
      bucket_start: wsIsoOffset(TYDZIEN),
      bucket_end: wsIsoOffset(2 * TYDZIEN),
      replies: 4,
      questions: 2,
    }),
    threadInsightRow({
      bucket_index: 2,
      bucket_start: wsIsoOffset(2 * TYDZIEN),
      bucket_end: wsIsoOffset(3 * TYDZIEN),
      replies: 1,
    }),
  ];

  it("zapytanie w locie pokazuje zastępnik wykresu", () => {
    threadApiMock.fetchClubThreadInsights.mockReturnValue(wLocie());

    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("awaria RPC daje komunikat z ponowieniem", async () => {
    threadApiMock.fetchClubThreadInsights.mockImplementation(odmowa);

    renderPanel();

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    const przed = threadApiMock.fetchClubThreadInsights.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadInsights.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("brak wierszy to pustka, a nie wykres", async () => {
    threadApiMock.fetchClubThreadInsights.mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByText("club.workspace.insights.empty")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("kubełki po samych zerach też są pustką - wykres płaski wygląda jak awaria", async () => {
    threadApiMock.fetchClubThreadInsights.mockResolvedValue([
      threadInsightRow(),
      threadInsightRow({ bucket_index: 1 }),
    ]);

    renderPanel();

    expect(await screen.findByText("club.workspace.insights.empty")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.insights.emptyHint")).toBeInTheDocument();
  });

  it("cztery liczby zbiorcze stoją w STAŁEJ kolejności serii", async () => {
    threadApiMock.fetchClubThreadInsights.mockResolvedValue(SERIA);

    const { container } = renderPanel();

    await screen.findByRole("img");
    expect(Array.from(container.querySelectorAll("dl dt")).map((node) => node.textContent)).toEqual(
      [
        "club.workspace.insights.series.replies",
        "club.workspace.insights.series.questions",
        "club.workspace.insights.series.documents",
        "club.workspace.insights.series.milestones",
      ],
    );
    expect(Array.from(container.querySelectorAll("dl dd")).map((n) => n.textContent)).toEqual([
      "5",
      "2",
      "0",
      "0",
    ]);
  });

  it("opis wykresu niesie sumę i zakres dat - bez niego obrazek jest ozdobą", async () => {
    threadApiMock.fetchClubThreadInsights.mockResolvedValue(SERIA);

    renderPanel();

    const zakres = `${formatDateShort(WS_BASE_ISO, "pl")} - ${formatDateShort(
      wsIsoOffset(3 * TYDZIEN),
      "pl",
    )}`;
    expect(await screen.findByRole("img")).toHaveAttribute(
      "aria-label",
      `club.workspace.insights.chartAria(range=${zakres},total=7)`,
    );
    expect(screen.getByText(zakres)).toBeInTheDocument();
  });

  it("wysokość segmentu liczy się wobec SZCZYTU, a pusty kubełek dostaje kreskę", async () => {
    threadApiMock.fetchClubThreadInsights.mockResolvedValue(SERIA);

    renderPanel();

    const wykres = await screen.findByRole("img");
    const slupki = Array.from(wykres.children);
    expect(slupki).toHaveLength(3);

    // Kubełek pusty: jedna kreska bez wysokości procentowej.
    expect(slupki[0].querySelectorAll("span[style]")).toHaveLength(0);
    expect(slupki[0].firstElementChild?.className).toContain("bg-muted");

    // Szczyt to 6, więc 4 z 6 to 67%, a 2 z 6 to 33%. Serie zerowe nie
    // wchodzą do słupka wcale.
    expect(
      Array.from(slupki[1].querySelectorAll("span")).map((n) => n.getAttribute("style")),
    ).toEqual(["height: 67%;", "height: 33%;"]);

    // Jedna odpowiedź z sześciu to 17% - wciąż powyżej progu widoczności.
    expect(
      Array.from(slupki[2].querySelectorAll("span")).map((n) => n.getAttribute("style")),
    ).toEqual(["height: 17%;"]);
  });

  it("segment mniejszy niż próg widoczności dostaje minimalne trzy procent", async () => {
    threadApiMock.fetchClubThreadInsights.mockResolvedValue([
      threadInsightRow({ replies: 100 }),
      threadInsightRow({ bucket_index: 1, bucket_start: wsIsoOffset(TYDZIEN), questions: 1 }),
    ]);

    const { container } = renderPanel();

    await screen.findByRole("img");
    // Jeden ze stu to poniżej procenta - słupek i tak musi być widoczny.
    expect(container.querySelectorAll("span[style]")[1].getAttribute("style")).toBe("height: 3%;");
  });

  it("tabela dostępnościowa niesie DOKŁADNIE te same liczby, co słupki", async () => {
    threadApiMock.fetchClubThreadInsights.mockResolvedValue(SERIA);

    const { container } = renderPanel();

    await screen.findByRole("img");
    const tabela = container.querySelector("table");
    expect(tabela).toHaveClass("sr-only");
    expect(tabela?.querySelector("caption")).toHaveTextContent(
      "club.workspace.insights.tableCaption",
    );
    expect(
      Array.from(tabela?.querySelectorAll("tbody tr") ?? []).map((tr) =>
        Array.from(tr.children).map((cell) => cell.textContent),
      ),
    ).toEqual([
      [formatDateShort(WS_BASE_ISO, "pl"), "0", "0", "0", "0"],
      [formatDateShort(wsIsoOffset(TYDZIEN), "pl"), "4", "2", "0", "0"],
      [formatDateShort(wsIsoOffset(2 * TYDZIEN), "pl"), "1", "0", "0", "0"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Szukanie
// ---------------------------------------------------------------------------

describe("ClubThreadFinderPanel", () => {
  const renderPanel = () =>
    renderWithQueryClient(<ClubThreadFinderPanel threadId={THREAD} lang="pl" />);

  /** Wpisanie frazy i odczekanie na przekazanie jej przez `useDeferredValue`. */
  async function wpisz(fraza: string): Promise<void> {
    fireEvent.change(screen.getByLabelText("club.workspace.search.label"), {
      target: { value: fraza },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("club.workspace.search.label")).toHaveValue(fraza),
    );
  }

  it("bezczynność zaprasza do wpisania frazy i NIE pyta bazy", async () => {
    renderPanel();

    expect(await screen.findByText("club.workspace.search.idle")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.search.idleHint")).toBeInTheDocument();
    expect(threadApiMock.searchClubThread).not.toHaveBeenCalled();
    expect(screen.getByText("club.workspace.search.hint")).toBeInTheDocument();
  });

  it("jedna litera mówi WPROST, że fraza jest za krótka, i nie idzie do bazy", async () => {
    renderPanel();

    await wpisz("k");

    await waitFor(() =>
      expect(screen.getByText("club.workspace.search.tooShort")).toBeInTheDocument(),
    );
    expect(threadApiMock.searchClubThread).not.toHaveBeenCalled();
  });

  it("zapytanie w locie pokazuje trzy zastępniki wiersza", async () => {
    threadApiMock.searchClubThread.mockReturnValue(wLocie());

    const { container } = renderPanel();
    await wpisz("koszt");

    await waitFor(() => expect(threadApiMock.searchClubThread).toHaveBeenCalled());
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.children).toHaveLength(3);
  });

  it("awaria RPC daje komunikat z ponowieniem, a nie „nic nie znaleziono”", async () => {
    threadApiMock.searchClubThread.mockImplementation(odmowa);

    renderPanel();
    await wpisz("koszt");

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    expect(screen.queryByText(/search\.noResults/)).toBeNull();
    const przed = threadApiMock.searchClubThread.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(threadApiMock.searchClubThread.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("brak wyników POWTARZA frazę, żeby było wiadomo, czego nie znaleziono", async () => {
    threadApiMock.searchClubThread.mockResolvedValue([]);

    renderPanel();
    await wpisz("  koszt  ");

    expect(
      await screen.findByText("club.workspace.search.noResults(query=koszt)"),
    ).toBeInTheDocument();
    expect(screen.getByText("club.workspace.search.noResultsHint")).toBeInTheDocument();
  });

  it("fraza jedzie do RPC obcięta z białych znaków", async () => {
    threadApiMock.searchClubThread.mockResolvedValue([]);

    renderPanel();
    await wpisz("  koszt  ");

    await waitFor(() =>
      expect(threadApiMock.searchClubThread).toHaveBeenCalledWith({
        threadId: THREAD,
        query: "koszt",
      }),
    );
  });

  it("wyniki idą sekcjami w STAŁEJ kolejności, z licznikiem i trafieniem w tekście", async () => {
    threadApiMock.searchClubThread.mockResolvedValue([
      workspaceSearchRow({ section: "question", item_id: "q-1", title: "Pytanie o koszt" }),
      workspaceSearchRow({ section: "reply", item_id: "r-1" }),
      workspaceSearchRow({
        section: "reply",
        item_id: "r-2",
        snippet: null,
        author_label: null,
        occurred_at: wsIsoOffset(-60),
      }),
    ]);

    const { container } = renderPanel();
    await wpisz("koszt");

    // Dyskusja przed pytaniami - tak brzmi kolejność sekcji.
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll("section > h3")).map((node) => node.textContent),
      ).toEqual(["club.workspace.section.reply(2)", "club.workspace.section.question(1)"]),
    );
    // Trafienie jest wyróżnione elementem `mark`, nie samym kolorem.
    expect(container.querySelector("mark")).toHaveTextContent("bilansowania");
    expect(screen.getByText("Pytanie o koszt")).toBeInTheDocument();
    // Wiersz bez fragmentu i bez autora nie rysuje pustych bloków.
    expect(container.querySelectorAll("mark")).toHaveLength(2);
  });

  it("liczba wyników jest ogłaszana grzecznie, bez przerywania pisania", async () => {
    threadApiMock.searchClubThread.mockResolvedValue([
      workspaceSearchRow({ item_id: "r-1" }),
      workspaceSearchRow({ item_id: "r-2" }),
    ]);

    const { container } = renderPanel();
    await wpisz("koszt");

    await waitFor(() =>
      expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
        "club.workspace.search.resultsCount(count=2)",
      ),
    );
    expect(container.querySelector('[aria-live="polite"]')).toHaveClass("sr-only");
  });

  it("skasowanie frazy wraca do zaproszenia, a nie do „nic nie znaleziono”", async () => {
    threadApiMock.searchClubThread.mockResolvedValue([workspaceSearchRow()]);

    const { container } = renderPanel();
    await wpisz("koszt");
    await waitFor(() => expect(container.querySelector("mark")).not.toBeNull());

    await wpisz("");

    await waitFor(() => expect(screen.getByText("club.workspace.search.idle")).toBeInTheDocument());
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent("");
  });
});
