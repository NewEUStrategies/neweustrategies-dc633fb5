// Jedno miejsce, w którym w klubie coś się PISZE (`ClubCreatePanel`).
//
// CO TEN PLIK DOWODZI.
//  1. BRAMKA PISANIA: gdy nikt nic nie napisze (`canPost` i `canPostThread`
//     fałszywe), panel schodzi do JEDNEJ linii, a nie do dwóch pustych
//     zakładek - i mówi, kto może pisać, zgodnie z `clubs.who_can_post`.
//  2. DOMYŚLNA ZAKŁADKA idzie za uprawnieniem: wpis dla piszącego, dyskusja
//     dla kogoś, kto wpisu dodać nie może. Zakładka bez uprawnienia jest
//     wyszarzona, a nie ukryta.
//  3. UTRATA UPRAWNIENIA W TRAKCIE SESJI (moderacja odbiera prawo między
//     odświeżeniami danych) nie zostawia użytkownika na formularzu, którego
//     nie ma prawa wysłać - to jedyna droga do gałęzi `tab === "post" &&
//     !canPost` oraz do zdania „zamknięte” wewnątrz zakładki dyskusji.
//  4. LISTA CELÓW: nowy wątek, DZIAŁY z prawem zakładania tematu (dział bez
//     tego prawa NIE ma prawa być do wyboru - inaczej wybór kończy się
//     odmową RPC) i istniejące wątki, przycięte do trzydziestu pozycji.
//  5. ADRES DOCELOWY jako PAYLOAD: wybór działu jedzie parametrem `groupId`,
//     brak działu nie dokłada pustego parametru, rodzaj wypowiedzi jedzie
//     parametrem `kind`, a wybór istniejącego wątku prowadzi do TEGO wątku
//     i chowa rodzaj (dopisanie się do rozmowy jest odpowiedzią).
//  6. Nazwa działu jest w JĘZYKU INTERFEJSU.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - KOMPOZYTORA WPISU: `ClubPostComposer` ma własny plik
//    (`clubComposers.test.tsx`) i tutaj stoi w atrapie - sprawdzamy WYŁĄCZNIE
//    kontrakt kompozycji (klub, dział, prawo, wariant bez ramki).
//  - LOKALIZACJI nazwy działu: reguła jest w `pickLocalized`/`clubGroupName`;
//    tutaj dowodzimy tylko, że panel podaje język interfejsu.
//  - PEŁNEGO kompozytora wątku: żyje na trasie /new, panel jest wyborem MIEJSCA.
//
// Radix Select nie działa pod happy-dom bez pełnego API wskaźnika, więc lista
// wyboru stoi w natywnym `<select>`; `Link` routera zapisuje swoje `to`,
// `params` i `search`, bo to one są tu kontraktem, a nie sam napis na guziku.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubGroupRow, ClubThreadListRow } from "@/lib/clubs/types";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  links: [] as Array<{ to: unknown; params: unknown; search: unknown }>,
  composers: [] as Array<{
    clubId: string;
    groupId?: string | null;
    canPost: boolean;
    chromeless?: boolean;
  }>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: (props: {
      to?: string;
      params?: Record<string, string>;
      search?: unknown;
      className?: string;
      children?: ReactNode;
    }) => {
      // Zapis PROPSÓW, nie DOM-u: `search` nie ma reprezentacji w atrybucie,
      // a to ono decyduje, z jakim rodzajem i działem otworzy się /new.
      h.links.push({ to: props.to, params: props.params, search: props.search });
      return (
        <RouterLinkStub to={props.to} params={props.params} className={props.className}>
          {props.children}
        </RouterLinkStub>
      );
    },
  };
});

vi.mock("@/components/clubs/molecules/ClubPostComposer", () => ({
  ClubPostComposer: (props: {
    clubId: string;
    groupId?: string | null;
    canPost: boolean;
    chromeless?: boolean;
  }) => {
    h.composers.push(props);
    return <div data-testid="post-composer-stub" />;
  },
}));

// Lista wyboru: natywny `<select>`. Etykietą jest tu `<span>`, nie `<label>`,
// więc pole znajdujemy po roli - dokładnie tak, jak widzi je czytnik ekranu.
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (next: string) => void;
      children?: ReactNode;
    }) => (
      <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
        {react.Children.toArray(children)}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

import { ClubCreatePanel } from "@/components/clubs/molecules/ClubCreatePanel";
import { CLUB_IDS, clubGroupRow, clubThreadListRow } from "@/test/clubs/fixtures";
import { translateKey } from "@/test/i18nStub";

const CLUB_SLUG = "klub-energetyczny";

function panelProps(overrides: {
  groupId?: string | null;
  groups?: readonly ClubGroupRow[];
  threads?: readonly ClubThreadListRow[];
  canPost?: boolean;
  canPostThread?: boolean;
  whoCanPost?: string;
  className?: string;
}) {
  return {
    clubSlug: CLUB_SLUG,
    clubId: CLUB_IDS.club,
    groupId: overrides.groupId ?? null,
    groups: overrides.groups ?? [],
    threads: overrides.threads ?? [],
    canPost: overrides.canPost ?? true,
    canPostThread: overrides.canPostThread ?? true,
    whoCanPost: overrides.whoCanPost ?? "members",
    ...(overrides.className === undefined ? {} : { className: overrides.className }),
  };
}

function targetSelect(): HTMLSelectElement {
  const el = screen.getByRole("combobox");
  if (!(el instanceof HTMLSelectElement)) throw new Error("lista celów nie jest polem wyboru");
  return el;
}

const tab = (value: "post" | "thread"): HTMLElement =>
  screen.getByRole("tab", { name: translateKey(`club.hub.create.tabs.${value}`) });

const lastLink = (): { to: unknown; params: unknown; search: unknown } => {
  const link = h.links.at(-1);
  if (link === undefined) throw new Error("panel nie wyrenderował żadnego odnośnika");
  return link;
};

beforeEach(() => {
  h.lang = "pl";
  h.links.length = 0;
  h.composers.length = 0;
});

afterEach(cleanup);

describe("ClubCreatePanel - bramka pisania", () => {
  it("gdy nikt nic nie napisze, panel schodzi do jednej linii o członkach", () => {
    render(
      <ClubCreatePanel
        {...panelProps({ canPost: false, canPostThread: false, whoCanPost: "members" })}
      />,
    );
    expect(screen.getByText(translateKey("club.hub.composer.closed.members"))).toBeInTheDocument();
    expect(screen.queryByTestId("club-create-panel")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("klub prowadzony przez moderację mówi o moderacji", () => {
    render(
      <ClubCreatePanel
        {...panelProps({ canPost: false, canPostThread: false, whoCanPost: "moderators" })}
      />,
    );
    expect(
      screen.getByText(translateKey("club.hub.composer.closed.moderators")),
    ).toBeInTheDocument();
  });
});

describe("ClubCreatePanel - zakładki", () => {
  it("piszący startuje na wpisie, a kompozytor dostaje klub, dział i wariant bez ramki", () => {
    render(
      <ClubCreatePanel {...panelProps({ groupId: CLUB_IDS.group, className: "moja-klasa" })} />,
    );
    expect(tab("post")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("post-composer-stub")).toBeInTheDocument();
    expect(h.composers.at(-1)).toEqual({
      clubId: CLUB_IDS.club,
      groupId: CLUB_IDS.group,
      canPost: true,
      chromeless: true,
    });
    expect(screen.getByTestId("club-create-panel")).toHaveClass("moja-klasa");
  });

  it("bez prawa do wpisu panel startuje na dyskusji, a zakładka wpisu jest wyszarzona", () => {
    render(<ClubCreatePanel {...panelProps({ canPost: false })} />);
    expect(tab("thread")).toHaveAttribute("aria-selected", "true");
    expect(tab("post")).toBeDisabled();
    expect(screen.queryByTestId("post-composer-stub")).toBeNull();
    expect(targetSelect()).toBeInTheDocument();
  });

  it("kliknięcie zakładki przełącza formę w obie strony", () => {
    render(<ClubCreatePanel {...panelProps({})} />);
    fireEvent.click(tab("thread"));
    expect(screen.queryByTestId("post-composer-stub")).toBeNull();
    expect(targetSelect()).toBeInTheDocument();

    fireEvent.click(tab("post"));
    expect(screen.getByTestId("post-composer-stub")).toBeInTheDocument();
  });

  it("odebrane prawo do wpisu przestawia otwartą zakładkę na dyskusję", () => {
    const { rerender } = render(<ClubCreatePanel {...panelProps({})} />);
    expect(screen.getByTestId("post-composer-stub")).toBeInTheDocument();

    rerender(<ClubCreatePanel {...panelProps({ canPost: false })} />);

    expect(screen.queryByTestId("post-composer-stub")).toBeNull();
    expect(targetSelect()).toBeInTheDocument();
  });

  it("odebrane prawo do tematów pokazuje zdanie „zamknięte” wewnątrz zakładki", () => {
    const { rerender } = render(<ClubCreatePanel {...panelProps({ canPost: false })} />);
    expect(targetSelect()).toBeInTheDocument();

    rerender(
      <ClubCreatePanel {...panelProps({ canPostThread: false, whoCanPost: "moderators" })} />,
    );

    expect(
      screen.getByText(translateKey("club.hub.composer.closed.moderators")),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(tab("thread")).toBeDisabled();

    // Ten sam stan w klubie „piszą członkowie” mówi o CZŁONKACH - zdanie
    // wewnątrz zakładki czyta się z tej samej kolumny co bramka nad panelem.
    rerender(<ClubCreatePanel {...panelProps({ canPostThread: false, whoCanPost: "members" })} />);
    expect(screen.getByText(translateKey("club.hub.composer.closed.members"))).toBeInTheDocument();
  });
});

describe("ClubCreatePanel - lista celów", () => {
  const groups: readonly ClubGroupRow[] = [
    clubGroupRow({ id: CLUB_IDS.group, name_pl: "Dyskusje", name_en: "Discussions" }),
    clubGroupRow({
      id: CLUB_IDS.otherGroup,
      name_pl: "Ogłoszenia",
      name_en: "Announcements",
      can_post_thread: false,
    }),
  ];
  const threads: readonly ClubThreadListRow[] = [
    clubThreadListRow(),
    clubThreadListRow({ id: "thread-2", slug: "temat-drugi", title: "Temat drugi" }),
  ];

  it("pusta lista celów zostawia sam nowy wątek, bez nagłówków sekcji", () => {
    render(<ClubCreatePanel {...panelProps({ canPost: false })} />);
    expect(Array.from(targetSelect().options).map((option) => option.value)).toEqual(["new"]);
    expect(screen.queryByText(translateKey("club.hub.create.groupsHeading"))).toBeNull();
    expect(screen.queryByText(translateKey("club.hub.create.threadsHeading"))).toBeNull();
  });

  it("dział bez prawa zakładania tematu NIE jest do wyboru", () => {
    render(<ClubCreatePanel {...panelProps({ canPost: false, groups, threads })} />);
    expect(Array.from(targetSelect().options).map((option) => option.value)).toEqual([
      "new",
      `g:${CLUB_IDS.group}`,
      "t:temat-pierwszy",
      "t:temat-drugi",
    ]);
    expect(screen.getByText(translateKey("club.hub.create.groupsHeading"))).toBeInTheDocument();
    expect(screen.getByText(translateKey("club.hub.create.threadsHeading"))).toBeInTheDocument();
    expect(screen.getByText("Dyskusje")).toBeInTheDocument();
    expect(screen.queryByText("Ogłoszenia")).toBeNull();
  });

  it("lista wątków jest przycięta do trzydziestu pozycji", () => {
    const many: ClubThreadListRow[] = Array.from({ length: 31 }, (_, index) =>
      clubThreadListRow({
        id: `thread-${index}`,
        slug: `temat-${index}`,
        title: `Temat ${index}`,
      }),
    );
    render(<ClubCreatePanel {...panelProps({ canPost: false, threads: many })} />);
    const values = Array.from(targetSelect().options).map((option) => option.value);
    expect(values).toHaveLength(31);
    expect(values.at(-1)).toBe("t:temat-29");
  });

  it("nazwa działu idzie za językiem interfejsu", () => {
    h.lang = "en";
    render(<ClubCreatePanel {...panelProps({ canPost: false, groups })} />);
    expect(screen.getByText("Discussions")).toBeInTheDocument();
    expect(screen.queryByText("Dyskusje")).toBeNull();
  });
});

describe("ClubCreatePanel - adres docelowy", () => {
  const groups: readonly ClubGroupRow[] = [clubGroupRow({ id: CLUB_IDS.group })];
  const threads: readonly ClubThreadListRow[] = [clubThreadListRow()];

  it("bez aktywnego działu celem jest nowy wątek, a adres nie niesie działu", () => {
    render(<ClubCreatePanel {...panelProps({ canPost: false, groups, threads })} />);
    expect(targetSelect().value).toBe("new");
    expect(screen.getByText(translateKey("club.hub.create.start"))).toBeInTheDocument();
    expect(lastLink()).toEqual({
      to: "/club/$clubSlug/new",
      params: { clubSlug: CLUB_SLUG },
      search: { kind: "discussion" },
    });
  });

  it("aktywny dział jest domyślnym celem i jedzie parametrem adresu", () => {
    render(
      <ClubCreatePanel
        {...panelProps({ canPost: false, groupId: CLUB_IDS.group, groups, threads })}
      />,
    );
    expect(targetSelect().value).toBe(`g:${CLUB_IDS.group}`);
    expect(lastLink().search).toEqual({ kind: "discussion", groupId: CLUB_IDS.group });
  });

  it("wybrany rodzaj wypowiedzi jedzie parametrem adresu", () => {
    render(<ClubCreatePanel {...panelProps({ canPost: false })} />);
    const position = screen.getByRole("button", { name: translateKey("club.kind.position") });
    expect(position).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(position);

    expect(
      screen.getByRole("button", { name: translateKey("club.kind.position") }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: translateKey("club.kind.discussion") }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(lastLink().search).toEqual({ kind: "position" });
  });

  it("wybór istniejącego wątku chowa rodzaj i prowadzi do TEGO wątku", () => {
    render(<ClubCreatePanel {...panelProps({ canPost: false, threads })} />);
    fireEvent.change(targetSelect(), { target: { value: "t:temat-pierwszy" } });

    expect(screen.queryByRole("button", { name: translateKey("club.kind.position") })).toBeNull();
    expect(screen.getByText(translateKey("club.hub.create.continueThread"))).toBeInTheDocument();
    expect(lastLink()).toEqual({
      to: "/club/$clubSlug/t/$threadSlug",
      params: { clubSlug: CLUB_SLUG, threadSlug: "temat-pierwszy" },
      search: undefined,
    });
    expect(screen.getByRole("link")).toHaveAttribute("href", `/club/${CLUB_SLUG}/t/temat-pierwszy`);
  });

  it("wątek zdjęty z listy w trakcie sesji wraca do zakładania nowego", () => {
    const drugi = clubThreadListRow({ id: "thread-2", slug: "temat-drugi", title: "Temat drugi" });
    const { rerender } = render(
      <ClubCreatePanel {...panelProps({ canPost: false, threads: [...threads, drugi] })} />,
    );
    fireEvent.change(targetSelect(), { target: { value: "t:temat-drugi" } });
    expect(screen.getByText(translateKey("club.hub.create.continueThread"))).toBeInTheDocument();

    // Moderacja schowała wybrany wątek między odświeżeniami listy. Wybór celu
    // zostaje w stanie, więc panel MUSI wrócić do zakładania nowego tematu,
    // a nie prowadzić do adresu, który oddaje 404.
    rerender(<ClubCreatePanel {...panelProps({ canPost: false, threads })} />);

    expect(
      screen.getByRole("button", { name: translateKey("club.kind.discussion") }),
    ).toBeInTheDocument();
    expect(lastLink()).toEqual({
      to: "/club/$clubSlug/new",
      params: { clubSlug: CLUB_SLUG },
      search: { kind: "discussion" },
    });
  });
});
