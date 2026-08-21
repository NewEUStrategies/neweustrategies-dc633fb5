// Atomy identyfikacji wizualnej klubu: awatar autora i ikony rodzajów wpisów.
//
// CO TO DOWODZI.
// (1) `ClubAuthorAvatar` ma DWIE ścieżki, które muszą wyglądać jak jedna
//     rzecz: zdjęcie i inicjały. Kolumna odpowiedzi mieszająca kwadraty 28 px
//     ze kwadratami 36 px albo tracąca `rounded-lg` przy fallbacku rozjeżdża
//     rytm całej dyskusji, więc test pilnuje WSPÓLNEGO szkieletu (rozmiar,
//     promień, obwódka, `shrink-0`) po obu stronach warunku, a nie tylko tego,
//     że „coś się wyrenderowało”.
// (2) Reguła inicjałów (pierwsza litera pierwszego słowa + pierwsza litera
//     OSTATNIEGO) jest jedynym miejscem, w którym produkt zgaduje tożsamość
//     z napisu. Funkcja `initials` jest modułowa (nieeksportowana), więc jedzie
//     tabelą PRZEZ komponent: jedno słowo, dwa, trzy, puste, same spacje,
//     diakrytyki, adres e-mail, znak niealfabetyczny na początku, same cyfry.
//     Bez tej tabeli „?” dla pustej nazwy i „ŁŻ” dla „Łukasz Żółć” to
//     przypadek, a nie kontrakt - a nazwy anonimów i kont usuniętych przechodzą
//     tu przez słownik i18n, więc mogą być dowolnym napisem.
// (3) Awatar jest `aria-hidden` po OBU stronach warunku, bo imię stoi obok
//     niego w tym samym wierszu - czytnik ekranu, który przeczyta je dwa razy,
//     zamienia listę uczestników w echo.
// (4) `ClubEntryIcon` to JEDYNE mapowanie rodzaj -> kształt. Test jedzie
//     pełnymi słownikami (`CLUB_THREAD_DOCUMENT_KINDS`, `CLUB_MILESTONE_KINDS`,
//     `CLUB_WORKSPACE_SECTIONS`) i sprawdza, że każdy rodzaj dostaje kształt
//     WYPISANY W TEŚCIE z nazwy komponentu lucide - `Record<Kind, typeof
//     FileText>` pilnuje tylko, żeby COŚ tam było, więc zbiór danych z ikoną
//     dymka przeszedłby recenzję kodu niezauważony. Odcisk kształtu bierzemy
//     z klas `lucide-*` faktycznie wyrenderowanego SVG, porównując go z
//     RENDEREM ikony wzorcowej - dzięki temu test nie zna kebabowych nazw
//     lucide na pamięć i przeżywa zmianę nazwy ikony w bibliotece, a nadal
//     oblewa podmianę `Database` na `FileText`.
// (5) Wartość rodzaju spoza słownika (nowsza migracja, stary wiersz) dochodzi
//     do atomu WYŁĄCZNIE przez zawężenia `toClubDocumentKind`/
//     `toClubMilestoneKind`/`toClubWorkspaceSection` - tak robią wszyscy trzej
//     wywołujący (`ClubDocumentRow`, `ClubMilestoneRow`,
//     `ClubThreadFinderPanel`). Dlatego degradacja jest testowana PRZEZ te
//     zawężenia: „legacy_pdf” ma dać ikonę domyślną, a nie pusty kafel.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - Nie podaje atomom ikon wartości spoza unii literałów BEZ zawężenia: taki
//   test wymagałby rzutowania, którego reguły repozytorium zabraniają, a bez
//   rzutowania kompilator to blokuje. Dowód degradacji leży w zawężeniach
//   (punkt 5) i w ich własnych testach kontraktu słowników.
// - Nie testuje samego `lucide-react` (kształt ścieżek SVG) ani `DynamicIcon`
//   (rozwiązywanie nazw, doładowanie pełnego rejestru) - to biblioteka i osobny
//   moduł z własnymi testami.
// - Nie sprawdza, czy `avatarUrl` naprawdę się ładuje ani czy adres jest
//   bezpieczny: atom go tylko przepisuje, a `loading="lazy"` jest tu jedyną
//   regułą wydajnościową, którą atom sam wnosi.
// - Nie dubluje `clubThreadKindIcon`/`ClubThreadKindIcon` - te mieszkają
//   w `clubThreadKindIcon.test.ts`.
//
// GRANICA POMIARU (ClubAuthorAvatar.tsx, gałęzie 15/17 = 88,2%). Dwa prawe
// ramiona `?? ""` w `initials` (linia 23 i wnętrze linii 24) są NIEOSIĄGALNE
// w czasie wykonania: `parts` powstaje przez `.filter(Boolean)`, więc każdy jego
// element jest napisem NIEPUSTYM, a `str[0]` napisu niepustego nigdy nie jest
// `undefined`. Te dwa `??` istnieją wyłącznie dla `noUncheckedIndexedAccess`
// w kompilatorze. Wejście, które by je odpaliło, nie istnieje - dałoby się je
// „pokryć” jedynie rzutowaniem (zakaz) albo zmianą kodu produkcyjnego (nie ten
// etap). Pozostałe 15 gałęzi pliku jest pokryte, a instrukcje/linie/funkcje
// stoją na 100%.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  CalendarClock,
  CalendarDays,
  Database,
  FileText,
  Gavel,
  Link2,
  MessageSquare,
  Mic,
  Milestone,
  Newspaper,
  NotebookPen,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import {
  ClubDocumentIcon,
  ClubMilestoneIcon,
  ClubSectionIcon,
} from "@/components/clubs/atoms/ClubEntryIcon";
import {
  CLUB_MILESTONE_KINDS,
  CLUB_THREAD_DOCUMENT_KINDS,
  CLUB_WORKSPACE_SECTIONS,
  toClubDocumentKind,
  toClubMilestoneKind,
  toClubWorkspaceSection,
  type ClubMilestoneKind,
  type ClubThreadDocumentKind,
  type ClubWorkspaceSection,
} from "@/lib/clubs/workspaceTypes";

// ---------------------------------------------------------------------------
// Narzędzia rozpoznawania KSZTAŁTU ikony
//
// `lucide-react` znaczy każdy SVG klasą `lucide-<nazwa-kebab>`. Nie wpisujemy
// tych nazw do testu z pamięci (biblioteka je przemianowuje - `Users2` jest
// dziś aliasem `UsersRound`), tylko renderujemy ikonę WZORCOWĄ i porównujemy
// odciski. Test mówi więc „zbiór danych ma ikonę Database”, a nie „ma klasę
// lucide-database”.
// ---------------------------------------------------------------------------

/** Jedyny <svg> w renderze - atom ikony nie ma prawa dać zera ani dwóch. */
function svgOf(container: HTMLElement): SVGSVGElement {
  const all = container.querySelectorAll("svg");
  expect(all, "atom ikony musi wyrenderować DOKŁADNIE jedną ikonę").toHaveLength(1);
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("render atomu nie zawiera ikony SVG");
  return svg;
}

/** Odcisk kształtu: klasy `lucide-*` bez klas rozmiaru z propsa. */
function shapeOf(container: HTMLElement): string {
  const classes = (svgOf(container).getAttribute("class") ?? "").split(/\s+/);
  const shape = classes.filter((name) => name.startsWith("lucide-"));
  expect(shape.length, "SVG musi nieść klasę kształtu lucide").toBeGreaterThan(0);
  return shape.join(" ");
}

/** Odcisk ikony wzorcowej wprost z lucide - wzorzec porównania. */
function shapeOfLucide(Icon: LucideIcon): string {
  const view = render(<Icon />);
  const shape = shapeOf(view.container);
  view.unmount();
  return shape;
}

/** Element główny awatara - `<img>` albo `<span>` z inicjałami. */
function avatarBox(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("awatar nie wyrenderował elementu");
  return element;
}

const AVATAR_URL = "https://cdn.example.org/klub/anna.webp";

describe("ClubAuthorAvatar - zdjęcie kontra inicjały", () => {
  it("z adresem zdjęcia renderuje <img> z tym adresem i leniwym ładowaniem", () => {
    // `loading="lazy"` nie jest ozdobą: lista uczestników wątku pokazuje
    // kilkadziesiąt awatarów, z których widać trzy.
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" avatarUrl={AVATAR_URL} />);
    const box = avatarBox(container);
    expect(box.tagName).toBe("IMG");
    expect(box.getAttribute("src")).toBe(AVATAR_URL);
    expect(box.getAttribute("loading")).toBe("lazy");
    expect(box.className).toContain("object-cover");
    expect(container.textContent).toBe("");
  });

  it("zdjęcie jest niewidoczne dla czytnika ekranu - imię stoi obok w wierszu", () => {
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" avatarUrl={AVATAR_URL} />);
    const box = avatarBox(container);
    expect(box.getAttribute("alt")).toBe("");
    expect(box.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    { label: "null (brak zdjęcia w bazie)", avatarUrl: null },
    { label: "undefined (prop nieprzekazany wprost)", avatarUrl: undefined },
    { label: "pusty napis (kolumna wyczyszczona, nie NULL)", avatarUrl: "" },
  ])("$label degraduje się do inicjałów, nie do pustego kwadratu", ({ avatarUrl }) => {
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" avatarUrl={avatarUrl} />);
    const box = avatarBox(container);
    expect(box.tagName).toBe("SPAN");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("AN");
  });

  it("bez propsa `avatarUrl` wchodzi ta sama ścieżka inicjałów", () => {
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" />);
    expect(avatarBox(container).tagName).toBe("SPAN");
    expect(container.textContent).toBe("AN");
  });

  it("inicjały są niewidoczne dla czytnika ekranu, tak jak zdjęcie", () => {
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" />);
    expect(avatarBox(container).getAttribute("aria-hidden")).toBe("true");
  });

  it("`muted` NIE blokuje zdjęcia - o pominięciu awatara decyduje wywołujący", () => {
    // Regresja, którą to łapie: „anonim nie dostaje zdjęcia” jest regułą
    // WYWOŁUJĄCEGO (`ClubParticipantRow` podaje `avatar_url` z projekcji RPC,
    // która anonimowi zeruje avatar). Gdyby atom sam zaczął kasować zdjęcie
    // przy `muted`, stonowany awatar prowadzącego przestałby mieć twarz.
    const { container } = render(
      <ClubAuthorAvatar name="Anonim" avatarUrl={AVATAR_URL} muted={true} />,
    );
    expect(avatarBox(container).tagName).toBe("IMG");
  });
});

describe("ClubAuthorAvatar - reguła inicjałów", () => {
  it.each([
    { name: "Anna", expected: "A", why: "jedno słowo daje JEDNĄ literę, nie dubluje jej" },
    { name: "Anna Nowak", expected: "AN", why: "dwa słowa: pierwsze i drugie" },
    {
      name: "Jan Maria Rokita",
      expected: "JR",
      why: "trzy słowa: pierwsze i OSTATNIE, drugie imię się nie liczy",
    },
    { name: "anna nowak", expected: "AN", why: "wynik jest zawsze wersalikami" },
    {
      name: "   Anna    Nowak   ",
      expected: "AN",
      why: "wielokrotne spacje nie robią pustych słów",
    },
    { name: "Łukasz Żółć", expected: "ŁŻ", why: "diakrytyki to litery, nie znaki do wyrzucenia" },
    {
      name: "kontakt@example.com",
      expected: "KC",
      why: "adres e-mail rozpada się na słowa po @ i kropce",
    },
    { name: "@nna", expected: "N", why: "znak niealfabetyczny na początku odpada" },
    { name: "d'Alembert", expected: "DA", why: "apostrof rozcina napis na dwa słowa" },
    { name: "Kowalski (PL)", expected: "KP", why: "nawias jest separatorem, nie literą" },
    { name: "123", expected: "1", why: "cyfry są dopuszczalnym znakiem inicjału" },
    { name: "", expected: "?", why: "pusta nazwa daje znak zapytania, nie pusty kwadrat" },
    { name: "     ", expected: "?", why: "same spacje to nadal brak nazwy" },
    { name: "!!!", expected: "?", why: "napis bez ani jednej litery i cyfry to brak nazwy" },
  ])("inicjały z [$name] to [$expected] - $why", ({ name, expected }) => {
    const { container } = render(<ClubAuthorAvatar name={name} />);
    expect(container.textContent).toBe(expected);
  });
});

describe("ClubAuthorAvatar - rozmiar i ton", () => {
  it("bez propsa `size` awatar jest mały (28 px) - domyślny rozmiar strumienia", () => {
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" />);
    const className = avatarBox(container).className;
    expect(className).toContain("h-7 w-7");
    expect(className).toContain("text-[11px]");
  });

  it.each([
    { size: "sm", box: "h-7 w-7", font: "text-[11px]" },
    { size: "md", box: "h-9 w-9", font: "text-xs" },
  ] as const)("`size=$size` daje kwadrat $box i skalę pisma $font", ({ size, box, font }) => {
    // Pismo MUSI zmieniać się razem z kwadratem: inicjały 12 px w kwadracie
    // 28 px wychodzą poza obwódkę, którą przycina `overflow-hidden`.
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" size={size} />);
    const className = avatarBox(container).className;
    expect(className).toContain(box);
    expect(className).toContain(font);
  });

  it("rozmiar działa też na ścieżce ze zdjęciem - to ten sam szkielet", () => {
    const { container } = render(
      <ClubAuthorAvatar name="Anna Nowak" avatarUrl={AVATAR_URL} size="md" />,
    );
    expect(avatarBox(container).className).toContain("h-9 w-9");
  });

  it("bez propsa `muted` inicjały noszą akcent marki", () => {
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" />);
    const className = avatarBox(container).className;
    expect(className).toContain("bg-primary/10");
    expect(className).toContain("text-primary");
    expect(className).not.toContain("text-muted-foreground");
  });

  it("`muted` odbiera akcent marki - anonim nie udaje rozpoznanej osoby", () => {
    const { container } = render(<ClubAuthorAvatar name="Anonim" muted={true} />);
    const className = avatarBox(container).className;
    expect(className).toContain("bg-muted");
    expect(className).toContain("text-muted-foreground");
    expect(className).not.toContain("bg-primary/10");
  });

  it.each([
    { label: "zdjęcie", avatarUrl: AVATAR_URL },
    { label: "inicjały", avatarUrl: null },
  ])("szkielet awatara ($label) trzyma promień, obwódkę i brak zgniatania", ({ avatarUrl }) => {
    // Regresja: gdy fallback traci `rounded-lg`/`ring-1`, kolumna odpowiedzi
    // dostaje raz kółko, raz kwadrat - a promień 6 px jest wspólny z kartami
    // i etykietami huba.
    const { container } = render(<ClubAuthorAvatar name="Anna Nowak" avatarUrl={avatarUrl} />);
    const className = avatarBox(container).className;
    expect(className).toContain("rounded-lg");
    expect(className).toContain("ring-1");
    expect(className).toContain("ring-border/60");
    expect(className).toContain("shrink-0");
    expect(className).toContain("overflow-hidden");
    expect(className).toContain("select-none");
  });
});

describe("ClubDocumentIcon", () => {
  const EXPECTED: Record<ClubThreadDocumentKind, LucideIcon> = {
    document: FileText,
    dataset: Database,
    link: Link2,
    note: NotebookPen,
    recording: Mic,
  };

  it.each(CLUB_THREAD_DOCUMENT_KINDS)("rodzaj źródła %s dostaje swój kształt", (kind) => {
    const { container } = render(<ClubDocumentIcon kind={kind} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(EXPECTED[kind]));
  });

  it("każdy rodzaj źródła ma INNY kształt - inaczej ikona nic nie mówi", () => {
    // Nagłówek `ClubDocumentRow` stawia to jako wymaganie wprost: przy trzech
    // pozycjach nie dawało się odróżnić zbioru danych od notatki bez czytania
    // etykiety.
    const shapes = CLUB_THREAD_DOCUMENT_KINDS.map((kind) => {
      const view = render(<ClubDocumentIcon kind={kind} />);
      const shape = shapeOf(view.container);
      view.unmount();
      return shape;
    });
    expect(new Set(shapes).size).toBe(CLUB_THREAD_DOCUMENT_KINDS.length);
  });

  it("wartość spoza słownika (po zawężeniu) daje ikonę dokumentu, nie pusty kafel", () => {
    const { container } = render(<ClubDocumentIcon kind={toClubDocumentKind("legacy_pdf")} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(FileText));
  });

  it("brak rodzaju w wierszu (null) też kończy się ikoną dokumentu", () => {
    const { container } = render(<ClubDocumentIcon kind={toClubDocumentKind(null)} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(FileText));
  });

  it("bez propsa `className` ikona ma rozmiar 16 px", () => {
    const { container } = render(<ClubDocumentIcon kind="dataset" />);
    expect(svgOf(container).getAttribute("class")).toContain("h-4 w-4");
  });

  it("`className` nadpisuje rozmiar - kafel w liście źródeł ma 18 px", () => {
    const { container } = render(<ClubDocumentIcon kind="dataset" className="h-[18px] w-[18px]" />);
    const className = svgOf(container).getAttribute("class") ?? "";
    expect(className).toContain("h-[18px] w-[18px]");
    expect(className).not.toContain("h-4 w-4");
  });

  it("ikona jest `aria-hidden` - obok stoi etykieta rodzaju", () => {
    const { container } = render(<ClubDocumentIcon kind="note" />);
    expect(svgOf(container).getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ClubMilestoneIcon", () => {
  const EXPECTED: Record<ClubMilestoneKind, LucideIcon> = {
    milestone: Milestone,
    meeting: Users2,
    deadline: CalendarClock,
    publication: Newspaper,
    vote: Gavel,
    consultation: MessageSquare,
  };

  it.each(CLUB_MILESTONE_KINDS)("rodzaj etapu %s dostaje swój kształt", (kind) => {
    const { container } = render(<ClubMilestoneIcon kind={kind} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(EXPECTED[kind]));
  });

  it("termin i głosowanie mają RÓŻNE kształty - to różne zobowiązania klubu", () => {
    const deadline = render(<ClubMilestoneIcon kind="deadline" />);
    const vote = render(<ClubMilestoneIcon kind="vote" />);
    expect(shapeOf(deadline.container)).not.toBe(shapeOf(vote.container));
  });

  it("każdy rodzaj etapu ma INNY kształt", () => {
    const shapes = CLUB_MILESTONE_KINDS.map((kind) => {
      const view = render(<ClubMilestoneIcon kind={kind} />);
      const shape = shapeOf(view.container);
      view.unmount();
      return shape;
    });
    expect(new Set(shapes).size).toBe(CLUB_MILESTONE_KINDS.length);
  });

  it("wartość spoza słownika (po zawężeniu) daje kształt etapu", () => {
    const { container } = render(<ClubMilestoneIcon kind={toClubMilestoneKind("hearing")} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(Milestone));
  });

  it("bez propsa `className` ikona etapu ma 16 px, z propsem - podany rozmiar", () => {
    const bare = render(<ClubMilestoneIcon kind="meeting" />);
    expect(svgOf(bare.container).getAttribute("class")).toContain("h-4 w-4");
    const sized = render(<ClubMilestoneIcon kind="meeting" className="h-5 w-5" />);
    expect(svgOf(sized.container).getAttribute("class")).toContain("h-5 w-5");
  });

  it("ikona etapu jest `aria-hidden`", () => {
    const { container } = render(<ClubMilestoneIcon kind="vote" />);
    expect(svgOf(container).getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ClubSectionIcon", () => {
  const EXPECTED: Record<ClubWorkspaceSection, LucideIcon> = {
    reply: MessageSquare,
    document: FileText,
    milestone: CalendarDays,
    question: MessageSquare,
  };

  it.each(CLUB_WORKSPACE_SECTIONS)("sekcja wyniku %s dostaje swój kształt", (section) => {
    const { container } = render(<ClubSectionIcon section={section} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(EXPECTED[section]));
  });

  it("odpowiedź i pytanie DZIELĄ kształt dymka - jedno i drugie to głos w rozmowie", () => {
    // To jest świadoma kolizja, nie przeoczenie: w wynikach szukania sekcje
    // stoją jako osobne grupy z własnym nagłówkiem tekstowym, a ikona odróżnia
    // rozmowę od kalendarza i od biblioteki.
    const reply = render(<ClubSectionIcon section="reply" />);
    const question = render(<ClubSectionIcon section="question" />);
    expect(shapeOf(reply.container)).toBe(shapeOf(question.container));
  });

  it("rozmowa, biblioteka i kalendarz to TRZY różne kształty", () => {
    const conversation = render(<ClubSectionIcon section="reply" />);
    const library = render(<ClubSectionIcon section="document" />);
    const calendar = render(<ClubSectionIcon section="milestone" />);
    const shapes = [conversation, library, calendar].map((view) => shapeOf(view.container));
    expect(new Set(shapes).size).toBe(3);
  });

  it("sekcja `milestone` w wynikach szukania to KALENDARZ, nie kamień milowy", () => {
    // Ta sama nazwa co rodzaj etapu, ale inna rola: w wyszukiwarce chodzi
    // o „coś z harmonogramu”, a nie o pojedynczy kamień milowy.
    const section = render(<ClubSectionIcon section="milestone" />);
    expect(shapeOf(section.container)).toBe(shapeOfLucide(CalendarDays));
    expect(shapeOf(section.container)).not.toBe(shapeOfLucide(Milestone));
  });

  it("wartość spoza słownika (po zawężeniu) ląduje w sekcji odpowiedzi", () => {
    const { container } = render(<ClubSectionIcon section={toClubWorkspaceSection("vote")} />);
    expect(shapeOf(container)).toBe(shapeOfLucide(MessageSquare));
  });

  it("bez propsa `className` ikona sekcji ma 16 px, z propsem - podany rozmiar", () => {
    const bare = render(<ClubSectionIcon section="reply" />);
    expect(svgOf(bare.container).getAttribute("class")).toContain("h-4 w-4");
    const sized = render(<ClubSectionIcon section="reply" className="h-3.5 w-3.5" />);
    const className = svgOf(sized.container).getAttribute("class") ?? "";
    expect(className).toContain("h-3.5 w-3.5");
    expect(className).not.toContain("h-4 w-4");
  });

  it("ikona sekcji jest `aria-hidden`", () => {
    const { container } = render(<ClubSectionIcon section="document" />);
    expect(svgOf(container).getAttribute("aria-hidden")).toBe("true");
  });
});
