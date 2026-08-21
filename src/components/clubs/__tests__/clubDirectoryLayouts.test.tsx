// Katalog klubów: `ClubDirectory` w KAŻDYM z czterech układów redakcyjnych
// (`CLUB_LAYOUTS`) plus sekcja „Moje kluby” z zakładkami obszarów
// (`MyClubsTabs`).
//
// CO TEN PLIK DOWODZI.
// (1) UKŁAD JEST DECYZJĄ REDAKCYJNĄ KLUBU, WIĘC KAŻDA JEGO WARTOŚĆ MUSI
//     RYSOWAĆ INNĄ SIATKĘ. Kolumna `clubs.layout` przychodzi z bazy, a nie
//     z kodu, więc pomyłka w gałęzi renderu nie wywala niczego - po prostu
//     hub jednego klienta wygląda jak hub innego. Tabela jedzie przez
//     `list`, `cards`, `magazine` i `editorial` oraz przez BRAK propa
//     (domyślny `cards`), a `magazine` osobno dla jednego klubu (sam kafel
//     wiodący) i dla trzech (kafel + wiersze).
// (2) FRAGMENT (`tagline`) JEST WE WSZYSTKICH UKŁADACH, ale klub bez zdania
//     wyjaśniającego nie może zostawić po sobie pustego akapitu - to widać
//     natychmiast w siatce, w której sąsiedzi są wyżsi o jedną linię.
// (3) UKŁAD `editorial` SPRZEDAJE DOSTĘP, nie tylko nazwę: cztery stany
//     członkostwa (członek, zaproszony, uprawniony planem, odcięty) dają
//     TRZY różne wezwania do działania, a pierwsza karta dostaje znacznik
//     „dzieje się teraz” ZAMIAST znacznika widoczności. Pomyłka w tej mapie
//     wysyła członka klubu na ścieżkę proszenia o dostęp, który już ma.
// (4) STAN ŁADOWANIA I PUSTKA TO DWA RÓŻNE EKRANY. Szkielet ma kształt
//     wybranego układu (żeby strona nie podskakiwała), a pustka - zdanie
//     podane propem `empty`.
// (5) WIDOCZNOŚĆ SPOZA SŁOWNIKA DEGRADUJE SIĘ DO `members`. `visibility`
//     jest w typie RPC zwykłym `string`, więc starsza albo obca wartość nie
//     ma prawa wyprodukować klucza i18n, którego nie ma w słownikach - klub
//     pokazałby wtedy surowy `club.visibility.cokolwiek`.
// (6) ZAKŁADKI „MOICH KLUBÓW” NIE MOGĄ NICZEGO ZGUBIĆ. Klub bez obszaru
//     trafia do „Pozostałe”, zakładka „Wszystkie” wraca do pełnej listy
//     jednym kliknięciem, a pasek NIE POJAWIA SIĘ przy jednej grupie (jeden
//     przycisk nie jest wyborem).
// (7) ZMIANA ZBIORU KLUBÓW (wyjście z klubu, refetch) MUSI ZDJĄĆ ZAKŁADKĘ,
//     KTÓREJ JUŻ NIE MA. Bez tego sekcja pokazuje pustkę bez powodu - i to
//     jest jedyny stan, w którym `?? []` w projekcji widocznych klubów
//     naprawdę biegnie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `groupMyClubs` / `shouldTabMyClubs` - czyste funkcje z własnymi testami
//     (`src/lib/clubs/myClubGroups.test.ts`). Tutaj dowodzimy, że komponent je
//     WOŁA i respektuje ich wynik (kolejność grup, grupa „Pozostałe” na końcu).
// (b) Atomów: `ClubCover`, `ClubDirectorySkeleton`, `ClubTopicChip`,
//     `Badge` - mają własne zakresy. Tu asercje idą na to, że wiersz katalogu
//     je składa (zastępnik okładki, klucz widoczności, chip obszaru).
// (c) `topicLabel` i katalogu obszarów - `useClubTopics` jest ATRAPĄ, bo
//     klucze cache i lista awaryjna są dowiedzione w testach hooków.
// (d) Nawigacji routera - `Link` jest podmieniony na kotwicę, więc dowodem
//     jest ADRES docelowy, nie zachowanie routera.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/clubs/useClubTopics", () => ({
  useClubTopics: () => ({
    topics: [
      { key: "energy", label_pl: "Energetyka", label_en: "Energy", sort_order: 10 },
      { key: "transport", label_pl: "Transport", label_en: "Transport", sort_order: 20 },
    ],
    isLoading: false,
  }),
}));

import { ClubDirectory, type ClubDirectoryCard } from "@/components/clubs/organisms/ClubDirectory";
import { MyClubsTabs } from "@/components/clubs/organisms/MyClubsTabs";
import { CLUB_LAYOUTS } from "@/lib/clubs/types";
import { clubListRow } from "@/test/clubs/fixtures";
import { axeViolations, summarize } from "@/test/axe";

/**
 * Karta katalogu. Wartości domyślne pochodzą z WIERSZA RPC (`club_list`), więc
 * rozjazd kolumny w migracji wychodzi na typach; nadpisania dopuszczają `null`
 * tam, gdzie karta jawnie go dopuszcza (brak obszaru, brak fragmentu).
 */
function directoryCard(overrides: Partial<ClubDirectoryCard> = {}): ClubDirectoryCard {
  const row = clubListRow();
  return {
    id: row.id,
    slug: row.slug,
    name_pl: row.name_pl,
    name_en: row.name_en,
    tagline_pl: row.tagline_pl,
    tagline_en: row.tagline_en,
    cover_image_url: row.cover_image_url,
    policy_area: row.policy_area,
    visibility: row.visibility,
    member_count: row.member_count,
    thread_count: row.thread_count,
    group_count: row.group_count,
    my_status: row.my_status,
    can_read: row.can_read,
    last_activity_at: row.last_activity_at,
    ...overrides,
  };
}

/** Drugi, trzeci... klub - własne id/slug/nazwa, żeby dały się rozróżnić. */
function otherCard(n: number, overrides: Partial<ClubDirectoryCard> = {}): ClubDirectoryCard {
  return directoryCard({
    id: `club-${n}`,
    slug: `klub-${n}`,
    name_pl: `Klub ${n}`,
    name_en: `Club ${n}`,
    ...overrides,
  });
}

beforeEach(() => {
  cleanup();
});

describe("ClubDirectory - stany zbioru", () => {
  it("ładowanie rysuje szkielet w kształcie układu, bez kart i bez pustki", () => {
    const { container } = render(
      <ClubDirectory
        title="Moje kluby"
        empty="Brak klubów"
        clubs={[directoryCard()]}
        loading
        layout="list"
        action={<button type="button">Dodaj</button>}
      />,
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Brak klubów")).toBeNull();
    // Nagłówek i akcja sekcji stoją NAD stanem danych - inaczej pasek
    // narzędzi migałby przy każdym refetchu.
    expect(screen.getByRole("heading", { name: "Moje kluby" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dodaj" })).toBeTruthy();
  });

  it("pusty zbiór pokazuje zdanie podane propem, a nie szkielet", () => {
    const { container } = render(
      <ClubDirectory
        title="Odkryj"
        empty="Brak klubów"
        clubs={[]}
        loading={false}
        layout="cards"
      />,
    );

    expect(screen.getByText("Brak klubów")).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("każdy układ ze słownika rysuje kartę każdego klubu", () => {
    for (const layout of CLUB_LAYOUTS) {
      cleanup();
      render(
        <ClubDirectory
          title="Odkryj"
          empty="Brak klubów"
          clubs={[directoryCard(), otherCard(2)]}
          loading={false}
          layout={layout}
        />,
      );

      expect(screen.getAllByRole("link").length, `układ ${layout}`).toBe(2);
      expect(screen.getByRole("heading", { name: "Klub energetyczny" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Klub 2" })).toBeTruthy();
    }
  });
});

describe("ClubDirectory - układ kafli (domyślny)", () => {
  it("bez propa `layout` rysuje kafle z okładką, widocznością, licznikami i wezwaniem", () => {
    render(
      <ClubDirectory
        title="Odkryj"
        empty="Brak klubów"
        clubs={[directoryCard()]}
        loading={false}
      />,
    );

    const card = screen.getByRole("link");
    expect(card.getAttribute("href")).toBe("/club/klub-energetyczny");
    expect(within(card).getByText("club.visibility.public")).toBeTruthy();
    expect(within(card).getByText("Energia i klimat")).toBeTruthy();
    expect(within(card).getByText("club.membersCount(count=42)")).toBeTruthy();
    expect(within(card).getByText("club.threadsCount(count=12)")).toBeTruthy();
    expect(within(card).getByText("club.groupsCount(count=3)")).toBeTruthy();
    expect(within(card).getByText("Energetyka")).toBeTruthy();
    expect(within(card).getByText("club.hub.goToThreads")).toBeTruthy();
  });

  it("klub bez fragmentu w OBU językach nie zostawia pustego akapitu", () => {
    render(
      <ClubDirectory
        title="Odkryj"
        empty="Brak klubów"
        clubs={[directoryCard({ tagline_pl: null, tagline_en: "   " })]}
        loading={false}
        layout="cards"
      />,
    );

    expect(screen.queryByText("Energia i klimat")).toBeNull();
    expect(screen.getByRole("link").querySelector("p")).toBeNull();
  });

  it("widoczność spoza słownika degraduje się do `members`", () => {
    render(
      <ClubDirectory
        title="Odkryj"
        empty="Brak klubów"
        clubs={[directoryCard({ visibility: "sekretny-tryb-z-migracji" })]}
        loading={false}
        layout="cards"
      />,
    );

    expect(screen.getByText("club.visibility.members")).toBeTruthy();
  });

  it("kafle katalogu są dostępne dla czytnika ekranu", async () => {
    const { container } = render(
      <ClubDirectory
        title="Odkryj"
        empty="Brak klubów"
        clubs={[directoryCard(), otherCard(2, { tagline_pl: null, tagline_en: null })]}
        loading={false}
        layout="cards"
      />,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("ClubDirectory - układ listy", () => {
  it("wiersz niesie miniaturę, nazwę, widoczność i liczniki", () => {
    render(
      <ClubDirectory
        title="Moje kluby"
        empty="Brak klubów"
        clubs={[directoryCard(), otherCard(2, { tagline_pl: null, tagline_en: null })]}
        loading={false}
        layout="list"
      />,
    );

    const rows = screen.getAllByRole("link");
    expect(rows.length).toBe(2);
    expect(within(rows[0]).getByText("Energia i klimat")).toBeTruthy();
    // Drugi wiersz bez fragmentu - i bez pustego akapitu w jego miejscu.
    expect(rows[1].querySelector("p")).toBeNull();
    expect(within(rows[1]).getByText("club.membersCount(count=42)")).toBeTruthy();
  });
});

describe("ClubDirectory - układ magazynowy", () => {
  it("jeden klub to SAM kafel wiodący, bez listy pod nim", () => {
    render(
      <ClubDirectory
        title="Moje kluby"
        empty="Brak klubów"
        clubs={[directoryCard()]}
        loading={false}
        layout="magazine"
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links.length).toBe(1);
    // Kafel wiodący ma NAJWIĘKSZY tytuł układu - stąd osobna klasa nagłówka.
    const heading = screen.getByRole("heading", { name: "Klub energetyczny" });
    expect(heading.className).toContain("text-lg");
  });

  it("kafel wiodący klubu bez fragmentu nie zostawia pustego akapitu", () => {
    render(
      <ClubDirectory
        title="Moje kluby"
        empty="Brak klubów"
        clubs={[directoryCard({ tagline_pl: "  ", tagline_en: null })]}
        loading={false}
        layout="magazine"
      />,
    );

    expect(screen.queryByText("Energia i klimat")).toBeNull();
    expect(screen.getByRole("link").querySelector("p")).toBeNull();
  });

  it("trzy kluby to kafel wiodący plus wiersze pozostałych", () => {
    render(
      <ClubDirectory
        title="Moje kluby"
        empty="Brak klubów"
        clubs={[
          directoryCard(),
          otherCard(2),
          otherCard(3, { tagline_pl: null, tagline_en: null }),
        ]}
        loading={false}
        layout="magazine"
      />,
    );

    expect(screen.getAllByRole("link").length).toBe(3);
    expect(screen.getByRole("heading", { name: "Klub energetyczny" }).className).toContain(
      "text-lg",
    );
    expect(screen.getByRole("heading", { name: "Klub 2" }).className).toContain("truncate");
  });
});

describe("ClubDirectory - układ prestiżowy (editorial)", () => {
  /** Cztery stany dostępu w JEDNEJ siatce - kolejność kart jest kolejnością wejścia. */
  const CLUBS: readonly ClubDirectoryCard[] = [
    otherCard(1, { my_status: "active" }),
    otherCard(2, { my_status: "invited" }),
    otherCard(3, { my_status: "none", can_read: true }),
    otherCard(4, { my_status: "none", can_read: false, tagline_pl: null, tagline_en: null }),
  ];

  it("stan członkostwa wybiera wezwanie do działania", () => {
    render(
      <ClubDirectory
        title="Odkryj"
        empty="Brak klubów"
        clubs={CLUBS}
        loading={false}
        layout="editorial"
      />,
    );

    const cards = screen.getAllByRole("link");
    expect(within(cards[0]).getByText("club.hub.enterWorkspace")).toBeTruthy();
    expect(within(cards[1]).getByText("club.hub.requestAccess")).toBeTruthy();
    expect(within(cards[2]).getByText("club.hub.enterPortal")).toBeTruthy();
    expect(within(cards[3]).getByText("club.hub.requestAccess")).toBeTruthy();
  });

  it("pierwsza karta jest wyróżniona znacznikiem aktywności ZAMIAST widoczności", () => {
    render(
      <ClubDirectory
        title="Odkryj"
        empty="Brak klubów"
        clubs={CLUBS}
        loading={false}
        layout="editorial"
      />,
    );

    const cards = screen.getAllByRole("link");
    expect(within(cards[0]).getByText("club.hub.activeNow")).toBeTruthy();
    expect(within(cards[0]).queryByText("club.visibility.public")).toBeNull();
    expect(within(cards[1]).getByText("club.visibility.public")).toBeTruthy();
    expect(within(cards[1]).queryByText("club.hub.activeNow")).toBeNull();
    // Liczniki są w KAŻDEJ karcie - wyróżnienie zmienia kolor, nie treść.
    expect(screen.getAllByText("club.membersCount(count=42)").length).toBe(4);
    expect(screen.getAllByText("club.threadsCount(count=12)").length).toBe(4);
  });

  it("karta bez fragmentu nie zostawia pustego akapitu także w tym układzie", () => {
    render(
      <ClubDirectory
        title="Odkryj"
        empty="Brak klubów"
        clubs={CLUBS}
        loading={false}
        layout="editorial"
      />,
    );

    const cards = screen.getAllByRole("link");
    expect(within(cards[0]).getByText("Energia i klimat")).toBeTruthy();
    expect(cards[3].querySelector("p")).toBeNull();
  });
});

describe("MyClubsTabs", () => {
  /** Dwa obszary z katalogu plus klub BEZ obszaru - trzy grupy, więc zakładki. */
  const MINE: readonly ClubDirectoryCard[] = [
    otherCard(1, { policy_area: "energy" }),
    otherCard(2, { policy_area: "energy" }),
    otherCard(3, { policy_area: "transport" }),
    otherCard(4, { policy_area: null }),
  ];

  /** Nazwy klubów widoczne w siatce - dowód, CO zakładka wpuściła do katalogu. */
  function visibleNames(): string[] {
    return screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent ?? "");
  }

  it("pasek wypisuje zakładkę `Wszystkie` z licznikiem oraz grupy w kolejności `groupMyClubs`", () => {
    render(<MyClubsTabs clubs={MINE} loading={false} layout="list" />);

    const nav = screen.getByRole("navigation", { name: "club.hub.myTopicsLabel" });
    const chips = within(nav).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "club.hub.allTopics4",
      "Energetyka2",
      "Transport1",
      "club.hub.otherTopic1",
    ]);
    expect(chips[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(visibleNames()).toEqual(["Klub 1", "Klub 2", "Klub 3", "Klub 4"]);
  });

  it("zakładka obszaru zawęża katalog do swoich klubów", () => {
    render(<MyClubsTabs clubs={MINE} loading={false} layout="list" />);

    fireEvent.click(screen.getByRole("button", { name: /Transport/ }));

    expect(visibleNames()).toEqual(["Klub 3"]);
    expect(screen.getByRole("button", { name: /Transport/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: /club.hub.allTopics/ }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("grupa `Pozostałe` (klub bez obszaru) też jest zakładką - nic nie znika z sekcji", () => {
    render(<MyClubsTabs clubs={MINE} loading={false} layout="list" />);

    fireEvent.click(screen.getByRole("button", { name: /club.hub.otherTopic/ }));

    expect(visibleNames()).toEqual(["Klub 4"]);
  });

  it("`Wszystkie` wraca do pełnej listy jednym kliknięciem", () => {
    render(<MyClubsTabs clubs={MINE} loading={false} layout="list" />);

    fireEvent.click(screen.getByRole("button", { name: /Energetyka/ }));
    expect(visibleNames()).toEqual(["Klub 1", "Klub 2"]);

    fireEvent.click(screen.getByRole("button", { name: /club.hub.allTopics/ }));
    expect(visibleNames()).toEqual(["Klub 1", "Klub 2", "Klub 3", "Klub 4"]);
  });

  it("jedna grupa nie dostaje paska - jeden przycisk nie jest wyborem", () => {
    render(
      <MyClubsTabs
        clubs={[otherCard(1, { policy_area: "energy" })]}
        loading={false}
        layout="cards"
      />,
    );

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(visibleNames()).toEqual(["Klub 1"]);
  });

  it("brak własnych klubów: bez paska i z komunikatem pustki katalogu", () => {
    render(<MyClubsTabs clubs={[]} loading={false} layout="cards" />);

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("club.empty")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "club.myClubs" })).toBeTruthy();
  });

  it("zniknięcie obszaru z listy klubów zdejmuje wybraną zakładkę zamiast pokazywać pustkę", () => {
    const { rerender } = render(<MyClubsTabs clubs={MINE} loading={false} layout="list" />);

    fireEvent.click(screen.getByRole("button", { name: /Transport/ }));
    expect(visibleNames()).toEqual(["Klub 3"]);

    // Użytkownik wyszedł z jedynego klubu obszaru „transport” (albo refetch
    // przyniósł zbiór bez niego) - zakładka nie ma prawa zostać wybrana.
    rerender(
      <MyClubsTabs
        clubs={[otherCard(1, { policy_area: "energy" }), otherCard(4, { policy_area: null })]}
        loading={false}
        layout="list"
      />,
    );

    expect(visibleNames()).toEqual(["Klub 1", "Klub 4"]);
    expect(
      screen.getByRole("button", { name: /club.hub.allTopics/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("stan ładowania przechodzi do katalogu razem z wybranym układem", () => {
    const { container } = render(<MyClubsTabs clubs={MINE} loading layout="magazine" />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    // Pasek zakładek zostaje - liczniki nie zależą od tego, czy siatka dojechała.
    expect(screen.getByRole("navigation", { name: "club.hub.myTopicsLabel" })).toBeTruthy();
  });
});
