// Lista odcinków panelu: liczniki, filtry, tabela, dwa puste stany.
//
// CO DOWODZI TEN PLIK. Tabela jest jedynym miejscem, w którym redakcja widzi
// stan archiwum, więc kłamstwo w komórce jest kłamstwem o treści serwisu:
//   * pusty stan „nie ma odcinków" przy WŁĄCZONYM filtrze zaprasza do
//     stworzenia duplikatu odcinka, który jest w bazie;
//   * kolumna „Program" bez indeksu tytułów pokazuje surowy identyfikator
//     (albo pustkę) i nie da się rozpoznać serii;
//   * przycisk usuwania wołający otwarcie edytora (albo odwrotnie) to dwie
//     akcje o zupełnie różnych skutkach pod jedną ikoną.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: reguł liczenia i filtrowania (`shape.test.ts`
// ma tabelę przypadków), warstwy danych (`queries.test.ts`) ani przełączania
// widoków panelu (`routes/__tests__/adminPodcastsRoute.test.tsx`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PodcastShow } from "@/lib/podcast/types";
import type { AdminPodcastRow } from "@/lib/podcast/shape";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));

const { EpisodesListPane } = await import("@/components/admin/podcasts/EpisodesListPane");

/**
 * Znak zastępczy kolumny programu. DYWIZ, nie pauza (U+2014).
 *
 * Ten test PRZYPINAŁ pauzę: `"\u2014"`. House style repozytorium zakazuje
 * pauzy, a `i18nCohesion.test.ts` pilnuje tego tylko w RDZENIU słowników
 * (`locale/pl.ts`, `locale/en.ts`) - literał w kodzie komponentu przechodził
 * obok bramki. Po zamianie na dywiz test padł, i to jest dowód, że asercja
 * faktycznie dotyczy tego znaku, a nie „czegokolwiek w tej komórce".
 */
const MISSING_SHOW = "-";

const SHOW: PodcastShow = {
  id: "s1",
  tenant_id: "t1",
  slug: "raport-baltycki",
  title_pl: "Raport Baltycki",
  title_en: "Baltic report",
  description_pl: "",
  description_en: "",
  cover_image_url: null,
  spotify_url: null,
  apple_url: null,
  youtube_url: null,
  sort_order: 1,
  status: "published",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function row(overrides: Partial<AdminPodcastRow> = {}): AdminPodcastRow {
  return {
    id: "e1",
    slug: "odc-1",
    title_pl: "Odcinek pierwszy",
    title_en: "Episode one",
    status: "published",
    duration_seconds: 3661,
    episode_number: 7,
    season: 2,
    audio_url: "https://cdn.example.org/1.mp3",
    cover_image_url: null,
    show_id: "s1",
    published_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPane(overrides: Partial<Parameters<typeof EpisodesListPane>[0]> = {}): {
  onOpen: ReturnType<typeof vi.fn>;
  onRequestRemove: ReturnType<typeof vi.fn>;
  onSearchChange: ReturnType<typeof vi.fn>;
  onStatusFilterChange: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onOpen: vi.fn(),
    onRequestRemove: vi.fn(),
    onSearchChange: vi.fn(),
    onStatusFilterChange: vi.fn(),
  };
  render(
    <EpisodesListPane
      rows={[row()]}
      shows={[SHOW]}
      search=""
      statusFilter="all"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("liczniki nad lista", () => {
  it("pokazuje cztery karty, a laczny czas w formacie H:MM:SS", () => {
    renderPane({ rows: [row({ id: "a" }), row({ id: "b", status: "draft" })] });
    expect(screen.getByText("adminPodcasts.statAll")).toBeTruthy();
    expect(screen.getByText("adminPodcasts.statPublished")).toBeTruthy();
    expect(screen.getByText("adminPodcasts.statDrafts")).toBeTruthy();
    expect(screen.getByText("adminPodcasts.statTotalTime")).toBeTruthy();
    // 2 x 3661 s = 2:02:02 - licznik czasu jest jedyną kartą, która nie jest
    // liczbą sztuk, więc pomyłka formatu widać tylko tutaj.
    expect(screen.getByText("2:02:02")).toBeTruthy();
  });
});

describe("tabela odcinkow", () => {
  it("tytul otwiera edytor, a kosz TYLKO prosi o potwierdzenie", () => {
    // Dwie akcje w jednym wierszu: pomyłka w podpięciu robi z „Usuń"
    // przycisk edycji (albo odwrotnie - z edycji nieodwracalne usunięcie).
    const { onOpen, onRequestRemove } = renderPane();
    fireEvent.click(screen.getByText("Odcinek pierwszy"));
    expect(onOpen).toHaveBeenCalledWith("e1");
    expect(onRequestRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("adminPodcasts.remove"));
    expect(onRequestRemove).toHaveBeenCalledWith("e1");
  });

  it("kolumna programu bierze TYTUL z indeksu, a bez programu stawia kreske", () => {
    renderPane({ rows: [row({ id: "a" }), row({ id: "b", show_id: null })] });
    expect(screen.getByText("Raport Baltycki")).toBeTruthy();
    expect(screen.getAllByText(MISSING_SHOW).length).toBeGreaterThan(0);
  });

  it("program, ktorego nie ma w indeksie, nie renderuje surowego identyfikatora", () => {
    // Odcinek przypięty do usuniętego programu: kolumna pokazuje kreskę,
    // a nie UUID, którego nikt w redakcji nie rozpozna.
    renderPane({ rows: [row({ show_id: "nieznany-program" })], shows: [] });
    expect(screen.queryByText("nieznany-program")).toBeNull();
  });

  it("okladka renderuje sie jako obraz, a jej brak jako placeholder", () => {
    renderPane({ rows: [row({ cover_image_url: "https://cdn.example.org/cover.png" })] });
    const image = document.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://cdn.example.org/cover.png");
    // Puste `alt` jest zamierzone: okładka nie niesie treści obok tytułu.
    expect(image?.getAttribute("alt")).toBe("");
    cleanup();
    renderPane({ rows: [row({ cover_image_url: null })] });
    expect(document.querySelector("img")).toBeNull();
  });

  it("sezon i numer skladaja sie w S/E, a sam sezon nie dokleja E", () => {
    renderPane({ rows: [row({ season: 2, episode_number: 7 })] });
    expect(screen.getByText(/S2/)).toBeTruthy();
    expect(screen.getByText(/E7/)).toBeTruthy();
  });
});

describe("dwa puste stany", () => {
  it("PUSTA BAZA mowi „brak odcinkow”", () => {
    renderPane({ rows: [] });
    expect(screen.getByText("adminPodcasts.emptyNoEpisodes")).toBeTruthy();
  });

  it("ZAWEZONY FILTR mowi „brak wynikow”, a nie „brak odcinkow”", () => {
    // To jest najważniejsza asercja pliku: pomylenie tych dwóch komunikatów
    // zaprasza redakcję do stworzenia duplikatu istniejącego odcinka.
    renderPane({ rows: [row({ status: "published" })], statusFilter: "draft" });
    expect(screen.getByText("adminPodcasts.emptyFiltered")).toBeTruthy();
    expect(screen.queryByText("adminPodcasts.emptyNoEpisodes")).toBeNull();
  });
});

describe("pasek filtrow", () => {
  it("wpisanie frazy melduje sie W GORE, bo stan filtra mieszka w trasie", () => {
    // Komponent jest bezstanowy z rozmysłem - fraza przetrwa wejście
    // w ustawienia tylko wtedy, gdy trzyma ją trasa.
    const { onSearchChange } = renderPane();
    fireEvent.change(screen.getByPlaceholderText("adminPodcasts.searchPlaceholder"), {
      target: { value: "sondaz" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("sondaz");
  });

  it("cztery przyciski statusu melduja swoja wartosc", () => {
    const { onStatusFilterChange } = renderPane();
    fireEvent.click(screen.getByText("adminPodcasts.filterPublished"));
    fireEvent.click(screen.getByText("adminPodcasts.filterDrafts"));
    fireEvent.click(screen.getByText("adminPodcasts.filterArchived"));
    fireEvent.click(screen.getByText("adminPodcasts.filterAll"));
    expect(onStatusFilterChange.mock.calls.flat()).toEqual([
      "published",
      "draft",
      "archived",
      "all",
    ]);
  });

  it("brak listy (odczyt w toku) nie wywraca panelu", () => {
    renderPane({ rows: undefined });
    expect(screen.getByText("adminPodcasts.emptyNoEpisodes")).toBeTruthy();
  });
});
