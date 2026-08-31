// TABELA po WSZYSTKICH edytorach bloków z `admin/blocks/edit/**` - CZĘŚĆ WSPÓLNA.
//
// CO TU MA DOWÓD. Katalog `edit/` to 62 pliki i 98 wyeksportowanych edytorów,
// które dyspozytor `BlockEditRenderer` mapuje `switch`-em po `block.type`
// (mapa jest EAGER - żadnego `lazy`, wszystkie edytory wchodzą do bundla
// panelu). Każdy z nich dostaje ten sam kontrakt `{ block, onChange }`
// (kilka dokłada `isActive`, dwa tekstowe - pełny zestaw handlerów klawiatury),
// ale kontrakt NIE JEST NAZWANY: każdy plik deklaruje własne, lokalne
// `interface Props`. Właśnie dlatego opłaca się przejechać je JEDNĄ tabelą.
//
// Cztery przypadki na edytor - dokładnie te, które psują się realnie:
//  1. WARTOŚĆ DOMYŚLNA. Blok wstawiony z palety ma `data` prawie puste;
//     edytor musi się na tym wyrenderować, pokazać własne domyślne wartości
//     i NIE zapisać niczego, dopóki redaktor nic nie kliknie (zapis na
//     renderze = pętla aktualizacji dokumentu i „brudna" strona bez akcji).
//  2. WARTOŚĆ EKSTREMALNA. Dokumenty przyszły z importu WordPressa: napisy po
//     kilka tysięcy znaków, zera, liczby ujemne, listy po sto pozycji.
//     Edytor nie ma prawa ani paść, ani pokazać `NaN`.
//  3. WARTOŚĆ NIEPOPRAWNA ODRZUCONA. Liczba jako słowo, lista jako napis,
//     obiekt jako tablica, `null` w każdym polu - edytor musi to SKOERCOWAĆ
//     do czegoś sensownego, a nie przepuścić do pola formularza. Asercja jest
//     twarda: żadne pole liczbowe nie pokazuje `NaN`, a lista wyboru nie
//     pokazuje wartości, której nie ma wśród swoich opcji (taka wartość ginie
//     przy pierwszej zmianie i redaktor traci ustawienie bez ostrzeżenia).
//  4. STAN ODMOWY. `BlockStyle.hidden` to JEDYNY stan „wyłączenia" w modelu
//     bloku i jest udokumentowany jako „hidden on the published site, still
//     shown/editable in the admin canvas" - więc edytor MUSI pozostać w pełni
//     edytowalny, a przy okazji tabela utrwala fakt, że w całej rodzinie NIE
//     MA ani jednego `disabled`/`readOnly` (patrz `blockEditDenialGate.test.ts`).
//
// CZEGO TU NIE MA
//  * asercji na POJEDYNCZE pola konkretnych edytorów - to podłoga, nie sufit.
//    Zachowania specyficzne (klamrowanie wysokości wykresu, poziom nagłówka,
//    limity serii) mieszkają w `blockEditClamping.test.tsx` obok,
//  * atrap warstw własnych. Mockowane są WYŁĄCZNIE GRANICE: `sonner` (toasty),
//    `<Link>` TanStack Routera (kontekst routera), klient Supabase i `fetch`.
//    i18n jest PRAWDZIWE (`@/test/i18nReal`) - dzięki temu zniknięcie klucza ze
//    słownika oblewa test, zamiast przechodzić na echu klucza.
//
// ── DLACZEGO TA TABELA JEST ROZBITA NA SZEŚĆ PLIKÓW ─────────────────────────
// Ten sam powód, co w `admin/builder/ui/organisms/widget-properties/__tests__/
// editorMatrix.shared.tsx`: tam JEDEN plik z 1 486 przypadkami dochodził do
// 7,3 GB RSS i jądro ubijało fork SIGKILL-em, a przebieg kończył się ZIELONYM
// logiem bez tych testów - pokrycie V8 utraconego forka nie dojechało do
// raportu i bramka spadła o 19 pp. Podział na kawałki utrzymuje każdy plik
// w budżecie pamięci i przywraca równoległość. Nowy edytor dopisuje się do
// `ALL_EDITORS` i do JEDNEGO kawałka w `MATRIX_SLICES`.
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import type { SelectionDirection } from "@/lib/blocks/crossSelection";

import { AffiliateBlock } from "../Affiliate";
import { ArchivesBlock } from "../Archives";
import { AudioBlock } from "../Audio";
import { ButtonBlock } from "../Button";
import { ButtonsBlock } from "../Buttons";
import { CalendarBlock } from "../Calendar";
import { CalloutBlock } from "../Callout";
import { CategoriesListBlock } from "../CategoriesList";
import { CodeBlock } from "../Code";
import { ColumnsBlock } from "../Columns";
import { CompareBlock } from "../Compare";
import {
  PostTitleBlock,
  PostDateBlock,
  PostAuthorBlock,
  PostExcerptBlock,
  PostFeaturedImageBlock,
  PostTermsBlock,
  SiteTitleBlock,
  SiteTaglineBlock,
  SiteLogoBlock,
} from "../ContextBlocks";
import {
  StepListBlock,
  ComparisonTableBlock,
  BannerImageBlock,
  VideoHeroBlock,
} from "../ConversionBlocks";
import { CoverBlock } from "../Cover";
import {
  TeamGridBlock,
  LogoGridBlock,
  FeatureGridBlock,
  AlertBannerBlock,
  DividerTextBlock,
} from "../DataSocialBlocks";
import { ChartBlock, DataMapBlock } from "../DataVizBlocks";
import { DetailsBlock } from "../Details";
import { EmbedBlock } from "../Embed";
import { FaqBlock } from "../Faq";
import { FileBlock } from "../File";
import {
  PostStatsBlock,
  PostRatingBlock,
  LoginOutBlock,
  MorePostsBlock,
} from "../FoxizExtraBlocks";
import { GalleryBlock } from "../Gallery";
import { GroupBlock } from "../Group";
import { HeadingBlock } from "../Heading";
import { HtmlBlock } from "../Html";
import { ImageBlock } from "../Image";
import { AccordionBlock, TabsBlock, CountdownBlock, ProgressBlock } from "../InteractiveBlocks";
import { LatestPostsBlock } from "../LatestPosts";
import { LinkPreviewBlock } from "../LinkPreviewBlock";
import { ListBlockEdit } from "../ListBlock";
import { LiveBlogBlock } from "../LiveBlog";
import { LoginFormBlock } from "../LoginForm";
import { LostPasswordFormBlock } from "../LostPasswordForm";
import {
  HeroBlock,
  CtaSectionBlock,
  ImageCarouselBlock,
  ContactFormBlock,
  MapBlock,
} from "../MarketingBlocks";
import { MediaTextBlock } from "../MediaText";
import { NavigationBlock, PostNavigationLinkBlock, QueryLoopBlock } from "../NavLoopBlocks";
import { NewsletterBlock } from "../Newsletter";
import { PageBreakBlock } from "../PageBreak";
import { ParagraphBlock } from "../Paragraph";
import { PollBlockEdit } from "../Poll";
import { AuthorBioBlock, RelatedPostsBlock } from "../PostContextBlocks";
import {
  BreadcrumbsBlock,
  ReadingTimeBlock,
  ShareButtonsBlock,
  PostViewsBlock,
} from "../PostUtilityBlocks";
import { PreformattedBlock } from "../Preformatted";
import {
  IconBoxBlock,
  StatsCounterBlock,
  TestimonialsBlock,
  PricingTableBlock,
  TimelineBlock,
} from "../PresentationBlocks";
import { ProsConsBlock } from "../ProsCons";
import { PullquoteBlock } from "../Pullquote";
import { QuoteBlock } from "../Quote";
import { ReadMoreBlock } from "../ReadMore";
import { RegisterFormBlock } from "../RegisterForm";
import { ResetPasswordFormBlock } from "../ResetPasswordForm";
import { ReviewBlock } from "../Review";
import { SearchBlock } from "../Search";
import { SeparatorBlock } from "../Separator";
import { SocialIconsBlock } from "../SocialIcons";
import { SpacerBlock } from "../Spacer";
import { SpoilerBlock } from "../Spoiler";
import { TableBlockEdit } from "../Table";
import { TagCloudBlock } from "../TagCloud";
import { TocBlock } from "../Toc";
import { VerseBlock } from "../Verse";
import { VideoBlock } from "../Video";
import { XQuoteBlock } from "../XQuote";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Radix `Select` i `Switch` - GRANICA BIBLIOTEKI, nie warstwa aplikacji.
// `AdminSelect` (nasz kod, ZOSTAJE PRAWDZIWY) opiera się na Radiksie, a Radix
// pod happy-dom nie rozwija listy (potrzebuje realnego wskaźnika i pomiarów
// układu) i renderuje wyłącznie przycisk-wyzwalacz. Bez tej podmiany asercja
// „lista wyboru nie pokazuje wartości spoza swoich opcji" nie miałaby czego
// zbadać dla 24 edytorów, bo w DOM-ie nie byłoby ani jednego `<option>`.
// Atrapa z repo zamienia `SelectItem` na `<option>`, więc widać PEŁNĄ dziedzinę
// pola - i dopiero wtedy wartość spoza niej daje się wykryć.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});

// `<Link>` TanStack Routera czyta kontekst routera i RZUCA bez `RouterProvider`
// (edytor `liveblog` linkuje do panelu moderacji). Wspólna atrapa z repo
// zamienia go na prawdziwe `<a href>` - granica frameworka, nie warstwa
// aplikacji.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Klient Supabase - granica danych. Edytory `poll`, `author-bio` i `related-posts`
// czytają listy z bazy, więc bez atrapy przejazd wychodziłby w sieć.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok } = await import("@/test/supabaseChain");
  const stub = supabaseFromStub();
  for (const table of ["polls", "profiles", "posts", "media", "experts"]) {
    stub.setResponse(table, ok([]));
  }
  return { supabase: stub };
});

// KONTEKST NAJEMCY - granica sesji, nie warstwa aplikacji. `MediaPickerDialog`
// (otwierany z edytorów `author-bio`, `gallery`, `cover`) woła
// `useRequiredTenant`, które RZUCA bez zalogowanej sesji, bo zapis mediów jest
// per najemca. Mock jest CZĘŚCIOWY: podmieniamy tylko odczyt identyfikatora
// najemcy, całą resztę `useAuth` zostawiamy prawdziwą. Ten sam zabieg i to samo
// uzasadnienie ma tabela paneli właściwości widgetów.
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-test",
    useCurrentTenantId: () => "tenant-test",
  };
});

// `fetch` - granica przeglądarki. Edytor `data-map` dociąga statyczną geometrię
// z `public/geo/*.json`; w teście ma NIE wychodzić w sieć.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ type: "FeatureCollection", features: [] }),
    })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/**
 * Wspólny kontrakt edytora bloku, WIDZIANY Z TESTU. W produkcji nie ma takiego
 * typu - każdy plik w `edit/` deklaruje własne, lokalne `interface Props`
 * (62 kopie). Ten alias jest NADZBIOREM tych deklaracji, więc każdy edytor
 * daje się mu przypisać bez rzutowania: funkcja przyjmująca węższy obiekt
 * propsów jest podtypem funkcji przyjmującej szerszy.
 */
export type BlockEditor = (props: {
  block: Block;
  isActive: boolean;
  onChange: (next: Block) => void;
  onTransform?: (replacement: Block[]) => void;
  onInsertAfter?: (block: Block) => void;
  onDeleteEmpty?: () => void;
  onMergeWithPrevious?: () => boolean;
  onFocusPrevious?: () => boolean;
  onFocusNext?: () => boolean;
  onSelectAllBlocks?: () => void;
  onExtendBlockSelection?: (dir: SelectionDirection) => boolean;
}) => ReactNode;

/** Wpis tabeli: nazwa komponentu, komponent, typ bloku ze `switch`a dyspozytora. */
export type EditorEntry = readonly [name: string, Editor: BlockEditor, type: BlockType];

/** Wyciek, którego nie wolno pokazać redakcji w polu formularza. */
const LEAKS = ["undefined", "NaN", "[object Object]"] as const;

function fields(root: HTMLElement): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>("input, textarea"));
}

function assertNoLeak(root: HTMLElement, label: string): void {
  const text = root.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: wyciekło „${leak}" do interfejsu`).toBe(false);
  }
  for (const field of fields(root)) {
    for (const leak of LEAKS) {
      expect(field.value.includes(leak), `${label}: wyciekło „${leak}" do pola`).toBe(false);
    }
  }
}

/**
 * Każde pole liczbowe MUSI trzymać się własnego `min`/`max`. Wartość poza
 * zadeklarowanym zakresem znaczy, że edytor przepuścił do formularza liczbę,
 * której warstwa czytająca (`parseChartConfig` i pokrewne) i tak nie użyje -
 * czyli pokazuje redaktorowi coś innego, niż zobaczy czytelnik.
 */
function assertNumbersInRange(root: HTMLElement, label: string): void {
  for (const field of fields(root)) {
    if (field.type !== "number" && field.type !== "range") continue;
    if (field.value === "") continue;
    const value = Number(field.value);
    expect(Number.isFinite(value), `${label}: pole liczbowe pokazuje „${field.value}"`).toBe(true);
    if (field.min !== "") {
      expect(
        value,
        `${label}: pole liczbowe pod dolnym limitem ${field.min}`,
      ).toBeGreaterThanOrEqual(Number(field.min));
    }
    if (field.max !== "") {
      expect(value, `${label}: pole liczbowe nad górnym limitem ${field.max}`).toBeLessThanOrEqual(
        Number(field.max),
      );
    }
  }
}

/**
 * Lista wyboru NIE MOŻE pokazywać wartości, której nie ma wśród swoich opcji.
 * Taka wartość ginie przy pierwszej zmianie pola (przeglądarka pokazuje wtedy
 * pierwszą opcję), więc redaktor traci ustawienie bez żadnego komunikatu.
 * `AdminSelect` (Radix) też ma ten sam problem - jego wartość poza listą
 * renderuje pusty `SelectValue`.
 */
function assertSelectsInEnum(root: HTMLElement, label: string): void {
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>("select"))) {
    const options = Array.from(select.options).map((o) => o.value);
    if (options.length === 0) continue;
    expect(
      options,
      `${label}: lista wyboru pokazuje „${select.value}" spoza swoich opcji`,
    ).toContain(select.value);
  }
}

/** Czy edytor daje redaktorowi cokolwiek do kliknięcia. */
function controls(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll("input, textarea, select, button, [contenteditable]"));
}

/** Czy edytor pokazał cokolwiek: sterowanie, tekst albo choćby element. */
function rendered(root: HTMLElement): boolean {
  return (
    controls(root).length > 0 ||
    (root.textContent?.trim().length ?? 0) > 0 ||
    root.firstElementChild !== null
  );
}

/** Ile pól jest zablokowanych - miara porównawcza dla stanu odmowy. */
function blockedFields(root: HTMLElement): number {
  return dataFields(root).filter((el) => el.hasAttribute("disabled") || el.hasAttribute("readonly"))
    .length;
}

/**
 * POLA WPROWADZANIA DANYCH - bez przycisków. Przycisk bywa wyłączony z własnych,
 * wewnętrznych powodów (np. „wyczyść datę" w `AdminDatePicker` jest wyłączone,
 * dopóki daty nie ma, a przyciski `WordStyleToolbar` - gdy komenda nie ma
 * zastosowania do zaznaczenia). To NIE jest odmowa edycji, więc asercja stanu
 * odmowy patrzy wyłącznie na pola, w które redaktor wpisuje treść.
 */
function dataFields(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll("input, textarea, select, [contenteditable]"));
}

/**
 * EDYTORY BEZ WŁASNEGO FORMULARZA - świadomie. Te cztery renderują w kanwie
 * wyłącznie PODGLĄD, a pola edycji mieszkają w prawym panelu „Blok"
 * (`HtmlBlock` mówi to redaktorowi wprost) albo blok nie ma żadnych opcji
 * (`page-break`, `separator`, `site-tagline`). Dla nich tabela odwraca asercję:
 * muszą pokazać COŚ WIDOCZNEGO i NIE MOGĄ dać ani jednego pola - bo pojawienie
 * się tu pola znaczyłoby dwa źródła prawdy dla tej samej wartości.
 *
 * `HtmlBlock` przyjmuje `onChange` i JAWNIE je ignoruje (`onChange: _onChange`),
 * więc jest to stan udokumentowany w kodzie, a nie przeoczenie.
 */
export const PREVIEW_ONLY: readonly string[] = [
  "HtmlBlock",
  "PageBreakBlock",
  "SeparatorBlock",
  "SiteTaglineBlock",
];

/**
 * EDYTORY Z ZAREJESTROWANYM DEFEKTEM KOERCJI. Na danych spoza dziedziny
 * (`level: "h2"`, `caption: {}`, `height: "wysoko"`) przepuszczają do
 * interfejsu `NaN` albo `[object Object]` - każdy z tych przypadków ma własny
 * `it.fails` z KONKRETNYM wejściem i opisem, co psuje, w
 * `blockEditCoercionDefects.test.tsx` obok. Tabela pomija dla nich asercję
 * wycieku (drugi raz ta sama porażka nic nie dowodzi), ale NADAL sprawdza
 * limity pól, listy wyboru i brak zapisu na renderze.
 *
 * Ta lista jest ZAMKNIĘTA i jest miarą skali defektu: 8 z 98 edytorów. Nowy
 * edytor z tym samym błędem obleje tabelę, zamiast dosiąść się do wyjątku.
 */
export const COERCION_DEFECTS: readonly string[] = [
  "AudioBlock",
  "ChartBlock",
  "HeadingBlock",
  "ImageBlock",
  "ListBlockEdit",
  "ProgressBlock",
  "SpacerBlock",
  "VideoBlock",
];

const NOOP = () => undefined;
const FALSE = () => false;

export function renderEditor(Editor: BlockEditor, block: Block) {
  const changes: Block[] = [];
  const view = renderWithQueryClient(
    <Editor
      block={block}
      isActive
      onChange={(next) => changes.push(next)}
      onTransform={NOOP}
      onInsertAfter={NOOP}
      onDeleteEmpty={NOOP}
      onMergeWithPrevious={FALSE}
      onFocusPrevious={FALSE}
      onFocusNext={FALSE}
      onSelectAllBlocks={NOOP}
      onExtendBlockSelection={FALSE}
    />,
  );
  return { ...view, changes };
}

/**
 * Wartość próbna DOPASOWANA DO TYPU POLA. Przeglądarka (i happy-dom) sanityzuje
 * wpis niezgodny z typem pola do pustego napisu - wpisanie „wpis redakcyjny"
 * w `<input type="month">` nie zmienia więc niczego i `onChange` nigdy nie
 * odpala. Test mierzyłby wtedy nie edytor, a walidację przeglądarki.
 */
function probeValue(pole: HTMLInputElement): string {
  switch (pole.type) {
    case "date":
      return "2026-09-01";
    case "month":
      return "2026-09";
    case "week":
      return "2026-W36";
    case "time":
      return "10:00";
    case "datetime-local":
      return "2026-09-01T10:00";
    case "email":
      return "redakcja@example.com";
    case "url":
      return "https://example.org/z";
    case "color":
      return "#123456";
    default:
      return "wpis redakcyjny";
  }
}

let seq = 0;
function makeBlock(type: BlockType, data: Record<string, Json>, style?: Block["style"]): Block {
  seq += 1;
  return { id: `blk-test-${seq}`, type, data, style };
}

/** 4 000 znaków - dłużej niż jakikolwiek nagłówek czy podpis w bazie. */
const LONG = "ą".repeat(4000);

/**
 * Wartości EKSTREMALNE: zero, liczby ujemne, miliardy, napisy po 4 000 znaków,
 * listy po sto pozycji. Klucze pokrywają wszystkie nazwy używane w rodzinie -
 * jeden literał obsługuje 98 edytorów, bo każdy czyta tylko swoje.
 */
function extremeItem(idx: number): Record<string, Json> {
  return {
    id: `x-${idx}`,
    title: LONG,
    label: LONG,
    text: LONG,
    name: LONG,
    quote: LONG,
    author: "Anna Przykładowa",
    role: LONG,
    avatar: "https://cdn.example.com/a.png",
    image: "https://cdn.example.com/b.png",
    url: "https://example.org/bardzo/dluga/sciezka",
    href: "https://example.org/x",
    icon: "star",
    description: LONG,
    value: -1_000_000_000,
    price: "-0",
    period: "",
    rating: -7,
    percent: 1e9,
    features: [LONG, ""],
    date: "0000-00-00",
    answer: LONG,
    question: LONG,
    content: LONG,
    caption: LONG,
    alt: LONG,
    ctaLabel: "",
    ctaHref: "",
    featured: true,
    suffix: LONG,
  };
}

const EXTREME_LIST: Json[] = Array.from({ length: 100 }, (_, i) => extremeItem(i));

/** Sto pozycji, ale NAPISÓW - dla edytorów, których lista to `string[]`. */
const EXTREME_STRING_LIST: Json[] = Array.from({ length: 100 }, () => LONG);

export const EXTREME_DATA: Record<string, Json> = {
  text: LONG,
  html: LONG,
  code: LONG,
  content: LONG,
  title: LONG,
  heading: LONG,
  subtitle: LONG,
  caption: LONG,
  alt: LONG,
  label: LONG,
  quote: LONG,
  author: "Jan Przykładowy",
  source: LONG,
  url: "https://example.org/x",
  src: "https://cdn.example.com/a.png",
  href: "https://example.org/x",
  email: "redakcja@example.com",
  level: 0,
  height: 0,
  width: 1e9,
  columns: 0,
  count: -5,
  limit: 1e9,
  duration: -1,
  rating: -7,
  max: 0,
  value: 1e9,
  percent: -100,
  size: -1,
  gap: -1,
  perPage: 0,
  items: EXTREME_LIST,
  plans: EXTREME_LIST,
  slides: EXTREME_LIST,
  rows: EXTREME_LIST,
  entries: EXTREME_LIST,
  buttons: EXTREME_LIST,
  pros: [LONG, LONG],
  cons: [LONG, LONG],
  categories: [LONG, ""],
  series: EXTREME_LIST,
  values: [-1e9, 0, 1e9],
  regions: EXTREME_LIST,
  steps: EXTREME_LIST,
  tabs: EXTREME_LIST,
  networks: EXTREME_LIST,
  options: EXTREME_LIST,
  features: [LONG, ""],
  align: "left",
};

/**
 * NADPISANIA fixture'u ekstremalnego dla edytorów, których lista to `string[]`,
 * a nie lista obiektów. „Ekstremalny" znaczy KSZTAŁT POPRAWNY, ROZMIAR skrajny -
 * podanie tam obiektu byłoby przypadkiem trzecim (wartość niepoprawna), a ten
 * ma własny fixture i własne asercje. Bez tego rozdziału przypadek drugi
 * mierzyłby to samo, co trzeci, i to na tych samych edytorach.
 */
const EXTREME_OVERRIDES: Readonly<Record<string, Record<string, Json>>> = {
  ListBlockEdit: { items: EXTREME_STRING_LIST, levels: [1, 2, 3, 7, -1] },
};

/** Dane ekstremalne dla nazwanego edytora - z nadpisaniami, jeśli je ma. */
function extremeFor(name: string): Record<string, Json> {
  return { ...EXTREME_DATA, ...(EXTREME_OVERRIDES[name] ?? {}) };
}

/**
 * Pozycja listy w kształcie POPRAWNYM i kompletnym - pod wszystkie nazwy
 * podkluczy, jakich używa którykolwiek edytor rodziny.
 */
const RICH_ITEM: Record<string, Json> = {
  id: "it-1",
  title: "Tytuł pozycji",
  label: "Etykieta",
  text: "Treść pozycji",
  name: "Anna Przykładowa",
  role: "Ekspertka",
  quote: "Cytat testowy",
  question: "Pytanie?",
  answer: "Odpowiedź.",
  description: "Opis pozycji",
  caption: "Podpis",
  alt: "Opis obrazka",
  url: "https://example.org/a",
  href: "https://example.org/b",
  src: "https://cdn.example.com/a.png",
  image: "https://cdn.example.com/b.png",
  avatar: "https://cdn.example.com/c.png",
  logo: "https://cdn.example.com/d.png",
  icon: "star",
  color: "#ff8800",
  value: 42,
  values: [1, 2, 3],
  percent: 60,
  rating: 4,
  price: "199",
  period: "mies.",
  date: "2026-09-01",
  time: "10:00",
  suffix: "%",
  code: "PL",
  network: "x",
  featured: true,
  open: true,
  features: ["Pierwsza", "Druga"],
  ctaLabel: "Sprawdź",
  ctaHref: "https://example.org/cta",
};

const RICH_LIST: Json[] = [{ ...RICH_ITEM }, { ...RICH_ITEM, id: "it-2", name: "Jan Przykładowy" }];
const RICH_STRINGS: Json[] = ["Pierwsza pozycja", "Druga pozycja"];

/**
 * Dane PEŁNE i POPRAWNE - po dwie pozycje w każdej liście, jakiej używa
 * którykolwiek edytor. Bez tego edytory listowe renderują tylko nagłówek
 * i przycisk „dodaj", a CAŁA ich logika (wiersze, pola per pozycja, usuwanie,
 * przenoszenie) nie jest w ogóle montowana.
 */
export const RICH_DATA: Record<string, Json> = {
  text: "Treść bloku",
  html: "<p>Treść</p>",
  code: "const a = 1;",
  content: "Treść",
  title: "Nagłówek",
  heading: "Nagłówek",
  subtitle: "Podtytuł",
  caption: "Podpis",
  alt: "Opis obrazka",
  label: "Etykieta",
  quote: "Cytat",
  author: "Anna Przykładowa",
  source: "Źródło",
  url: "https://example.org/a",
  src: "https://cdn.example.com/a.png",
  href: "https://example.org/b",
  email: "redakcja@example.com",
  poster: "https://cdn.example.com/p.png",
  level: 3,
  height: 240,
  width: 320,
  columns: 3,
  count: 6,
  limit: 6,
  duration: 1500,
  rating: 4,
  max: 100,
  value: 60,
  percent: 60,
  size: "md",
  gap: 16,
  perPage: 6,
  align: "center",
  variant: "card",
  layout: "grid",
  kind: "bar",
  targetAt: "2026-12-31T23:59",
  date: "2026-09-01",
  items: RICH_LIST,
  plans: RICH_LIST,
  slides: RICH_LIST,
  rows: RICH_LIST,
  entries: RICH_LIST,
  buttons: RICH_LIST,
  steps: RICH_LIST,
  tabs: RICH_LIST,
  networks: RICH_LIST,
  options: RICH_LIST,
  series: RICH_LIST,
  regions: RICH_LIST,
  pros: RICH_STRINGS,
  cons: RICH_STRINGS,
  categories: RICH_STRINGS,
  features: RICH_STRINGS,
  values: [1, 2, 3],
  images: [
    { url: "https://cdn.example.com/g1.png", alt: "Pierwsze zdjęcie" },
    { url: "https://cdn.example.com/g2.png", alt: "Drugie zdjęcie" },
  ],
  criteria: [
    { label: "Jakość", score: 8 },
    { label: "Cena", score: 6 },
  ],
  ordered: true,
  open: true,
  autoplay: true,
  showAuthor: true,
};

const RICH_OVERRIDES: Readonly<Record<string, Record<string, Json>>> = {
  ListBlockEdit: { items: RICH_STRINGS, levels: [1, 2] },
  // `rows` ma w rodzinie DWA kształty: tabela trzyma tam siatkę napisów,
  // a `comparison-table` listę obiektów. Jeden literał nie obsłuży obu, więc
  // tabela dostaje własny - razem z metadanymi scaleń i wyrównań z importu,
  // bo dopiero one włączają gałąź `hasMeta`.
  TableBlockEdit: {
    rows: [
      ["Nagłówek A", "Nagłówek B"],
      ["Komórka 1", "Komórka 2"],
    ],
    spans: [
      [
        [1, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1],
      ],
    ],
    aligns: [
      ["left", "center"],
      ["right", ""],
    ],
    header: true,
  },
  // Separator ma trzy warianty rysowania i ŻADNEGO pola - pokrycie jego
  // gałęzi bierze się wyłącznie z przejechania wariantów w danych.
  SeparatorBlock: { variant: "dots" },
};

function richFor(name: string): Record<string, Json> {
  return { ...RICH_DATA, ...(RICH_OVERRIDES[name] ?? {}) };
}

/**
 * TA SAMA pełna treść, ale z DRUGIM zestawem wartości wyliczeniowych i ze
 * WSZYSTKIMI przełącznikami JAWNIE wyłączonymi. Edytory zmieniają zestaw
 * widocznych pól w zależności od wariantu, układu, źródła danych i trybu -
 * bez drugiego przejazdu połowa tych gałęzi nie jest w ogóle renderowana,
 * a to w nich mieszkają pola, które redaktor faktycznie wypełnia. Wszystkie
 * flagi są domyślnie WŁĄCZONE (`!== false`), więc dopiero jawne `false`
 * przechodzi ich drugą gałąź.
 */
export const ALT_DATA: Record<string, Json> = {
  ...RICH_DATA,
  variant: "minimal",
  style: "outline",
  layout: "list",
  align: "right",
  size: "sm",
  kind: "pie",
  mode: "existing",
  source: "inline",
  authorSource: "inline",
  display: "profile",
  status: "draft",
  scope: "world",
  ordered: false,
  open: false,
  allowMultiple: false,
  animate: false,
  autoRefresh: false,
  autoplay: false,
  bordered: false,
  dismissible: false,
  grayscale: false,
  loop: false,
  preview: false,
  requireConsent: false,
  reverseChronological: false,
  rounded: false,
  showAvatar: false,
  showButton: false,
  showGrid: false,
  showHome: false,
  showIcon: false,
  showLegend: false,
  showPhone: false,
  showPostsCount: false,
  showSocial: false,
  showSubject: false,
  showTitle: false,
  showValue: false,
  showValues: false,
  stacked: false,
};

const ALT_OVERRIDES: Readonly<Record<string, Record<string, Json>>> = {
  ListBlockEdit: { items: RICH_STRINGS, levels: [1, 2] },
  TableBlockEdit: {
    rows: [
      ["A", "B", "C"],
      ["1", "2", "3"],
    ],
    header: false,
  },
  SeparatorBlock: { variant: "wide" },
  // `author-bio` ma DWIE osie zależności, które trzeba ustawić razem:
  // źródło autora (`authorSource: "inline"` włącza cały formularz autora
  // własnego z listą linków społecznościowych) i wariant prezentacji
  // (`variant: "profile"` dokłada panel ustawień karty profilu, wspólny
  // z widgetem `author-profile-card` w builderze). Bez obu naraz połowa
  // tego edytora nie jest w ogóle montowana.
  AuthorBioBlock: {
    variant: "profile",
    authorSource: "inline",
    inlineAuthor: {
      name: "Anna Przykładowa",
      bio: "Analityczka polityki europejskiej.",
      avatarUrl: "https://cdn.example.com/a.png",
      customSocials: [
        { label: "Strona", url: "https://example.org", iconUrl: "" },
        { label: "Profil", url: "https://example.org/p", iconUrl: "https://cdn.example.com/i.png" },
      ],
    },
  },
};

function altFor(name: string): Record<string, Json> {
  return { ...ALT_DATA, ...(ALT_OVERRIDES[name] ?? {}) };
}

/** Przejazd po wszystkich sterowaniach jednego renderu - bez asercji. */
function driveAllControls(container: HTMLElement): void {
  for (const pole of Array.from(container.querySelectorAll<HTMLInputElement>("input, textarea"))) {
    if (pole.disabled || pole.readOnly || pole.type === "file") continue;
    if (pole.type === "checkbox" || pole.type === "radio") {
      fireEvent.click(pole);
      continue;
    }
    if (pole.type === "number" || pole.type === "range") {
      fireEvent.change(pole, { target: { value: pole.min === "" ? "1" : pole.min } });
      fireEvent.change(pole, { target: { value: pole.max === "" ? "7" : pole.max } });
      continue;
    }
    fireEvent.change(pole, { target: { value: probeValue(pole) } });
  }
  for (const lista of Array.from(container.querySelectorAll<HTMLSelectElement>("select"))) {
    if (lista.disabled) continue;
    for (const opcja of Array.from(lista.options)) {
      fireEvent.change(lista, { target: { value: opcja.value } });
    }
  }
  for (const przycisk of Array.from(container.querySelectorAll<HTMLButtonElement>("button"))) {
    if (przycisk.disabled) continue;
    fireEvent.click(przycisk);
  }
}

/**
 * Wartości NIEPOPRAWNE, dokładnie w kształtach, jakie realnie siedzą w bazie po
 * imporcie WordPressa i po starszych wydaniach panelu: lista jako napis, liczba
 * jako słowo, obiekt jako tablica, `null` wszędzie, wartość wyliczeniowa spoza
 * dziedziny.
 */
export const INVALID_DATA: Record<string, Json> = {
  text: null,
  html: 7,
  code: null,
  content: [],
  title: 7,
  subtitle: null,
  caption: {},
  alt: false,
  label: [],
  quote: null,
  author: 0,
  source: null,
  url: 7,
  src: null,
  href: [],
  email: null,
  level: "nie-liczba",
  height: "wysoko",
  width: null,
  columns: "trzy",
  count: "dużo",
  limit: null,
  duration: "szybko",
  rating: "pięć",
  max: null,
  value: "nic",
  percent: "sto",
  size: {},
  gap: "brak",
  perPage: null,
  align: "gdzieś-indziej",
  variant: 7,
  layout: null,
  kind: "nie-ma-takiego",
  style: 7,
  type: null,
  items: "nie-tablica",
  plans: null,
  slides: 7,
  rows: {},
  entries: "x",
  buttons: null,
  pros: "tak",
  cons: null,
  categories: 7,
  series: "seria",
  values: "wartości",
  regions: "PL",
  steps: null,
  tabs: 7,
  networks: {},
  options: "a,b",
  features: 7,
  ordered: "tak",
  open: "nie",
  autoplay: "1",
  showAuthor: "0",
};

/**
 * Pełna tabela edytorów. Trzeci element wpisu to typ bloku ZE SWITCHA
 * `BlockEditRenderer` - dzięki temu bramka parytetu obok może porównać tabelę
 * z dyspozytorem i wyłapać edytor dopisany bez wpisu tutaj.
 */
export const ALL_EDITORS: readonly EditorEntry[] = [
  ["AffiliateBlock", AffiliateBlock, "affiliate"],
  ["ArchivesBlock", ArchivesBlock, "archives"],
  ["AudioBlock", AudioBlock, "audio"],
  ["ButtonBlock", ButtonBlock, "button"],
  ["ButtonsBlock", ButtonsBlock, "buttons"],
  ["CalendarBlock", CalendarBlock, "calendar"],
  ["CalloutBlock", CalloutBlock, "callout"],
  ["CategoriesListBlock", CategoriesListBlock, "categories-list"],
  ["CodeBlock", CodeBlock, "code"],
  ["ColumnsBlock", ColumnsBlock, "columns"],
  ["CompareBlock", CompareBlock, "compare"],
  ["PostTitleBlock", PostTitleBlock, "post-title"],
  ["PostDateBlock", PostDateBlock, "post-date"],
  ["PostAuthorBlock", PostAuthorBlock, "post-author"],
  ["PostExcerptBlock", PostExcerptBlock, "post-excerpt"],
  ["PostFeaturedImageBlock", PostFeaturedImageBlock, "post-featured-image"],
  ["PostTermsBlock", PostTermsBlock, "post-terms"],
  ["SiteTitleBlock", SiteTitleBlock, "site-title"],
  ["SiteTaglineBlock", SiteTaglineBlock, "site-tagline"],
  ["SiteLogoBlock", SiteLogoBlock, "site-logo"],
  ["StepListBlock", StepListBlock, "step-list"],
  ["ComparisonTableBlock", ComparisonTableBlock, "comparison-table"],
  ["BannerImageBlock", BannerImageBlock, "banner-image"],
  ["VideoHeroBlock", VideoHeroBlock, "video-hero"],
  ["CoverBlock", CoverBlock, "cover"],
  ["TeamGridBlock", TeamGridBlock, "team-grid"],
  ["LogoGridBlock", LogoGridBlock, "logo-grid"],
  ["FeatureGridBlock", FeatureGridBlock, "feature-grid"],
  ["AlertBannerBlock", AlertBannerBlock, "alert-banner"],
  ["DividerTextBlock", DividerTextBlock, "divider-text"],
  ["ChartBlock", ChartBlock, "chart"],
  ["DataMapBlock", DataMapBlock, "data-map"],
  ["DetailsBlock", DetailsBlock, "details"],
  ["EmbedBlock", EmbedBlock, "embed"],
  ["FaqBlock", FaqBlock, "faq"],
  ["FileBlock", FileBlock, "file"],
  ["PostStatsBlock", PostStatsBlock, "post-stats"],
  ["PostRatingBlock", PostRatingBlock, "post-rating"],
  ["LoginOutBlock", LoginOutBlock, "loginout"],
  ["MorePostsBlock", MorePostsBlock, "more-posts"],
  ["GalleryBlock", GalleryBlock, "gallery"],
  ["GroupBlock", GroupBlock, "group"],
  ["HeadingBlock", HeadingBlock, "heading"],
  ["HtmlBlock", HtmlBlock, "html"],
  ["ImageBlock", ImageBlock, "image"],
  ["AccordionBlock", AccordionBlock, "accordion"],
  ["TabsBlock", TabsBlock, "tabs"],
  ["CountdownBlock", CountdownBlock, "countdown"],
  ["ProgressBlock", ProgressBlock, "progress"],
  ["LatestPostsBlock", LatestPostsBlock, "latest-posts"],
  ["LinkPreviewBlock", LinkPreviewBlock, "link-preview"],
  ["ListBlockEdit", ListBlockEdit, "list"],
  ["LiveBlogBlock", LiveBlogBlock, "liveblog"],
  ["LoginFormBlock", LoginFormBlock, "login-form"],
  ["LostPasswordFormBlock", LostPasswordFormBlock, "lost-password-form"],
  ["HeroBlock", HeroBlock, "hero"],
  ["CtaSectionBlock", CtaSectionBlock, "cta-section"],
  ["ImageCarouselBlock", ImageCarouselBlock, "image-carousel"],
  ["ContactFormBlock", ContactFormBlock, "contact-form"],
  ["MapBlock", MapBlock, "map"],
  ["MediaTextBlock", MediaTextBlock, "media-text"],
  ["NavigationBlock", NavigationBlock, "navigation"],
  ["PostNavigationLinkBlock", PostNavigationLinkBlock, "post-navigation-link"],
  ["QueryLoopBlock", QueryLoopBlock, "query-loop"],
  ["NewsletterBlock", NewsletterBlock, "newsletter"],
  ["PageBreakBlock", PageBreakBlock, "page-break"],
  ["ParagraphBlock", ParagraphBlock, "paragraph"],
  ["PollBlockEdit", PollBlockEdit, "poll"],
  ["AuthorBioBlock", AuthorBioBlock, "author-bio"],
  ["RelatedPostsBlock", RelatedPostsBlock, "related-posts"],
  ["BreadcrumbsBlock", BreadcrumbsBlock, "breadcrumbs"],
  ["ReadingTimeBlock", ReadingTimeBlock, "reading-time"],
  ["ShareButtonsBlock", ShareButtonsBlock, "share-buttons"],
  ["PostViewsBlock", PostViewsBlock, "post-views"],
  ["PreformattedBlock", PreformattedBlock, "preformatted"],
  ["IconBoxBlock", IconBoxBlock, "icon-box"],
  ["StatsCounterBlock", StatsCounterBlock, "stats-counter"],
  ["TestimonialsBlock", TestimonialsBlock, "testimonials"],
  ["PricingTableBlock", PricingTableBlock, "pricing-table"],
  ["TimelineBlock", TimelineBlock, "timeline"],
  ["ProsConsBlock", ProsConsBlock, "proscons"],
  ["PullquoteBlock", PullquoteBlock, "pullquote"],
  ["QuoteBlock", QuoteBlock, "quote"],
  ["ReadMoreBlock", ReadMoreBlock, "read-more"],
  ["RegisterFormBlock", RegisterFormBlock, "register-form"],
  ["ResetPasswordFormBlock", ResetPasswordFormBlock, "reset-password-form"],
  ["ReviewBlock", ReviewBlock, "review"],
  ["SearchBlock", SearchBlock, "search"],
  ["SeparatorBlock", SeparatorBlock, "separator"],
  ["SocialIconsBlock", SocialIconsBlock, "social-icons"],
  ["SpacerBlock", SpacerBlock, "spacer"],
  ["SpoilerBlock", SpoilerBlock, "spoiler"],
  ["TableBlockEdit", TableBlockEdit, "table"],
  ["TagCloudBlock", TagCloudBlock, "tag-cloud"],
  ["TocBlock", TocBlock, "toc"],
  ["VerseBlock", VerseBlock, "verse"],
  ["VideoBlock", VideoBlock, "video"],
  ["XQuoteBlock", XQuoteBlock, "xquote"],
];

/**
 * Podział na kawałki. Nowy edytor MUSI trafić do dokładnie jednego - bramka
 * `blockEditMatrixSlices.test.ts` obok pilnuje, że suma kawałków to dokładnie
 * `ALL_EDITORS`, więc edytor dopisany do tabeli i pominięty w podziale nie
 * przejdzie cicho poza przejazd.
 */
export const MATRIX_SLICES = {
  part1: [
    "AffiliateBlock",
    "ArchivesBlock",
    "AudioBlock",
    "ButtonBlock",
    "ButtonsBlock",
    "CalendarBlock",
    "CalloutBlock",
    "CategoriesListBlock",
    "CodeBlock",
    "ColumnsBlock",
    "CompareBlock",
    "PostTitleBlock",
    "PostDateBlock",
    "PostAuthorBlock",
    "PostExcerptBlock",
    "PostFeaturedImageBlock",
    "PostTermsBlock",
  ],
  part2: [
    "SiteTitleBlock",
    "SiteTaglineBlock",
    "SiteLogoBlock",
    "StepListBlock",
    "ComparisonTableBlock",
    "BannerImageBlock",
    "VideoHeroBlock",
    "CoverBlock",
    "TeamGridBlock",
    "LogoGridBlock",
    "FeatureGridBlock",
    "AlertBannerBlock",
    "DividerTextBlock",
    "ChartBlock",
    "DataMapBlock",
    "DetailsBlock",
    "EmbedBlock",
  ],
  part3: [
    "FaqBlock",
    "FileBlock",
    "PostStatsBlock",
    "PostRatingBlock",
    "LoginOutBlock",
    "MorePostsBlock",
    "GalleryBlock",
    "GroupBlock",
    "HeadingBlock",
    "HtmlBlock",
    "ImageBlock",
    "AccordionBlock",
    "TabsBlock",
    "CountdownBlock",
    "ProgressBlock",
    "LatestPostsBlock",
  ],
  part4: [
    "LinkPreviewBlock",
    "ListBlockEdit",
    "LiveBlogBlock",
    "LoginFormBlock",
    "LostPasswordFormBlock",
    "HeroBlock",
    "CtaSectionBlock",
    "ImageCarouselBlock",
    "ContactFormBlock",
    "MapBlock",
    "MediaTextBlock",
    "NavigationBlock",
    "PostNavigationLinkBlock",
    "QueryLoopBlock",
    "NewsletterBlock",
    "PageBreakBlock",
  ],
  part5: [
    "ParagraphBlock",
    "PollBlockEdit",
    "AuthorBioBlock",
    "RelatedPostsBlock",
    "BreadcrumbsBlock",
    "ReadingTimeBlock",
    "ShareButtonsBlock",
    "PostViewsBlock",
    "PreformattedBlock",
    "IconBoxBlock",
    "StatsCounterBlock",
    "TestimonialsBlock",
    "PricingTableBlock",
    "TimelineBlock",
    "ProsConsBlock",
    "PullquoteBlock",
  ],
  part6: [
    "QuoteBlock",
    "ReadMoreBlock",
    "RegisterFormBlock",
    "ResetPasswordFormBlock",
    "ReviewBlock",
    "SearchBlock",
    "SeparatorBlock",
    "SocialIconsBlock",
    "SpacerBlock",
    "SpoilerBlock",
    "TableBlockEdit",
    "TagCloudBlock",
    "TocBlock",
    "VerseBlock",
    "VideoBlock",
    "XQuoteBlock",
  ],
} as const;

export type MatrixSlice = keyof typeof MATRIX_SLICES;

/** Nazwy wszystkich edytorów tabeli - kolejność jak w `ALL_EDITORS`. */
export const ALL_EDITOR_NAMES: readonly string[] = ALL_EDITORS.map(([name]) => name);

/**
 * Edytory jednego kawałka. Nieznana nazwa RZUCA - literówka w liście nie ma
 * prawa cicho wypisać edytora z przejazdu.
 */
export function editorsOf(slice: MatrixSlice): readonly EditorEntry[] {
  return MATRIX_SLICES[slice].map((name) => {
    const entry = ALL_EDITORS.find(([n]) => n === name);
    if (!entry)
      throw new Error(
        `blockEditMatrix: nieznany edytor \u201e${name}" w kawa\u0142ku \u201e${slice}"`,
      );
    return entry;
  });
}

/**
 * Pełny przejazd czterech przypadków dla PODANEGO podzbioru edytorów. Wołane
 * z pliku kawałka.
 */
export function defineBlockEditMatrix(entries: readonly EditorEntry[]): void {
  const withForm = entries.filter(([name]) => !PREVIEW_ONLY.includes(name));
  const previewOnly = entries.filter(([name]) => PREVIEW_ONLY.includes(name));
  const coercionOk = entries.filter(([name]) => !COERCION_DEFECTS.includes(name));

  beforeEach(() => {
    // Edytory z podglądem na żywo (`chart`, `data-map`, `author-bio`) logują
    // ostrzeżenia Reacta przy danych spoza dziedziny - to nie jest przedmiotem
    // dowodu tej tabeli, a zaśmieca log przejazdu 98 komponentów.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  describe("1. wartość domyślna - blok świeżo wstawiony z palety", () => {
    if (withForm.length > 0) {
      it.each(withForm)("%s daje formularz na pustych danych", (name, Editor, type) => {
        const { container } = renderEditor(Editor, makeBlock(type, {}));
        expect(
          controls(container).length,
          `${name}: brak czegokolwiek, czym redaktor mógłby ruszyć blok`,
        ).toBeGreaterThan(0);
        assertNoLeak(container, name);
      });

      it.each(withForm)(
        "%s domyślne wartości mieszczą się w limitach pól",
        (name, Editor, type) => {
          const { container } = renderEditor(Editor, makeBlock(type, {}));
          assertNumbersInRange(container, name);
          assertSelectsInEnum(container, name);
        },
      );
    }

    if (previewOnly.length > 0) {
      it.each(previewOnly)(
        "%s (sam podgląd) pokazuje treść, ale ŻADNEGO pola - edycja jest w panelu",
        (name, Editor, type) => {
          const { container } = renderEditor(Editor, makeBlock(type, {}));
          expect(rendered(container), `${name}: pusty podgląd`).toBe(true);
          expect(controls(container), `${name}: podgląd dostał sterowanie`).toHaveLength(0);
          assertNoLeak(container, name);
        },
      );
    }

    it.each(entries)("%s nie zapisuje niczego na samym renderze", (name, Editor, type) => {
      const { changes } = renderEditor(Editor, makeBlock(type, {}));
      expect(changes, `${name}: zapis bez akcji redaktora`).toEqual([]);
    });
  });

  describe("2. wartość ekstremalna - napisy 4 000 znaków, zera, liczby ujemne, sto pozycji", () => {
    it.each(entries)("%s znosi wartości ekstremalne", (name, Editor, type) => {
      const { container } = renderEditor(Editor, makeBlock(type, extremeFor(name)));
      expect(rendered(container), `${name}: pusty render na ekstremach`).toBe(true);
      assertNoLeak(container, name);
    });

    it.each(entries)("%s na ekstremach nadal nie zapisuje bez akcji", (name, Editor, type) => {
      const { changes } = renderEditor(Editor, makeBlock(type, extremeFor(name)));
      expect(changes, `${name}: zapis bez akcji redaktora`).toEqual([]);
    });
  });

  describe("3. wartość niepoprawna - koercja, a nie przepuszczenie do pola", () => {
    it.each(entries)("%s renderuje się na danych w złych typach", (name, Editor, type) => {
      const { container } = renderEditor(Editor, makeBlock(type, INVALID_DATA));
      expect(rendered(container), `${name}: pusty render na złych typach`).toBe(true);
    });

    if (coercionOk.length > 0) {
      it.each(coercionOk)(
        "%s NIE przepuszcza niepoprawnej wartości do interfejsu",
        (name, Editor, type) => {
          const { container } = renderEditor(Editor, makeBlock(type, INVALID_DATA));
          assertNoLeak(container, name);
        },
      );
    }

    it.each(entries)(
      "%s odrzuca niepoprawne liczby i wartości spoza listy wyboru",
      (name, Editor, type) => {
        const { container } = renderEditor(Editor, makeBlock(type, INVALID_DATA));
        assertNumbersInRange(container, name);
        assertSelectsInEnum(container, name);
      },
    );

    it.each(entries)("%s na złych typach nie zapisuje bez akcji", (name, Editor, type) => {
      const { changes } = renderEditor(Editor, makeBlock(type, INVALID_DATA));
      expect(changes, `${name}: zapis bez akcji redaktora`).toEqual([]);
    });
  });

  describe("2b. przejazd po WSZYSTKICH polach - każdy zapis oddaje POPRAWNY blok", () => {
    // PO CO. Same rendery pokrywają wyłącznie ODCZYT danych. Cała logika
    // ZAPISU (`onChange({ ...block, data: { ...block.data, x: … } })`,
    // dopisywanie i usuwanie pozycji listy, przełączniki) siedzi w domknięciach,
    // których render nie woła - a to w nich mieszka defekt typu „zapis pod
    // złym kluczem" albo „zapis gubi `id` bloku".
    //
    // NIEZMIENNIK. Każdy zapis MUSI oddać blok z TYM SAMYM `id` i TYM SAMYM
    // `type`, z `data` będącym obiektem. Zmiana `id` rozspaja blok z historią
    // (undo/redo trzyma się identyfikatorów) i z zakotwiczeniami nagłówków;
    // zmiana `type` przez pole formularza to cicha podmiana bloku pod ręką
    // redaktora. Żadna zapisana wartość nie może też być `undefined` - taki
    // klucz ginie przy serializacji dokumentu do JSON-a, więc ustawienie
    // „wyczyszczone" wraca po przeładowaniu strony.
    it.each(entries)("%s: pola przyjmują wpis i oddają poprawny blok", (name, Editor, type) => {
      const start = makeBlock(type, richFor(name));
      const { container, changes } = renderEditor(Editor, start);

      for (const pole of Array.from(
        container.querySelectorAll<HTMLInputElement>("input, textarea"),
      )) {
        if (pole.disabled || pole.readOnly) continue;
        if (pole.type === "checkbox" || pole.type === "radio") {
          fireEvent.click(pole);
          continue;
        }
        if (pole.type === "number" || pole.type === "range") {
          const dolny = pole.min === "" ? "1" : pole.min;
          const gorny = pole.max === "" ? "7" : pole.max;
          fireEvent.change(pole, { target: { value: dolny } });
          fireEvent.change(pole, { target: { value: gorny } });
          continue;
        }
        if (pole.type === "file") continue;
        fireEvent.change(pole, { target: { value: probeValue(pole) } });
      }

      for (const lista of Array.from(container.querySelectorAll<HTMLSelectElement>("select"))) {
        if (lista.disabled) continue;
        for (const opcja of Array.from(lista.options)) {
          fireEvent.change(lista, { target: { value: opcja.value } });
        }
      }

      for (const przycisk of Array.from(container.querySelectorAll<HTMLButtonElement>("button"))) {
        if (przycisk.disabled) continue;
        fireEvent.click(przycisk);
      }

      for (const [i, next] of changes.entries()) {
        expect(next.id, `${name}: zapis ${i} zmienił identyfikator bloku`).toBe(start.id);
        expect(next.type, `${name}: zapis ${i} zmienił typ bloku`).toBe(start.type);
        expect(
          next.data !== null && typeof next.data === "object" && !Array.isArray(next.data),
          `${name}: zapis ${i} oddał data nie będące obiektem`,
        ).toBe(true);
        for (const [klucz, wartosc] of Object.entries(next.data)) {
          expect(
            wartosc,
            `${name}: zapis ${i} ustawił ${klucz} na undefined - ten klucz zginie w JSON-ie`,
          ).not.toBeUndefined();
        }
      }
    });

    it.each(entries)(
      "%s: DRUGI zestaw wartości wyliczeniowych i przełączniki wyłączone",
      (name, Editor, type) => {
        // Ten przejazd nie powtarza asercji wyżej - jego przedmiotem są POLA
        // ZALEŻNE: te, które pojawiają się dopiero przy innym wariancie,
        // innym układzie albo wyłączonej fladze. Niezmiennik jest ten sam
        // (poprawny blok na wyjściu), ale przechodzi po innych gałęziach.
        const start = makeBlock(type, altFor(name));
        const { container, changes } = renderEditor(Editor, start);
        assertNoLeak(container, name);
        driveAllControls(container);
        for (const [i, next] of changes.entries()) {
          expect(next.id, `${name}: zapis ${i} zmienił identyfikator bloku`).toBe(start.id);
          expect(next.type, `${name}: zapis ${i} zmienił typ bloku`).toBe(start.type);
        }
      },
    );

    it.each(entries)("%s: co najmniej jedno pole faktycznie zapisuje", (name, Editor, type) => {
      // Edytor, w którym ŻADNE pole nie woła `onChange`, jest atrapą - redaktor
      // wpisuje tekst i traci go przy pierwszym przerysowaniu kanwy.
      if (PREVIEW_ONLY.includes(name)) return;
      const { container, changes } = renderEditor(Editor, makeBlock(type, richFor(name)));
      const pola = Array.from(
        container.querySelectorAll<HTMLInputElement>('input:not([type="file"]), textarea'),
      ).filter((el) => !el.disabled && !el.readOnly);
      if (pola.length === 0) return;
      fireEvent.change(pola[0], { target: { value: probeValue(pola[0]) } });
      if (pola[0].type === "checkbox") fireEvent.click(pola[0]);
      expect(changes.length, `${name}: pierwsze pole nie zapisuje niczego`).toBeGreaterThan(0);
    });
  });

  describe("4. stan odmowy - `style.hidden` NIE odbiera prawa edycji", () => {
    // `BlockStyle.hidden` jest JEDYNYM stanem „wyłączenia" w modelu bloku
    // i jego kontrakt brzmi wprost: „hidden on the published site, still
    // shown/editable in the admin canvas" (`src/lib/blocks/types.ts:136`).
    // Gdyby któryś edytor zaczął to czytać i blokować pola, redaktor nie
    // mógłby odkryć bloku z powrotem - i o tym jest ta asercja.
    if (withForm.length > 0) {
      it.each(withForm)(
        "%s blok ukryty na stronie pozostaje w pełni edytowalny",
        (name, Editor, type) => {
          // Porównanie DWÓCH renderów tego samego bloku - z `hidden` i bez -
          // zamiast „zero zablokowanych pól". Część edytorów blokuje pole
          // ZALEŻNE z własnych, poprawnych powodów (`AdminDateTimePicker`
          // trzyma pole godziny wyłączone, dopóki nie ma daty - bez daty
          // godzina nie ma sensu). Przedmiotem dowodu nie jest brak takich
          // pól, a to, że `style.hidden` NIE ZMIENIA ANI JEDNEGO z nich.
          const widoczny = renderEditor(Editor, makeBlock(type, {}));
          const ukryty = renderEditor(Editor, makeBlock(type, {}, { hidden: true, align: "full" }));
          expect(
            controls(ukryty.container).length,
            `${name}: ukryty blok stracił formularz`,
          ).toBeGreaterThan(0);
          expect(
            controls(ukryty.container).length,
            `${name}: ukryty blok ma inną liczbę sterowań niż widoczny`,
          ).toBe(controls(widoczny.container).length);
          expect(
            blockedFields(ukryty.container),
            `${name}: ukrycie bloku zablokowało pole - to zmiana kontraktu`,
          ).toBe(blockedFields(widoczny.container));
        },
      );
    }

    if (previewOnly.length > 0) {
      it.each(previewOnly)(
        "%s (sam podgląd) odmawia edycji NIEZALEŻNIE od `style.hidden`",
        (name, Editor, type) => {
          const { container, changes } = renderEditor(
            Editor,
            makeBlock(type, {}, { hidden: true }),
          );
          expect(controls(container), `${name}: podgląd dostał sterowanie`).toHaveLength(0);
          expect(changes).toEqual([]);
        },
      );
    }
  });
}
