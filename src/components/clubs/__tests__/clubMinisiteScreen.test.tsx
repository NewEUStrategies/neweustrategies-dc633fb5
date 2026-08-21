// Minisite klubu (`ClubMinisite`) - kuratorska wizytówka klubu wewnątrz klubu.
//
// CO TEN PLIK DOWODZI.
//
//   1. BRAMKA ROZSTRZYGA, KTÓRY PANEL NARYSOWAĆ - i nic więcej. Dla każdej
//      z pięciu wartości `ClubMinisiteAccess` ekran albo pokazuje fragmenty,
//      albo zachętę; ODMOWA BAZY (`no_read`) nie dostaje przycisku cennika, bo
//      plan nie odblokuje czegoś, czego baza nie wydała.
//   2. NAGŁÓWEK JEST WIZYTÓWKĄ, NIE PANELEM: nazwa, zapowiedź, liczniki, obszar
//      tematyczny, reguła atrybucji i stan dostępu. Zero kontrolek listy.
//   3. TRZY STANY LISTY WĄTKÓW: w locie (zastępniki, `aria-busy`), pusta
//      (jedno zdanie, nie pusta siatka) i pełna - PIERWSZY wątek jest
//      wyróżniony, pozostałe idą w siatkę.
//   4. FRAGMENT WĄTKU CZYTA AUTORA WSPÓLNĄ FUNKCJĄ: alias, konto usunięte
//      i podpis imienny to trzy różne wyniki, nie trzy kopie reguły.
//   5. DATA WĄTKU BIERZE SIĘ Z OSTATNIEJ ODPOWIEDZI, a gdy jej nie ma - z daty
//      utworzenia; data, której nie da się przeczytać, nie rysuje rubryki
//      (zamiast pokazać puste miejsce po dacie).
//   6. SEKCJE OPCJONALNE (zapowiedź, opis, zasady) znikają, gdy w bazie stoi
//      pusty napis - nie zostawiają po sobie nagłówka bez treści.
//   7. EKRAN JEST DOSTĘPNY - jeden przebieg `axeViolations()` na wariancie
//      z pełnymi danymi.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁY `resolveClubMinisiteAccess` / `showsClubMinisiteContent`: mają tabelę
//   przypadków w `src/lib/clubs/__tests__/minisiteAccess.test.ts`. Tutaj wchodzi
//   GOTOWA wartość i sprawdzamy decyzję EKRANU, nie rachunek bramki.
// - `toAuthorLabel` i `pickLocalized` - własne zakresy; tu dowodzimy WYWOŁANIA.
// - ATOMÓW `ClubCover` i `ClubTopicChip` - zakres w testach atomów.
// - TRASY: tego, skąd biorą się `club`, `threads` i `access`, dowodzi
//   `clubHubRoutes.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { CLUB_BASE_ISO, clubThreadListRow, clubViewRow } from "@/test/clubs/fixtures";
import { axeViolations, summarize } from "@/test/axe";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ClubMinisiteAccess } from "@/lib/clubs/minisiteAccess";
import { ClubMinisite } from "@/components/clubs/organisms/ClubMinisite";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
// Katalog obszarów idzie przez react-query; atrapa trzyma test poza siecią,
// a `topicLabel` i tak zna listę awaryjną, więc chip ma czym się podpisać.
vi.mock("@/lib/clubs/topicsApi", () => ({
  fetchActiveClubTopics: vi.fn().mockResolvedValue([]),
  fetchAdminClubTopics: vi.fn(),
  upsertClubTopic: vi.fn(),
  setClubTopicActive: vi.fn(),
  deleteClubTopic: vi.fn(),
}));

const WATKI = [
  clubThreadListRow({ id: "w-1", slug: "temat-pierwszy", title: "Temat pierwszy" }),
  clubThreadListRow({ id: "w-2", slug: "temat-drugi", title: "Temat drugi" }),
  clubThreadListRow({ id: "w-3", slug: "temat-trzeci", title: "Temat trzeci" }),
];

function pokaz(
  access: ClubMinisiteAccess,
  options: {
    threads?: typeof WATKI;
    loading?: boolean;
    club?: ReturnType<typeof clubViewRow>;
  } = {},
) {
  return renderWithQueryClient(
    <ClubMinisite
      club={options.club ?? clubViewRow()}
      threads={options.threads ?? WATKI}
      loading={options.loading ?? false}
      access={access}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("ClubMinisite - bramka miękka", () => {
  it.each<ClubMinisiteAccess>(["member", "invited", "entitled"])(
    "dostęp „%s” pokazuje fragmenty wątków, a nie zachętę",
    (access) => {
      pokaz(access);

      expect(screen.getByText("club.minisite.readingTitle")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Temat pierwszy" })).toBeInTheDocument();
      expect(screen.queryByText("club.minisite.lockedTitle")).toBeNull();
      expect(screen.queryByText("club.minisite.noReadTitle")).toBeNull();
      expect(screen.getByText(`club.minisite.access.${access}`)).toBeInTheDocument();
    },
  );

  it("dostęp „locked” pokazuje zachętę z drogą do planu, a nie fragmenty", () => {
    pokaz("locked");

    expect(screen.getByText("club.minisite.lockedTitle")).toBeInTheDocument();
    expect(screen.getByText("club.minisite.lockedBody")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "club.hub.upgradeCta" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.queryByText("club.minisite.readingTitle")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Temat pierwszy" })).toBeNull();
  });

  it("dostęp „no_read” to odmowa bazy: własny komunikat i BRAK przycisku cennika", () => {
    pokaz("no_read");

    expect(screen.getByText("club.minisite.noReadTitle")).toBeInTheDocument();
    expect(screen.getByText("club.minisite.noReadBody")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "club.hub.upgradeCta" })).toBeNull();
    expect(screen.queryByText("club.minisite.lockedTitle")).toBeNull();
    expect(screen.queryByText("club.minisite.readingTitle")).toBeNull();
  });

  it("zachęta nie zabiera nagłówka ani zasad - wizytówka zostaje wizytówką", () => {
    pokaz("locked");

    expect(
      screen.getByRole("heading", { level: 1, name: "Klub energetyczny" }),
    ).toBeInTheDocument();
    expect(screen.getByText("club.minisite.aboutTitle")).toBeInTheDocument();
    expect(screen.getByText("club.rules")).toBeInTheDocument();
  });
});

describe("ClubMinisite - nagłówek", () => {
  it("dane PEŁNE: nazwa, zapowiedź, liczniki, obszar, reguła Chatham House i droga do dyskusji", () => {
    pokaz("member", {
      club: clubViewRow({ attribution_mode: "chatham", cover_image_url: "" }),
    });

    expect(screen.getByText("club.minisite.eyebrow")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Klub energetyczny" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Energia i klimat")).toBeInTheDocument();
    expect(screen.getByText("club.membersCount(count=42)")).toBeInTheDocument();
    expect(screen.getByText("club.threadsCount(count=12)")).toBeInTheDocument();
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
    expect(screen.getByText("club.attribution.chatham")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "club.minisite.toDiscussion" })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny",
    );
  });

  it("klub z podpisem imiennym nie dostaje odznaki Chatham House", () => {
    pokaz("member", { club: clubViewRow({ attribution_mode: "named" }) });

    expect(screen.queryByText("club.attribution.chatham")).toBeNull();
  });

  it("dane CZĘŚCIOWE: puste zapowiedź, opis i zasady nie zostawiają nagłówków bez treści", () => {
    pokaz("member", {
      club: clubViewRow({
        tagline_pl: "   ",
        tagline_en: "   ",
        description_pl: "",
        description_en: "",
        rules_pl: "   ",
        rules_en: "   ",
      }),
    });

    expect(screen.queryByText("Energia i klimat")).toBeNull();
    expect(screen.queryByText("club.minisite.aboutTitle")).toBeNull();
    expect(screen.queryByText("club.rules")).toBeNull();
    // Sama lista fragmentów zostaje - to ona jest treścią minisite'u.
    expect(screen.getByText("club.minisite.readingTitle")).toBeInTheDocument();
  });

  it("okładka pojawia się tylko wtedy, gdy klub ma zdjęcie", () => {
    const { container } = pokaz("member", {
      club: clubViewRow({ cover_image_url: "https://obrazy.example/klub.jpg" }),
    });
    expect(container.querySelector("img")).not.toBeNull();

    cleanup();
    const bezOkladki = pokaz("member", { club: clubViewRow({ cover_image_url: "" }) });
    expect(bezOkladki.container.querySelector("img")).toBeNull();
  });

  it("klub bez obszaru tematycznego nie rysuje pustego chipu", () => {
    pokaz("member", { club: clubViewRow({ policy_area: "" }) });

    expect(screen.queryByText("Energetyka")).toBeNull();
    expect(screen.getByText("club.membersCount(count=42)")).toBeInTheDocument();
  });
});

describe("ClubMinisite - lista fragmentów", () => {
  it("zapytanie w locie pokazuje zastępniki, a nie pustą sekcję", () => {
    const { container } = pokaz("member", { threads: [], loading: true });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("club.minisite.empty")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Temat pierwszy" })).toBeNull();
  });

  it("pusta lista mówi jedno zdanie, a nie rysuje siatki bez kafli", () => {
    pokaz("member", { threads: [] });

    expect(screen.getByText("club.minisite.empty")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Temat pierwszy" })).toBeNull();
  });

  it("jeden wątek to sam wyróżniony fragment - bez siatki pozostałych", () => {
    pokaz("member", { threads: [WATKI[0]!] });

    const wyrozniony = screen.getByRole("link", { name: /Temat pierwszy/ });
    expect(wyrozniony).toHaveAttribute("href", "/club/klub-energetyczny/t/temat-pierwszy");
    expect(screen.getByRole("heading", { name: "Temat pierwszy" }).className).toContain("text-xl");
    expect(screen.queryByRole("heading", { name: "Temat drugi" })).toBeNull();
  });

  it("lista PEŁNA wyróżnia PIERWSZY wątek, a pozostałe wkłada do siatki", () => {
    pokaz("member");

    expect(screen.getByRole("heading", { name: "Temat pierwszy" }).className).toContain("text-xl");
    expect(screen.getByRole("heading", { name: "Temat drugi" }).className).not.toContain("text-xl");
    expect(screen.getByRole("heading", { name: "Temat trzeci" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Temat trzeci/ })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny/t/temat-trzeci",
    );
  });

  it("fragment niesie rodzaj, dział, licznik odpowiedzi i datę ostatniej odpowiedzi", () => {
    pokaz("member", {
      threads: [
        clubThreadListRow({
          id: "w-pelny",
          slug: "temat-pelny",
          title: "Temat pełny",
          kind: "position",
          reply_count: 7,
          last_reply_at: CLUB_BASE_ISO,
        }),
      ],
    });

    const fragment = within(screen.getByRole("link", { name: /Temat pełny/ }));
    expect(fragment.getByText("club.kind.position")).toBeInTheDocument();
    expect(fragment.getByText("Dyskusje")).toBeInTheDocument();
    expect(fragment.getByText("club.repliesCount(count=7)")).toBeInTheDocument();
    expect(fragment.getByText("18 sie 2026")).toBeInTheDocument();
    expect(fragment.getByText("Fragment")).toBeInTheDocument();
  });

  it("brak ostatniej odpowiedzi spada na datę utworzenia wątku", () => {
    pokaz("member", {
      threads: [
        clubThreadListRow({
          id: "w-bez-odpowiedzi",
          slug: "temat-bez-odpowiedzi",
          title: "Temat bez odpowiedzi",
          last_reply_at: null,
          created_at: "2026-07-01T08:00:00.000Z",
          reply_count: 0,
        }),
      ],
    });

    const fragment = within(screen.getByRole("link", { name: /Temat bez odpowiedzi/ }));
    expect(fragment.getByText("1 lip 2026")).toBeInTheDocument();
    expect(fragment.getByText("club.repliesCount(count=0)")).toBeInTheDocument();
  });

  it("data pusta i data nieczytelna nie rysują rubryki daty", () => {
    pokaz("member", {
      threads: [
        clubThreadListRow({
          id: "w-pusta-data",
          slug: "temat-pusta-data",
          title: "Temat z pustą datą",
          last_reply_at: null,
          created_at: "",
        }),
        clubThreadListRow({
          id: "w-zla-data",
          slug: "temat-zla-data",
          title: "Temat ze złą datą",
          last_reply_at: "nie-data",
        }),
      ],
    });

    expect(
      within(screen.getByRole("link", { name: /Temat z pustą datą/ })).queryByText(/2026/),
    ).toBeNull();
    expect(
      within(screen.getByRole("link", { name: /Temat ze złą datą/ })).queryByText(/2026/),
    ).toBeNull();
  });

  it("fragment bez zajawki nie rysuje pustego akapitu", () => {
    pokaz("member", {
      threads: [
        clubThreadListRow({
          id: "w-bez-zajawki",
          slug: "temat-bez-zajawki",
          title: "Temat bez zajawki",
          excerpt: "   ",
        }),
        clubThreadListRow({
          id: "w-null-zajawka",
          slug: "temat-null-zajawka",
          title: "Temat z pustym polem",
          excerpt: null,
        }),
      ],
    });

    expect(screen.queryByText("Fragment")).toBeNull();
    expect(screen.getByRole("heading", { name: "Temat bez zajawki" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Temat z pustym polem" })).toBeInTheDocument();
  });

  it("autorstwo idzie przez wspólną funkcję: alias, konto usunięte i podpis imienny", () => {
    pokaz("member", {
      threads: [
        clubThreadListRow({
          id: "w-alias",
          slug: "temat-alias",
          title: "Temat pod aliasem",
          is_anonymous: true,
          author_alias: "Uczestnik 4",
          author_name: null,
        }),
        clubThreadListRow({
          id: "w-usuniety",
          slug: "temat-usuniety",
          title: "Temat po usuniętym koncie",
          author_alias: null,
          author_name: null,
          author_id: null,
        }),
        clubThreadListRow({
          id: "w-imienny",
          slug: "temat-imienny",
          title: "Temat imienny",
          author_name: "Anna Nowak",
        }),
      ],
    });

    expect(
      within(screen.getByRole("link", { name: /Temat pod aliasem/ })).getByText(
        "club.anonymousAuthor",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("link", { name: /Temat po usuniętym koncie/ })).getByText(
        "club.deletedAuthor",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("link", { name: /Temat imienny/ })).getByText("Anna Nowak"),
    ).toBeInTheDocument();
  });
});

describe("ClubMinisite - dostępność", () => {
  it("wariant z pełnymi danymi nie ma naruszeń axe", async () => {
    const { container } = pokaz("member", {
      club: clubViewRow({
        attribution_mode: "chatham",
        cover_image_url: "https://obrazy.example/klub.jpg",
      }),
    });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
