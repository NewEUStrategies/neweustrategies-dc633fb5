// Atomy przestrzeni roboczej klubu: znaczniki rodzajów, pusty panel, zakładka
// i znacznik źródła.
//
// CO TO DOWODZI. Te cztery pliki są JEDYNYM miejscem, w którym zapada decyzja
// "jak wygląda rodzaj dokumentu / rodzaj wpisu w kalendarzu / stan etapu /
// dział pochodzenia". Biblioteka, kalendarz i harmonogram pokazują swoje
// rodzaje w czterech miejscach każdy (lista, karta, filtr, formularz), więc
// dowód musi obejmować PEŁNE słowniki, a nie próbkę:
//   1. `Record<Kind, ...>` pilnuje, że coś tam JEST, ale nie pilnuje, że jest
//      to coś INNEGO niż u sąsiada. Dlatego test jedzie tabelą przez
//      `CLUB_DOCUMENT_KINDS`, `CLUB_EVENT_KINDS` i `CLUB_MILESTONE_STATES`
//      i po każdej tabeli stawia asercję-kanarka o ROZŁĄCZNOŚCI: osiem
//      rodzajów wpisu ma osiem różnych tonów, osiem rodzajów wpisu ma osiem
//      różnych ikon, a żaden PRODUKT klubu nie dostaje ikony materiału
//      wejściowego (`FileText`). Sklejenie dwóch rodzajów w jeden wygląd
//      przechodzi recenzję kodu niezauważone i widać je dopiero na ekranie.
//   2. Ton wpisu wychodzi z JEDNEJ funkcji (`clubEventToneClass`) i ta sama
//      wartość musi trafić do chipa i do kropki w siatce miesiąca - inaczej
//      lista i kalendarz mówią o tym samym terminie dwoma kolorami.
//   3. Licznik zakładki: `null` znaczy "brak licznika", a `0` znaczy "zero" -
//      to są DWA różne stany i test zapisuje tę regułę wprost, bo jest jedyną
//      rzeczą, której sygnatura `number | null` sama nie wymusza.
//   4. Znacznik źródła jest KLIKALNY tylko wtedy, gdy ma dokąd prowadzić:
//      bez `onSelect` albo bez identyfikatora działu zostaje etykietą
//      (`<span>`), nie martwym przyciskiem.
// Asercje idą na KLUCZE i18n i na fragmenty klas nośne dla znaczenia, nigdy na
// polskie napisy ze słowników.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (1) Wartości POZA zbiorem enuma - do tych atomów nie dochodzą: propsy są
//     zawężonymi uniami, a wartość spoza słownika wymagałaby rzutowania, którego
//     reguły repozytorium zabraniają. Dowód degradacji leży w `workspaceTypes`
//     (`toDocumentKind`, `toEventKind`, `toMilestoneState` z jawnym fallbackiem)
//     i tam jest testowany.
// (2) `lucide-react`, `cn`/tailwind-merge i `Badge` z `components/ui` - to
//     biblioteki, nie nasz kontrakt.
// (3) Wnętrza `ClubGroupAccent` (`clubGroupAccentVars`, `ClubGroupIcon`,
//     fallbacki ikon po głębokości) - to osobny atom z własnym dowodem. Tutaj
//     sprawdzamy wyłącznie, że `ClubSourceChip` PRZEKAZUJE do niego akcent
//     i nazwę ikony działu.
// (4) Istnienia kluczy w słownikach tłumaczeń - pilnują tego bramki i18n.
// (5) Belki zakładek (kolejność, strzałki, przewijanie) ani paneli, do których
//     zakładki prowadzą - `ClubWorkspaceTab` jest jednym przyciskiem i nie wie
//     nic o sąsiadach; nawigacja klawiaturą należy do belki.
// (6) Skąd bierze się `ClubSourceMark` - `clubSourceOf`/`groupClubThreadsBySource`
//     mają własne testy w `threadSources`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import {
  ClubDocumentKindChip,
  ClubDocumentKindIcon,
  ClubEventDot,
  ClubEventKindChip,
  ClubEventKindIcon,
  ClubMilestoneMarker,
  ClubMilestoneStateChip,
  clubEventToneClass,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubWorkspaceTab } from "@/components/clubs/atoms/ClubWorkspaceTab";
import { ClubSourceChip } from "@/components/clubs/atoms/ClubSourceChip";
import {
  CLUB_DOCUMENT_KINDS,
  CLUB_EVENT_KINDS,
  CLUB_MILESTONE_STATES,
  CLUB_PRODUCT_KINDS,
  type ClubMilestoneState,
} from "@/lib/clubs/workspaceTypes";
import type { ClubSourceMark } from "@/lib/clubs/threadSources";

// ---------------------------------------------------------------------------
// Pomocnicze - bez rzutowań, z jawnym błędem testu przy braku elementu
// ---------------------------------------------------------------------------

/** Element po selektorze; brak elementu to błąd TESTU, nie ciche `null`. */
function pick(container: HTMLElement, selector: string): Element {
  const found = container.querySelector(selector);
  if (found === null) throw new Error(`test: brak elementu ${selector}`);
  return found;
}

/**
 * Tożsamość ikony lucide odczytana z klasy `lucide-<nazwa>`. To jedyny sposób
 * odróżnienia dwóch ikon bez zaglądania w ścieżki SVG - a odróżnienie ikon jest
 * tu całą treścią kontraktu.
 */
function iconOf(container: HTMLElement): string {
  const svg = pick(container, "svg");
  const token = [...svg.classList].find((cls) => cls.startsWith("lucide-"));
  if (token === undefined) throw new Error("test: element nie jest ikoną lucide");
  return token;
}

/** Czy element niesie WSZYSTKIE klasy z podanego ciągu. */
function hasClasses(element: Element, classes: string): boolean {
  return classes.split(" ").every((cls) => element.classList.contains(cls));
}

// ---------------------------------------------------------------------------
// Dokumenty
// ---------------------------------------------------------------------------

describe("ClubDocumentKindIcon", () => {
  it.each(CLUB_DOCUMENT_KINDS)("rodzaj dokumentu %s ma ikonę ukrytą dla czytnika", (kind) => {
    // Ikona jest DUBLETEM etykiety obok, więc czytnik ekranu nie może jej
    // czytać - inaczej lista dokumentów mówi każdy rodzaj dwa razy.
    const { container } = render(<ClubDocumentKindIcon kind={kind} />);
    const svg = pick(container, "svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(hasClasses(svg, "h-4 w-4 shrink-0")).toBe(true);
  });

  it("bez `className` zostaje rozmiar domyślny, z `className` rozmiar wołającego", () => {
    // Dwie gałęzie propsa opcjonalnego: chip podaje `h-3 w-3`, lista nie
    // podaje nic i musi dostać `h-4 w-4`.
    const bare = render(<ClubDocumentKindIcon kind="brief" />);
    expect(hasClasses(pick(bare.container, "svg"), "h-4 w-4")).toBe(true);

    const sized = render(<ClubDocumentKindIcon kind="brief" className="h-6 w-6" />);
    const svg = pick(sized.container, "svg");
    expect(hasClasses(svg, "h-6 w-6")).toBe(true);
    expect(svg.classList.contains("h-4")).toBe(false);
  });

  it("KAŻDY produkt klubu ma inną ikonę niż materiał wejściowy `brief`", () => {
    // Regresja, którą to łapie: produkt z ikoną `FileText` przestaje odróżniać
    // WYJŚCIE klubu od jego WEJŚCIA, czyli kasuje jedyną rzecz, po której
    // widać dorobek klubu (A29).
    const briefIcon = iconOf(render(<ClubDocumentKindIcon kind="brief" />).container);
    for (const kind of CLUB_PRODUCT_KINDS) {
      const productIcon = iconOf(render(<ClubDocumentKindIcon kind={kind} />).container);
      expect(productIcon, `produkt ${kind} nie może dzielić ikony z materiałem`).not.toBe(
        briefIcon,
      );
    }
  });

  it("siedem produktów ma siedem RÓŻNYCH ikon", () => {
    const icons = CLUB_PRODUCT_KINDS.map((kind) =>
      iconOf(render(<ClubDocumentKindIcon kind={kind} />).container),
    );
    expect(new Set(icons).size).toBe(CLUB_PRODUCT_KINDS.length);
  });
});

describe("ClubDocumentKindChip", () => {
  it.each(CLUB_DOCUMENT_KINDS)("chip %s niesie klucz i18n, znacznik danych i ikonę", (kind) => {
    const { container } = render(<ClubDocumentKindChip kind={kind} />);
    const chip = pick(container, "[data-club-document-kind]");
    expect(chip.getAttribute("data-club-document-kind")).toBe(kind);
    expect(chip.textContent).toBe(`club.docs.kind.${kind}`);
    // Ikona w chipie jest zmniejszona - inaczej rozpycha wiersz listy.
    expect(hasClasses(pick(container, "svg"), "h-3 w-3")).toBe(true);
  });

  it("rodzaj dokumentu jest NEUTRALNY - kolor niesie tu stan, nie rodzaj", () => {
    // Świadoma reguła: piętnaście rodzajów w piętnastu kolorach zamienia
    // bibliotekę w paletę farb. Wyróżnienie zostaje dla stanu i dla kalendarza.
    const tones = CLUB_DOCUMENT_KINDS.map(
      (kind) =>
        pick(render(<ClubDocumentKindChip kind={kind} />).container, "[data-club-document-kind]")
          .className,
    );
    expect(new Set(tones).size).toBe(1);
    expect(tones[0]).toContain("bg-muted/40");
  });

  it("`className` wołającego dokleja się do wspólnego kształtu chipa", () => {
    const { container } = render(<ClubDocumentKindChip kind="legal" className="ml-2" />);
    const chip = pick(container, "[data-club-document-kind]");
    expect(hasClasses(chip, "ml-2 inline-flex")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kalendarz
// ---------------------------------------------------------------------------

describe("clubEventToneClass", () => {
  it.each(CLUB_EVENT_KINDS)("rodzaj wpisu %s ma niepusty ton", (kind) => {
    expect(clubEventToneClass(kind).trim()).not.toBe("");
  });

  it("osiem rodzajów wpisu ma OSIEM różnych tonów", () => {
    // Asercja-kanarek. `Record<ClubEventKind, string>` przepuszcza dwa rodzaje
    // z tym samym tonem, a wtedy kalendarz przestaje odpowiadać na pytanie
    // "co mnie czeka" jednym spojrzeniem.
    const tones = CLUB_EVENT_KINDS.map((kind) => clubEventToneClass(kind));
    expect(new Set(tones).size).toBe(CLUB_EVENT_KINDS.length);
  });

  it("TERMIN jest czerwony, a nie neutralny - to jedyna rzecz nie do odrobienia", () => {
    expect(clubEventToneClass("deadline")).toContain("destructive");
    expect(clubEventToneClass("other")).toContain("muted");
    expect(clubEventToneClass("deadline")).not.toBe(clubEventToneClass("meeting"));
  });
});

describe("ClubEventKindIcon", () => {
  it.each(CLUB_EVENT_KINDS)("rodzaj wpisu %s ma ikonę ukrytą dla czytnika", (kind) => {
    const { container } = render(<ClubEventKindIcon kind={kind} />);
    const svg = pick(container, "svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(hasClasses(svg, "h-4 w-4 shrink-0")).toBe(true);
  });

  it("osiem rodzajów wpisu ma OSIEM różnych ikon", () => {
    // Termin ustawowy nie może wyglądać jak posiedzenie: to dwie różne rzeczy
    // w kalendarzu jednego klubu (nagłówek `ClubWorkspaceBadges.tsx`).
    const icons = CLUB_EVENT_KINDS.map((kind) =>
      iconOf(render(<ClubEventKindIcon kind={kind} />).container),
    );
    expect(new Set(icons).size).toBe(CLUB_EVENT_KINDS.length);
  });

  it("bez `className` rozmiar domyślny, z `className` rozmiar wołającego", () => {
    const bare = render(<ClubEventKindIcon kind="vote" />);
    expect(hasClasses(pick(bare.container, "svg"), "h-4 w-4")).toBe(true);
    const sized = render(<ClubEventKindIcon kind="vote" className="h-5 w-5" />);
    expect(pick(sized.container, "svg").classList.contains("h-4")).toBe(false);
  });
});

describe("ClubEventKindChip", () => {
  it.each(CLUB_EVENT_KINDS)("chip %s niesie klucz i18n, znacznik danych i swój ton", (kind) => {
    const { container } = render(<ClubEventKindChip kind={kind} />);
    const chip = pick(container, "[data-club-event-kind]");
    expect(chip.getAttribute("data-club-event-kind")).toBe(kind);
    expect(chip.textContent).toBe(`club.calendar.kind.${kind}`);
    expect(hasClasses(chip, clubEventToneClass(kind))).toBe(true);
    expect(hasClasses(pick(container, "svg"), "h-3 w-3")).toBe(true);
  });

  it("`className` wołającego dokleja się do kształtu i tonu", () => {
    const { container } = render(<ClubEventKindChip kind="meeting" className="w-full" />);
    const chip = pick(container, "[data-club-event-kind]");
    expect(hasClasses(chip, "w-full inline-flex")).toBe(true);
    expect(hasClasses(chip, clubEventToneClass("meeting"))).toBe(true);
  });
});

describe("ClubEventDot", () => {
  it.each(CLUB_EVENT_KINDS)("kropka %s niesie ten SAM ton, co chip tego rodzaju", (kind) => {
    // Kropka w siatce miesiąca i chip w liście to ta sama informacja na dwóch
    // powierzchniach - rozjazd koloru znaczy, że użytkownik widzi dwa różne
    // rodzaje wpisu tam, gdzie jest jeden.
    const { container } = render(<ClubEventDot kind={kind} label={`etykieta-${kind}`} />);
    const dot = screen.getByRole("img", { name: `etykieta-${kind}` });
    expect(hasClasses(dot, clubEventToneClass(kind))).toBe(true);
    // Sam kolor - w komórce dnia nie ma miejsca na napis.
    expect(dot.textContent).toBe("");
    expect(pick(container, "[role='img']").getAttribute("title")).toBe(`etykieta-${kind}`);
  });

  it("treść dla czytnika idzie w `aria-label` ORAZ w `title` - mysz i klawiatura", () => {
    render(<ClubEventDot kind="deadline" label="Koniec konsultacji" />);
    const dot = screen.getByRole("img", { name: "Koniec konsultacji" });
    expect(dot.getAttribute("title")).toBe("Koniec konsultacji");
  });

  it("pusta etykieta zostawia kropkę bez nazwy - i to jest wina wołającego", () => {
    // Wartość fałszywa, ale prawidłowa dla sygnatury `label: string`.
    // Kropka nadal się rysuje (kolor to informacja), ale czytnik nie ma co
    // powiedzieć - dlatego etykietę składa panel kalendarza, nie ten atom.
    const { container } = render(<ClubEventDot kind="other" label="" />);
    const dot = pick(container, "[role='img']");
    expect(dot.getAttribute("aria-label")).toBe("");
    expect(hasClasses(dot, "rounded-full border")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Harmonogram
// ---------------------------------------------------------------------------

describe("ClubMilestoneStateChip", () => {
  const MARK: Record<ClubMilestoneState, string> = {
    planned: "bg-muted/40",
    active: "bg-primary/10",
    done: "bg-emerald-500/10",
    blocked: "bg-destructive/10",
    cancelled: "bg-muted/30",
  };

  it.each(CLUB_MILESTONE_STATES)("chip stanu %s niesie klucz i18n, znacznik i ton", (state) => {
    const { container } = render(<ClubMilestoneStateChip state={state} />);
    const chip = pick(container, "[data-club-milestone-state]");
    expect(chip.getAttribute("data-club-milestone-state")).toBe(state);
    expect(chip.textContent).toBe(`club.schedule.state.${state}`);
    expect(chip.className).toContain(MARK[state]);
  });

  it("pięć stanów etapu ma PIĘĆ różnych wyglądów", () => {
    const looks = CLUB_MILESTONE_STATES.map(
      (state) =>
        pick(
          render(<ClubMilestoneStateChip state={state} />).container,
          "[data-club-milestone-state]",
        ).className,
    );
    expect(new Set(looks).size).toBe(CLUB_MILESTONE_STATES.length);
  });

  it("etap odwołany jest PRZEKREŚLONY, zablokowany czerwony - to różne wiadomości", () => {
    // Odwołany etap nie ma czego dowozić (patrz `isMilestoneOverdue`), więc nie
    // wolno mu wyglądać jak alarm; zablokowany właśnie alarmem być musi.
    const cancelled = render(<ClubMilestoneStateChip state="cancelled" />);
    expect(
      pick(cancelled.container, "[data-club-milestone-state]").classList.contains("line-through"),
    ).toBe(true);
    const blocked = render(<ClubMilestoneStateChip state="blocked" />);
    const blockedChip = pick(blocked.container, "[data-club-milestone-state]");
    expect(blockedChip.className).toContain("destructive");
    expect(blockedChip.classList.contains("line-through")).toBe(false);
  });

  it("ikona chipa stanu jest ukryta dla czytnika, a `className` się dokleja", () => {
    const { container } = render(<ClubMilestoneStateChip state="active" className="mt-1" />);
    expect(pick(container, "svg").getAttribute("aria-hidden")).toBe("true");
    expect(hasClasses(pick(container, "[data-club-milestone-state]"), "mt-1 inline-flex")).toBe(
      true,
    );
  });
});

describe("ClubMilestoneMarker", () => {
  const LOOK: Record<ClubMilestoneState, string> = {
    planned: "border-border bg-background",
    active: "border-primary bg-primary",
    done: "border-emerald-500 bg-emerald-500",
    blocked: "border-destructive bg-destructive",
    // Odwołany etap na osi czasu wygląda jak jeszcze niezaczęty: pusta kropka.
    // Różnicę niesie chip stanu obok (przekreślenie), a nie ta kropka.
    cancelled: "border-border bg-background",
  };

  it.each(CLUB_MILESTONE_STATES)("kropka osi dla stanu %s ma swoje wypełnienie", (state) => {
    const { container } = render(<ClubMilestoneMarker state={state} />);
    const marker = pick(container, "span");
    expect(hasClasses(marker, LOOK[state])).toBe(true);
    // Kropka jest DEKORACJĄ - treść niesie chip stanu obok niej.
    expect(marker.getAttribute("aria-hidden")).toBe("true");
  });

  it("zamknięty, trwający i zablokowany etap to trzy RÓŻNE kropki", () => {
    const looks = (["done", "active", "blocked"] as const).map(
      (state) => pick(render(<ClubMilestoneMarker state={state} />).container, "span").className,
    );
    expect(new Set(looks).size).toBe(3);
  });

  it("kropka etapu zaplanowanego jest PUSTA - wypełnienie znaczy `zamknięty`", () => {
    const { container } = render(<ClubMilestoneMarker state="planned" />);
    const marker = pick(container, "span");
    expect(marker.classList.contains("bg-background")).toBe(true);
    expect(marker.className).not.toContain("bg-emerald-500");
    expect(marker.className).not.toContain("bg-primary");
  });
});

// ---------------------------------------------------------------------------
// Pusty panel
// ---------------------------------------------------------------------------

describe("ClubWorkspaceEmpty", () => {
  it("z samym tytułem nie rysuje ani ikony, ani podpowiedzi, ani akcji", () => {
    // Trzy propsy opcjonalne pominięte naraz: czytelnik bez prawa zapisu ma
    // dostać zdanie o pustce i ANI JEDNEGO martwego przycisku obok.
    const { container } = render(<ClubWorkspaceEmpty title="club.docs.empty.title" />);
    expect(screen.getByText("club.docs.empty.title")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("button")).toBeNull();
  });

  it("z ikoną, podpowiedzią i akcją rysuje wszystkie trzy warstwy", () => {
    render(
      <ClubWorkspaceEmpty
        icon={<span data-testid="ikona" />}
        title="club.docs.empty.title"
        hint="club.docs.empty.hint"
        action={<button type="button">club.docs.empty.cta</button>}
      />,
    );
    expect(screen.getByTestId("ikona")).toBeInTheDocument();
    expect(screen.getByText("club.docs.empty.hint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "club.docs.empty.cta" })).toBeInTheDocument();
  });

  it("kontener ikony jest ukryty dla czytnika - obok stoi tytuł, który mówi to samo", () => {
    const { container } = render(
      <ClubWorkspaceEmpty icon={<span data-testid="ikona" />} title="club.docs.empty.title" />,
    );
    const wrapper = pick(container, "[aria-hidden='true']");
    expect(wrapper.querySelector("[data-testid='ikona']")).not.toBeNull();
  });

  it("podpowiedź PUSTA to nadal podpowiedź - straż stoi na `undefined`, nie na fałszywości", () => {
    // Wartość fałszywa, ale prawidłowa dla `hint?: string`. Reguła zapisana
    // wprost, bo od niej zależy, czy panel z `hint={""}` dostaje pusty akapit
    // (dziś: dostaje) - i czy odstęp pod tytułem nagle rośnie bez treści.
    const { container } = render(<ClubWorkspaceEmpty title="club.docs.empty.title" hint="" />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1].textContent).toBe("");
  });

  it("akcja jest w osobnym pasie pod treścią, a nie w tym samym akapicie", () => {
    // Bez własnego pasa (`mt-4`) przycisk lądowałby przyklejony do
    // podpowiedzi - to jedyna rzecz, która oddziela opis od zaproszenia.
    const { container } = render(
      <ClubWorkspaceEmpty
        title="club.docs.empty.title"
        action={<button type="button">club.docs.empty.cta</button>}
      />,
    );
    const bar = pick(container, "button").parentElement;
    expect(bar?.tagName).toBe("DIV");
    expect(bar?.className).toBe("mt-4");
  });
});

// ---------------------------------------------------------------------------
// Zakładka
// ---------------------------------------------------------------------------

describe("ClubWorkspaceTab", () => {
  /** Wspólne propsy - test nadpisuje tylko to, czego dotyczy. */
  function renderTab(
    overrides: Partial<{ count: number | null; active: boolean; onSelect: () => void }> = {},
  ) {
    return render(
      <ClubWorkspaceTab
        id="tab-docs"
        panelId="panel-docs"
        label="club.thread.panel.documents"
        count={overrides.count === undefined ? null : overrides.count}
        icon={<span data-testid="ikona" />}
        active={overrides.active ?? false}
        onSelect={overrides.onSelect ?? (() => {})}
      />,
    );
  }

  it("jest PRZYCISKIEM w roli zakładki, wiąże się z panelem i nie wysyła formularza", () => {
    // `type="button"` nie jest ozdobą: zakładka w formularzu edycji wątku bez
    // tego atrybutu wysyła formularz, czyli gubi to, co użytkownik wpisał.
    renderTab();
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("type")).toBe("button");
    expect(tab.getAttribute("id")).toBe("tab-docs");
    expect(tab.getAttribute("aria-controls")).toBe("panel-docs");
  });

  it("zakładka aktywna jest ogłoszona i JEST w kolejności Tab", () => {
    renderTab({ active: true });
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("tabindex")).toBe("0");
    expect(tab.className).toContain("border-primary/40");
  });

  it("zakładka nieaktywna WYPADA z kolejności Tab - fokus wchodzi w belkę raz", () => {
    // Wzorzec WAI-ARIA "tabs with manual activation": Tab wchodzi w belkę,
    // strzałki przenoszą fokus wewnątrz. `tabIndex=0` na każdej zakładce
    // znaczyłby tyle przystanków Taba, ile paneli.
    renderTab({ active: false });
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("aria-selected")).toBe("false");
    expect(tab.getAttribute("tabindex")).toBe("-1");
    expect(tab.className).toContain("border-transparent");
  });

  it("`count === null` znaczy BRAK licznika: ani odznaki, ani liczby w nazwie", () => {
    const { container } = renderTab({ count: null });
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("aria-label")).toBe("club.thread.panel.documents");
    // Odznaka to jedyny węzeł `aria-hidden` obok kontenera ikony.
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(1);
  });

  it("`count === 0` POKAZUJE zero - ukrycie licznika należy do wołającego przez `null`", () => {
    // Reguła zapisana wprost, bo sygnatura `number | null` jej nie wymusza:
    // atom rozróżnia "brak licznika" (`null`) od "zero" (`0`) i zera NIE
    // przemilcza. Panel, który nie chce zerowej odznaki, podaje `null`.
    renderTab({ count: 0 });
    const tab = screen.getByRole("tab", { name: "club.thread.panel.documents (0)" });
    expect(tab.textContent).toContain("0");
  });

  it("licznik wchodzi w NAZWĘ dostępną, a odznaka jest dla czytnika niewidzialna", () => {
    // Czytnik mówi "Dokumenty, 7" jednym tchem; gdyby odznaka nie była
    // `aria-hidden`, liczba padłaby dwa razy.
    const { container } = renderTab({ count: 7 });
    const tab = screen.getByRole("tab", { name: "club.thread.panel.documents (7)" });
    expect(tab.textContent).toContain("7");
    const badges = [...container.querySelectorAll("[aria-hidden='true']")].filter(
      (node) => node.textContent === "7",
    );
    expect(badges).toHaveLength(1);
  });

  it("odznaka aktywnej zakładki jest wypełniona, nieaktywnej - przygaszona", () => {
    const activeTab = renderTab({ count: 3, active: true });
    const activeBadge = [...activeTab.container.querySelectorAll("[aria-hidden='true']")].filter(
      (node) => node.textContent === "3",
    )[0];
    expect(activeBadge.className).toContain("bg-primary");

    const idleTab = renderTab({ count: 3, active: false });
    const idleBadge = [...idleTab.container.querySelectorAll("[aria-hidden='true']")].filter(
      (node) => node.textContent === "3",
    )[0];
    expect(idleBadge.className).toContain("bg-muted");
  });

  it("kontener ikony barwi się TYLKO na zakładce aktywnej", () => {
    const active = renderTab({ active: true });
    const activeIcon = pick(active.container, "[data-testid='ikona']").parentElement;
    expect(activeIcon?.className).toBe("text-primary");

    const idle = renderTab({ active: false });
    const idleIcon = pick(idle.container, "[data-testid='ikona']").parentElement;
    expect(idleIcon?.className).toBe("");
  });

  it("kliknięcie emituje wybór DOKŁADNIE raz", () => {
    const onSelect = vi.fn();
    renderTab({ onSelect });
    fireEvent.click(screen.getByRole("tab"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("kliknięcie zakładki JUŻ aktywnej też emituje - o odrzuceniu decyduje belka", () => {
    // Atom nie zna stanu belki i nie wolno mu go zgadywać: gdyby połykał
    // kliknięcie aktywnej zakładki, panel nie dałby się przewinąć na górę
    // powtórnym kliknięciem.
    const onSelect = vi.fn();
    renderTab({ active: true, onSelect });
    fireEvent.click(screen.getByRole("tab"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Znacznik źródła
// ---------------------------------------------------------------------------

describe("ClubSourceChip", () => {
  function mark(overrides: Partial<ClubSourceMark> = {}): ClubSourceMark {
    return {
      id: overrides.id === undefined ? "grp-kuluary" : overrides.id,
      name: overrides.name ?? "Kuluary",
      accent: overrides.accent === undefined ? "#2f6feb" : overrides.accent,
      icon: overrides.icon === undefined ? "landmark" : overrides.icon,
    };
  }

  it("bez `onSelect` jest ETYKIETĄ, nie przyciskiem", () => {
    // Znacznik pochodzenia, który nic nie robi, nie ma udawać, że coś zrobi.
    const { container } = render(<ClubSourceChip source={mark()} />);
    expect(container.querySelector("button")).toBeNull();
    const chip = pick(container, "span");
    expect(chip.getAttribute("aria-pressed")).toBeNull();
    expect(screen.getByText("Kuluary")).toBeInTheDocument();
  });

  it("z `onSelect`, ale BEZ identyfikatora działu zostaje etykietą - nie ma czego zawęzić", () => {
    // Wpis poza działami (`id === null`) niesie nazwę kubełka, a nie dział,
    // więc filtrowanie po nim nie ma sensu.
    const onSelect = vi.fn();
    const { container } = render(
      <ClubSourceChip source={mark({ id: null, name: "Bez działu" })} onSelect={onSelect} />,
    );
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByText("Bez działu")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("z `onSelect` i identyfikatorem jest przyciskiem z podpowiedzią i stanem", () => {
    render(<ClubSourceChip source={mark()} onSelect={() => {}} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("title")).toBe("club.hub.sources.filterHint");
    // `active` pominięty - domyślne `false` musi trafić do `aria-pressed`.
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("kliknięcie nieaktywnego chipa ZAWĘŻA strumień do tego działu", () => {
    const onSelect = vi.fn();
    render(<ClubSourceChip source={mark()} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("grp-kuluary");
  });

  it("kliknięcie AKTYWNEGO chipa zdejmuje zawężenie (`null`)", () => {
    // Bez tej gałęzi filtr da się włączyć, ale nie da się wyłączyć tam, gdzie
    // chip jest jedynym elementem sterującym.
    const onSelect = vi.fn();
    render(<ClubSourceChip source={mark()} onSelect={onSelect} active />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("chip aktywny dostaje obwódkę, nieaktywny nie", () => {
    const activeChip = render(<ClubSourceChip source={mark()} onSelect={() => {}} active />);
    expect(pick(activeChip.container, "button").className).toContain("ring-1");
    const idleChip = render(<ClubSourceChip source={mark()} onSelect={() => {}} active={false} />);
    expect(pick(idleChip.container, "button").className).not.toContain("ring-1");
  });

  it("akcent działu wjeżdża w zmienne CSS - i etykieta, i przycisk", () => {
    // Ten sam dział ma mieć ten sam kolor niezależnie od tego, czy chip jest
    // klikalny; inaczej "Kuluary" w karcie i "Kuluary" w panelu źródeł
    // wyglądają jak dwa różne działy.
    const label = render(<ClubSourceChip source={mark({ accent: "#2f6feb" })} />);
    expect(pick(label.container, "span").getAttribute("style")).toContain("--club-accent: #2f6feb");
    const button = render(
      <ClubSourceChip source={mark({ accent: "#2f6feb" })} onSelect={() => {}} />,
    );
    expect(pick(button.container, "button").getAttribute("style")).toContain(
      "--club-accent: #2f6feb",
    );
  });

  it("dział BEZ akcentu dziedziczy `--primary`, a nie pustą zmienną", () => {
    // Dział spoza listy (albo bez `accent_color`) ma się pokazać BEZ koloru
    // własnego, ale NIE zniknąć - znikający wątek byłby gorszy od wątku bez
    // kropki (nagłówek `threadSources.ts`).
    const { container } = render(<ClubSourceChip source={mark({ accent: null })} />);
    expect(pick(container, "span").getAttribute("style")).toContain(
      "--club-accent: var(--primary)",
    );
  });

  it("ikona działu z bazy wygrywa z ikoną zastępczą", () => {
    const named = render(<ClubSourceChip source={mark({ icon: "landmark" })} />);
    expect(iconOf(named.container)).toBe("lucide-landmark");
    const bare = render(<ClubSourceChip source={mark({ icon: null })} />);
    expect(iconOf(bare.container)).not.toBe("lucide-landmark");
  });

  it("PUSTA nazwa nie ukrywa chipa - kolor i ikona nadal mówią, skąd to jest", () => {
    // Wartość fałszywa, ale prawidłowa dla `name: string`. `clubSourceOf` nigdy
    // jej nie wypuszcza (zwraca `null` przy braku nazwy), więc to zapis reguły
    // obronnej: chip nie decyduje o własnym istnieniu.
    const { container } = render(<ClubSourceChip source={mark({ name: "" })} />);
    const chip = pick(container, "span");
    expect(chip.textContent).toBe("");
    expect(hasClasses(chip, "inline-flex rounded-lg border")).toBe(true);
  });

  it("`className` wołającego dokleja się do obu wariantów", () => {
    const label = render(<ClubSourceChip source={mark()} className="mt-2" />);
    expect(hasClasses(pick(label.container, "span"), "mt-2 inline-flex")).toBe(true);
    const button = render(<ClubSourceChip source={mark()} onSelect={() => {}} className="mt-2" />);
    expect(hasClasses(pick(button.container, "button"), "mt-2 inline-flex")).toBe(true);
  });
});
