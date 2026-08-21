// Chipy i znaczniki stanu w publicznym module klubów - siedem atomów, jeden
// plik, bo wszystkie odpowiadają na to samo pytanie: JAK WYGLĄDA STAN.
// (`ClubTopicChip`, `ClubStatusPill`, `ClubThreadHeat`, `ClubHubAccessBadge`,
// `ClubRegimeMark`, `ClubGroupAccent`, `ClubHoverAction`.)
//
// CO TO DOWODZI.
// (1) MAPY STANU -> WYGLĄD SĄ WYCZERPUJĄCE I ROZŁĄCZNE. `milestoneTone`
//     i `questionTone` przyjmują `string`, nie unię - dostają wartość wprost
//     z bazy, więc status z nowszej migracji („paused”, „”) MUSI wpaść
//     w zdefiniowany fallback, a nie w pigułkę bez tonu. Tabele jadą przez
//     pełne słowniki (`CLUB_MILESTONE_STATUSES`, `CLUB_QUESTION_STATUSES`)
//     plus wartość pustą i wartość spoza zbioru. Osobno pilnujemy tego, co
//     nagłówek `ClubStatusPill.tsx` deklaruje jako powód istnienia JEDNEGO
//     komponentu na dwa słowniki: „zrobione” w harmonogramie i „odpowiedziane”
//     w Q&A muszą mieć TEN SAM ton, inaczej użytkownik widzi dwa różne stany.
// (2) REŻIM DZIAŁU POKAZUJE WYŁĄCZNIE ODSTĘPSTWO. `isChathamGroup`
//     i `isRestrictedGroup` to czyste predykaty nad kolumnami `*_inherited`
//     z `club_groups_list` - dział DZIEDZICZĄCY ustawienia klubu nie dostaje
//     znacznika (gdyby dostał, znacznik stałby przy każdym dziale i przestałby
//     cokolwiek znaczyć). Test przejeżdża każdy warunek w OBIE strony, w tym
//     `null` w kolumnie i wartość spoza słownika, i pilnuje reguły
//     pierwszeństwa: Chatham House wygrywa nad zawężeniem widoczności, bo
//     zmienia sposób PISANIA, a nie tylko krąg czytających.
// (3) AKCENT DZIAŁU NIGDY NIE JEST PUSTY. `clubGroupAccentVars` daje
//     `var(--primary)` dla `null`, pustego napisu i samych spacji - inaczej
//     `color-mix(in oklab, <nic> 8%, transparent)` wywala całą regułę CSS
//     i kafel działu traci tło razem z krawędzią. Sprawdzamy też, że stałe
//     `CLUB_GROUP_*` faktycznie CZYTAJĄ `--club-accent`, bo zmienna ustawiona
//     przez atom i klasa, która jej nie używa, to najcichsza możliwa awaria.
// (4) ZERO JEST WARTOŚCIĄ, ALE NIE PLAKIETKĄ. `ClubHoverActionBody` pokazuje
//     licznik od jedynki (`count = 0` to brak dyskusji, nie „0 komentarzy”),
//     a etykieta zostaje w DOM ZAWSZE - maskuje ją `overflow-hidden`, więc
//     czytnik ekranu i wyszukiwanie w stronie ją widzą także w spoczynku.
// (5) `clubHoverActionClass` ma trzy niezależne opcje i wołanie BEZ argumentu
//     (`options ?? {}`), które musi dać dokładnie to samo, co `{}` - to jedyne
//     miejsce, w którym geometria powłoki akcji jest wspólna dla `<button>`
//     i `<Link>`.
// (6) CHIP OBSZARU JEST KLIKALNY TYLKO WTEDY, GDY MA DOKĄD PROWADZIĆ: bez
//     `onSelect` renderuje `<span>` (obszar JEST ustalony), z `onSelect`
//     `<button aria-pressed>`, a ponowne kliknięcie ZDEJMUJE filtr
//     (`onSelect(null)`). `active` wygrywa nad `tone`, bo obszar wybrany ma
//     wyglądać tak samo na pasku filtrów i na karcie wątku.
// (7) SKALA DYNAMIKI WĄTKU ma tyle wypełnionych słupków, ile wynosi poziom -
//     to jedyny nośnik znaczenia niezależny od koloru (nagłówek
//     `ClubThreadHeat.tsx` stawia to jako wymóg dostępności), a tooltip
//     i `aria-label` są TYM SAMYM napisem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - PROGÓW `computeThreadPulse` (0,5 / 2 / 6 odpowiedzi na dobę, kary za
//   ciszę, sufit dla wątku bez odpowiedzi). Mają własny test z jawnym `now`:
//   `src/lib/clubs/__tests__/threadPulse.test.ts`. Tutaj poziom jest WEJŚCIEM
//   dla słupków, więc dobieramy dane tak, by trafić w każdy poziom skali,
//   i asertujemy liczbę słupków, a nie arytmetykę tempa.
//   Bezpiecznik `FILL[pulse.level] ?? "bg-primary"` jest za to sprawdzony
//   WPROST: dzisiejsze `level` jest z definicji z zakresu 0-4, więc jedyną
//   drogą do prawej strony `??` jest podstawienie pulsu - robi to fabryka
//   `vi.mock` delegująca do prawdziwej implementacji (bez rzutowań; fabryka
//   `vi.mock` nie jest typowana kontraktem modułu). Ten bezpiecznik zaczyna
//   znaczyć w dniu, w którym ktoś rozszerzy `THREAD_HEAT_LEVELS` i zapomni
//   o `FILL` - bez niego klasa słupka brzmiałaby `... undefined`.
// - `DynamicIcon` i pełnego rejestru lucide (własna warstwa `lib/icons`),
//   `Badge` z `components/ui` (biblioteka) oraz istnienia kluczy i18n
//   w słownikach (robią to bramki i18n). Asercje idą na KLUCZE i18n.
// - Etykiet obszarów z `CLUB_TOPIC_FALLBACK` wpisanych z pamięci - oczekiwanie
//   liczymy z zaimportowanej stałej, więc test nie zamarza na polskim napisie.
// - Walidacji formatu koloru akcentu: atom przepuszcza napis WERBATIM
//   (walidacja jest w panelu administracyjnym) i to jest tu asertowane jako
//   świadoma granica odpowiedzialności, nie jako brak.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  EyeOff,
  Folder,
  FolderTree,
  Heart,
  KeyRound,
  Layers,
  Lock,
  MailCheck,
  ShieldCheck,
  Tag,
  VenetianMask,
  Zap,
  type LucideIcon,
} from "lucide-react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

/**
 * Podstawienie POZIOMU pulsu dla jednego testu. `null` = licz prawdziwie.
 * Stan przez `vi.hoisted`, bo fabryka `vi.mock` jedzie na samą górę pliku.
 */
const pulseOverride = vi.hoisted<{ level: number | null }>(() => ({ level: null }));

// Fabryka DELEGUJE do prawdziwego `computeThreadPulse` (progi tempa i ciszy
// zostają nietknięte - mają własny test) i tylko opcjonalnie nadpisuje
// `level`. Modul `threadPulse` nie importuje niczego, wiec nie ma tu ryzyka
// zakleszczenia kolekcji przez `react-i18next`.
vi.mock("@/lib/clubs/threadPulse", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clubs/threadPulse")>();
  return {
    ...real,
    computeThreadPulse: (...args: Parameters<typeof real.computeThreadPulse>) => {
      const pulse = real.computeThreadPulse(...args);
      return pulseOverride.level === null ? pulse : { ...pulse, level: pulseOverride.level };
    },
  };
});

import {
  ClubStatusPill,
  milestoneTone,
  questionTone,
  type ClubStatusTone,
} from "@/components/clubs/atoms/ClubStatusPill";
import {
  ClubRegimeMark,
  hasOwnRegime,
  isChathamGroup,
  isRestrictedGroup,
} from "@/components/clubs/atoms/ClubRegimeMark";
import {
  CLUB_GROUP_CHIP,
  CLUB_GROUP_CHIP_ACTIVE,
  CLUB_GROUP_EDGE,
  CLUB_GROUP_TEXT,
  CLUB_GROUP_TINT,
  ClubGroupIcon,
  clubGroupAccentVars,
} from "@/components/clubs/atoms/ClubGroupAccent";
import {
  ClubHoverActionBody,
  clubHoverActionClass,
} from "@/components/clubs/atoms/ClubHoverAction";
import {
  ClubTopicChip,
  ClubTopicFilterChip,
  clubTopicChipClass,
  type ClubTopicChipSize,
  type ClubTopicChipTone,
} from "@/components/clubs/atoms/ClubTopicChip";
import { ClubThreadHeat } from "@/components/clubs/atoms/ClubThreadHeat";
import { ClubHubAccessBadge } from "@/components/clubs/atoms/ClubHubAccessBadge";
import type { ClubHubAccess } from "@/lib/clubs/hubAccess";
import { CLUB_TOPIC_FALLBACK, type ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { CLUB_MILESTONE_STATUSES, CLUB_QUESTION_STATUSES } from "@/lib/clubs/threadWorkspaceTypes";
import type { ClubGroupRow } from "@/lib/clubs/types";
import {
  CLUB_BASE_ISO,
  clubGroupRow,
  clubIsoOffset,
  clubThreadListRow,
} from "@/test/clubs/fixtures";

// ---------------------------------------------------------------------------
// Narzędzia wspólne
// ---------------------------------------------------------------------------

/** Klasy jako ZBIÓR tokenów - `includes("px-2")` trafiałby też w „px-2.5”. */
function tokens(className: string): Set<string> {
  return new Set(className.split(/\s+/).filter((token) => token !== ""));
}

/** Czy element niesie DOKŁADNIE ten util Tailwinda (nie prefiks). */
function hasClass(element: Element, token: string): boolean {
  return tokens(element.getAttribute("class") ?? "").has(token);
}

/** Jedyny `<svg>` w renderze - atom ikony nie ma prawa dać zera ani dwóch. */
function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  expect(container.querySelectorAll("svg"), "atom musi wyrenderować jedną ikonę").toHaveLength(1);
  if (svg === null) throw new Error("render atomu nie zawiera ikony SVG");
  return svg;
}

/**
 * Odcisk KSZTAŁTU ikony - klasy `lucide-*` bez klas rozmiaru z propsa.
 * Nie wpisujemy kebabowych nazw z pamięci: biblioteka je przemianowuje.
 */
function shapeOf(container: HTMLElement): string {
  const classes = (svgOf(container).getAttribute("class") ?? "").split(/\s+/);
  const shape = classes.filter((name) => name.startsWith("lucide-"));
  expect(shape.length, "SVG musi nieść klasę kształtu lucide").toBeGreaterThan(0);
  return shape.join(" ");
}

/** Odcisk ikony WZORCOWEJ wprost z lucide - wzorzec porównania. */
function shapeOfLucide(Icon: LucideIcon): string {
  const view = render(<Icon />);
  const shape = shapeOf(view.container);
  view.unmount();
  return shape;
}

/** Element główny renderu - atomy zwracają jeden węzeł albo `null`. */
function rootOf(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("atom nie wyrenderował elementu");
  return element;
}

// ===========================================================================
// ClubStatusPill - dwa słowniki statusów, jeden zestaw tonów
// ===========================================================================

/**
 * Fragment klasy rozpoznający ton. Celowo NIE cała klasa: pilnujemy
 * ZNACZENIA (neutralny / w toku / domknięty / odwołany), a nie zestawu utilsów,
 * który wolno przeformatować. Tony `neutral` i `cancelled` różnią się tylko
 * przezroczystością tła, więc dla `cancelled` odciskiem jest `line-through` -
 * to jedyna rzecz, która na ekranie mówi „odwołane”.
 */
const STATUS_TONE_MARK: Record<ClubStatusTone, string> = {
  neutral: "bg-muted/50",
  active: "bg-primary/10",
  done: "bg-emerald-500/10",
  cancelled: "line-through",
};

const ALL_STATUS_TONES: readonly ClubStatusTone[] = ["neutral", "active", "done", "cancelled"];

/** Tony rozpoznane w klasie - musi wyjść DOKŁADNIE jeden. */
function statusTonesOf(element: Element): ClubStatusTone[] {
  const set = tokens(element.getAttribute("class") ?? "");
  return ALL_STATUS_TONES.filter((tone) => set.has(STATUS_TONE_MARK[tone]));
}

describe("ClubStatusPill - pigułka statusu", () => {
  it("tabela tonów pokrywa CAŁY słownik `ClubStatusTone`", () => {
    // `Record<ClubStatusTone, string>` wymusza wpis dla nowego tonu, a ta
    // asercja wymusza dopisanie go także do listy przejeżdżanej tabelą.
    expect(ALL_STATUS_TONES).toHaveLength(Object.keys(STATUS_TONE_MARK).length);
  });

  it.each(ALL_STATUS_TONES)("ton %s daje dokładnie jeden odcisk wizualny", (tone) => {
    const { container } = render(<ClubStatusPill label="club.milestone.status" tone={tone} />);
    expect(statusTonesOf(rootOf(container))).toEqual([tone]);
  });

  it("bez propsu `tone` pigułka jest neutralna (domyślna gałąź)", () => {
    const { container } = render(<ClubStatusPill label="club.question.status" />);
    expect(statusTonesOf(rootOf(container))).toEqual(["neutral"]);
    expect(rootOf(container)).toHaveTextContent("club.question.status");
  });

  it("pigułka nie daje się ścisnąć w wąskiej kolumnie", () => {
    // `shrink-0` to nie ozdoba: pigułka statusu w wierszu harmonogramu
    // zwężona do zera przestaje być czytelna, a wiersz nie zmienia wysokości.
    const { container } = render(<ClubStatusPill label="club.milestone.status.done" tone="done" />);
    expect(hasClass(rootOf(container), "shrink-0")).toBe(true);
  });

  it("pusta etykieta nadal renderuje pigułkę - to wartość, nie brak", () => {
    const { container } = render(<ClubStatusPill label="" />);
    expect(rootOf(container).textContent).toBe("");
    expect(statusTonesOf(rootOf(container))).toEqual(["neutral"]);
  });

  it("`className` wywołującego dokłada się do tonu, nie zamiast niego", () => {
    const { container } = render(
      <ClubStatusPill label="club.milestone.status.active" tone="active" className="ml-2" />,
    );
    expect(hasClass(rootOf(container), "ml-2")).toBe(true);
    expect(statusTonesOf(rootOf(container))).toEqual(["active"]);
  });
});

describe("milestoneTone - statusy harmonogramu", () => {
  const EXPECTED: Record<(typeof CLUB_MILESTONE_STATUSES)[number], ClubStatusTone> = {
    planned: "neutral",
    active: "active",
    done: "done",
    cancelled: "cancelled",
  };

  it.each(CLUB_MILESTONE_STATUSES)("status %s dostaje swój ton", (status) => {
    expect(milestoneTone(status)).toBe(EXPECTED[status]);
  });

  it.each([
    ["pusty napis", ""],
    ["status spoza słownika (nowsza migracja)", "paused"],
    ["status z literówką", "Done"],
  ])("%s wpada w ton neutralny, nie w brak tonu", (_opis, status) => {
    expect(milestoneTone(status)).toBe("neutral");
  });
});

describe("questionTone - statusy pytań", () => {
  const EXPECTED: Record<(typeof CLUB_QUESTION_STATUSES)[number], ClubStatusTone> = {
    open: "active",
    answered: "done",
    declined: "cancelled",
    hidden: "cancelled",
  };

  it.each(CLUB_QUESTION_STATUSES)("status %s dostaje swój ton", (status) => {
    expect(questionTone(status)).toBe(EXPECTED[status]);
  });

  it.each([
    ["pusty napis", ""],
    ["status spoza słownika", "escalated"],
  ])("%s wpada w ton „w toku” - pytanie bez rozstrzygnięcia wciąż czeka", (_opis, status) => {
    expect(questionTone(status)).toBe("active");
  });

  it("odrzucone i ukryte pytanie mają TEN SAM ton - oba są domknięte bez odpowiedzi", () => {
    expect(questionTone("declined")).toBe(questionTone("hidden"));
  });
});

describe("spójność obu słowników statusów", () => {
  it("„zrobione” w harmonogramie i „odpowiedziane” w Q&A to jeden ton", () => {
    // To jest POWÓD, dla którego istnieje jeden komponent na dwa słowniki
    // (nagłówek `ClubStatusPill.tsx`). Rozjazd tonów zamieniłby ten sam stan
    // cyklu życia w dwa różne stany na ekranie.
    expect(milestoneTone("done")).toBe(questionTone("answered"));
  });

  it("„odwołane” w harmonogramie i „odrzucone” w Q&A to jeden ton", () => {
    expect(milestoneTone("cancelled")).toBe(questionTone("declined"));
  });

  it("stan otwarty NIE jest tym samym tonem co stan domknięty", () => {
    expect(questionTone("open")).not.toBe(questionTone("answered"));
  });
});

// ===========================================================================
// ClubRegimeMark - czwarta oś klubu: reżim działu
// ===========================================================================

/** Dział z jawnie ustawioną atrybucją (albo dziedziczoną). */
function grupaAtrybucji(mode: string, inherited: boolean): ClubGroupRow {
  return clubGroupRow({ attribution_mode: mode, attribution_mode_inherited: inherited });
}

/** Dział z jawnie ustawioną widocznością (albo dziedziczoną). */
function grupaWidocznosci(visibility: string, inherited: boolean): ClubGroupRow {
  return clubGroupRow({ visibility, visibility_inherited: inherited });
}

describe("isChathamGroup", () => {
  it.each([
    ["chatham ustawiony WŁASNY", "chatham", false, true],
    ["chatham ODZIEDZICZONY po klubie", "chatham", true, false],
    ["atrybucja imienna własna", "attributed", false, false],
    ["anonimy dopuszczone", "anonymous_allowed", false, false],
    // Pusty napis to w tej kolumnie DOKŁADNIE to samo, co NULL: „dziedzicz
    // z klubu" (patrz `ClubGroupPatch` w `lib/clubs/types.ts`). Wiersz RPC
    // typuje kolumnę jako `string`, więc pustka ma tu jedną reprezentację.
    ["kolumna pusta (dziedziczenie)", "", false, false],
    ["wartość spoza słownika", "half_chatham", false, false],
  ] as const)("%s -> %s", (_opis, mode, inherited, expected) => {
    expect(isChathamGroup(grupaAtrybucji(mode, inherited))).toBe(expected);
  });
});

describe("isRestrictedGroup", () => {
  it.each([
    ["prywatny WŁASNY", "private", false, true],
    ["tajny WŁASNY", "secret", false, true],
    ["prywatny ODZIEDZICZONY", "private", true, false],
    ["tajny ODZIEDZICZONY", "secret", true, false],
    ["publiczny własny", "public", false, false],
    ["dla członków własny", "members", false, false],
    ["kolumna pusta (dziedziczenie)", "", false, false],
    ["wartość spoza słownika", "unlisted", false, false],
  ] as const)("%s -> %s", (_opis, visibility, inherited, expected) => {
    expect(isRestrictedGroup(grupaWidocznosci(visibility, inherited))).toBe(expected);
  });
});

describe("hasOwnRegime", () => {
  it("dział dziedziczący WSZYSTKO nie ma własnego reżimu", () => {
    expect(hasOwnRegime(clubGroupRow())).toBe(false);
  });

  it("sam Chatham House wystarcza", () => {
    expect(hasOwnRegime(grupaAtrybucji("chatham", false))).toBe(true);
  });

  it("samo zawężenie widoczności wystarcza", () => {
    expect(hasOwnRegime(grupaWidocznosci("private", false))).toBe(true);
  });

  it("oba odstępstwa naraz nadal dają jedno „tak”", () => {
    const group = clubGroupRow({
      attribution_mode: "chatham",
      attribution_mode_inherited: false,
      visibility: "secret",
      visibility_inherited: false,
    });
    expect(hasOwnRegime(group)).toBe(true);
  });
});

describe("ClubRegimeMark - pokazujemy WYŁĄCZNIE odstępstwo", () => {
  it("dział dziedziczący ustawienia klubu nie dostaje znacznika", () => {
    const { container } = render(<ClubRegimeMark group={clubGroupRow()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Chatham House: nazwa na opakowaniu z rolą `img`, ikona `aria-hidden`", () => {
    const { container } = render(<ClubRegimeMark group={grupaAtrybucji("chatham", false)} />);
    const mark = screen.getByRole("img");
    expect(mark).toHaveAttribute("aria-label", "club.attribution.chatham");
    expect(mark).toHaveAttribute("title", "club.attribution.chatham");
    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
    expect(shapeOf(container)).toBe(shapeOfLucide(VenetianMask));
  });

  it.each(["private", "secret"] as const)(
    "zawężenie widoczności na %s niesie klucz i18n TEJ widoczności",
    (visibility) => {
      const { container } = render(<ClubRegimeMark group={grupaWidocznosci(visibility, false)} />);
      expect(screen.getByRole("img")).toHaveAttribute(
        "aria-label",
        `club.visibility.${visibility}`,
      );
      expect(shapeOf(container)).toBe(shapeOfLucide(EyeOff));
    },
  );

  it("Chatham WYGRYWA nad zawężeniem widoczności - to reguła wypowiedzi", () => {
    // Dział „Kuluary” jest prywatny I chodzi pod Chatham House. Przed
    // napisaniem czegokolwiek ważniejsze jest JAK wolno pisać, niż KTO czyta.
    const group = clubGroupRow({
      attribution_mode: "chatham",
      attribution_mode_inherited: false,
      visibility: "private",
      visibility_inherited: false,
    });
    const { container } = render(<ClubRegimeMark group={group} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "club.attribution.chatham");
    expect(shapeOf(container)).toBe(shapeOfLucide(VenetianMask));
  });

  it("bez `className` znacznik nadal ma szkielet, z `className` dokłada klasę", () => {
    const group = grupaAtrybucji("chatham", false);
    const bez = render(<ClubRegimeMark group={group} />);
    expect(hasClass(rootOf(bez.container), "inline-flex")).toBe(true);
    expect(hasClass(rootOf(bez.container), "shrink-0")).toBe(true);
    expect(hasClass(rootOf(bez.container), "ml-1")).toBe(false);
    bez.unmount();

    const z = render(<ClubRegimeMark group={group} className="ml-1" />);
    expect(hasClass(rootOf(z.container), "ml-1")).toBe(true);
    expect(hasClass(rootOf(z.container), "shrink-0")).toBe(true);
  });
});

// ===========================================================================
// ClubGroupAccent - kolor i ikona działu
// ===========================================================================

/** Zmienne CSS odczytane z faktycznie wyrenderowanego elementu. */
function accentVars(accent: string | null): { accent: string; glow: string } {
  const view = render(<div style={clubGroupAccentVars(accent)} />);
  const probe = rootOf(view.container);
  const read = {
    accent: probe.style.getPropertyValue("--club-accent"),
    glow: probe.style.getPropertyValue("--club-glow"),
  };
  view.unmount();
  return read;
}

describe("clubGroupAccentVars", () => {
  it("kolor z bazy jedzie WERBATIM i wchodzi do poświaty", () => {
    const vars = accentVars("#0f766e");
    expect(vars.accent).toBe("#0f766e");
    expect(vars.glow).toBe("color-mix(in oklab, #0f766e 20%, transparent)");
  });

  it.each([
    ["null (dział bez akcentu)", null],
    ["pusty napis", ""],
    ["same spacje", "   "],
  ])("%s dziedziczy `--primary` - `color-mix` bez koloru wywala całą regułę", (_opis, accent) => {
    const vars = accentVars(accent);
    expect(vars.accent).toBe("var(--primary)");
    expect(vars.glow).toBe("color-mix(in oklab, var(--primary) 20%, transparent)");
  });

  it("nazwa koloru CSS przechodzi bez zmian", () => {
    expect(accentVars("rebeccapurple").accent).toBe("rebeccapurple");
  });

  it("napis, który kolorem nie jest, atom przepuszcza - walidacja jest w panelu", () => {
    // Granica odpowiedzialności: atom nie zgaduje intencji redakcji. Gdyby
    // „naprawiał” wartość, panel przestałby pokazywać, że zapisano śmieć.
    const vars = accentVars("granatowy");
    expect(vars.accent).toBe("granatowy");
    expect(vars.glow).toContain("granatowy");
  });
});

describe("stałe klas działu", () => {
  it.each([
    ["CLUB_GROUP_TINT", CLUB_GROUP_TINT],
    ["CLUB_GROUP_TEXT", CLUB_GROUP_TEXT],
    ["CLUB_GROUP_EDGE", CLUB_GROUP_EDGE],
    ["CLUB_GROUP_CHIP", CLUB_GROUP_CHIP],
    ["CLUB_GROUP_CHIP_ACTIVE", CLUB_GROUP_CHIP_ACTIVE],
  ])("%s czyta zmienną ustawianą przez `clubGroupAccentVars`", (_nazwa, klasa) => {
    // Zmienna ustawiona przez atom i klasa, która jej nie używa, to awaria
    // bez żadnego objawu w konsoli: kafel po prostu wygląda jak wszystkie inne.
    expect(klasa).toContain("var(--club-accent)");
  });

  it("wariant aktywny kafla jest MOCNIEJSZY od spoczynkowego", () => {
    // Bez tej różnicy wybrany dział w szynie nie odróżnia się od pozostałych.
    expect(CLUB_GROUP_CHIP_ACTIVE).not.toBe(CLUB_GROUP_CHIP);
    expect(CLUB_GROUP_CHIP).toContain("_12%");
    expect(CLUB_GROUP_CHIP_ACTIVE).toContain("_18%");
  });

  it("tekst bierze jasność z `--foreground`, a od akcentu tylko odcień", () => {
    // Regresja opisana w nagłówku pliku: przy dominującym akcencie dział
    // z ciemnym granatem znikał w trybie ciemnym.
    expect(CLUB_GROUP_TEXT).toContain("var(--foreground)");
    expect(CLUB_GROUP_TEXT).toContain("_35%");
  });
});

describe("ClubGroupIcon", () => {
  it("ikona z bazy wygrywa nad ikoną głębokości", () => {
    const { container } = render(<ClubGroupIcon icon="zap" />);
    expect(shapeOf(container)).toBe(shapeOfLucide(Zap));
  });

  it.each([
    ["bez propsu `depth` (gałąź domyślna)", undefined, Layers],
    ["poziom 0", 0, Layers],
    ["poziom 1", 1, FolderTree],
    ["poziom 2", 2, Folder],
    ["poziom poza skalą", 7, Folder],
  ] as const)("dział bez ikony na %s dostaje kształt głębokości", (_opis, depth, Expected) => {
    const { container } = render(<ClubGroupIcon icon={null} depth={depth} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(Expected));
  });

  it("sam biały znak w kolumnie `icon` liczy się jako brak ikony", () => {
    const { container } = render(<ClubGroupIcon icon="   " depth={1} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(FolderTree));
  });

  it("nazwa ikony spoza kurowanego zestawu NIE spada na ikonę głębokości", async () => {
    // Gdyby spadała, dział z egzotyczną ikoną wyglądałby jak dział bez ikony,
    // a redakcja nie miałaby jak zauważyć, że wybór nie działa.
    //
    // TIMEOUT 10 s, nie domyślna sekunda: ikona spoza kuracji jedzie przez
    // `Suspense` + `lazy(() => import("./DynamicIconFull"))`, a ten chunk
    // wciąga PEŁNY zestaw lucide. Pod pełną równoległością pakietu samo
    // przetworzenie tego modułu w jsdom potrafi przekroczyć sekundę - i tylko
    // wtedy ten test padał. To koszt transformacji, nie regresja atomu.
    const { container } = render(<ClubGroupIcon icon="venetian-mask" depth={0} />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(shapeOf(container)).not.toBe(shapeOfLucide(Layers));
  }, 15_000);

  it("rozmiar zostaje po stronie wołającego, szkielet po stronie atomu", () => {
    const { container } = render(<ClubGroupIcon icon={null} className="h-7 w-7" />);
    const svg = svgOf(container);
    expect(hasClass(svg, "shrink-0")).toBe(true);
    expect(hasClass(svg, "h-7")).toBe(true);
    expect(hasClass(svg, "h-4")).toBe(false);
  });
});

// ===========================================================================
// ClubHoverAction - ikona, która na najechaniu rozwija etykietę
// ===========================================================================

describe("clubHoverActionClass", () => {
  it("wołanie BEZ argumentu daje to samo co `{}` - `options ?? {}`", () => {
    expect(clubHoverActionClass()).toBe(clubHoverActionClass({}));
  });

  it("geometria powłoki jest wspólna dla przycisku i odnośnika", () => {
    // Wydzielenie tych klas ma sens tylko wtedy, gdy trzymają WYSOKOŚĆ
    // i ognisko - rozjazd h-7 między `<button>` a `<Link>` rozwala rząd akcji.
    const set = tokens(clubHoverActionClass());
    expect(set.has("h-7")).toBe(true);
    expect(set.has("inline-flex")).toBe(true);
    expect(set.has("rounded-lg")).toBe(true);
    expect(set.has("focus-visible:ring-2")).toBe(true);
  });

  it("stan spoczynkowy jest przezroczysty i reaguje na najechanie", () => {
    const set = tokens(clubHoverActionClass());
    expect(set.has("bg-transparent")).toBe(true);
    expect(set.has("hover:border-primary/40")).toBe(true);
    expect(set.has("bg-primary/10")).toBe(false);
  });

  it("stan aktywny jest wypełniony i NIE udaje spoczynku", () => {
    const set = tokens(clubHoverActionClass({ active: true }));
    expect(set.has("bg-primary/10")).toBe(true);
    expect(set.has("text-primary")).toBe(true);
    expect(set.has("bg-transparent")).toBe(false);
  });

  it("`active: false` podane jawnie to nadal spoczynek", () => {
    expect(clubHoverActionClass({ active: false })).toBe(clubHoverActionClass());
  });

  it("`disabled` odcina kliknięcie, nie tylko przygasza", () => {
    // `opacity-50` bez `pointer-events-none` daje przycisk, który wygląda na
    // wyłączony i nadal działa - to najgorszy z możliwych stanów.
    const set = tokens(clubHoverActionClass({ disabled: true }));
    expect(set.has("pointer-events-none")).toBe(true);
    expect(set.has("opacity-50")).toBe(true);
  });

  it("`disabled: false` podane jawnie nie odcina niczego", () => {
    expect(tokens(clubHoverActionClass({ disabled: false })).has("pointer-events-none")).toBe(
      false,
    );
  });

  it("`className` wywołującego dokłada się do geometrii", () => {
    const set = tokens(clubHoverActionClass({ className: "ml-2" }));
    expect(set.has("ml-2")).toBe(true);
    expect(set.has("h-7")).toBe(true);
  });

  it("trzy opcje naraz sumują się, żadna nie zjada pozostałych", () => {
    const set = tokens(clubHoverActionClass({ active: true, disabled: true, className: "mt-1" }));
    expect(set.has("bg-primary/10")).toBe(true);
    expect(set.has("pointer-events-none")).toBe(true);
    expect(set.has("mt-1")).toBe(true);
  });
});

describe("ClubHoverActionBody", () => {
  /** Powłoka + wnętrze - tak, jak składa je karta strumienia. */
  function renderAction(props: { count?: number; expanded?: boolean }) {
    return render(
      <button type="button" className={clubHoverActionClass()}>
        <ClubHoverActionBody
          icon={Heart}
          label="club.action.react"
          count={props.count}
          expanded={props.expanded}
        />
      </button>,
    );
  }

  it("etykieta zostaje w DOM także w spoczynku - czytnik ekranu ją widzi", () => {
    const { container } = renderAction({});
    expect(screen.getByText("club.action.react")).toBeInTheDocument();
    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("bez propsu `expanded` etykieta jest zwinięta i rozwija się na hover/focus", () => {
    const { container } = renderAction({});
    const grid = container.querySelector(".grid");
    expect(grid).not.toBeNull();
    if (grid === null) throw new Error("brak siatki rozwijającej etykietę");
    expect(hasClass(grid, "grid-cols-[0fr]")).toBe(true);
    expect(hasClass(grid, "group-hover/act:grid-cols-[1fr]")).toBe(true);
    expect(hasClass(grid, "group-focus-visible/act:grid-cols-[1fr]")).toBe(true);
  });

  it("`expanded` wymusza rozwinięcie i zdejmuje stan zwinięty", () => {
    const { container } = renderAction({ expanded: true });
    const grid = container.querySelector(".grid");
    if (grid === null) throw new Error("brak siatki rozwijającej etykietę");
    expect(hasClass(grid, "grid-cols-[1fr]")).toBe(true);
    expect(hasClass(grid, "grid-cols-[0fr]")).toBe(false);
    expect(hasClass(grid, "motion-reduce:transition-none")).toBe(true);
  });

  it("licznik bez wartości nie rysuje plakietki", () => {
    const { container } = renderAction({});
    expect(container.querySelector(".tabular-nums")).toBeNull();
  });

  it("`count = 0` to brak dyskusji, nie plakietka „0”", () => {
    const { container } = renderAction({ count: 0 });
    expect(container.querySelector(".tabular-nums")).toBeNull();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("licznik od jedynki jest widoczny i `aria-hidden` (liczba stoi w etykiecie)", () => {
    const { container } = renderAction({ count: 4 });
    const badge = container.querySelector(".tabular-nums");
    expect(badge).not.toBeNull();
    if (badge === null) throw new Error("brak licznika");
    expect(badge.textContent).toBe("4");
    expect(badge).toHaveAttribute("aria-hidden", "true");
  });
});

// ===========================================================================
// ClubTopicChip - obszar tematyczny
// ===========================================================================

const SIZE_MARK: Record<ClubTopicChipSize, string> = { sm: "px-2", md: "px-2.5" };
const TOPIC_TONE_MARK: Record<ClubTopicChipTone, string> = {
  quiet: "bg-muted/40",
  active: "bg-primary",
  outline: "bg-primary/5",
};

const ALL_SIZES: readonly ClubTopicChipSize[] = ["sm", "md"];
const ALL_TOPIC_TONES: readonly ClubTopicChipTone[] = ["quiet", "active", "outline"];

/** Katalog organizacji - etykiety są NASZE, więc wolno je asertować. */
const KATALOG: readonly ClubTopicOption[] = [
  { key: "energy", label_pl: "Energia-PL", label_en: "Energy-EN", sort_order: 10 },
  { key: "widmo", label_pl: "", label_en: "", sort_order: 20 },
];

/** Etykieta z listy awaryjnej - liczona ze stałej, nie wpisana z pamięci. */
function etykietaAwaryjna(key: string): string {
  const hit = CLUB_TOPIC_FALLBACK.find((option) => option.key === key);
  if (hit === undefined) throw new Error(`test: brak ${key} na liście awaryjnej`);
  return hit.label_pl;
}

describe("clubTopicChipClass", () => {
  it("wywołanie bez argumentów daje rozmiar `md` i ton `quiet`", () => {
    expect(clubTopicChipClass()).toBe(clubTopicChipClass("md", "quiet"));
  });

  it.each(ALL_SIZES.flatMap((size) => ALL_TOPIC_TONES.map((tone) => [size, tone] as const)))(
    "rozmiar %s + ton %s: oba odciski w jednej klasie",
    (size, tone) => {
      const set = tokens(clubTopicChipClass(size, tone));
      expect(set.has(SIZE_MARK[size])).toBe(true);
      expect(set.has(TOPIC_TONE_MARK[tone])).toBe(true);
    },
  );

  it("skala mobilna nie schodzi poniżej 11 px w żadnym rozmiarze", () => {
    // Nagłówek atomu stawia to jako granicę czytelności na telefonie.
    for (const size of ALL_SIZES) {
      expect(tokens(clubTopicChipClass(size)).has("text-[11px]")).toBe(true);
    }
  });

  it("szkielet chipa jest wspólny dla wszystkich wariantów", () => {
    const set = tokens(clubTopicChipClass("sm", "outline"));
    expect(set.has("inline-flex")).toBe(true);
    expect(set.has("rounded-lg")).toBe(true);
    expect(set.has("shrink-0")).toBe(true);
    expect(set.has("max-w-full")).toBe(true);
  });
});

describe("ClubTopicChip", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty napis", ""],
    ["same spacje", "   "],
  ] as const)("obszar %s nie rysuje chipa", (_opis, topic) => {
    const { container } = render(<ClubTopicChip topic={topic} lang="pl" catalog={KATALOG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("obszar z katalogu organizacji dostaje etykietę z katalogu", () => {
    render(<ClubTopicChip topic="energy" lang="pl" catalog={KATALOG} />);
    expect(screen.getByText("Energia-PL")).toBeInTheDocument();
  });

  it("język przełącza kolumnę etykiety", () => {
    render(<ClubTopicChip topic="energy" lang="en" catalog={KATALOG} />);
    expect(screen.getByText("Energy-EN")).toBeInTheDocument();
  });

  it("bez katalogu (pierwszy render, SSR) chip bierze etykietę z listy awaryjnej", () => {
    // Gałąź `catalog ?? []`: select nigdy nie jest pusty, a chip nie mruga.
    render(<ClubTopicChip topic="energy" lang="pl" />);
    expect(screen.getByText(etykietaAwaryjna("energy"))).toBeInTheDocument();
  });

  it("stary klucz spoza taksonomii nie znika z interfejsu", () => {
    render(<ClubTopicChip topic="kwantowa_polityka" lang="pl" catalog={[]} />);
    expect(screen.getByText("kwantowa_polityka")).toBeInTheDocument();
  });

  it("obszar bez etykiety w ŻADNYM języku nie rysuje pustego chipa", () => {
    // Redakcja dodała obszar i nie opisała go - puste kółko obok tytułu
    // wątku wygląda jak błąd renderowania.
    const { container } = render(<ClubTopicChip topic="widmo" lang="pl" catalog={KATALOG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ikona jest domyślnie i daje się zdjąć", () => {
    const z = render(<ClubTopicChip topic="energy" lang="pl" catalog={KATALOG} />);
    expect(shapeOf(z.container)).toBe(shapeOfLucide(Tag));
    expect(svgOf(z.container)).toHaveAttribute("aria-hidden", "true");
    z.unmount();

    const bez = render(
      <ClubTopicChip topic="energy" lang="pl" catalog={KATALOG} showIcon={false} />,
    );
    expect(bez.container.querySelector("svg")).toBeNull();
    expect(screen.getByText("Energia-PL")).toBeInTheDocument();
  });

  it("bez `onSelect` chip jest STATYCZNY - obszar jest ustalony, nie ma czego przełączać", () => {
    const { container } = render(<ClubTopicChip topic="energy" lang="pl" catalog={KATALOG} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(rootOf(container).tagName).toBe("SPAN");
    expect(rootOf(container)).toHaveAttribute("data-club-topic", "energy");
  });

  it("z `onSelect` chip zawęża strumień do swojego obszaru", () => {
    const onSelect = vi.fn();
    render(<ClubTopicChip topic="energy" lang="pl" catalog={KATALOG} onSelect={onSelect} />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveAttribute("title", "club.topic.filterHint");
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("energy");
  });

  it("ponowne kliknięcie ZDEJMUJE filtr, nie ustawia go po raz drugi", () => {
    const onSelect = vi.fn();
    render(
      <ClubTopicChip
        topic="energy"
        lang="pl"
        catalog={KATALOG}
        onSelect={onSelect}
        active={true}
      />,
    );
    const chip = screen.getByRole("button");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("`active` WYGRYWA nad `tone` - wybrany obszar wygląda tak samo wszędzie", () => {
    const { container } = render(
      <ClubTopicChip topic="energy" lang="pl" catalog={KATALOG} tone="outline" active={true} />,
    );
    const chip = rootOf(container);
    expect(hasClass(chip, TOPIC_TONE_MARK.active)).toBe(true);
    expect(hasClass(chip, TOPIC_TONE_MARK.outline)).toBe(false);
  });

  it("bez `active` chip trzyma ton podany przez wywołującego", () => {
    const { container } = render(
      <ClubTopicChip topic="energy" lang="pl" catalog={KATALOG} tone="outline" />,
    );
    expect(hasClass(rootOf(container), TOPIC_TONE_MARK.outline)).toBe(true);
  });

  it("rozmiar i `className` wywołującego dochodzą do chipa", () => {
    const { container } = render(
      <ClubTopicChip topic="energy" lang="pl" catalog={KATALOG} size="sm" className="mt-1" />,
    );
    const chip = rootOf(container);
    expect(hasClass(chip, SIZE_MARK.sm)).toBe(true);
    expect(hasClass(chip, "mt-1")).toBe(true);
  });

  it("wartość obszaru jedzie do `onSelect` WERBATIM - normalizuje wywołujący", () => {
    // `data-club-topic` i argument zwrotki muszą być tą samą wartością, jaką
    // wywołujący ma w stanie filtra; przycinanie po drodze dałoby filtr,
    // który nigdy nie zgadza się z listą.
    const onSelect = vi.fn();
    const { container } = render(
      <ClubTopicChip topic="  energy  " lang="pl" catalog={KATALOG} onSelect={onSelect} />,
    );
    expect(rootOf(container)).toHaveAttribute("data-club-topic", "  energy  ");
    expect(screen.getByText("Energia-PL")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("  energy  ");
  });
});

describe("ClubTopicFilterChip", () => {
  it("nieaktywny filtr jest cichy i ogłasza swój stan", () => {
    const { container } = render(
      <ClubTopicFilterChip active={false} onClick={() => {}}>
        club.hub.allTopics
      </ClubTopicFilterChip>,
    );
    const chip = screen.getByRole("button");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(hasClass(rootOf(container), TOPIC_TONE_MARK.quiet)).toBe(true);
    expect(chip).toHaveTextContent("club.hub.allTopics");
  });

  it("aktywny filtr jest wypełniony i ogłasza wybór", () => {
    const { container } = render(
      <ClubTopicFilterChip active={true} onClick={() => {}}>
        club.hub.allTopics
      </ClubTopicFilterChip>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(hasClass(rootOf(container), TOPIC_TONE_MARK.active)).toBe(true);
  });

  it("kliknięcie woła zwrotkę dokładnie raz", () => {
    const onClick = vi.fn();
    render(
      <ClubTopicFilterChip active={false} onClick={onClick}>
        club.hub.allTopics
      </ClubTopicFilterChip>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("domyślny rozmiar to `md`, podany rozmiar wygrywa, `className` się dokłada", () => {
    const domyslny = render(
      <ClubTopicFilterChip active={false} onClick={() => {}}>
        x
      </ClubTopicFilterChip>,
    );
    expect(hasClass(rootOf(domyslny.container), SIZE_MARK.md)).toBe(true);
    domyslny.unmount();

    const maly = render(
      <ClubTopicFilterChip active={false} onClick={() => {}} size="sm" className="ml-1">
        x
      </ClubTopicFilterChip>,
    );
    expect(hasClass(rootOf(maly.container), SIZE_MARK.sm)).toBe(true);
    expect(hasClass(rootOf(maly.container), "ml-1")).toBe(true);
  });

  it("filtr i chip statyczny mają WSPÓLNY kształt", () => {
    // Nagłówek atomu deklaruje to wprost: „ten sam kształt co statyczny”.
    const filtr = render(
      <ClubTopicFilterChip active={false} onClick={() => {}}>
        x
      </ClubTopicFilterChip>,
    );
    const filtrKlasy = tokens(rootOf(filtr.container).getAttribute("class") ?? "");
    filtr.unmount();
    for (const token of tokens(clubTopicChipClass("md", "quiet"))) {
      expect(filtrKlasy.has(token), `filtr musi nieść ${token}`).toBe(true);
    }
  });
});

// ===========================================================================
// ClubThreadHeat - cztery słupki dynamiki
// ===========================================================================

/** Tempo sformatowane tak, jak robi to komponent (niezależnie od lokalizacji). */
function tempo(perDay: number): string {
  return perDay.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

const MINUTA_DOBY = 24 * 60;

/** Wątek o zadanej dynamice - dni liczone od `CLUB_BASE_ISO`. */
function watek(params: {
  dniOdZalozenia: number;
  godzinCiszy: number | null;
  odpowiedzi: number;
  uczestnicy: number;
}) {
  return clubThreadListRow({
    created_at: clubIsoOffset(-params.dniOdZalozenia * MINUTA_DOBY),
    last_reply_at: params.godzinCiszy === null ? null : clubIsoOffset(-params.godzinCiszy * 60),
    reply_count: params.odpowiedzi,
    participant_count: params.uczestnicy,
  });
}

function heatOf(): HTMLElement {
  return screen.getByTestId("club-thread-heat");
}

/** Liczba WYPEŁNIONYCH słupków - jedyny nośnik poziomu niezależny od koloru. */
function wypelnioneSlupki(container: HTMLElement): number {
  const bars = container.querySelectorAll("span[style]");
  expect(bars, "wskaźnik ma zawsze cztery słupki").toHaveLength(4);
  return Array.from(bars).filter((bar) => !hasClass(bar, "bg-muted")).length;
}

describe("ClubThreadHeat", () => {
  beforeEach(() => {
    // Komponent woła `computeThreadPulse` BEZ `now`, więc czas musi stać.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(CLUB_BASE_ISO));
  });

  afterEach(() => {
    vi.useRealTimers();
    pulseOverride.level = null;
  });

  it.each([
    ["uśpiony", { dniOdZalozenia: 10, godzinCiszy: null, odpowiedzi: 0, uczestnicy: 0 }, 0],
    ["wolny", { dniOdZalozenia: 20, godzinCiszy: 100, odpowiedzi: 10, uczestnicy: 2 }, 1],
    ["miarowy", { dniOdZalozenia: 10, godzinCiszy: 100, odpowiedzi: 20, uczestnicy: 2 }, 2],
    ["aktywny", { dniOdZalozenia: 10, godzinCiszy: 100, odpowiedzi: 20, uczestnicy: 3 }, 3],
    ["gorący", { dniOdZalozenia: 10, godzinCiszy: 100, odpowiedzi: 60, uczestnicy: 3 }, 4],
  ] as const)("wątek %s: poziom = liczba wypełnionych słupków", (_opis, dane, poziom) => {
    const { container } = render(<ClubThreadHeat thread={watek(dane)} />);
    expect(heatOf()).toHaveAttribute("data-level", String(poziom));
    expect(wypelnioneSlupki(container)).toBe(poziom);
  });

  it("skala ma sufit - wątek ponad miarę nadal ma cztery słupki, nie pięć", () => {
    const { container } = render(
      <ClubThreadHeat
        thread={watek({ dniOdZalozenia: 10, godzinCiszy: 1, odpowiedzi: 60, uczestnicy: 5 })}
      />,
    );
    expect(heatOf()).toHaveAttribute("data-level", "4");
    expect(wypelnioneSlupki(container)).toBe(4);
  });

  it("tooltip i `aria-label` to TEN SAM napis - klucz i18n z tempem i ciszą", () => {
    render(
      <ClubThreadHeat
        thread={watek({ dniOdZalozenia: 20, godzinCiszy: 100, odpowiedzi: 10, uczestnicy: 2 })}
      />,
    );
    const oczekiwany = `club.heat.tooltip(hours=100,perDay=${tempo(0.5)},state=club.heat.slow)`;
    expect(heatOf()).toHaveAttribute("title", oczekiwany);
    expect(heatOf()).toHaveAttribute("aria-label", oczekiwany);
  });

  it("nieczytelna data założenia daje ciszę 0, a nie „null godzin”", () => {
    // Gałąź `pulse.hoursSinceActivity ?? 0`: bez niej tooltip mówiłby
    // „ostatni głos null godzin temu”.
    render(
      <ClubThreadHeat
        thread={clubThreadListRow({
          created_at: "brak-daty",
          last_reply_at: null,
          reply_count: 0,
          participant_count: 0,
        })}
      />,
    );
    expect(heatOf()).toHaveAttribute(
      "title",
      `club.heat.tooltip(hours=0,perDay=${tempo(0)},state=club.heat.dormant)`,
    );
  });

  it("bez propsu `showLabel` obok słupków nie ma podpisu (wiersz listy)", () => {
    render(
      <ClubThreadHeat
        thread={watek({ dniOdZalozenia: 10, godzinCiszy: 100, odpowiedzi: 20, uczestnicy: 2 })}
      />,
    );
    expect(screen.queryByText("club.heat.steady")).not.toBeInTheDocument();
  });

  it("`showLabel` dokłada podpis stanu kluczem i18n (układ kart)", () => {
    render(
      <ClubThreadHeat
        thread={watek({ dniOdZalozenia: 10, godzinCiszy: 100, odpowiedzi: 20, uczestnicy: 2 })}
        showLabel={true}
      />,
    );
    expect(screen.getByText("club.heat.steady")).toBeInTheDocument();
  });

  it("słupki są `aria-hidden` - stan niesie opakowanie, nie cztery kreski", () => {
    const { container } = render(
      <ClubThreadHeat
        thread={watek({ dniOdZalozenia: 10, godzinCiszy: 100, odpowiedzi: 20, uczestnicy: 2 })}
      />,
    );
    const bars = container.querySelector("span[aria-hidden='true']");
    expect(bars).not.toBeNull();
  });

  it("poziom spoza dzisiejszej skali nadal dostaje KLASĘ, nie `undefined`", () => {
    // Bezpiecznik `FILL[level] ?? "bg-primary"`. Dziś nieosiągalny (level
    // 0-4), ale ma znaczyć w dniu, w którym `THREAD_HEAT_LEVELS` urośnie
    // bez dopisania koloru: wtedy słupek dostałby `class="... undefined"`,
    // czyli słupek NIEWIDOCZNY na ekranie i zero śladu w konsoli.
    pulseOverride.level = 9;
    const { container } = render(
      <ClubThreadHeat
        thread={watek({ dniOdZalozenia: 10, godzinCiszy: 100, odpowiedzi: 20, uczestnicy: 2 })}
      />,
    );
    expect(heatOf()).toHaveAttribute("data-level", "9");
    const bars = Array.from(container.querySelectorAll("span[style]"));
    expect(bars).toHaveLength(4);
    for (const bar of bars) {
      const klasa = bar.getAttribute("class") ?? "";
      expect(klasa, "słupek nie ma prawa dostać klasy `undefined`").not.toContain("undefined");
      expect(hasClass(bar, "bg-primary"), "każdy słupek jest wypełniony").toBe(true);
    }
  });

  it("bez `className` szkielet zostaje, z `className` klasa się dokłada", () => {
    const dane = { dniOdZalozenia: 10, godzinCiszy: 100, odpowiedzi: 20, uczestnicy: 2 } as const;
    const bez = render(<ClubThreadHeat thread={watek(dane)} />);
    expect(hasClass(heatOf(), "inline-flex")).toBe(true);
    expect(hasClass(heatOf(), "ml-2")).toBe(false);
    bez.unmount();

    render(<ClubThreadHeat thread={watek(dane)} className="ml-2" />);
    expect(hasClass(heatOf(), "inline-flex")).toBe(true);
    expect(hasClass(heatOf(), "ml-2")).toBe(true);
  });
});

// ===========================================================================
// ClubHubAccessBadge - stan dostępu do klubów
// ===========================================================================

const ACCESS_ICON: Record<ClubHubAccess, LucideIcon> = {
  member: ShieldCheck,
  invited: MailCheck,
  entitled: KeyRound,
  locked: Lock,
};

const ALL_ACCESS: readonly ClubHubAccess[] = ["member", "invited", "entitled", "locked"];

describe("ClubHubAccessBadge", () => {
  it("tabela ikon pokrywa CAŁY słownik `ClubHubAccess`", () => {
    expect(ALL_ACCESS).toHaveLength(Object.keys(ACCESS_ICON).length);
  });

  it.each(ALL_ACCESS)("stan %s dostaje klucz i18n i SWOJĄ ikonę", (access) => {
    const { container } = render(<ClubHubAccessBadge access={access} />);
    expect(screen.getByText(`club.hub.access.${access}`)).toBeInTheDocument();
    expect(shapeOf(container)).toBe(shapeOfLucide(ACCESS_ICON[access]));
  });

  it("„zamknięty” to wariant obrysowany, każdy inny stan jest wypełniony", () => {
    // Zamknięty dostęp NIE jest stanem osiągniętym - nie wolno mu wyglądać
    // jak plakietka członka. Reszta stanów mówi „coś już masz”.
    const zamkniety = render(<ClubHubAccessBadge access="locked" />);
    expect(hasClass(rootOf(zamkniety.container), "bg-secondary")).toBe(false);
    zamkniety.unmount();

    for (const access of ALL_ACCESS.filter((value) => value !== "locked")) {
      const view = render(<ClubHubAccessBadge access={access} />);
      expect(hasClass(rootOf(view.container), "bg-secondary"), access).toBe(true);
      view.unmount();
    }
  });

  it("ikona i napis są jedną plakietką, nie dwoma bytami obok siebie", () => {
    const { container } = render(<ClubHubAccessBadge access="member" />);
    const badge = rootOf(container);
    expect(hasClass(badge, "gap-1.5")).toBe(true);
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge).toHaveTextContent("club.hub.access.member");
  });
});
