// Lewa szyna huba i jej dwa pozostałe nośniki (`ClubHubRail.tsx`):
// `ClubHubRail` (kolumna w hubie), `ClubHubSectionBar` (poziomy pasek na
// telefonie) i `ClubWorkspaceRail` (ta sama kolumna na podstronach).
//
// CO TEN PLIK DOWODZI.
//  1. JEDNA REGUŁA WIDOCZNOŚCI DLA TRZECH NOŚNIKÓW. Sekcje mówiące o LUDZIACH
//     (`members`, `experts`, `spotlight`) milkną tam, gdzie klub ukrywa skład -
//     i milkną IDENTYCZNIE w kolumnie, na pasku i na podstronach. Rozjazd
//     między nośnikami znaczyłby, że ktoś wchodzi w listę nazwisk z telefonu,
//     a nie wchodzi z desktopu. `board` (tablica ogłoszeń) zostaje: ogłoszenie
//     nie jest listą nazwisk.
//  2. KTÓRY LINK JEST AKTYWNY. Sekcja „wątki” celuje w `/club/$clubSlug`,
//     który jest PREFIKSEM każdej pozostałej trasy klubu, więc jako JEDYNA
//     dopasowuje się DOKŁADNIE - bez tego świeciłaby się na wszystkich
//     dziewięciu ekranach naraz. Asercja idzie po `activeOptions`, bo to ono
//     jest tu kontraktem, a nie klasa CSS stanu.
//  3. LICZBY SĄ OPCJONALNE I SĄ OZDOBĄ DLA OKA: sekcja bez liczby wygląda jak
//     sekcja (a nie jak sekcja z zerem), zero nie rysuje plakietki, powyżej
//     99 skraca się do „99+”, a NAZWA DOSTĘPNA linku nigdy nie zawiera liczby -
//     „Dokumenty 12” czytane na głos brzmi jak nazwa dokumentu numer dwanaście.
//  4. PANELE POD SPISEM TREŚCI mają po trzy stany: dział (jest / brak),
//     obszar tematyczny (jest / null / same białe znaki) i zasady (są / brak).
//     Białoznakowa kolumna zasad to BRAK zasad - inaczej szyna linkuje
//     w zakładkę z pustym ciągiem.
//  5. DZIAŁY SĄ ZAWĘŻENIEM STRUMIENIA, nie trasą: stoją w szynie huba
//     i NIE MA ich w szynie podstron, bo na bibliotece nie mają czego odsiać.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - `ClubGroupTree`: drzewo działów, zwijanie i liczniki mają własny zakres.
//    Tutaj dowodzimy WPIĘCIA - że szyna oddaje wybór działu w górę.
//  - `ClubTopicChip` / `topicCatalog`: etykieta obszaru ma własne testy;
//    tutaj liczy się, że szyna podaje katalog z `useClubTopics` i język.
//  - `pickLocalized`: polityka „żądany język -> drugi -> ''” ma własny zakres.
//  - STANU AKTYWNEGO jako WYGLĄDU: `data-status` dokłada router, więc atrapa
//    `Link` nie ma prawa go udawać - zamiast klasy sprawdzamy wejście reguły.
//
// GAŁĄŹ NIEDOBITA ŚWIADOMIE: `if (items.length === 0) return null` w siatce
// sekcji. Grupa „club” i „work” nie mają ani jednej sekcji o ludziach,
// a z grupy „people” po ukryciu składu zostaje `board` - więc żadna grupa nie
// robi się pusta i tej gałęzi nie da się dziś wywołać bez zmiany katalogu
// sekcji. Zostaje jako obrona przed katalogiem, w którym cała grupa zniknie.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  /** Wejście reguły stanu aktywnego, zapisane per adres docelowy. */
  exactByTo: new Map<string, boolean>(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: ({
      activeOptions,
      ...rest
    }: {
      to?: string;
      params?: Record<string, string>;
      activeOptions?: { exact?: boolean };
      className?: string;
      children?: ReactNode;
    }) => {
      // `activeOptions` nie ma reprezentacji w DOM-ie, a to ono rozstrzyga,
      // czy link świeci się na jednym ekranie, czy na wszystkich.
      if (typeof rest.to === "string" && activeOptions !== undefined) {
        h.exactByTo.set(rest.to, activeOptions.exact === true);
      }
      return <RouterLinkStub {...rest} />;
    },
  };
});

vi.mock("@/lib/clubs/useClubTopics", () => ({
  useClubTopics: () => ({
    topics: [{ key: "energy", label_pl: "Energia", label_en: "Energy", sort_order: 1 }],
    isLoading: false,
  }),
}));

import {
  ClubHubRail,
  ClubHubSectionBar,
  ClubWorkspaceRail,
} from "@/components/clubs/molecules/ClubHubRail";
import { clubGroupRow, clubViewRow, CLUB_IDS } from "@/test/clubs/fixtures";
import type { ClubGroupRow, ClubViewRow } from "@/lib/clubs/types";

const SLUG = "klub-energetyczny";

/** Nazwy sekcji o LUDZIACH, które milkną przy ukrytym składzie. */
const PEOPLE = ["members", "experts", "spotlight"] as const;

function railProps(overrides: {
  canSeeMembers?: boolean;
  groups?: readonly ClubGroupRow[];
  policyArea?: string | null;
  activeGroupId?: string | null;
  onGroupChange?: (groupId: string | null) => void;
  counts?: Partial<Record<string, number>>;
  hasRules?: boolean;
} = {}) {
  return {
    clubSlug: SLUG,
    canSeeMembers: overrides.canSeeMembers ?? true,
    groups: overrides.groups ?? [],
    policyArea: overrides.policyArea ?? null,
    activeGroupId: overrides.activeGroupId ?? null,
    onGroupChange: overrides.onGroupChange ?? vi.fn(),
    counts: overrides.counts,
    hasRules: overrides.hasRules ?? false,
  };
}

function sectionLinkNames(): string[] {
  const nav = screen.getByRole("navigation", { name: "club.hub.sectionsLabel" });
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

afterEach(() => {
  cleanup();
  h.lang = "pl";
  h.exactByTo.clear();
});

describe("Spis treści klubu - widoczność sekcji", () => {
  it("kolumna pokazuje wszystkie dziewięć sekcji w trzech grupach, gdy skład jest widoczny", () => {
    render(<ClubHubRail {...railProps({ canSeeMembers: true })} />);

    expect(sectionLinkNames()).toHaveLength(9);
    for (const group of ["club", "people", "work"]) {
      expect(screen.getByText(`club.hub.sectionGroups.${group}`)).toBeInTheDocument();
    }
  });

  it("kolumna ukrywa sekcje o LUDZIACH, gdy klub ukrywa skład - tablica zostaje", () => {
    render(<ClubHubRail {...railProps({ canSeeMembers: false })} />);

    const names = sectionLinkNames();
    expect(names).toHaveLength(6);
    for (const key of PEOPLE) {
      expect(names.some((name) => name.includes(`club.hub.sections.${key}`))).toBe(false);
    }
    expect(names.some((name) => name.includes("club.hub.sections.board"))).toBe(true);
    // Grupa „ludzie” nie znika razem z nazwiskami - ma jeszcze tablicę.
    expect(screen.getByText("club.hub.sectionGroups.people")).toBeInTheDocument();
  });

  it("poziomy pasek stosuje DOKŁADNIE tę samą regułę i nie rysuje nagłówków grup", () => {
    const { container } = render(
      <ClubHubSectionBar clubSlug={SLUG} canSeeMembers={false} className="mb-3" />,
    );

    const names = sectionLinkNames();
    expect(names).toHaveLength(6);
    for (const key of PEOPLE) {
      expect(names.some((name) => name.includes(`club.hub.sections.${key}`))).toBe(false);
    }
    expect(container.querySelector("h3")).toBeNull();
  });

  it("poziomy pasek przy widocznym składzie pokazuje pełną dziewiątkę", () => {
    render(<ClubHubSectionBar clubSlug={SLUG} canSeeMembers />);
    expect(sectionLinkNames()).toHaveLength(9);
  });
});

describe("Spis treści klubu - który link jest aktywny", () => {
  it("kolumna: tylko „wątki” dopasowują się DOKŁADNIE, reszta prefiksem", () => {
    render(<ClubHubRail {...railProps({ canSeeMembers: true })} />);

    expect(h.exactByTo.get("/club/$clubSlug")).toBe(true);
    expect(h.exactByTo.get("/club/$clubSlug/documents")).toBe(false);
    expect(h.exactByTo.get("/club/$clubSlug/members")).toBe(false);
    expect(h.exactByTo.get("/club/$clubSlug/insights")).toBe(false);
  });

  it("poziomy pasek niesie tę samą regułę dopasowania", () => {
    render(<ClubHubSectionBar clubSlug={SLUG} canSeeMembers />);

    expect(h.exactByTo.get("/club/$clubSlug")).toBe(true);
    expect(h.exactByTo.get("/club/$clubSlug/calendar")).toBe(false);
  });

  it("adres sekcji jest rozwiązany dla TEGO klubu", () => {
    render(<ClubHubRail {...railProps()} />);
    expect(screen.getByRole("link", { name: "club.hub.sections.documents" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/documents`,
    );
  });
});

describe("Spis treści klubu - liczby przy kafelkach", () => {
  it("liczba dodatnia jest widoczna, zero i brak liczby nie rysują plakietki", () => {
    render(
      <ClubHubRail {...railProps({ counts: { threads: 12, documents: 0 } })} />,
    );

    const threads = screen.getByRole("link", { name: "club.hub.sections.threads" });
    const documents = screen.getByRole("link", { name: "club.hub.sections.documents" });
    const calendar = screen.getByRole("link", { name: "club.hub.sections.calendar" });

    expect(threads.textContent).toContain("12");
    expect(documents.textContent).toBe("club.hub.sections.documents");
    expect(calendar.textContent).toBe("club.hub.sections.calendar");
  });

  it("liczba powyżej dziewięćdziesięciu dziewięciu skraca się do „99+”", () => {
    render(<ClubHubRail {...railProps({ counts: { threads: 250 } })} />);
    expect(
      screen.getByRole("link", { name: "club.hub.sections.threads" }).textContent,
    ).toContain("99+");
  });

  it("liczba NIE wchodzi do nazwy dostępnej linku", () => {
    render(<ClubHubRail {...railProps({ counts: { members: 42 } })} />);
    // Gdyby plakietka nie była `aria-hidden`, ta nazwa brzmiałaby „…members 42”.
    expect(screen.getByRole("link", { name: "club.hub.sections.members" })).toBeInTheDocument();
  });
});

describe("ClubHubRail - panele pod spisem treści", () => {
  it("działy klubu stoją w szynie jako filtr i oddają wybór w górę", () => {
    const onGroupChange = vi.fn();
    render(
      <ClubHubRail
        {...railProps({
          groups: [clubGroupRow()],
          onGroupChange,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Dyskusje/ }));
    expect(onGroupChange).toHaveBeenCalledWith(CLUB_IDS.group);
  });

  it("klub bez działów nie dostaje pustego panelu działów", () => {
    render(<ClubHubRail {...railProps({ groups: [] })} />);
    expect(screen.queryByText("club.groups")).toBeNull();
  });

  it("obszar tematyczny jedzie z katalogu i w języku interfejsu", () => {
    h.lang = "en";
    render(<ClubHubRail {...railProps({ policyArea: "energy" })} />);

    expect(screen.getByText("club.topic.label")).toBeInTheDocument();
    expect(screen.getByText("Energy")).toBeInTheDocument();
  });

  it("brak obszaru tematycznego nie rysuje panelu", () => {
    render(<ClubHubRail {...railProps({ policyArea: null })} />);
    expect(screen.queryByText("club.topic.label")).toBeNull();
  });

  it("obszar z samych białych znaków jest brakiem obszaru", () => {
    render(<ClubHubRail {...railProps({ policyArea: "   " })} />);
    expect(screen.queryByText("club.topic.label")).toBeNull();
  });

  it("link do zasad pojawia się wyłącznie wtedy, gdy klub ma zasady", () => {
    render(<ClubHubRail {...railProps({ hasRules: true })} />);
    expect(screen.getByRole("link", { name: "club.rules" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/about`,
    );
  });

  it("klub bez zasad nie linkuje w pustą zakładkę", () => {
    render(<ClubHubRail {...railProps({ hasRules: false })} />);
    expect(screen.queryByRole("link", { name: "club.rules" })).toBeNull();
  });
});

describe("ClubWorkspaceRail - ta sama kolumna na podstronach", () => {
  function mountWorkspace(overrides: Partial<ClubViewRow> = {}) {
    return render(<ClubWorkspaceRail club={clubViewRow(overrides)} />);
  }

  it("liczy WYŁĄCZNIE to, co i tak wiezie wiersz klubu - biblioteka nie dostaje plakietki", () => {
    mountWorkspace({ thread_count: 12, member_count: 42 });

    expect(
      screen.getByRole("link", { name: "club.hub.sections.threads" }).textContent,
    ).toContain("12");
    expect(
      screen.getByRole("link", { name: "club.hub.sections.members" }).textContent,
    ).toContain("42");
    expect(screen.getByRole("link", { name: "club.hub.sections.documents" }).textContent).toBe(
      "club.hub.sections.documents",
    );
  });

  it("ukrywa sekcje o ludziach tą samą regułą, co szyna huba", () => {
    mountWorkspace({ can_see_members: false });

    const names = sectionLinkNames();
    expect(names).toHaveLength(6);
    for (const key of PEOPLE) {
      expect(names.some((name) => name.includes(`club.hub.sections.${key}`))).toBe(false);
    }
  });

  it("NIE ma filtra działów - dział zawęża strumień, nie bibliotekę", () => {
    mountWorkspace();
    expect(screen.queryByText("club.groups")).toBeNull();
  });

  it("pokazuje obszar tematyczny klubu w języku interfejsu", () => {
    h.lang = "en-US";
    mountWorkspace({ policy_area: "energy" });
    expect(screen.getByText("Energy")).toBeInTheDocument();
  });

  it("klub bez obszaru tematycznego nie dostaje panelu obszaru", () => {
    mountWorkspace({ policy_area: "  " });
    expect(screen.queryByText("club.topic.label")).toBeNull();
  });

  it("zasady z samych białych znaków to BRAK zasad, nie zakładka z pustym ciągiem", () => {
    mountWorkspace({ rules_pl: "   ", rules_en: "" });
    expect(screen.queryByRole("link", { name: "club.rules" })).toBeNull();
  });

  it("klub z zasadami linkuje do „o klubie”", () => {
    mountWorkspace({ rules_pl: "Zasady klubu" });
    expect(screen.getByRole("link", { name: "club.rules" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/about`,
    );
  });
});
