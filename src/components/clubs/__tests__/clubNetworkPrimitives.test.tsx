// Prymitywy sieciujące klubu (`ClubNetworkPrimitives`) i prymitywy powłoki huba
// (`ClubHubPrimitives`) - dwa pliki atomów, jeden test, bo pierwszy z nich
// deklaruje wprost, że trzyma „skalę huba" z drugiego.
//
// CO TO DOWODZI.
// (1) LICZNIK „+N" W STOSIE TWARZY. Cała wartość `ClubFaceStack` to zdanie
//     „ilu ludzi tu jest", a `hidden = max(0, (total ?? faces.length) - shown.length)`
//     ma trzy niezależne miejsca na off-by-one: obcięcie do `max`, wybór
//     mianownika i podłoga na zerze. Test przejeżdża granicę DOKŁADNIE (mniej
//     niż limit, równo limit, limit + 1) i osobno pilnuje, że `total = 0` -
//     wartość FAŁSZYWA, ale prawidłowa - nie wpada w `faces.length` (to jest
//     różnica między `??` i `||`, niewidoczna w recenzji i niewidoczna na
//     ekranie do dnia, w którym licznik pokaże cudzą liczbę).
// (2) KIERUNEK TRANSAKCJI W OGŁOSZENIU. `ClubNoticeKindPill` musi dać dwóm
//     rodzajom DWA tony i DWIE ikony - nagłówek komponentu mówi, że bez tego
//     każde ogłoszenie wygląda jak prośba. Asercje idą na klucz i18n i na
//     fragment klasy tonu, nigdy na polski napis ze słownika.
// (3) ZERO JEST WARTOŚCIĄ. `ClubSignalMetric` i `ClubStatPill` dostają "0"
//     i pustą etykietę - metryka, która chowa zero, kłamie o pulsie klubu.
// (4) WYBÓR W PRZEŁĄCZNIKU. `ClubSegmented` emituje id TEJ opcji, w którą
//     kliknięto (pomyłka w mapowaniu przestawia źródło strumienia bez śladu
//     w interfejsie), ogłasza wybór przez `aria-checked` i pokazuje licznik
//     dopiero od jedynki - `count = 0` to brak plakietki, nie plakietka „0".
// (5) DYMEK PLAKIETKI OSOBY otwiera się FOKUSEM (nie tylko myszą) i wpuszcza
//     do treści wyłącznie te pola, które nie są `null`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - Nie testuje `ClubAuthorAvatar` (inicjały, wybór zdjęcia) ani `Tooltip`
//   z `components/ui` - mają własne testy; tutaj sprawdzamy tylko to, co te
//   atomy DODAJĄ ponad nie (kropka w rogu, zawartość dymka).
// - Nie sprawdza wartości `kind` spoza zbioru przez rzutowanie (reguły
//   repozytorium tego zabraniają). Degradację nieznanej wartości pokazuje
//   ścieżka produkcyjna, która przyjmuje `string`: `toClubNoticeKind`.
// - Nie sprawdza istnienia kluczy i18n w słownikach (robią to bramki i18n)
//   ani wyglądu tych atomów w modułach, które je składają.
// - `ClubFace` to interfejs bez kodu wykonywalnego - dowodem jego kontraktu są
//   fixture'y `face()` niżej, kompilowane przez `tsc`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Flame, Users } from "lucide-react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import {
  ClubExpertiseChip,
  ClubFaceStack,
  ClubNoticeKindPill,
  ClubPersonBadge,
  ClubPresenceAvatar,
  ClubPresenceDot,
  ClubSignalMetric,
  type ClubFace,
} from "@/components/clubs/atoms/ClubNetworkPrimitives";
import {
  ClubRailPanel,
  ClubSegmented,
  ClubStatPill,
  HUB_SURFACE,
} from "@/components/clubs/atoms/ClubHubPrimitives";
import { CLUB_NOTICE_KINDS, toClubNoticeKind } from "@/lib/clubs/networkTypes";
import { CLUB_IDS } from "@/test/clubs/fixtures";
import { axeViolations, summarize } from "@/test/axe";

/** Twarz o przewidywalnym id i nazwisku - numer idzie do obu, żeby liczyć. */
function face(index: number, overrides: Partial<ClubFace> = {}): ClubFace {
  return { userId: `user-${index}`, name: `Osoba ${index}`, avatarUrl: null, ...overrides };
}

/** `n` twarzy - do przejeżdżania granicy licznika „+N". */
function faces(count: number): ClubFace[] {
  return Array.from({ length: count }, (_, index) => face(index + 1));
}

/** Plakietka „+N" albo `null`, gdy stos nie ukrywa nikogo. */
function overflowBadge(): HTMLElement | null {
  return screen.queryByText(/^\+\d+$/);
}

/** Awatary widoczne w stosie - `li` z awatarem, bez plakietki „+N". */
function stackItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll("li"));
}

describe("HUB_SURFACE - jedna powierzchnia dla wszystkich paneli huba", () => {
  it("niesie promień 6 px, przygaszoną krawędź i tło karty", () => {
    // Nagłówek pliku stawia to jako regułę systemu: `rounded-lg` mapuje się na
    // `--radius` serwisu, a pigułka (`rounded-full`) jest z innego systemu
    // i widać to natychmiast, gdy stanie obok karty.
    expect(HUB_SURFACE).toContain("rounded-lg");
    expect(HUB_SURFACE).toContain("border-border/60");
    expect(HUB_SURFACE).toContain("bg-card");
    expect(HUB_SURFACE).not.toContain("rounded-full");
  });
});

describe("ClubRailPanel - nagłówek jest OPCJONALNY", () => {
  it("bez tytułu nie renderuje nagłówka, ale zachowuje powierzchnię i treść", () => {
    const { container } = render(
      <ClubRailPanel>
        <p>treść panelu</p>
      </ClubRailPanel>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("treść panelu")).toBeInTheDocument();
    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    for (const token of HUB_SURFACE.split(" ")) {
      expect(section?.className).toContain(token);
    }
    expect(section?.className).toContain("p-3");
  });

  it("z tytułem daje nagłówek stopnia 2 z tekstem tytułu", () => {
    render(
      <ClubRailPanel title="club.hub.rail.pulse">
        <p>treść</p>
      </ClubRailPanel>,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("club.hub.rail.pulse");
  });

  it("ikona jest opcjonalna i zawsze ukryta przed czytnikiem ekranu", () => {
    const { container: withoutIcon } = render(
      <ClubRailPanel title="club.hub.rail.roster">
        <p>bez ikony</p>
      </ClubRailPanel>,
    );
    expect(withoutIcon.querySelectorAll("header svg")).toHaveLength(0);

    const { container: withIcon } = render(
      <ClubRailPanel title="club.hub.rail.roster" icon={Users}>
        <p>z ikoną</p>
      </ClubRailPanel>,
    );
    const svg = withIcon.querySelector("header svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("akcja stoi w nagłówku - i tylko tam, więc panel bez tytułu jej nie pokazuje", () => {
    // Świadoma konsekwencja kształtu panelu (akcja mieszka w nagłówku,
    // a nagłówek jest opcjonalny). Test przybija ją, bo cichy zanik przycisku
    // po usunięciu tytułu jest regresją, której nie widać w recenzji propsów.
    render(
      <ClubRailPanel title="club.hub.rail.board" action={<button type="button">akcja</button>}>
        <p>z tytułem</p>
      </ClubRailPanel>,
    );
    expect(screen.getByRole("button", { name: "akcja" })).toBeInTheDocument();

    render(
      <ClubRailPanel action={<button type="button">osierocona</button>}>
        <p>bez tytułu</p>
      </ClubRailPanel>,
    );
    expect(screen.queryByRole("button", { name: "osierocona" })).not.toBeInTheDocument();
  });

  it("`className` DOKŁADA się do powierzchni, a nie ją zastępuje", () => {
    const { container } = render(
      <ClubRailPanel className="mt-4">
        <p>treść</p>
      </ClubRailPanel>,
    );
    const section = container.querySelector("section");
    expect(section?.className).toContain("mt-4");
    expect(section?.className).toContain("bg-card");
  });

  it("nie wnosi naruszeń dostępności (nagłówek + treść)", async () => {
    const { container } = render(
      <ClubRailPanel title="club.hub.rail.pulse" icon={Users}>
        <p>treść panelu</p>
      </ClubRailPanel>,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("ClubStatPill - liczba i opis jednym głosem", () => {
  it("pokazuje wartość i etykietę, a ikonę ukrywa przed czytnikiem", () => {
    const { container } = render(
      <ClubStatPill icon={Users} value="12" label="club.hub.stats.members" />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("club.hub.stats.members")).toBeInTheDocument();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("wartość ZERO się renderuje - pusty puls to też informacja", () => {
    render(<ClubStatPill icon={Users} value="0" label="club.hub.stats.active" />);
    const value = screen.getByText("0");
    expect(value).toBeInTheDocument();
    // `tabular-nums` pilnuje, żeby liczba nie skakała przy zmianie z 9 na 10.
    expect(value.className).toContain("tabular-nums");
  });

  it("pusta etykieta nie wywraca etykiety - zostaje sama liczba", () => {
    const { container } = render(<ClubStatPill icon={Users} value="7" label="" />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(container.querySelector("span.text-muted-foreground")?.textContent).toBe("");
  });

  it("`className` dokłada się do powierzchni etykiety", () => {
    const { container } = render(
      <ClubStatPill icon={Users} value="3" label="club.hub.stats.threads" className="ml-2" />,
    );
    const pill = container.firstElementChild;
    expect(pill?.className).toContain("ml-2");
    expect(pill?.className).toContain("rounded-lg");
  });
});

/** Konkretna unia źródeł strumienia - `ClubSegmented` jest generyczny po niej. */
type StreamSource = "threads" | "notices" | "people";

const SOURCES: ReadonlyArray<{ value: StreamSource; label: string }> = [
  { value: "threads", label: "club.hub.source.threads" },
  { value: "notices", label: "club.hub.source.notices" },
  { value: "people", label: "club.hub.source.people" },
];

/** Segment rozpoznawany po kluczu etykiety, nie po pozycji w rzędzie. */
function segment(label: string): HTMLElement {
  const found = screen
    .getAllByRole("radio")
    .find((radio) => (radio.textContent ?? "").includes(label));
  if (found === undefined) throw new Error(`test: brak segmentu ${label}`);
  return found;
}

describe("ClubSegmented - kontrakt grupy radiowej", () => {
  it("jest grupą radiową z opisem i wystawia segment na KAŻDĄ opcję", () => {
    render(
      <ClubSegmented
        value="threads"
        options={SOURCES}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    expect(screen.getByRole("radiogroup").getAttribute("aria-label")).toBe("club.hub.source.label");
    expect(screen.getAllByRole("radio")).toHaveLength(SOURCES.length);
  });

  it.each(SOURCES)("kliknięcie w segment $value emituje DOKŁADNIE swoje id", (option) => {
    // Regresja, którą to łapie: przestawienie `key` albo domknięcie po zmiennej
    // pętli przełącza źródło strumienia na cudze, a etykieta zostaje ta sama.
    const onChange = vi.fn<(next: StreamSource) => void>();
    render(
      <ClubSegmented
        value="threads"
        options={SOURCES}
        onChange={onChange}
        ariaLabel="club.hub.source.label"
      />,
    );
    fireEvent.click(segment(option.label));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(option.value);
  });

  it.each(SOURCES)("aktywne źródło $value jest zaznaczone, pozostałe nie", (option) => {
    render(
      <ClubSegmented
        value={option.value}
        options={SOURCES}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    expect(segment(option.label).getAttribute("aria-checked")).toBe("true");
    for (const other of SOURCES.filter((candidate) => candidate.value !== option.value)) {
      expect(segment(other.label).getAttribute("aria-checked")).toBe("false");
    }
  });

  it("kliknięcie w AKTYWNY segment emituje tę samą wartość - komponent jest bezstanowy", () => {
    const onChange = vi.fn<(next: StreamSource) => void>();
    render(
      <ClubSegmented
        value="notices"
        options={SOURCES}
        onChange={onChange}
        ariaLabel="club.hub.source.label"
      />,
    );
    fireEvent.click(segment("club.hub.source.notices"));
    expect(onChange).toHaveBeenCalledWith("notices");
  });

  it("aktywny segment ma tło akcentu, nieaktywny tło karty", () => {
    render(
      <ClubSegmented
        value="people"
        options={SOURCES}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    expect(segment("club.hub.source.people").className).toContain("bg-primary");
    expect(segment("club.hub.source.threads").className).toContain("bg-card");
    expect(segment("club.hub.source.threads").className).not.toContain("bg-primary ");
  });

  it("każdy segment jest `type=button` i aktywuje się klawiaturą jako `<button>`", () => {
    // Enter/Spacja na `<button>` to zachowanie przeglądarki, nie kodu, dlatego
    // asercja pilnuje ELEMENTU, który je zapewnia, plus faktu, że aktywacja
    // dochodzi do `onChange`.
    const onChange = vi.fn<(next: StreamSource) => void>();
    render(
      <ClubSegmented
        value="threads"
        options={SOURCES}
        onChange={onChange}
        ariaLabel="club.hub.source.label"
      />,
    );
    const target = segment("club.hub.source.people");
    expect(target.tagName).toBe("BUTTON");
    expect(target.getAttribute("type")).toBe("button");
    fireEvent.keyDown(target, { key: "Enter" });
    fireEvent.click(target);
    expect(onChange).toHaveBeenCalledWith("people");
  });

  it("ikona segmentu jest opcjonalna i ukryta przed czytnikiem ekranu", () => {
    render(
      <ClubSegmented
        value="threads"
        options={[
          { value: "threads", label: "club.hub.source.threads", icon: Flame },
          { value: "notices", label: "club.hub.source.notices" },
        ]}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    const withIcon = segment("club.hub.source.threads").querySelector("svg");
    expect(withIcon).not.toBeNull();
    expect(withIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(segment("club.hub.source.notices").querySelector("svg")).toBeNull();
  });

  it.each([
    { count: undefined, visible: false, note: "brak licznika" },
    { count: 0, visible: false, note: "zero nie zasługuje na plakietkę" },
    { count: 1, visible: true, note: "od jedynki licznik jest sygnałem" },
    { count: 42, visible: true, note: "wielocyfrowy licznik" },
  ])("licznik $count: widoczny=$visible ($note)", ({ count, visible }) => {
    render(
      <ClubSegmented
        value="threads"
        options={[{ value: "notices", label: "club.hub.source.notices", count }]}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    const badge = segment("club.hub.source.notices").querySelector("span.tabular-nums");
    if (visible) {
      expect(badge?.textContent).toBe(String(count));
    } else {
      expect(badge).toBeNull();
    }
  });

  it("licznik na segmencie AKTYWNYM ma inne tło niż na nieaktywnym", () => {
    render(
      <ClubSegmented
        value="threads"
        options={[
          { value: "threads", label: "club.hub.source.threads", count: 2 },
          { value: "notices", label: "club.hub.source.notices", count: 3 },
        ]}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    const activeBadge = segment("club.hub.source.threads").querySelector("span.tabular-nums");
    const idleBadge = segment("club.hub.source.notices").querySelector("span.tabular-nums");
    expect(activeBadge?.className).toContain("bg-primary-foreground/20");
    expect(idleBadge?.className).toContain("bg-muted");
  });

  it("lista jednoelementowa daje jeden zaznaczony segment", () => {
    render(
      <ClubSegmented
        value="threads"
        options={[{ value: "threads", label: "club.hub.source.threads" }]}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(1);
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
  });

  it("pusta lista opcji zostawia samą grupę - bez segmentu-widma", () => {
    render(
      <ClubSegmented
        value="threads"
        options={[]}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("`className` dokłada się do rzędu, który przewija się w poziomie", () => {
    render(
      <ClubSegmented
        value="threads"
        options={SOURCES}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
        className="mb-3"
      />,
    );
    const group = screen.getByRole("radiogroup");
    expect(group.className).toContain("mb-3");
    expect(group.className).toContain("overflow-x-auto");
  });

  it("nie wnosi naruszeń dostępności (radiogroup + radio + licznik)", async () => {
    const { container } = render(
      <ClubSegmented
        value="threads"
        options={[
          { value: "threads", label: "club.hub.source.threads", icon: Flame, count: 4 },
          { value: "notices", label: "club.hub.source.notices" },
        ]}
        onChange={() => {}}
        ariaLabel="club.hub.source.label"
      />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("ClubPresenceDot - UDZIAŁ, nie połączenie z serwerem", () => {
  it("jest obrazkiem z opisem mówiącym o AKTYWNOŚCI i nosi kolor marki", () => {
    // Nagłówek komponentu stawia to wprost: to nie zielona kropka „online".
    render(<ClubPresenceDot />);
    const dot = screen.getByRole("img");
    expect(dot.getAttribute("aria-label")).toBe("club.network.roster.activeDot");
    expect(dot.className).toContain("bg-primary");
    expect(dot.className).toContain("rounded-full");
  });

  it("`className` dokłada pozycjonowanie, zachowując rozmiar i obwódkę karty", () => {
    render(<ClubPresenceDot className="absolute -bottom-1" />);
    const dot = screen.getByRole("img");
    expect(dot.className).toContain("absolute -bottom-1");
    expect(dot.className).toContain("h-2.5");
    expect(dot.className).toContain("border-card");
  });
});

describe("ClubPresenceAvatar - twarz plus sygnał obecności", () => {
  it("aktywna osoba dostaje kropkę w rogu", () => {
    render(<ClubPresenceAvatar name="Anna Kowalska" avatarUrl={null} active />);
    const dot = screen.getByRole("img");
    expect(dot.getAttribute("aria-label")).toBe("club.network.roster.activeDot");
    expect(dot.className).toContain("-right-0.5");
  });

  it("nieaktywna osoba NIE dostaje kropki - brak sygnału to też stan", () => {
    render(<ClubPresenceAvatar name="Anna Kowalska" avatarUrl={null} active={false} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("zdjęcie zastępuje inicjały, a jego brak nie wywraca awatara", () => {
    const { container: withPhoto } = render(
      <ClubPresenceAvatar name="Anna Kowalska" avatarUrl="https://example.test/a.png" active />,
    );
    expect(withPhoto.querySelector("img")?.getAttribute("src")).toBe("https://example.test/a.png");

    const { container: withoutPhoto } = render(
      <ClubPresenceAvatar name="Anna Kowalska" avatarUrl={null} active={false} />,
    );
    expect(withoutPhoto.querySelector("img")).toBeNull();
    expect(withoutPhoto.textContent).toBe("AK");
  });

  it("domyślny rozmiar to `sm`, a `md` faktycznie powiększa twarz", () => {
    const { container: small } = render(
      <ClubPresenceAvatar name="Anna Kowalska" avatarUrl={null} active={false} />,
    );
    expect(small.querySelector("span > span")?.className).toContain("h-7");

    const { container: medium } = render(
      <ClubPresenceAvatar name="Anna Kowalska" avatarUrl={null} active={false} size="md" />,
    );
    expect(medium.querySelector("span > span")?.className).toContain("h-9");
  });

  it("`className` dokłada się do opakowania, które trzyma kropkę w rogu", () => {
    const { container } = render(
      <ClubPresenceAvatar name="Anna Kowalska" avatarUrl={null} active className="mr-1" />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("mr-1");
    expect(wrapper?.className).toContain("relative");
  });
});

describe("ClubNoticeKindPill - kierunek transakcji widać przed przeczytaniem", () => {
  const TONE: Record<(typeof CLUB_NOTICE_KINDS)[number], string> = {
    seeking: "bg-amber-500/10",
    offering: "bg-emerald-500/10",
  };

  it.each(CLUB_NOTICE_KINDS)("rodzaj %s niesie swój klucz i18n i swój ton", (kind) => {
    render(<ClubNoticeKindPill kind={kind} />);
    const pill = screen.getByText(`club.network.board.kind.${kind}`);
    expect(pill.className).toContain(TONE[kind]);
  });

  it("„szukam” i „oferuję” to DWA tony i DWIE ikony, nie dwa napisy", () => {
    // Regresja, którą to łapie: sklejenie obu rodzajów w jeden ton (albo jedną
    // ikonę) zamienia tablicę ogłoszeń w listę identycznie wyglądających prośb.
    render(
      <>
        <ClubNoticeKindPill kind="seeking" />
        <ClubNoticeKindPill kind="offering" />
      </>,
    );
    const seeking = screen.getByText("club.network.board.kind.seeking");
    const offering = screen.getByText("club.network.board.kind.offering");
    expect(seeking.className).not.toContain("bg-emerald-500/10");
    expect(offering.className).not.toContain("bg-amber-500/10");
    const seekingIcon = seeking.querySelector("svg")?.innerHTML ?? "";
    const offeringIcon = offering.querySelector("svg")?.innerHTML ?? "";
    expect(seekingIcon).not.toBe("");
    expect(seekingIcon).not.toBe(offeringIcon);
  });

  it("ikona pigułki jest ukryta przed czytnikiem - nośnikiem treści jest napis", () => {
    render(<ClubNoticeKindPill kind="offering" />);
    const pill = screen.getByText("club.network.board.kind.offering");
    expect(pill.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("wartość NIEZNANA z bazy degraduje do „szukam” (przez `toClubNoticeKind`)", () => {
    // Pigułka przyjmuje wąski typ, więc wartość spoza zbioru dochodzi do niej
    // tylko przez zawężenie produkcyjne - i to ono jest tu pod testem, zamiast
    // rzutowania zakazanego regułami repozytorium.
    render(<ClubNoticeKindPill kind={toClubNoticeKind("barter")} />);
    const pill = screen.getByText("club.network.board.kind.seeking");
    expect(pill.className).toContain("bg-amber-500/10");
  });

  it("`className` dokłada się do pigułki bez utraty tonu", () => {
    render(<ClubNoticeKindPill kind="seeking" className="ml-auto" />);
    const pill = screen.getByText("club.network.board.kind.seeking");
    expect(pill.className).toContain("ml-auto");
    expect(pill.className).toContain("bg-amber-500/10");
  });
});

describe("ClubFaceStack - granica licznika „+N”", () => {
  it("pusta lista NIE renderuje niczego - stos zera twarzy to nie stos", () => {
    const { container } = render(<ClubFaceStack faces={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("jedna twarz: jeden awatar, brak licznika, nazwisko dla czytnika ekranu", () => {
    const { container } = render(<ClubFaceStack faces={[face(1)]} />);
    expect(stackItems(container)).toHaveLength(1);
    expect(overflowBadge()).toBeNull();
    expect(container.querySelector(".sr-only")?.textContent).toBe("Osoba 1");
  });

  it.each([
    { count: 2, max: 3, badge: null, note: "mniej niż limit" },
    { count: 3, max: 3, badge: null, note: "DOKŁADNIE limit - licznika nie ma" },
    { count: 4, max: 3, badge: "+1", note: "limit + 1 - licznik pokazuje jedną osobę" },
    { count: 9, max: 3, badge: "+6", note: "wielu ukrytych" },
  ])("$count twarzy przy limicie $max: licznik $badge ($note)", ({ count, max, badge }) => {
    const { container } = render(<ClubFaceStack faces={faces(count)} max={max} />);
    const shown = Math.min(count, max);
    expect(stackItems(container).filter((item) => item.title !== "")).toHaveLength(shown);
    if (badge === null) {
      expect(overflowBadge()).toBeNull();
    } else {
      expect(overflowBadge()?.textContent).toBe(badge);
    }
  });

  it("domyślny limit to SZEŚĆ twarzy - bez propa `max`", () => {
    // Dwie gałęzie wartości domyślnej: sześć twarzy mieści się bez licznika,
    // siódma go włącza. Zmiana domyślnej szóstki na piątkę rozjeżdża szynę
    // 20 rem, więc jest to kontrakt, nie szczegół.
    const { container: exactly } = render(<ClubFaceStack faces={faces(6)} />);
    expect(stackItems(exactly)).toHaveLength(6);
    expect(overflowBadge()).toBeNull();

    const { container: overflowing } = render(<ClubFaceStack faces={faces(7)} />);
    expect(stackItems(overflowing).filter((item) => item.title !== "")).toHaveLength(6);
    expect(overflowBadge()?.textContent).toBe("+1");
  });

  it("`total` większy niż liczba twarzy dokłada licznik, choć wszystkie się zmieściły", () => {
    // To jest ścieżka produkcyjna panelu składu: przychodzą trzy twarze i pełna
    // liczba członków z RPC.
    render(<ClubFaceStack faces={faces(3)} total={18} max={6} />);
    expect(overflowBadge()?.textContent).toBe("+15");
  });

  it("`total` = 0 (wartość fałszywa, ale prawidłowa) NIE wraca do liczby twarzy", () => {
    // Dokładnie różnica między `total ?? faces.length` i `total || faces.length`:
    // przy `||` zero wpadłoby w liczbę twarzy i licznik pokazałby „+1".
    render(<ClubFaceStack faces={faces(2)} total={0} max={1} />);
    expect(overflowBadge()).toBeNull();
  });

  it("`total` mniejszy niż liczba twarzy nie daje licznika ujemnego", () => {
    render(<ClubFaceStack faces={faces(4)} total={2} max={6} />);
    expect(overflowBadge()).toBeNull();
  });

  it("warstwa dla czytnika ekranu wymienia WSZYSTKIE nazwiska, także ukryte", () => {
    // Stos jest ozdobą dla oka (`aria-hidden` na liście), więc informacja
    // musi być dostępna bez oczu - inaczej „+3" jest ślepym zaułkiem.
    const { container } = render(<ClubFaceStack faces={faces(4)} max={2} />);
    expect(container.querySelector("ul")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".sr-only")?.textContent).toBe(
      "Osoba 1, Osoba 2, Osoba 3, Osoba 4",
    );
  });

  it("każda twarz nosi nazwisko w `title` - podpowiedź myszy nad awatarem", () => {
    const { container } = render(
      <ClubFaceStack faces={[face(1, { name: "Anna Kowalska" }), face(2)]} />,
    );
    expect(stackItems(container)[0]?.title).toBe("Anna Kowalska");
  });

  it.each([
    { active: true, dots: 1, note: "aktywna dostaje kropkę" },
    { active: false, dots: 0, note: "nieaktywna nie dostaje" },
    { active: undefined, dots: 0, note: "brak pola czyta się jak nieaktywna" },
  ])("obecność $active daje $dots kropek ($note)", ({ active, dots }) => {
    // Kropka jest wewnątrz listy oznaczonej `aria-hidden`, więc nie ma jej
    // w drzewie dostępności (nazwiska niesie warstwa `sr-only`) - dlatego
    // liczymy po atrybucie roli, a nie zapytaniem `getAllByRole`.
    const { container } = render(<ClubFaceStack faces={[{ ...face(1), active }]} />);
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(dots);
  });

  it("rozmiar `md` powiększa także plakietkę „+N”, żeby rząd był równy", () => {
    render(<ClubFaceStack faces={faces(3)} max={2} size="md" />);
    expect(overflowBadge()?.className).toContain("h-9");

    render(<ClubFaceStack faces={faces(3)} max={2} />);
    const badges = screen.getAllByText(/^\+\d+$/);
    expect(badges[1]?.className).toContain("h-7");
  });

  it("`className` dokłada się do opakowania stosu", () => {
    const { container } = render(<ClubFaceStack faces={faces(2)} className="mt-2" />);
    expect(container.firstElementChild?.className).toContain("mt-2");
    expect(container.firstElementChild?.className).toContain("flex items-center");
  });
});

/** Treść dymka w warstwie dla czytnika ekranu (Radix duplikuje ją tam). */
function badgeTooltip(): HTMLElement {
  return screen.getByRole("tooltip");
}

/** Otwiera dymek plakietki FOKUSEM - to jest dostęp z klawiatury. */
function openBadge(name: string): void {
  fireEvent.focus(screen.getByRole("button", { name }));
}

describe("ClubPersonBadge - powód, żeby zagadać", () => {
  it("bez fokusu pokazuje tylko wyzwalacz, a po fokusie treść dymka", () => {
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline="Dyrektorka ds. energetyki"
        roleLabel={null}
        statusLabel={null}
        topics={[]}
      >
        <button type="button">Anna</button>
      </ClubPersonBadge>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    openBadge("Anna");
    expect(within(badgeTooltip()).getByText("Anna Kowalska")).toBeInTheDocument();
    expect(within(badgeTooltip()).getByText("Dyrektorka ds. energetyki")).toBeInTheDocument();
  });

  it("rola w klubie pojawia się tylko wtedy, gdy jest inna niż domyślna", () => {
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline={null}
        roleLabel="club.role.lead"
        statusLabel={null}
        topics={[]}
      >
        <button type="button">Anna</button>
      </ClubPersonBadge>,
    );
    openBadge("Anna");
    expect(within(badgeTooltip()).getByText("club.role.lead")).toBeInTheDocument();
  });

  it("`null` w roli, opisie i statusie zostawia w dymku SAMO nazwisko", () => {
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline={null}
        roleLabel={null}
        statusLabel={null}
        topics={[]}
      >
        <button type="button">Anna</button>
      </ClubPersonBadge>,
    );
    openBadge("Anna");
    const tooltip = badgeTooltip();
    expect(tooltip.querySelectorAll("p")).toHaveLength(1);
    expect(tooltip.textContent).toBe("Anna Kowalska");
  });

  it('PUSTY opis (`""`) to nie `null` - linijka zostaje, choć jest bez treści', () => {
    // Wartość fałszywa, ale prawidłowa: kod pyta o `!== null`, więc pusty
    // string przechodzi. Test przybija tę granicę, bo zamiana warunku na
    // `headline ? ...` zmieniłaby układ dymka dla danych z bazy.
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline=""
        roleLabel={null}
        statusLabel={null}
        topics={[]}
      >
        <button type="button">Anna</button>
      </ClubPersonBadge>,
    );
    openBadge("Anna");
    expect(badgeTooltip().querySelectorAll("p")).toHaveLength(2);
  });

  it("kompetencje wchodzą do dymka, ale NIE WIĘCEJ NIŻ TRZY", () => {
    // Plakietka niesie powód do rozmowy, nie pełną kartę osoby - czwarta
    // kompetencja rozjeżdża dymek 15 rem na czwarty wiersz.
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline={null}
        roleLabel={null}
        statusLabel={null}
        topics={["Energetyka", "Rynek mocy", "Wodór", "CBAM", "Taksonomia"]}
      >
        <button type="button">Anna</button>
      </ClubPersonBadge>,
    );
    openBadge("Anna");
    const tooltip = badgeTooltip();
    expect(within(tooltip).getByText("Energetyka")).toBeInTheDocument();
    expect(within(tooltip).getByText("Wodór")).toBeInTheDocument();
    expect(within(tooltip).queryByText("CBAM")).not.toBeInTheDocument();
  });

  it("puste kompetencje w liście nie zostawiają chipów-widm", () => {
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline={null}
        roleLabel={null}
        statusLabel={null}
        topics={["Energetyka", "   ", ""]}
      >
        <button type="button">Anna</button>
      </ClubPersonBadge>,
    );
    openBadge("Anna");
    const chips = badgeTooltip().querySelectorAll("span.border-primary\\/30");
    expect(chips).toHaveLength(1);
  });

  it("status obecności dostaje kolor akcentu i ikonę ukrytą przed czytnikiem", () => {
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline={null}
        roleLabel={null}
        statusLabel="club.network.roster.activeToday"
        topics={[]}
      >
        <button type="button">Anna</button>
      </ClubPersonBadge>,
    );
    openBadge("Anna");
    const tooltip = badgeTooltip();
    const status = within(tooltip).getByText("club.network.roster.activeToday");
    expect(status.closest("p")?.className).toContain("text-primary");
    expect(tooltip.querySelector("p.text-primary svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("pełny zestaw pól daje cztery linijki w jednym dymku", () => {
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline="Dyrektorka ds. energetyki"
        roleLabel="club.role.moderator"
        statusLabel="club.network.roster.newHere"
        topics={["Energetyka"]}
      >
        <button type="button">Anna</button>
      </ClubPersonBadge>,
    );
    openBadge("Anna");
    expect(badgeTooltip().querySelectorAll("p")).toHaveLength(4);
  });

  it("wyzwalaczem zostaje PRZEKAZANY element - plakietka nie dorabia własnego", () => {
    render(
      <ClubPersonBadge
        name="Anna Kowalska"
        headline={null}
        roleLabel={null}
        statusLabel={null}
        topics={[]}
      >
        <a href={`/klub/${CLUB_IDS.club}/sklad/${CLUB_IDS.member}`}>Anna</a>
      </ClubPersonBadge>,
    );
    const trigger = screen.getByRole("link", { name: "Anna" });
    expect(trigger.getAttribute("href")).toBe(`/klub/${CLUB_IDS.club}/sklad/${CLUB_IDS.member}`);
    fireEvent.focus(trigger);
    expect(within(badgeTooltip()).getByText("Anna Kowalska")).toBeInTheDocument();
  });
});

describe("ClubSignalMetric - liczba nad opisem", () => {
  it("pokazuje wartość i etykietę, ikonę ukrywa przed czytnikiem", () => {
    const { container } = render(
      <ClubSignalMetric icon={Users} value="12" label="club.network.pulse.people" />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("club.network.pulse.people")).toBeInTheDocument();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("wartość „0” MUSI się renderować - cisza w klubie to informacja, nie brak", () => {
    // Najczęstsza regresja tej rodziny: warunek `value && ...` chowa zero
    // i panel pulsu pokazuje wtedy trzy etykiety bez liczb.
    render(<ClubSignalMetric icon={Users} value="0" label="club.network.pulse.today" />);
    const value = screen.getByText("0");
    expect(value).toBeInTheDocument();
    expect(value.className).toContain("tabular-nums");
  });

  it("pusta etykieta zostawia samą liczbę, bez wywrotki układu", () => {
    const { container } = render(<ClubSignalMetric icon={Users} value="5" label="" />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(container.querySelector("span.truncate")?.textContent).toBe("");
  });

  it("domyślnie NIE ma akcentu, a `emphasis` go dokłada", () => {
    // Dwie gałęzie wartości domyślnej `emphasis = false`: bez propa metryka
    // jest zwykłą liczbą, z propem niesie sygnał („ktoś tu dziś był").
    render(<ClubSignalMetric icon={Users} value="3" label="club.network.pulse.today" />);
    expect(screen.getByText("3").className).not.toContain("text-primary");

    render(<ClubSignalMetric icon={Users} value="4" label="club.network.pulse.today" emphasis />);
    expect(screen.getByText("4").className).toContain("text-primary");
  });

  it("etykieta się skraca, a nie zawija - trzy metryki stoją w rzędzie 20 rem", () => {
    render(<ClubSignalMetric icon={Users} value="8" label="club.network.pulse.veryLongLabelKey" />);
    expect(screen.getByText("club.network.pulse.veryLongLabelKey").className).toContain("truncate");
  });
});

describe("ClubExpertiseChip - deklaracja osoby, nie filtr strumienia", () => {
  it("pokazuje etykietę z ikoną kompetencji ukrytą przed czytnikiem", () => {
    render(<ClubExpertiseChip label="Energetyka" />);
    const chip = screen.getByText("Energetyka").closest("span.border-primary\\/30");
    expect(chip).not.toBeNull();
    expect(chip?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    { label: "", note: "pusty napis" },
    { label: "   ", note: "same spacje" },
    { label: "\n\t", note: "same białe znaki" },
  ])("etykieta $note nie renderuje chipa ($note)", ({ label }) => {
    const { container } = render(<ClubExpertiseChip label={label} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("nie jest klikalny - kompetencja przy twarzy nie filtruje klubu", () => {
    // Nagłówek komponentu stawia to jako regułę: gdyby chip wyglądał i działał
    // jak `ClubTopicChip`, czytelnik próbowałby zawężać strumień przez czyjąś
    // kompetencję.
    render(<ClubExpertiseChip label="Rynek mocy" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("`className` dokłada się do chipa bez utraty krawędzi akcentu", () => {
    render(<ClubExpertiseChip label="Wodór" className="mt-1" />);
    const chip = screen.getByText("Wodór").closest("span.border-primary\\/30");
    expect(chip?.className).toContain("mt-1");
    expect(chip?.className).toContain("border-primary/30");
  });
});
