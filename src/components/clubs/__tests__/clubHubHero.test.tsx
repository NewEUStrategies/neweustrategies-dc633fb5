// Nagłówek STRONY GŁÓWNEJ klubów (`ClubHubHero`) - wariant „architectural
// prestige”: dwuwierszowy tytuł, zdanie wiodące, znacznik dostępu, slot na
// wyszukiwarkę i pionowa szyna trzech paneli statystyk.
//
// CO TEN PLIK DOWODZI.
//  1. TYTUŁ DZIELI SIĘ NA DWIE LINIE, a ostatnie słowo idzie w złocie.
//     `splitPrestigeTitle` ma tu pełną tabelę przypadków, bo od niej zależy,
//     czy nagłówek w ogóle ma drugą linię: tytuł jednowyrazowy NIE MOŻE
//     wyrenderować pustego, złotego wiersza.
//  2. ANONIM I ZALOGOWANY WIDZĄ INNE LICZBY, i to jest decyzja produktowa,
//     nie kosmetyka: liczniki bazy dla niezalogowanego są zerami, więc
//     dostaje skalę programu (specjalizacje, grupy, eksperci), a nie trzy zera.
//  3. TRZY STANY SZYNY DLA ZALOGOWANEGO: `mine` z wartością dodatnią (panel
//     prowadzi do „moich klubów”), `mine` równe zeru (prowadzi do katalogu,
//     bo w „moich” nie ma czego pokazać) i `mine` NIEPODANE (panel spada na
//     sumę miejsc). To tu leżą gałęzie `??`/`?:` całego organizmu.
//  4. ZNACZNIK DOSTĘPU pokazuje się tylko wtedy, gdy stan jest ROZSTRZYGNIĘTY
//     (`access !== null`), a pasek z zaproszeniem do planu - wyłącznie
//     w stanie `locked`. Pasek pokazany „na wszelki wypadek” sprzedawałby plan
//     osobie, która ma już członkostwo.
//  5. SLOT jest opcjonalny, a przycisk „zaproponuj klub” stoi w nim WYŁĄCZNIE
//     dla zalogowanego - anonim nie ma jeszcze czego proponować.
//  6. PANEL STATYSTYK JEST REALNYM LINKIEM: gdy kotwica istnieje na stronie,
//     klik przewija i NIE zmienia adresu; gdy nie istnieje, klik zostaje
//     zwykłym skokiem po kotwicy, którego nie wolno zablokować.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - `ClubHubAccessBadge`: mapa ikon i klucze stanów mają własny zakres
//    (atomy klubu). Tutaj liczy się WYBÓR - czy znacznik w ogóle się rysuje.
//  - `resolveClubHubAccess` z `hubAccess.ts`: reguła „członkostwo bije plan”
//    jest dowiedziona na czystej funkcji. Nagłówek dostaje wynik z trasy
//    i tylko go RESPEKTUJE - dlatego `access` jest tu wejściem, nie liczbą.
//  - LICZENIA statystyk: `stats` składa trasa `club.index`
//    (`clubCatalogRoute.test.tsx`), nagłówek je wyłącznie pokazuje.
//
// WYJĄTEK OD ASERCJI NA KLUCZACH - jeden i świadomy: tytuł hero jest DZIELONY
// po spacjach, a klucz i18n („club.title”) jest jednym tokenem bez spacji,
// więc atrapa echa klucza nie może udowodnić podziału. Dlatego wyłącznie dla
// `club.title` atrapa podstawia napis podany z testu; wszystkie pozostałe
// asercje w pliku idą po KLUCZACH.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  titles: {} as Record<string, string | undefined>,
}));

vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  const t = (key: string, options?: Record<string, unknown>): string =>
    h.titles[key] ?? translateKey(key, options);
  // Jeden STABILNY obiekt `i18n`, jak realna instancja i18next.
  const i18n = { language: "pl", t };
  return {
    useTranslation: () => ({ t, i18n }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

import {
  CLUB_HUB_ANCHORS,
  ClubHubHero,
  splitPrestigeTitle,
  type ClubHubStats,
} from "@/components/clubs/organisms/ClubHubHero";
import type { ClubHubAccess } from "@/lib/clubs/hubAccess";
import type { ReactNode } from "react";

const STATS: ClubHubStats = { clubs: 7, threads: 36, seats: 126 };

function mount(props: {
  access?: ClubHubAccess | null;
  signedIn?: boolean;
  stats?: ClubHubStats;
  children?: ReactNode;
}) {
  return render(
    <ClubHubHero
      access={props.access ?? null}
      signedIn={props.signedIn ?? false}
      stats={props.stats ?? STATS}
    >
      {props.children}
    </ClubHubHero>,
  );
}

/** Panel statystyk jest linkiem po kotwicy - szukamy go po adresie. */
function anchorLink(container: HTMLElement, hash: string): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>(`a[href="${hash}"]`);
}

afterEach(() => {
  cleanup();
  h.titles = {};
  document.body.innerHTML = "";
});

describe("splitPrestigeTitle - podział tytułu na dwie linie", () => {
  it("oddziela OSTATNIE słowo od reszty", () => {
    expect(splitPrestigeTitle("Kluby dyskusyjne")).toEqual(["Kluby", "dyskusyjne"]);
  });

  it("przy trzech słowach w pierwszej linii zostają dwa", () => {
    expect(splitPrestigeTitle("Kluby dyskusyjne NES")).toEqual(["Kluby dyskusyjne", "NES"]);
  });

  it("tytuł jednowyrazowy nie ma drugiej linii", () => {
    expect(splitPrestigeTitle("Kluby")).toEqual(["Kluby", ""]);
  });

  it("pusty tytuł nie wywraca podziału", () => {
    expect(splitPrestigeTitle("")).toEqual(["", ""]);
  });

  it("nadmiarowe białe znaki nie robią z tytułu trzech słów", () => {
    expect(splitPrestigeTitle("  Kluby   dyskusyjne  ")).toEqual(["Kluby", "dyskusyjne"]);
  });
});

describe("ClubHubHero - blok tytułowy", () => {
  it("rysuje dwie linie tytułu, gdy tytuł ma co najmniej dwa słowa", () => {
    h.titles["club.title"] = "Kluby dyskusyjne";
    mount({ signedIn: true });

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.children).toHaveLength(2);
    // Dwie linie to dwa BLOKI, więc między nimi nie ma spacji w treści.
    expect(heading.children[0]).toHaveTextContent("Kluby");
    expect(heading.children[1]).toHaveTextContent("dyskusyjne");
  });

  it("tytuł jednowyrazowy nie zostawia pustej złotej linii", () => {
    h.titles["club.title"] = "Kluby";
    mount({ signedIn: true });

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.children).toHaveLength(1);
    expect(heading).toHaveTextContent("Kluby");
  });

  it("zalogowany dostaje zdanie redakcyjne, anonim - zaproszenie", () => {
    mount({ signedIn: true });
    expect(screen.getByText("club.hub.editorialSubtitle")).toBeInTheDocument();
    expect(screen.queryByText("club.hub.anonLead")).toBeNull();

    cleanup();
    mount({ signedIn: false });
    expect(screen.getByText("club.hub.anonLead")).toBeInTheDocument();
    expect(screen.queryByText("club.hub.editorialSubtitle")).toBeNull();
  });

  it("nierozstrzygnięty stan dostępu nie rysuje znacznika", () => {
    mount({ signedIn: true, access: null });
    expect(screen.queryByText(/^club\.hub\.access\./)).toBeNull();
  });

  it("rozstrzygnięty stan dostępu pokazuje znacznik", () => {
    mount({ signedIn: true, access: "member" });
    expect(screen.getByText("club.hub.access.member")).toBeInTheDocument();
  });
});

describe("ClubHubHero - slot na wyszukiwarkę", () => {
  it("bez dziecka nie rysuje ani slotu, ani propozycji nowego klubu", () => {
    mount({ signedIn: true });
    expect(screen.queryByTestId("slot")).toBeNull();
    expect(screen.queryByText("club.hub.suggestNew")).toBeNull();
  });

  it("zalogowany dostaje w slocie także propozycję nowego klubu", () => {
    mount({ signedIn: true, children: <input data-testid="slot" aria-label="szukaj" /> });

    expect(screen.getByTestId("slot")).toBeInTheDocument();
    const suggest = screen.getByRole("link", { name: "club.hub.suggestNew" });
    expect(suggest).toHaveAttribute("href", "/kontakt");
  });

  it("anonim widzi slot, ale nie widzi propozycji nowego klubu", () => {
    mount({ signedIn: false, children: <input data-testid="slot" aria-label="szukaj" /> });

    expect(screen.getByTestId("slot")).toBeInTheDocument();
    expect(screen.queryByText("club.hub.suggestNew")).toBeNull();
  });
});

describe("ClubHubHero - szyna statystyk", () => {
  it("zalogowany z aktywnymi klubami: środkowy panel prowadzi do „moich klubów”", () => {
    const { container } = mount({
      signedIn: true,
      stats: { clubs: 7, threads: 36, seats: 126, mine: 2 },
    });

    expect(screen.getByText("club.hub.statClubs")).toBeInTheDocument();
    expect(screen.getByText("club.hub.statMineLabel")).toBeInTheDocument();
    expect(screen.getByText("club.hub.statThreads")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(anchorLink(container, CLUB_HUB_ANCHORS.mine)).not.toBeNull();
  });

  it("zalogowany BEZ ani jednego klubu: ten sam panel prowadzi do katalogu", () => {
    const { container } = mount({
      signedIn: true,
      stats: { clubs: 7, threads: 36, seats: 126, mine: 0 },
    });

    expect(screen.getByText("club.hub.statMineLabel")).toBeInTheDocument();
    expect(anchorLink(container, CLUB_HUB_ANCHORS.mine)).toBeNull();
    expect(anchorLink(container, CLUB_HUB_ANCHORS.discover)).not.toBeNull();
  });

  it("bez policzonego członkostwa panel spada na sumę MIEJSC, nie osób", () => {
    mount({ signedIn: true, stats: STATS });

    expect(screen.getByText("club.hub.statSeats")).toBeInTheDocument();
    expect(screen.queryByText("club.hub.statMineLabel")).toBeNull();
    expect(screen.getByText("126")).toBeInTheDocument();
  });

  it("anonim widzi skalę programu, a nie trzy zera z bazy", () => {
    const { container } = mount({ signedIn: false, stats: { clubs: 0, threads: 0, seats: 0 } });

    expect(screen.getByText("club.hub.anonStatSpecializations")).toBeInTheDocument();
    expect(screen.getByText("club.hub.anonStatGroups")).toBeInTheDocument();
    expect(screen.getByText("club.hub.anonStatExperts")).toBeInTheDocument();
    expect(screen.queryByText("club.hub.statClubs")).toBeNull();
    expect(anchorLink(container, CLUB_HUB_ANCHORS.specializations)).not.toBeNull();
  });

  it("klik w panel przewija do sekcji i NIE zmienia adresu", () => {
    const target = document.createElement("div");
    target.id = CLUB_HUB_ANCHORS.discover.slice(1);
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.appendChild(target);

    const { container } = mount({ signedIn: true, stats: STATS });
    const link = anchorLink(container, CLUB_HUB_ANCHORS.discover);
    expect(link).not.toBeNull();

    const notPrevented = link === null ? true : fireEvent.click(link);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(notPrevented).toBe(false);
  });

  it("gdy kotwicy nie ma na stronie, klik zostaje zwykłym skokiem po kotwicy", () => {
    const { container } = mount({ signedIn: true, stats: STATS });
    const link = anchorLink(container, CLUB_HUB_ANCHORS.discover);
    expect(link).not.toBeNull();

    const notPrevented = link === null ? false : fireEvent.click(link);

    expect(notPrevented).toBe(true);
  });
});

describe("ClubHubHero - zaproszenie do planu", () => {
  it("stan `locked` dokłada pasek z zaproszeniem i wezwaniem do cennika", () => {
    mount({ signedIn: true, access: "locked" });

    expect(screen.getByText("club.hub.upgradeTitle")).toBeInTheDocument();
    expect(screen.getByText("club.hub.upgradeNote")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "club.hub.upgradeCta" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("członek klubu nie dostaje paska sprzedażowego", () => {
    mount({ signedIn: true, access: "member" });
    expect(screen.queryByText("club.hub.upgradeTitle")).toBeNull();
  });

  it("nierozstrzygnięty dostęp też nie sprzedaje planu", () => {
    mount({ signedIn: true, access: null });
    expect(screen.queryByText("club.hub.upgradeTitle")).toBeNull();
  });
});
