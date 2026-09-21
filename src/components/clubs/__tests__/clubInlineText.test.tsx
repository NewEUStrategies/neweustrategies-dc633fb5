// Atomy treści inline klubu: `ClubInlineText` (+ `MentionSegment`) i `ClubInlineTitle`.
//
// CO TO DOWODZI.
// (1) BEZPIECZEŃSTWO LINKU UGC. Adres z wpisu członka wychodzi jako `<a>`
//     z `target="_blank"` i PEŁNYM `rel="nofollow ugc noopener noreferrer"`.
//     Zgubienie `noopener` daje otwartej stronie dostęp do `window.opener`
//     (tabnabbing), a zgubienie `nofollow ugc` zamienia klub w farmę linków.
//     Recenzja kodu tego nie łapie, bo brak atrybutu wygląda identycznie.
// (2) LENIWOŚĆ PODGLĄDU. Wątek z kilkoma linkami i wzmiankami NIE MOŻE odpalić
//     kilku wyjść na świat przy renderze. Obie ścieżki trzymają tę obietnicę
//     inaczej i test zapisuje to, co jest naprawdę: hook podglądu LINKU dostaje
//     `enabled: false` aż do otwarcia dymka, a hook profilu WZMIANKI nie jest
//     przed otwarciem wołany w ogóle, bo siedzi w treści dymka (Radix montuje
//     ją dopiero po otwarciu). To jedyna warstwa, w której to widać.
// (3) TREŚĆ ZOSTAJE TEKSTEM. Render odtwarza wejście znak w znak - z DWOMA
//     świadomymi wyjątkami: kratę tagu zastępuje ikona (`#energia` -> chip
//     „energia"), a wzmianka schodzi z nicku na CZŁOWIEKA („@anna-nowak" ->
//     awatar + „Anna Nowak"). Etykieta tagu pokazuje pisownię autora, choć
//     klucz filtra i cel linku są znormalizowane.
// (4) DEGRADACJA BEZ KONTEKSTU KLUBU. `clubSlug === null` zamienia tag w
//     etykietę (nie ma dokąd prowadzić); każda inna wartość - także pusty
//     napis - zostaje linkiem filtra. Strażnik jest ścisły, nie „falsy".
// (5) DYMKI ROZRÓŻNIAJĄ TRZY STANY: ładowanie (szkielety), brak danych
//     (klucz `noPreview` / `noProfile`) i dane (tytuł, opis, obrazek, osoba).
//     Sklejenie „ładuje się" z „nie ma podglądu" kłamie użytkownikowi.
// (6) TON I ROZMIAR `ClubInlineTitle` to nośniki znaczenia (rodzaj elementu),
//     więc każda wartość obu unii dostaje własny, ROZŁĄCZNY zestaw klas -
//     `Record<Tone, string>` pilnuje tylko tego, żeby COŚ tam było.
// (7) NICKU NIE MA NIGDZIE. Wzmianka bez katalogu pokazuje uczytelniony slug
//     („Anna Nowak"), wzmianka z katalogu - nazwę z profilu; w żadnym stanie
//     w drzewie nie pojawia się małpa. To jest KONTRAKT, nie kosmetyka:
//     dostępną nazwą linku jest nazwisko, bo awatar obok jest `aria-hidden`.
// (8) AWATAR SCHODZI INACZEJ W BIEGU TEKSTU NIŻ W DYMKU. Bez zdjęcia w linii
//     tekstu wchodzi IKONA (inicjały tuż obok pełnego nazwiska czytałyby się
//     jak literówka), a w dymku - INICJAŁY. Test pilnuje obu wariantów naraz,
//     bo pojedynczy łatwo „naprawić" przez ujednolicenie i zepsuć drugi.
// (9) FIRMA JEST OPCJONALNA I NIE ZOSTAWIA ŚLADU. Brak firmy to brak elementu,
//     nie pusty `<span>` i nie separator-sierota; brak stanowiska ORAZ firmy
//     to brak całej linii tożsamości, nie awaryjny uchwyt `@slug`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) REGUŁ PARSERA. `splitInline` (granice wzmianki, obcinanie interpunkcji
//     i nawiasów, inwariant odtwarzalności, `null`/`undefined`) ma własną
//     suitę: `src/lib/clubs/__tests__/clubPureModules.test.ts`. Tutaj wchodzą
//     tylko te wejścia, które prowadzą do RÓŻNYCH węzłów React.
// (b) WARSTWY DANYCH. `useClubLinkPreview` i `useMentionProfile` (klucze cache,
//     `enabled`, `staleTime`, mapowanie wiersza) są przetestowane w
//     `src/lib/clubs/__tests__/clubCatalogHooks.test.tsx` - tu są atrapami,
//     bo testujemy WIDOK stanu, nie sposób jego pobrania.
// (c) BIBLIOTEK. Pozycjonowania, animacji i opóźnień Radix `HoverCard` ani
//     `Skeleton` z `components/ui` - dymek otwieramy fokusem (dostępna droga
//     klawiaturą) i czekamy `waitFor`, bez sterowania zegarem.
// (d) `body: null | undefined`. Sygnatura `ClubInlineText` wymaga `string`,
//     więc wejście nietypowane wymagałoby rzutowania, którego reguły
//     repozytorium zabraniają; obsługa pustej treści przez parser jest pokryta
//     w (a). Z tego samego powodu nie ma wartości spoza unii tonu/rozmiaru
//     `ClubInlineTitle`.
// (e) `LinkSegment` NIE JEST eksportowany - `hostOf` (razem z gałęzią wyjątku
//     na niepoprawnym adresie) testujemy przez render `ClubInlineText`.
//     W samym `LinkSegment` NIE MA gałęzi „link wewnętrzny": każdy adres
//     z treści jest zewnętrzny, co test utrwala jawnie.
// (f) ISTNIENIA KLUCZY w słownikach - to `clubI18nKeys.gate.test.ts`.
// (g) KATALOGU WZMIANEK. `slugToDisplayName`, `buildDirectory` (pierwszeństwo
//     osoby) i `identityLine` mają własną suitę
//     `src/lib/mentions/__tests__/directory.test.ts`, a rozwiązywanie slugów
//     jednym zapytaniem - warstwę `useMentionDirectory`. Tutaj `useMentionEntity`
//     jest atrapą: sprawdzamy, CO atom robi z rozwiązanym bytem, a nie skąd go
//     bierze.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { ClubLinkPreview } from "@/lib/clubs/useClubLinkPreview";
import type { MentionProfilePreview } from "@/lib/mentions/useMentionProfile";
import type { MentionEntity, MentionOrg, MentionPerson } from "@/lib/mentions/directory";

/** Stan atrap: język UI, to, co „zwracają" hooki danych, oraz KATALOG. */
const state = vi.hoisted(() => ({
  lang: "pl",
  linkPreview: { data: null as ClubLinkPreview | null, isPending: false },
  mention: { data: null as MentionProfilePreview | null, isPending: false },
  /** Byt, który katalog powierzchni rozwiązał dla sluga; `null` = nie zna go. */
  entity: null as MentionEntity | null,
  linkCalls: [] as Array<{ url: string | null; enabled: boolean }>,
  mentionCalls: [] as Array<{ slug: string | null; lang: string; enabled: boolean }>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => state.lang),
);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/lib/clubs/useClubLinkPreview", () => ({
  useClubLinkPreview: (url: string | null, enabled: boolean) => {
    state.linkCalls.push({ url, enabled });
    return state.linkPreview;
  },
}));
vi.mock("@/lib/mentions/useMentionProfile", () => ({
  useMentionProfile: (slug: string | null, lang: string, enabled: boolean) => {
    state.mentionCalls.push({ slug, lang, enabled });
    return state.mention;
  },
}));
// Katalog powierzchni podstawiamy w całości: atom czyta z niego przy renderze,
// a my chcemy sterować JEDNYM wymiarem - czy slug jest rozwiązany i na co.
// Prawdziwy dostawca robi zapytanie do Supabase, więc w teście atomu byłby
// tylko drugą atrapą, za to o dwa poziomy dalej od asercji.
vi.mock("@/components/mentions/MentionDirectory", () => ({
  useMentionEntity: () => state.entity,
}));

import { ClubInlineText, MentionSegment } from "@/components/clubs/atoms/ClubInlineText";
import {
  ClubInlineTitle,
  type ClubInlineTitleSize,
  type ClubInlineTitleTone,
} from "@/components/clubs/atoms/ClubInlineTitle";

/** Karta OpenGraph z domyślnie PUSTYMI polami - każdy test dokłada tylko swoje. */
function preview(overrides: Partial<ClubLinkPreview> = {}): ClubLinkPreview {
  return {
    url: "https://example.com/a",
    title: null,
    description: null,
    image: null,
    siteName: null,
    ...overrides,
  };
}

/** Osoba z podglądu wzmianki - domyślnie minimum pól (sam slug i imię). */
function person(overrides: Partial<MentionProfilePreview> = {}): MentionProfilePreview {
  return {
    kind: "person",
    id: "person-1",
    slug: "anna-nowak",
    name: "Anna Nowak",
    avatarUrl: null,
    logoUrl: null,
    jobTitle: null,
    company: null,
    website: null,
    bio: null,
    verified: false,
    ...overrides,
  };
}

/** Osoba ROZWIĄZANA PRZEZ KATALOG - to, co widz dostaje już przy renderze. */
function personEntity(overrides: Partial<MentionPerson> = {}): MentionPerson {
  return {
    kind: "person",
    slug: "anna-nowak",
    name: "Anna Nowak",
    avatarUrl: null,
    jobTitle: null,
    company: null,
    bio: null,
    verified: false,
    ...overrides,
  };
}

/** Organizacja rozwiązana przez katalog (term taksonomii, nie profil). */
function orgEntity(overrides: Partial<MentionOrg> = {}): MentionOrg {
  return {
    kind: "org",
    slug: "org-00000000-0000-4000-8000-000000000001",
    id: "00000000-0000-4000-8000-000000000001",
    name: "ACME Polska",
    logoUrl: null,
    description: null,
    website: null,
    ...overrides,
  };
}

/**
 * Otwiera dymek DROGĄ KLAWIATURY (fokus na wyzwalaczu). Radix otwiera kartę
 * po własnym opóźnieniu, więc czekamy na jej pojawienie się `waitFor` -
 * bez `setTimeout` i bez sterowania zegarem po stronie testu.
 */
async function openCard(trigger: HTMLElement, testId: string): Promise<HTMLElement> {
  fireEvent.focusIn(trigger);
  return await waitFor(() => screen.getByTestId(testId));
}

/**
 * Wzorzec, a nie dokładny napis, bo nazwa dostępna linku wzmianki bywa dłuższa
 * o firmę („Anna Nowak · ACME"). Awatar jest `aria-hidden`, więc do nazwy
 * dostępnej nie wchodzi - i o to właśnie chodzi.
 */
function linkNamed(name: string | RegExp): HTMLElement {
  return screen.getByRole("link", { name });
}

/** Wyzwalacz wzmianki - po nazwisku, bo nicku w drzewie już nie ma. */
const ANNA = /Anna Nowak/;

/** Liczba szkieletów w dymku - odróżnia „ładuje się" od „nie ma danych". */
function skeletons(card: HTMLElement): number {
  return card.querySelectorAll(".animate-pulse").length;
}

beforeEach(() => {
  state.lang = "pl";
  state.linkPreview = { data: null, isPending: false };
  state.mention = { data: null, isPending: false };
  state.entity = null;
  state.linkCalls = [];
  state.mentionCalls = [];
});

// ---------------------------------------------------------------------------
// Link w treści: atrybuty bezpieczeństwa i leniwy podgląd
// ---------------------------------------------------------------------------

describe("ClubInlineText - link z treści członka", () => {
  const HREF = "https://example.com/raport";

  it("jest zewnętrznym anchorem z PEŁNYM rel dla treści UGC", () => {
    render(<ClubInlineText body={`czytaj ${HREF} dalej`} />);
    const link = linkNamed(HREF);

    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", HREF);
    expect(link).toHaveAttribute("target", "_blank");
    // Kolejność tokenów jest nieistotna, obecność KAŻDEGO - krytyczna.
    const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
    expect(rel).toEqual(expect.arrayContaining(["nofollow", "ugc", "noopener", "noreferrer"]));
    expect(link).toHaveAttribute("data-club-link", HREF);
  });

  it.each([
    ["https://example.com/a", "adres obcej domeny"],
    ["http://localhost:3000/wewnetrzny", "adres wyglądający na wewnętrzny"],
  ])("%s (%s) dostaje TE SAME reguły - nie ma gałęzi linku wewnętrznego", (href) => {
    render(<ClubInlineText body={`zob. ${href}`} />);
    const link = linkNamed(href);

    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("NIE pyta o podgląd przy renderze - trzy linki to zero zapytań", () => {
    // Regresja, którą to łapie: `enabled` na sztywno `true` zamienia otwarcie
    // wątku w tyle wyjść na świat, ile jest w nim adresów.
    render(<ClubInlineText body="https://a.example oraz https://b.example i https://c.example" />);

    expect(state.linkCalls).toHaveLength(3);
    expect(state.linkCalls.every((call) => call.enabled === false)).toBe(true);
    expect(state.linkCalls.map((call) => call.url)).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ]);
  });

  it("pyta o podgląd DOPIERO po otwarciu dymka i tylko dla swojego adresu", async () => {
    render(<ClubInlineText body={`a ${HREF} b`} />);
    await openCard(linkNamed(HREF), "club-link-preview");

    const enabled = state.linkCalls.filter((call) => call.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.every((call) => call.url === HREF)).toBe(true);
  });
});

describe("ClubInlineText - etykieta źródła w dymku (hostOf)", () => {
  it.each([
    ["https://www.example.com/artykul", "example.com", "www zdjęte"],
    ["https://example.com", "example.com", "bez www"],
    ["https://example.com:8443/panel", "example.com", "port nie wchodzi do etykiety"],
    ["https://example.com/a/b?q=1", "example.com", "podścieżka i zapytanie nie wchodzą"],
    ["https://sub.www.example.com/a", "sub.www.example.com", "www tylko na początku"],
  ])("%s pokazuje źródło jako %s (%s)", async (href, host) => {
    render(<ClubInlineText body={`zob. ${href}`} />);
    const card = await openCard(linkNamed(href), "club-link-preview");

    expect(within(card).getByText(host)).toBeInTheDocument();
  });

  it("NIEPOPRAWNY adres nie wywala renderu - etykietą zostaje sam napis", async () => {
    // `new URL` rzuca; `hostOf` musi to złapać, bo treść pisze człowiek,
    // a wysypanie atomu zabiera cały wątek (ErrorBoundary trasy).
    const broken = "http://[niepoprawny";
    render(<ClubInlineText body={`uwaga ${broken} koniec`} />);
    const card = await openCard(linkNamed(broken), "club-link-preview");

    expect(within(card).getByText(broken)).toBeInTheDocument();
  });

  it("nazwa serwisu z OpenGraph WYGRYWA z hostem", async () => {
    state.linkPreview = { data: preview({ siteName: "Serwis Testowy" }), isPending: false };
    render(<ClubInlineText body="zob. https://www.example.com/a" />);
    const card = await openCard(linkNamed("https://www.example.com/a"), "club-link-preview");

    expect(within(card).getByText("Serwis Testowy")).toBeInTheDocument();
    expect(within(card).queryByText("example.com")).toBeNull();
  });
});

describe("ClubInlineText - trzy stany dymka linku", () => {
  const HREF = "https://example.com/a";

  async function cardFor(): Promise<HTMLElement> {
    render(<ClubInlineText body={`zob. ${HREF}`} />);
    return await openCard(linkNamed(HREF), "club-link-preview");
  }

  it("w trakcie ładowania pokazuje szkielety i NIE mówi, że podglądu nie ma", async () => {
    state.linkPreview = { data: null, isPending: true };
    const card = await cardFor();

    expect(skeletons(card)).toBe(3);
    expect(card.textContent).not.toContain("club.inline.noPreview");
  });

  it("brak danych po zapytaniu daje klucz `noPreview`, nie puste pudełko", async () => {
    state.linkPreview = { data: null, isPending: false };
    const card = await cardFor();

    expect(within(card).getByText("club.inline.noPreview")).toBeInTheDocument();
    expect(skeletons(card)).toBe(0);
  });

  it("odpowiedź BEZ tytułu też degraduje do `noPreview`", async () => {
    // `data` jest, ale strona nie oddała tytułu - pusta karta wygląda jak błąd.
    state.linkPreview = { data: preview({ title: null }), isPending: false };
    const card = await cardFor();

    expect(within(card).getByText("club.inline.noPreview")).toBeInTheDocument();
  });

  it("tytuł i opis wchodzą jako osobne akapity obok etykiety źródła", async () => {
    state.linkPreview = {
      data: preview({ title: "Raport o korytarzu", description: "Streszczenie ustaleń." }),
      isPending: false,
    };
    const card = await cardFor();

    expect(within(card).getByText("Raport o korytarzu")).toBeInTheDocument();
    expect(within(card).getByText("Streszczenie ustaleń.")).toBeInTheDocument();
    expect(card.querySelectorAll("p")).toHaveLength(3);
    expect(card.textContent).not.toContain("club.inline.noPreview");
  });

  it("tytuł bez opisu nie zostawia pustego akapitu", async () => {
    state.linkPreview = { data: preview({ title: "Raport o korytarzu" }), isPending: false };
    const card = await cardFor();

    // Dwa akapity: źródło + tytuł. Trzeci znaczyłby pusty `line-clamp`.
    expect(card.querySelectorAll("p")).toHaveLength(2);
  });

  it("obrazek karty jest opcjonalny, a gdy jest - jest leniwy i bez opisu", async () => {
    state.linkPreview = {
      data: preview({ title: "Raport", image: "https://cdn.example.com/og.png" }),
      isPending: false,
    };
    const card = await cardFor();
    const image = card.querySelector("img");

    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", "https://cdn.example.com/og.png");
    // Obrazek jest dekoracją karty - nazwę niesie tytuł, więc `alt` jest pusty.
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("loading", "lazy");
  });

  it("bez obrazka nie ma pustej ramki nad tekstem", async () => {
    state.linkPreview = { data: preview({ title: "Raport", image: null }), isPending: false };
    const card = await cardFor();

    expect(card.querySelector("img")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wzmianka (komponent eksportowany - testowany bezpośrednio)
// ---------------------------------------------------------------------------
describe("MentionSegment - wyzwalacz bez katalogu", () => {
  /** Awatar z biegu tekstu - jeden na wzmiankę, zawsze pod tym atrybutem. */
  function avatar(): HTMLElement {
    const found = document.querySelector<HTMLElement>("[data-mention-avatar]");
    if (found === null) throw new Error("test: brak awatara wzmianki w drzewie");
    return found;
  }

  it("prowadzi do profilu autora i niesie slug w atrybucie danych", () => {
    render(<MentionSegment slug="anna-nowak" />);
    const link = linkNamed(ANNA);

    expect(link).toHaveAttribute("href", "/author/anna-nowak");
    expect(link).toHaveAttribute("data-mention", "anna-nowak");
  });

  it("etykietą jest UCZYTELNIONY SLUG, a małpy nie ma nigdzie w drzewie", () => {
    // Regresja, którą to łapie: powrót do renderowania `@slug`. Nick nie niesie
    // informacji - czytelnik widzi „@a-nowak" i nie wie, kto to jest - więc
    // nawet stan zastępczy (katalog nie zna sluga) pokazuje człowieka.
    const { container } = render(<MentionSegment slug="anna-nowak" />);

    expect(linkNamed(ANNA).textContent).toBe("Anna Nowak");
    expect(container.textContent).not.toContain("@");
  });

  it("wieloczłonowy slug rozkłada się na słowa wersalikiem na początku", () => {
    render(<MentionSegment slug="jan_kowalski-nowak" />);

    expect(linkNamed("Jan Kowalski Nowak")).toHaveAttribute("href", "/author/jan_kowalski-nowak");
  });

  it("bez zdjęcia w BIEGU TEKSTU wchodzi ikona, nie inicjały", () => {
    // Inicjały stoją tu tuż obok pełnego nazwiska, więc czytnik zrzucający
    // tekst strony przeczytałby „AN Anna Nowak" - to wygląda jak literówka.
    render(<MentionSegment slug="anna-nowak" />);
    const mark = avatar();

    expect(mark.tagName).toBe("SPAN");
    expect(mark.querySelector("svg")).not.toBeNull();
    expect(mark.textContent).toBe("");
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("zdjęcie z katalogu wchodzi jako leniwy obrazek bez nazwy dostępnej", () => {
    state.entity = personEntity({ avatarUrl: "https://cdn.example.com/a.jpg" });
    render(<MentionSegment slug="anna-nowak" />);
    const mark = avatar();

    expect(mark.tagName).toBe("IMG");
    expect(mark).toHaveAttribute("src", "https://cdn.example.com/a.jpg");
    // Nazwę niesie tekst obok, więc obrazek jest dekoracją - inaczej czytnik
    // przeczytałby nazwisko dwa razy.
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveAttribute("loading", "lazy");
    expect(linkNamed(ANNA).textContent).toBe("Anna Nowak");
  });

  it("bez `className` ma tylko klasy własne", () => {
    render(<MentionSegment slug="anna-nowak" />);
    const link = linkNamed(ANNA);

    expect(link.classList.contains("text-primary")).toBe(true);
    expect(link.className).not.toContain("undefined");
  });

  it("z `className` DOKŁADA klasę wywołującego, nie podmienia własnych", () => {
    render(<MentionSegment slug="anna-nowak" className="text-xs" />);
    const link = linkNamed(ANNA);

    expect(link.classList.contains("text-xs")).toBe(true);
    expect(link.classList.contains("font-medium")).toBe(true);
  });

  it("NIE pyta o profil przed otwarciem dymka - trzy wzmianki to zero zapytań", () => {
    // Obietnica z nagłówka pliku jest dziś SPEŁNIONA MOCNIEJ niż kiedyś: hook
    // profilu siedzi w treści dymka, a Radix montuje ją dopiero po otwarciu,
    // więc przed otwarciem nie ma nawet wywołania z `enabled: false`. Asercja
    // na PUSTEJ liście łapie obie regresje naraz - i wywołanie z `enabled`
    // na sztywno `true`, i wyciągnięcie hooka z powrotem na poziom atomu.
    render(<ClubInlineText body="cc @anna-nowak @jan-kowalski @ewa-lis" />);

    expect(state.mentionCalls).toEqual([]);
  });

  it("pyta o profil DOPIERO po otwarciu i tylko o swój slug", async () => {
    render(<MentionSegment slug="anna-nowak" />);
    await openCard(linkNamed(ANNA), "club-mention-preview");

    expect(state.mentionCalls.length).toBeGreaterThan(0);
    expect(state.mentionCalls.every((call) => call.slug === "anna-nowak")).toBe(true);
    expect(state.mentionCalls.every((call) => call.enabled)).toBe(true);
  });

  it.each([
    ["pl", "pl"],
    ["en", "en"],
    ["en-GB", "en"],
    ["de", "pl"],
  ])("język UI %s pobiera biogram w wersji %s", async (uiLanguage, expected) => {
    // Biogram ma dwie kolumny (`bio_pl`/`bio_en`) - zły język to cudzy tekst
    // w dymku, a nie brak tekstu, więc nikt tego nie zgłosi jako błąd.
    state.lang = uiLanguage;
    render(<MentionSegment slug="anna-nowak" />);
    await openCard(linkNamed(ANNA), "club-mention-preview");

    const enabled = state.mentionCalls.filter((call) => call.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.every((call) => call.lang === expected)).toBe(true);
  });
});

describe("MentionSegment - wzmianka rozwiązana przez katalog", () => {
  it("pokazuje nazwę z profilu, nie uczytelniony slug", () => {
    state.entity = personEntity({ slug: "a-nowak", name: "Anna Kowalska-Nowak" });
    const { container } = render(<MentionSegment slug="a-nowak" />);

    expect(linkNamed("Anna Kowalska-Nowak")).toHaveAttribute("href", "/author/a-nowak");
    // „A Nowak" to postać zastępcza - jej obecność znaczyłaby, że katalog jest
    // pobierany, ale nieczytany.
    expect(screen.queryByText("A Nowak")).toBeNull();
    expect(container.textContent).not.toContain("@");
  });

  it("firma z profilu stoi w linii tekstu obok nazwiska", () => {
    state.entity = personEntity({ company: "ACME Polska" });
    render(<MentionSegment slug="anna-nowak" />);

    expect(linkNamed(/Anna Nowak/).textContent).toBe("Anna Nowak· ACME Polska");
  });

  it("brak firmy NIE zostawia separatora ani pustego elementu", () => {
    // Regresja, którą to łapie: separator wpisany na sztywno przed firmą.
    // Wtedy wzmianka bez firmy kończy się sierotą „· " i wygląda na uciętą.
    state.entity = personEntity({ company: null });
    const { container } = render(<MentionSegment slug="anna-nowak" />);
    const link = linkNamed(ANNA);

    expect(link.textContent).toBe("Anna Nowak");
    expect(container.textContent).not.toContain("·");
    // Awatar + nazwisko. Trzeci `span` znaczyłby pustą ramkę po firmie.
    expect(link.querySelectorAll("span > span")).toHaveLength(2);
  });

  it("mając byt z katalogu NIE dociąga profilu nawet po otwarciu dymka", async () => {
    // To jest cała stawka jednego zapytania na powierzchnię: skoro wątek
    // rozwiązał slugi zbiorczo, dymek nie ma po co wychodzić drugi raz.
    state.entity = personEntity({ jobTitle: "Dyrektor" });
    render(<MentionSegment slug="anna-nowak" />);
    const card = await openCard(linkNamed(ANNA), "club-mention-preview");

    expect(within(card).getByText("Dyrektor")).toBeInTheDocument();
    expect(state.mentionCalls).toEqual([]);
  });

  it("ORGANIZACJA dostaje własny atrybut i cel, nie link do profilu osoby", () => {
    state.entity = orgEntity();
    const { container } = render(<MentionSegment slug="acme" />);
    const link = linkNamed("ACME Polska");

    expect(link).toHaveAttribute("data-mention-org", "org-00000000-0000-4000-8000-000000000001");
    expect(container.querySelector("[data-mention]")).toBeNull();
    // Ikona budynku zamiast awatara - organizacja nie ma twarzy.
    expect(link.querySelector("[data-mention-avatar]")?.tagName).toBe("svg");
  });

  it("ORGANIZACJA dostaje kartę organizacji zamiast karty osoby", async () => {
    state.entity = orgEntity({ description: "Operator terminalu." });
    render(<MentionSegment slug="acme" />);
    const card = await openCard(linkNamed("ACME Polska"), "club-mention-preview");

    expect(within(card).getByText("Operator terminalu.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "club.inline.viewOrg" })).toBeInTheDocument();
    expect(within(card).queryByText("club.inline.viewProfile")).toBeNull();
    expect(state.mentionCalls).toEqual([]);
  });
});

describe("MentionSegment - stany dymka", () => {
  async function cardFor(): Promise<HTMLElement> {
    render(<MentionSegment slug="anna-nowak" />);
    return await openCard(linkNamed(ANNA), "club-mention-preview");
  }

  it("w trakcie ładowania pokazuje szkielet wizytówki, bez komunikatu o braku", async () => {
    state.mention = { data: null, isPending: true };
    const card = await cardFor();

    expect(skeletons(card)).toBe(3);
    expect(card.textContent).not.toContain("club.inline.noProfile");
  });

  it("nierozpoznana wzmianka mówi to wprost kluczem `noProfile`", async () => {
    // Wzmianka jest linkiem ZAWSZE (parser nie wie, kto istnieje) - dymek
    // jest jedynym miejscem, w którym widać, że profilu nie ma.
    state.mention = { data: null, isPending: false };
    const card = await cardFor();

    expect(within(card).getByText("club.inline.noProfile")).toBeInTheDocument();
    expect(skeletons(card)).toBe(0);
  });

  it("rozpoznana osoba dostaje nazwę i drugi link do profilu", async () => {
    state.mention = { data: person(), isPending: false };
    const card = await cardFor();

    expect(within(card).getByText("Anna Nowak")).toBeInTheDocument();
    const view = within(card).getByRole("link", { name: "club.inline.viewProfile" });
    expect(view).toHaveAttribute("href", "/author/anna-nowak");
  });

  it("bez awatara W DYMKU pokazuje inicjały wersalikami", async () => {
    // Odwrotnie niż w biegu tekstu: tu jest miejsce i nie ma nazwiska tuż
    // obok, więc inicjały czytają się jak awatar, a nie jak literówka.
    state.mention = { data: person({ name: "anna nowak", avatarUrl: null }), isPending: false };
    const card = await cardFor();

    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getByText("AN")).toBeInTheDocument();
  });

  it("z awatarem pokazuje obrazek zamiast inicjałów", async () => {
    state.mention = {
      data: person({ avatarUrl: "https://cdn.example.com/a.jpg" }),
      isPending: false,
    };
    const card = await cardFor();

    expect(card.querySelector("img")).toHaveAttribute("src", "https://cdn.example.com/a.jpg");
    expect(within(card).queryByText("AN")).toBeNull();
  });

  it("weryfikacja jest ogłoszona czytnikowi ekranu, nie tylko kolorem", async () => {
    state.mention = { data: person({ verified: true }), isPending: false };
    const card = await cardFor();

    expect(within(card).getByLabelText("club.inline.verified")).toBeInTheDocument();
  });

  it("brak weryfikacji NIE rysuje znaczka", async () => {
    state.mention = { data: person({ verified: false }), isPending: false };
    const card = await cardFor();

    expect(within(card).queryByLabelText("club.inline.verified")).toBeNull();
  });

  // Tabela OBIEKTÓW, nie krotek: krotki mieszające `string` z `null` na tej samej
  // pozycji dają unię typów krotek, a wtedy sygnatura wywołania zwrotnego nie
  // pasuje do żadnego jej członu. Interpolacja `$pole` w opisie działa tak samo.
  const PODPISY: readonly {
    readonly jobTitle: string | null;
    readonly company: string | null;
    readonly expected: string;
    readonly opis: string;
  }[] = [
    {
      jobTitle: "Dyrektor",
      company: "ACME",
      expected: "Dyrektor · ACME",
      opis: "stanowisko i firma",
    },
    { jobTitle: "Dyrektor", company: null, expected: "Dyrektor", opis: "tylko stanowisko" },
    { jobTitle: null, company: "ACME", expected: "ACME", opis: "tylko firma" },
  ];

  it.each(PODPISY)("podpis: $opis -> $expected", async ({ jobTitle, company, expected }) => {
    state.mention = { data: person({ jobTitle, company }), isPending: false };
    const card = await cardFor();

    expect(within(card).getByText(expected)).toBeInTheDocument();
  });

  // Tam, gdzie kiedyś stał awaryjny uchwyt `@slug`, dziś nie ma NICZEGO.
  // Uchwyt był jedynym miejscem, w którym nick wyciekał do dymka.
  const BEZ_PODPISU: readonly {
    readonly jobTitle: string | null;
    readonly company: string | null;
    readonly opis: string;
  }[] = [
    { jobTitle: null, company: null, opis: "brak obu" },
    { jobTitle: "", company: "", opis: "puste napisy są traktowane jak brak" },
  ];

  it.each(BEZ_PODPISU)("bez linii tożsamości: $opis", async ({ jobTitle, company }) => {
    state.mention = { data: person({ jobTitle, company, bio: null }), isPending: false };
    const card = await cardFor();

    // Sama nazwa. Drugi akapit znaczyłby pustą linię pod nazwiskiem, a jeszcze
    // gorzej - powrót uchwytu `@anna-nowak` jako wypełniacza.
    expect(card.querySelectorAll("p")).toHaveLength(1);
    expect(card.textContent).not.toContain("@");
    expect(card.textContent).not.toContain("·");
  });

  it("biogram, gdy jest, wchodzi jako trzeci akapit wizytówki", async () => {
    state.mention = {
      data: person({ jobTitle: "Dyrektor", bio: "Pracuje nad korytarzem." }),
      isPending: false,
    };
    const card = await cardFor();

    expect(within(card).getByText("Pracuje nad korytarzem.")).toBeInTheDocument();
    // Nazwa + podpis + biogram.
    expect(card.querySelectorAll("p")).toHaveLength(3);
  });

  it("bez biogramu nie zostawia pustego akapitu", async () => {
    state.mention = { data: person({ jobTitle: "Dyrektor", bio: null }), isPending: false };
    const card = await cardFor();

    expect(card.querySelectorAll("p")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tag: filtr strumienia albo zwykła etykieta
// ---------------------------------------------------------------------------

describe("ClubInlineText - tag", () => {
  function chip(): HTMLElement {
    const found = document.querySelector<HTMLElement>("[data-club-tag]");
    if (found === null) throw new Error("test: brak chipu tagu w drzewie");
    return found;
  }

  it("bez kontekstu klubu (prop pominięty) jest ETYKIETĄ, nie linkiem", () => {
    render(<ClubInlineText body="temat #energia w klubie" />);

    expect(chip().tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).toBeNull();
    expect(chip()).toHaveAttribute("data-club-tag", "energia");
  });

  it("`clubSlug={null}` jawnie zachowuje się jak pominięty prop", () => {
    render(<ClubInlineText body="temat #energia" clubSlug={null} />);

    expect(chip().tagName).toBe("SPAN");
  });

  it("z kontekstem klubu prowadzi do strumienia zawężonego tym tagiem", () => {
    render(<ClubInlineText body="temat #energia" clubSlug="korytarz-baltycki" />);

    expect(chip().tagName).toBe("A");
    expect(chip()).toHaveAttribute("href", "/club/korytarz-baltycki");
  });

  it("PUSTY `clubSlug` nadal daje link - strażnik pilnuje `null`, nie fałszywości", () => {
    // Regresja, którą to łapie: zamiana `clubSlug === null` na `!clubSlug`
    // cicho gasi filtr tam, gdzie slug przyjdzie z RPC jako pusty napis.
    render(<ClubInlineText body="temat #energia" clubSlug="" />);

    expect(chip().tagName).toBe("A");
  });

  it("etykieta zachowuje pisownię autora, klucz filtra jest znormalizowany", () => {
    render(<ClubInlineText body="temat #Energetyka" clubSlug="klub" />);

    expect(chip()).toHaveAttribute("data-club-tag", "energetyka");
    expect(chip().textContent).toBe("Energetyka");
  });

  it("interpunkcja przyklejona do tagu zostaje poza chipem", () => {
    const { container } = render(<ClubInlineText body="temat #energia." />);

    expect(chip().textContent).toBe("energia");
    // Kropka wraca do strumienia tekstu, a nie do nazwy tagu; samą kratę
    // zastępuje ikona, więc w treści zostaje „temat energia.".
    expect(container.textContent).toBe("temat energia.");
  });

  it("ikona kraty jest dekoracją - nie dubluje nazwy tagu czytnikowi", () => {
    render(<ClubInlineText body="temat #energia" />);
    const icon = chip().querySelector("svg");

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});

// ---------------------------------------------------------------------------
// Cała treść: składanie segmentów
// ---------------------------------------------------------------------------

describe("ClubInlineText - składanie treści", () => {
  it("pusta treść nie renderuje nic", () => {
    const { container } = render(<ClubInlineText body="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("sam tekst zostaje tekstem - zero węzłów interaktywnych", () => {
    const { container } = render(<ClubInlineText body="Zwykłe zdanie bez adresów i tagów." />);

    expect(container.textContent).toBe("Zwykłe zdanie bez adresów i tagów.");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("[data-club-tag]")).toHaveLength(0);
  });

  it("link w środku i na końcu zdania - render odtwarza wejście znak w znak", () => {
    const body = "start https://a.example środek https://b.example";
    const { container } = render(<ClubInlineText body={body} />);

    expect(container.textContent).toBe(body);
    expect(container.querySelectorAll("[data-club-link]")).toHaveLength(2);
  });

  it("kilka wzmianek daje kilka osobnych wizytówek, slug idzie małymi literami", () => {
    const { container } = render(<ClubInlineText body="cc @Anna-Nowak i @jan-kowalski" />);
    const mentions = container.querySelectorAll("[data-mention]");

    expect(Array.from(mentions).map((node) => node.getAttribute("data-mention"))).toEqual([
      "anna-nowak",
      "jan-kowalski",
    ]);
    // Inaczej niż przy tagu: pisownia autora NIE zostaje, bo etykietą wzmianki
    // jest człowiek, a nie zapis uchwytu. Nicku nie ma w żadnej z nich.
    expect(mentions[0]?.textContent).toBe("Anna Nowak");
    expect(mentions[1]?.textContent).toBe("Jan Kowalski");
    expect(container.textContent).not.toContain("@");
  });

  it("adres e-mail NIE staje się linkiem ani wzmianką", () => {
    // Wzorzec wzmianki jest lustrem triggera powiadomień - linkowanie
    // `example.org` z adresu pocztowego wysłałoby ludzi w nicość.
    const { container } = render(<ClubInlineText body="pisz na kontakt@example.org" />);

    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toBe("pisz na kontakt@example.org");
  });

  it("mieszanka czterech rodzajów segmentów renderuje po jednym węźle każdego", () => {
    const body = "zob. https://a.example od @anna-nowak w #energia";
    const { container } = render(<ClubInlineText body={body} clubSlug="klub" />);

    expect(container.querySelectorAll("[data-club-link]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-mention]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-club-tag]")).toHaveLength(1);
    // Dwie różnice wobec wejścia i obie są świadome: krata tagu jest ikoną,
    // a uchwyt wzmianki - nazwiskiem. Reszta znaków przechodzi bez zmian.
    expect(container.textContent).toBe(body.replace("#", "").replace("@anna-nowak", "Anna Nowak"));
  });
});

// ---------------------------------------------------------------------------
// ClubInlineTitle
// ---------------------------------------------------------------------------

describe("ClubInlineTitle", () => {
  /** Klasa tła rozpoznająca ton - to ona niesie rodzaj elementu. */
  const TONE_MARK: Record<ClubInlineTitleTone, string> = {
    thread: "bg-primary/10",
    event: "bg-sky-500/10",
    document: "bg-muted/60",
    milestone: "bg-emerald-500/10",
    neutral: "bg-muted/50",
  };

  /** Klasa stopnia pisma rozpoznająca rozmiar. */
  const SIZE_MARK: Record<ClubInlineTitleSize, string> = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  /** Klasa wcięcia - drugi wymiar rozmiaru, obok stopnia pisma. */
  const PADDING_MARK: Record<ClubInlineTitleSize, string> = {
    sm: "px-2",
    md: "px-2.5",
    lg: "px-3",
  };

  const TONES = Object.keys(TONE_MARK) as ClubInlineTitleTone[];
  const SIZES = Object.keys(SIZE_MARK) as ClubInlineTitleSize[];

  /**
   * Etykieta z DRZEWA TEGO renderu - nie przez `screen`, bo część testów
   * renderuje kilka wariantów i szukanie po całym dokumencie byłoby dwuznaczne.
   */
  function titleIn(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>("[data-club-inline-title]");
    if (found === null) throw new Error("test: brak etykiety tytułu w drzewie");
    return found;
  }

  it.each(TONES)("ton %s trafia do atrybutu danych i do klasy tła", (tone) => {
    const { container } = render(<ClubInlineTitle tone={tone}>Tytuł wątku</ClubInlineTitle>);
    const label = titleIn(container);

    expect(label).toHaveAttribute("data-club-inline-title", tone);
    expect(label.classList.contains(TONE_MARK[tone])).toBe(true);
  });

  it("tony są ROZŁĄCZNE - żaden nie nosi tła innego", () => {
    // Regresja, którą to łapie: skopiowanie wiersza w `TONES` daje dwa
    // rodzaje elementu w jednym kolorze, czyli kolumnę bez rozróżnienia.
    const { container, rerender } = render(
      <ClubInlineTitle tone="neutral">Tytuł wątku</ClubInlineTitle>,
    );

    for (const tone of TONES) {
      rerender(<ClubInlineTitle tone={tone}>Tytuł wątku</ClubInlineTitle>);
      const classes = titleIn(container).classList;
      const matching = TONES.filter((candidate) => classes.contains(TONE_MARK[candidate]));

      expect(matching, `ton ${tone} musi mieć DOKŁADNIE jedno tło`).toEqual([tone]);
    }
  });

  it.each(SIZES)("rozmiar %s ustawia stopień pisma i własne wcięcie", (size) => {
    const { container } = render(<ClubInlineTitle size={size}>Tytuł wątku</ClubInlineTitle>);
    const classes = titleIn(container).classList;

    expect(classes.contains(SIZE_MARK[size])).toBe(true);
    expect(classes.contains(PADDING_MARK[size])).toBe(true);
  });

  it("rozmiary są ROZŁĄCZNE - stopień pisma nie przecieka między nimi", () => {
    const { container, rerender } = render(
      <ClubInlineTitle size="md">Tytuł wątku</ClubInlineTitle>,
    );

    for (const size of SIZES) {
      rerender(<ClubInlineTitle size={size}>Tytuł wątku</ClubInlineTitle>);
      const classes = titleIn(container).classList;
      const matching = SIZES.filter((candidate) => classes.contains(SIZE_MARK[candidate]));

      expect(matching, `rozmiar ${size} musi mieć DOKŁADNIE jeden stopień pisma`).toEqual([size]);
    }
  });

  it("bez propsów bierze ton `neutral` i rozmiar `md`", () => {
    const { container } = render(<ClubInlineTitle>Tytuł wątku</ClubInlineTitle>);
    const label = titleIn(container);

    expect(label).toHaveAttribute("data-club-inline-title", "neutral");
    expect(label.classList.contains(TONE_MARK.neutral)).toBe(true);
    expect(label.classList.contains(SIZE_MARK.md)).toBe(true);
  });

  it("ton i rozmiar są niezależne - kombinacja bierze obie klasy", () => {
    const { container } = render(
      <ClubInlineTitle tone="event" size="lg">
        Tytuł wątku
      </ClubInlineTitle>,
    );
    const classes = titleIn(container).classList;

    expect(classes.contains(TONE_MARK.event)).toBe(true);
    expect(classes.contains(SIZE_MARK.lg)).toBe(true);
  });

  it("`interactive` dokłada sygnał najazdu", () => {
    const { container } = render(<ClubInlineTitle interactive>Tytuł wątku</ClubInlineTitle>);
    const classes = titleIn(container).classList;

    expect(classes.contains("group-hover/title:border-primary/60")).toBe(true);
    expect(classes.contains("hover:text-primary")).toBe(true);
    expect(classes.contains("transition-colors")).toBe(true);
  });

  it.each([
    [undefined, false],
    [false, false],
    [true, true],
  ])("`interactive={%s}` daje sygnał najazdu: %s", (interactive, expected) => {
    // Tytuł nieklikalny z podświetleniem najazdu to obietnica bez pokrycia,
    // dlatego domyślny brak propsa musi zachować się jak jawne `false`.
    const { container } = render(
      <ClubInlineTitle interactive={interactive}>Tytuł wątku</ClubInlineTitle>,
    );
    const classes = titleIn(container).classList;

    expect(classes.contains("hover:text-primary")).toBe(expected);
    expect(classes.contains("group-hover/title:border-primary/60")).toBe(expected);
  });

  it("`className` wywołującego dokłada się do klas własnych", () => {
    const { container } = render(
      <ClubInlineTitle className="max-w-[12rem]">Tytuł wątku</ClubInlineTitle>,
    );
    const classes = titleIn(container).classList;

    expect(classes.contains("max-w-[12rem]")).toBe(true);
    expect(classes.contains("rounded-lg")).toBe(true);
  });

  it("bez `className` nie wstrzykuje śmieci do atrybutu klasy", () => {
    const { container } = render(<ClubInlineTitle>Tytuł wątku</ClubInlineTitle>);

    expect(titleIn(container).className).not.toContain("undefined");
  });

  it("jest `span`-em, nie nagłówkiem - hierarchia zostaje po stronie wywołującego", () => {
    const { container } = render(
      <h2>
        <ClubInlineTitle tone="thread">Tytuł wątku</ClubInlineTitle>
      </h2>,
    );

    expect(titleIn(container).tagName).toBe("SPAN");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Tytuł wątku");
  });

  it("przyjmuje dowolne dzieci, nie tylko napis", () => {
    const { container } = render(
      <ClubInlineTitle>
        <em>Tytuł wątku</em>
      </ClubInlineTitle>,
    );

    expect(titleIn(container).querySelector("em")).not.toBeNull();
    expect(titleIn(container).textContent).toBe("Tytuł wątku");
  });

  it("długie słowo bez spacji łamie się w środku, nie rozpycha karty", () => {
    // `[overflow-wrap:anywhere]` jest tu regułą układu, nie ozdobą: nazwa
    // dokumentu bywa jednym ciągiem i inaczej rozjeżdża kolumnę.
    const { container } = render(<ClubInlineTitle>Tytuł wątku</ClubInlineTitle>);
    const classes = titleIn(container).classList;

    expect(classes.contains("[overflow-wrap:anywhere]")).toBe(true);
    expect(classes.contains("max-w-full")).toBe(true);
  });
});
