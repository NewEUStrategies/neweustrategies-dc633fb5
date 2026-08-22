// CO DOWODZI TEN PLIK
//   1. KODOWANIE ADRESU UDOSTĘPNIENIA - osobno dla KAŻDEGO z siedmiu kanałów
//      (x, facebook, linkedin, mail, whatsapp, telegram, reddit) i osobno dla
//      pięciu kształtów wejścia: adres z parametrami zapytania, adres z polskimi
//      znakami w ścieżce, adres z fragmentem `#`, tytuł z apostrofem i tytuł
//      z ampersandem. Każdy parametr musi wracać z `href` po zdekodowaniu BEZ
//      zmian, a query string musi mieć DOKŁADNIE tyle par, ile kanał deklaruje.
//      To jest asercja na tę jedną klasę błędu, która daje połamany link na
//      Facebooku: `&` z tytułu wpisany surowo rozrywa query string i portal
//      dostaje obcięty adres albo obcięty tytuł.
//   2. FILTR KANAŁÓW z konfiguracji CMS-a: wyłączony kanał jest NIEOBECNY
//      (asercja na nieobecności, nie na „niewidocznym"), wszystkie wyłączone to
//      zero linków, a `social` podane CZĘŚCIOWO domyka się przez deep-merge z
//      `DEFAULT_READING_PANEL_SETTINGS` - klucz `social` nie może zostać
//      nadpisany w całości, bo panel z jedną zmienioną flagą wyciąłby resztę.
//   3. SCHOWEK: sukces daje `toast.success` z kluczem `share.bar.copied`.
//      ODMOWA UPRAWNIENIA jest DEFEKTEM - patrz `it.fails` niżej.
//   4. Web Share API NIE ISTNIEJE w tym komponencie: udostępnianie idzie
//      wyłącznie przez jawne linki kanałów, a `navigator.share` ma zero wywołań
//      zarówno wtedy, gdy jest dostępne, jak i wtedy, gdy go brak.
//   5. ADRES: `url` z propa wygrywa; puste `url` czyta `window.location.href`
//      w efekcie; ZMIANA `entityId`/`title` czyta adres PONOWNIE - to jawny
//      kontrakt komentarza w kodzie o nawigacji wpis->wpis (poddrzewo wpisu jest
//      reużywane, więc odczyt tylko przy montowaniu zostawiłby link na
//      POPRZEDNIM artykule).
//   6. WARIANTY: `rail` jest schowany do przewinięcia `showAfter` i odsłania się
//      po nim; `sidebar` jest widoczny ZAWSZE, bez bramki przewinięcia.
//   7. POSTĘP CZYTANIA i wszystkie jego gałęzie: brak korzenia artykułu (0 i
//      brak wyjątku), korzeń o zerowej wysokości (`end <= start`, czyli gałąź
//      dzielenia przez zero), przewinięcie w połowie, przewinięcie ZA koniec
//      (zaklamrowane do 1) i przewinięcie PRZED początek (zaklamrowane do 0).
//   8. SPIS TREŚCI: brak nagłówków to brak listy; nagłówki dają listę z
//      kotwicami i licznikiem; `MutationObserver` przelicza listę po
//      domontowaniu treści; klik woła `smoothScrollToAnchor` z tym id, zamyka
//      arkusz mobilny i ustawia aktywną pozycję; klik w pozycję, której elementu
//      NIE MA w DOM, nie robi NIC i nie rzuca; scrollspy przez
//      `IntersectionObserver` wybiera NAJWYŻSZY widoczny nagłówek.
//   9. ARKUSZ MOBILNY: otwarcie, zamknięcie krzyżykiem i tłem, `Escape`,
//      `useFocusTrap` dostaje `true` dokładnie wtedy, gdy arkusz jest otwarty,
//      a listener `keydown` jest ZDJĘTY z okna po zamknięciu (asercja na
//      `removeEventListener` z TYM SAMYM uchwytem).
//  10. DRUK: klik woła `window.print()` dokładnie raz.
//  11. DOSTĘPNOŚĆ: `axeViolations()` = [] dla widocznego `rail`, dla `sidebar`
//      i dla otwartego arkusza mobilnego; każdy przycisk akcji jest osiągalny
//      klawiaturą i ma dostępną nazwę z klucza i18n.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   * NIE dubluje ŻADNEGO z 15 testów `e2e/seo.spec.ts`. Tamten plik dowodzi
//     BAJTAMI na żywym SSR tras kanałów (`rss.xml is a well-formed feed`,
//     `content feeds respond for the tracker and live coverage`, `podcast feed
//     is auto-discoverable from the podcast pages`), sitemap i `robots.txt` oraz
//     kontraktu `<head>` - test `head contract on /` (i jego trzy siostry
//     `head contract on /en`, `/blog`, `/qa`), który sprawdza `og:title`,
//     `og:image`, `canonical`, `viewport` i `html[lang]`. To są META DANE
//     dokumentu, czytane przez CRAWLERA. Ten plik nie dotyka `<head>` ani jednym
//     zapytaniem: pyta wyłącznie o `href` linków W TREŚCI, czyli o to, co robi
//     KLIKNIĘCIE CZYTELNIKA. Powierzchnie nie stykają się w żadnym punkcie.
//   * NIE dubluje `e2e/seo.spec.ts` -> `/admin/seo is auth-gated (redirects to
//     /auth or /login)`: pasek jest komponentem publicznej treści, nie ma
//     bramki roli.
//   * NIE testuje samego skanera nagłówków (`lib/content/anchorScan`:
//     `getArticleRoot`, `scanHeadings`, kanoniczne kotwice, aliasy historyczne)
//     - ma własne testy jednostkowe i jest tu ATRAPĄ. Interesuje nas wyłącznie
//     to, co pasek robi z JEGO wynikiem.
//   * NIE testuje animacji `smoothScrollToAnchor` ani zapisu „na później"
//     (`SaveArticleButton` -> `useSaveArticle` -> `user_bookmarks`): oba są
//     atrapami, a ich logika (RLS, wielotenantowość, popup logowania) ma własne
//     pliki. RLS i RPC nie są tu badane w ogóle.
//   * ŻADNE wywołanie nie wychodzi do sieci.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { axeViolations, summarize } from "@/test/axe";
import {
  DEFAULT_READING_PANEL_SETTINGS,
  SOCIAL_KEYS,
  type ReadingPanelSettings,
  type SocialKey,
} from "@/lib/sidebarBuilder/types";
import type { ScannedHeading } from "@/lib/content/anchorScan";

/** Nagłówek zwracany przez atrapę skanera. */
type Heading = ScannedHeading;

const h = vi.hoisted(() => ({
  /** Korzeń treści zwracany przez atrapę `getArticleRoot`. */
  articleRoot: null as HTMLElement | null,
  /** Lista, którą oddaje atrapa `scanHeadings` przy każdym skanie. */
  scanned: [] as Array<{ id: string; text: string; level: 1 | 2 | 3 | 4 | 5 }>,
  getArticleRoot: null as Mock<() => HTMLElement | null> | null,
  scanHeadings: null as Mock<(root: HTMLElement) => Heading[]> | null,
  smoothScroll: null as Mock<(id: string) => void> | null,
  focusTrap: null as Mock<(ref: unknown, active: boolean) => void> | null,
  toastSuccess: null as Mock<(message: string) => void> | null,
  toastError: null as Mock<(message: string) => void> | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Nakładka słownikowa jest importowana przez komponent jako EFEKT UBOCZNY i
// ciągnie `lib/i18n` -> `react-i18next`. W teście napisy dostarcza atrapa i18n,
// więc nakładka jest tu pustym modułem.
vi.mock("@/lib/i18n-share", () => ({}));

vi.mock("@/lib/content/anchorScan", async () => {
  const { vi: v } = await import("vitest");
  h.getArticleRoot = v.fn<() => HTMLElement | null>(() => h.articleRoot);
  h.scanHeadings = v.fn<(root: HTMLElement) => Heading[]>(() => h.scanned);
  return { getArticleRoot: h.getArticleRoot, scanHeadings: h.scanHeadings };
});

vi.mock("@/lib/smoothAnchorScroll", async () => {
  const { vi: v } = await import("vitest");
  h.smoothScroll = v.fn<(id: string) => void>();
  return { smoothScrollToAnchor: h.smoothScroll };
});

vi.mock("@/lib/a11y/useFocusTrap", async () => {
  const { vi: v } = await import("vitest");
  h.focusTrap = v.fn<(ref: unknown, active: boolean) => void>();
  return { useFocusTrap: h.focusTrap };
});

vi.mock("sonner", async () => {
  const { vi: v } = await import("vitest");
  h.toastSuccess = v.fn<(message: string) => void>();
  h.toastError = v.fn<(message: string) => void>();
  return { toast: { success: h.toastSuccess, error: h.toastError } };
});

// Ikona brandu czyta bibliotekę ikon przez react-query - tu nieistotne. Atrapa
// zostaje `aria-hidden`, bo dostępną nazwę linku daje jego `aria-label`.
vi.mock("@/components/atoms/BrandIcon", () => ({
  BrandIcon: ({ name }: { name: string }) => <span data-brand-icon={name} aria-hidden="true" />,
}));

vi.mock("@/components/atoms/SaveArticleButton", () => ({
  SaveArticleButton: (props: {
    title: string;
    lang: string;
    entityId?: string;
    entityType?: string;
    url?: string;
    variant?: string;
  }) => (
    <button
      type="button"
      data-save-article
      data-entity-id={props.entityId ?? ""}
      data-entity-type={props.entityType ?? ""}
      data-save-url={props.url ?? ""}
      data-variant={props.variant ?? ""}
      aria-label="atrapa.saveArticle"
    />
  ),
}));

vi.mock("@/components/audio/SidebarListenCard", () => ({
  SidebarListenCard: (props: { postId: string; postHref?: string }) => (
    <div data-listen-card data-post-id={props.postId} data-post-href={props.postHref ?? ""} />
  ),
}));

vi.mock("@/components/post/AuthorBusinessCard", () => ({
  AuthorBusinessCard: (props: { name: string }) => <div data-author-card data-name={props.name} />,
}));

import { FloatingShareBar } from "@/components/share/FloatingShareBar";

type BarProps = React.ComponentProps<typeof FloatingShareBar>;

function scanMock(): Mock<(root: HTMLElement) => Heading[]> {
  if (!h.scanHeadings) throw new Error("atrapa scanHeadings nie została ustawiona");
  return h.scanHeadings;
}

function rootMock(): Mock<() => HTMLElement | null> {
  if (!h.getArticleRoot) throw new Error("atrapa getArticleRoot nie została ustawiona");
  return h.getArticleRoot;
}

function smoothScrollMock(): Mock<(id: string) => void> {
  if (!h.smoothScroll) throw new Error("atrapa smoothScrollToAnchor nie została ustawiona");
  return h.smoothScroll;
}

function focusTrapMock(): Mock<(ref: unknown, active: boolean) => void> {
  if (!h.focusTrap) throw new Error("atrapa useFocusTrap nie została ustawiona");
  return h.focusTrap;
}

function toastSuccessMock(): Mock<(message: string) => void> {
  if (!h.toastSuccess) throw new Error("atrapa toast.success nie została ustawiona");
  return h.toastSuccess;
}

function toastErrorMock(): Mock<(message: string) => void> {
  if (!h.toastError) throw new Error("atrapa toast.error nie została ustawiona");
  return h.toastError;
}

// ---------------------------------------------------------------------------
// Deterministyczne klatki animacji.
//
// `rafThrottle` zbija strumień zdarzeń scroll/resize do jednego wywołania na
// klatkę. Zamiast czekać na PRAWDZIWĄ klatkę (co wprowadziłoby zegar do testu)
// podstawiamy `requestAnimationFrame` kolejką, którą test opróżnia JAWNIE.
// ---------------------------------------------------------------------------
const pendingFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function fakeRequestAnimationFrame(callback: FrameRequestCallback): number {
  const id = nextFrameId;
  nextFrameId += 1;
  pendingFrames.set(id, callback);
  return id;
}

function fakeCancelAnimationFrame(id: number): void {
  pendingFrames.delete(id);
}

/** Odpala WSZYSTKIE zaplanowane klatki (znacznik czasu stały - zero zegara). */
function flushFrames(): void {
  const due = Array.from(pendingFrames.values());
  pendingFrames.clear();
  act(() => {
    for (const callback of due) callback(0);
  });
}

function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: y });
}

/** Ustawia przewinięcie, emituje zdarzenie i domyka klatkę. */
function scrollWindowTo(y: number): void {
  setScrollY(y);
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  flushFrames();
}

function resizeWindow(): void {
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
  flushFrames();
}

// ---------------------------------------------------------------------------
// Atrapa IntersectionObserver - scrollspy sterowany z testu.
// ---------------------------------------------------------------------------
const observers: FakeIntersectionObserver[] = [];

/** Prostokąt spełniający `DOMRectReadOnly` bez rzutowania. */
function rectAtTop(top: number): DOMRectReadOnly {
  return {
    x: 0,
    y: top,
    width: 640,
    height: 24,
    top,
    right: 640,
    bottom: top + 24,
    left: 0,
    toJSON: () => ({ top }),
  };
}

function intersectionEntry(
  target: Element,
  isIntersecting: boolean,
  top: number,
): IntersectionObserverEntry {
  return {
    boundingClientRect: rectAtTop(top),
    intersectionRatio: isIntersecting ? 1 : 0,
    intersectionRect: rectAtTop(top),
    isIntersecting,
    rootBounds: null,
    target,
    time: 0,
  };
}

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  readonly observed: Element[] = [];
  disconnected = false;
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin ?? "";
    const threshold = options?.threshold;
    this.thresholds =
      typeof threshold === "number" ? [threshold] : Array.isArray(threshold) ? threshold : [];
    observers.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(target: Element): void {
    const at = this.observed.indexOf(target);
    if (at >= 0) this.observed.splice(at, 1);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed.length = 0;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(entries: IntersectionObserverEntry[]): void {
    act(() => {
      this.callback(entries, this);
    });
  }
}

function latestObserver(): FakeIntersectionObserver {
  const last = observers[observers.length - 1];
  if (!last) throw new Error("scrollspy nie założył ani jednego IntersectionObserver");
  return last;
}

// ---------------------------------------------------------------------------
// Treść artykułu i korzeń o kontrolowanej geometrii.
// ---------------------------------------------------------------------------
let articleRoot: HTMLElement | null = null;

/**
 * Tworzy korzeń treści z nagłówkami i STAŁYM prostokątem - `getBoundingClientRect`
 * happy-doma zwraca zera, a postęp czytania liczy się właśnie z niego.
 */
function mountArticle(headings: Heading[], rect: { top: number; height: number }): HTMLElement {
  const root = document.createElement("div");
  root.className = "article-body";
  for (const heading of headings) {
    const el = document.createElement(`h${heading.level}`);
    el.id = heading.id;
    el.textContent = heading.text;
    root.appendChild(el);
  }
  Object.defineProperty(root, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: rect.top,
      width: 640,
      height: rect.height,
      top: rect.top,
      right: 640,
      bottom: rect.top + rect.height,
      left: 0,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(root);
  articleRoot = root;
  h.articleRoot = root;
  return root;
}

const HEADINGS: Heading[] = [
  { id: "wstep", text: "Wstęp", level: 1 },
  { id: "kontekst", text: "Kontekst instytucjonalny", level: 2 },
  { id: "wnioski", text: "Wnioski", level: 3 },
];

/** Nagłówki na wszystkich pięciu poziomach - domykają drabinki wcięć. */
const HEADINGS_ALL_LEVELS: Heading[] = [
  { id: "h1", text: "Poziom pierwszy", level: 1 },
  { id: "h2", text: "Poziom drugi", level: 2 },
  { id: "h3", text: "Poziom trzeci", level: 3 },
  { id: "h4", text: "Poziom czwarty", level: 4 },
  { id: "h5", text: "Poziom piąty", level: 5 },
];

// ---------------------------------------------------------------------------
// Konfiguracja kanałów.
// ---------------------------------------------------------------------------
const ALL_SOCIAL: Record<SocialKey, boolean> = {
  x: true,
  facebook: true,
  linkedin: true,
  mail: true,
  copy: true,
  whatsapp: true,
  telegram: true,
  reddit: true,
};

const NO_SOCIAL: Record<SocialKey, boolean> = {
  x: false,
  facebook: false,
  linkedin: false,
  mail: false,
  copy: false,
  whatsapp: false,
  telegram: false,
  reddit: false,
};

/**
 * Mapa kanałów, w której w RUNTIME BRAKUJE kluczy - dokładnie tak wygląda
 * `settings.social` wczytane z JSON-a panelu CMS, bo redakcja zapisuje tylko
 * przestawione flagi. Typ propa deklaruje rekord TOTALNY, a TypeScript nie ma
 * jak wyrazić „ten rekord minus klucze", więc brakujące pola zdejmujemy
 * `Reflect.deleteProperty`: to operacja RUNTIME, nie rzutowanie - w pliku nie
 * ma ani jednego `as`, który kłamałby o kształcie danych.
 */
function partialSocial(enabled: SocialKey[]): Record<SocialKey, boolean> {
  const map: Record<SocialKey, boolean> = { ...ALL_SOCIAL };
  for (const key of SOCIAL_KEYS) {
    if (!enabled.includes(key)) Reflect.deleteProperty(map, key);
  }
  return map;
}

interface ChannelSpec {
  id: SocialKey;
  /** Klucz etykiety - atrapa i18n zwraca go jako dostępną nazwę linku. */
  label: string;
  /** Pełny, oczekiwany prefiks `href` wraz ze znakiem zapytania. */
  prefix: string;
  /** Co MUSI się odczytać z query stringu PO zdekodowaniu. */
  expected: (url: string, title: string) => Record<string, string>;
}

const CHANNELS: ChannelSpec[] = [
  {
    id: "x",
    label: "share.channel.x(lng=pl)",
    prefix: "https://twitter.com/intent/tweet?",
    expected: (url, title) => ({ url, text: title }),
  },
  {
    id: "facebook",
    label: "share.channel.facebook(lng=pl)",
    prefix: "https://www.facebook.com/sharer/sharer.php?",
    expected: (url) => ({ u: url }),
  },
  {
    id: "linkedin",
    label: "share.channel.linkedin(lng=pl)",
    prefix: "https://www.linkedin.com/sharing/share-offsite/?",
    expected: (url) => ({ url }),
  },
  {
    id: "mail",
    label: "share.channel.mail(lng=pl)",
    prefix: "mailto:?",
    expected: (url, title) => ({ subject: title, body: url }),
  },
  {
    id: "whatsapp",
    label: "share.channel.whatsapp(lng=pl)",
    prefix: "https://wa.me/?",
    // WhatsApp bierze JEDEN parametr - tytuł i adres złączone spacją.
    expected: (url, title) => ({ text: `${title} ${url}` }),
  },
  {
    id: "telegram",
    label: "share.channel.telegram(lng=pl)",
    prefix: "https://t.me/share/url?",
    expected: (url, title) => ({ url, text: title }),
  },
  {
    id: "reddit",
    label: "share.channel.reddit(lng=pl)",
    prefix: "https://www.reddit.com/submit?",
    expected: (url, title) => ({ url, title }),
  },
];

interface PayloadCase {
  nazwa: string;
  url: string;
  title: string;
}

const PAYLOADS: PayloadCase[] = [
  {
    nazwa: "adres z parametrami zapytania",
    url: "https://example.org/analizy/wpis?utm_source=a&b=c",
    title: "Zwykły tytuł wpisu",
  },
  {
    nazwa: "polskie znaki w ścieżce",
    url: "https://example.org/analizy/zolc-gesla-jazn-żółć-gęślą-jaźń",
    title: "Ćwierć wieku w Unii",
  },
  {
    nazwa: "adres z fragmentem",
    url: "https://example.org/analizy/wpis#sekcja-2",
    title: "Raport śródroczny",
  },
  {
    nazwa: "tytuł z apostrofem",
    url: "https://example.org/analizy/wpis",
    title: "„Szczyt' w Brukseli - o'Neill komentuje",
  },
  {
    nazwa: "tytuł z ampersandem",
    url: "https://example.org/analizy/wpis?utm_source=a&b=c#sekcja-2",
    title: "Polska & Niemcy: raport 2026",
  },
];

// ---------------------------------------------------------------------------
// Render i selektory.
// ---------------------------------------------------------------------------
const BASE_URL = "https://example.org/analizy/wpis";

function renderBar(overrides: Partial<BarProps> = {}) {
  const props: BarProps = {
    title: "Tytuł wpisu",
    url: BASE_URL,
    lang: "pl",
    ...overrides,
  };
  const result = render(<FloatingShareBar {...props} />);
  // Efekt montowania woła throttlowany handler od razu - opróżniamy klatkę,
  // żeby `visible` i `progress` odpowiadały stanowi przewinięcia.
  flushFrames();
  return result;
}

function railOf(container: HTMLElement): HTMLElement {
  const rail = container.querySelector<HTMLElement>("[data-floating-share]");
  if (!rail) throw new Error("panel `data-floating-share` nie został wyrenderowany");
  return rail;
}

function sheetOf(container: HTMLElement): HTMLElement {
  const sheet = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!sheet) throw new Error("arkusz mobilny (role=dialog) nie został wyrenderowany");
  return sheet;
}

function fabOf(container: HTMLElement): HTMLElement {
  const fab = container.querySelector<HTMLElement>("[data-floating-share-fab]");
  if (!fab) throw new Error("przycisk mobilny (FAB) nie został wyrenderowany");
  return fab;
}

/** Szerokość wypełnienia paska postępu w danym poddrzewie (np. „42%"). */
function progressWidth(scope: HTMLElement): string {
  const fill = scope.querySelector<HTMLElement>('div[aria-hidden="true"] > div');
  if (!fill) throw new Error("pasek postępu nie został wyrenderowany");
  return fill.style.width;
}

function hasProgressBar(scope: HTMLElement): boolean {
  return scope.querySelector('div[aria-hidden="true"] > div') !== null;
}

function isRevealed(rail: HTMLElement): boolean {
  return rail.className.includes("opacity-100") && !rail.className.includes("pointer-events-none");
}

function tocButtons(scope: HTMLElement): HTMLElement[] {
  const nav = scope.querySelector<HTMLElement>("nav");
  if (!nav) return [];
  return Array.from(nav.querySelectorAll<HTMLElement>("button"));
}

function activeTocId(scope: HTMLElement): string | null {
  const current = scope.querySelector<HTMLElement>('nav button[aria-current="true"]');
  return current?.getAttribute("title") ?? current?.textContent ?? null;
}

function clickTocItem(scope: HTMLElement, text: string): void {
  const button = tocButtons(scope).find((b) => b.textContent === text);
  if (!button) throw new Error(`pozycja spisu treści „${text}" nie została wyrenderowana`);
  act(() => {
    button.click();
  });
}

function openSheet(container: HTMLElement): void {
  act(() => {
    fabOf(container).click();
  });
}

function isSheetOpen(container: HTMLElement): boolean {
  const wrapper = sheetOf(container).parentElement;
  if (!wrapper) throw new Error("arkusz mobilny nie ma kontenera");
  return wrapper.getAttribute("aria-hidden") === "false";
}

/**
 * Wiersz statusu ze stopki arkusza mobilnego: procent przeczytania i tytuł
 * BIEŻĄCEJ sekcji. Tytuł powtarza się też na liście spisu treści, więc czytamy
 * go po strukturze wiersza, nie po samym napisie.
 */
function sheetStatus(sheet: HTMLElement): { percent: string; title: string } {
  const read = within(sheet).getByText("share.bar.read(lng=pl)");
  const percentSpan = read.parentElement;
  const row = percentSpan?.parentElement;
  const titleSpan = row?.lastElementChild;
  if (!percentSpan || !row || !titleSpan) {
    throw new Error("stopka arkusza mobilnego nie ma wiersza statusu");
  }
  return {
    percent: (percentSpan.textContent ?? "").replace("share.bar.read(lng=pl)", "").trim(),
    title: (titleSpan.textContent ?? "").trim(),
  };
}

function pressKey(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

let printSpy: Mock<() => void>;
let shareSpy: Mock<(data?: ShareData) => Promise<void>>;
let clipboardWrite: Mock<(text: string) => Promise<void>>;

beforeEach(() => {
  observers.length = 0;
  pendingFrames.clear();
  nextFrameId = 1;
  h.articleRoot = null;
  h.scanned = [];
  articleRoot = null;
  // `mockClear` NIE zdejmuje implementacji, a testy postępu podmieniają
  // `getArticleRoot` na `() => null` - bez `mockReset` przeciekłoby to na
  // wszystkie kolejne pliki opisów i spis treści byłby wiecznie pusty.
  rootMock().mockReset();
  rootMock().mockImplementation(() => h.articleRoot);
  scanMock().mockReset();
  scanMock().mockImplementation(() => h.scanned);
  smoothScrollMock().mockClear();
  focusTrapMock().mockClear();
  toastSuccessMock().mockClear();
  toastErrorMock().mockClear();

  setScrollY(0);
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: 768,
  });

  printSpy = vi.fn<() => void>();
  shareSpy = vi.fn<(data?: ShareData) => Promise<void>>(async () => undefined);
  clipboardWrite = vi.fn<(text: string) => Promise<void>>(async () => undefined);

  vi.stubGlobal("requestAnimationFrame", fakeRequestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", fakeCancelAnimationFrame);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  Object.defineProperty(window, "print", { configurable: true, writable: true, value: printSpy });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    writable: true,
    value: shareSpy,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText: clipboardWrite },
  });
  window.history.replaceState({}, "", "/analizy/wpis");
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (articleRoot?.parentNode) articleRoot.parentNode.removeChild(articleRoot);
  articleRoot = null;
});

// ===========================================================================
// 1. Kodowanie adresu - każdy kanał osobno.
// ===========================================================================
describe("FloatingShareBar - kodowanie adresu udostępnienia", () => {
  const cases = CHANNELS.flatMap((channel) =>
    PAYLOADS.map((payload) => ({
      kanal: channel.id,
      przypadek: payload.nazwa,
      channel,
      payload,
    })),
  );

  it.each(cases)(
    "kanał $kanal koduje poprawnie: $przypadek",
    ({ channel, payload }: { channel: ChannelSpec; payload: PayloadCase }) => {
      const { container } = renderBar({
        title: payload.title,
        url: payload.url,
        settings: { social: ALL_SOCIAL },
      });

      const link = within(railOf(container)).getByRole("link", { name: channel.label });
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith(channel.prefix)).toBe(true);

      const query = href.slice(channel.prefix.length);
      const expected = channel.expected(payload.url, payload.title);

      // NAJWAŻNIEJSZA asercja tego pliku: query string ma DOKŁADNIE tyle par,
      // ile kanał deklaruje. Surowe `&` z tytułu („Polska & Niemcy") rozerwałoby
      // go na dodatkową parę - i to jest ten błąd, który daje obcięty link na
      // Facebooku i obcięty tytuł na X.
      expect(query.split("&")).toHaveLength(Object.keys(expected).length);
      // Nic surowego nie wycieka do adresu: ani spacja, ani `#`, ani `?`.
      expect(query).toMatch(/^[!-~]+$/);
      expect(query).not.toContain("#");
      expect(query).not.toContain("?");
      expect(new URL(href).hash).toBe("");

      const params = new URLSearchParams(query);
      for (const [key, value] of Object.entries(expected)) {
        expect(params.get(key)).toBe(value);
      }
    },
  );

  it("kanał pocztowy celuje w to samo okno, pozostałe w nowe - z rel bez wycieku referrera", () => {
    const { container } = renderBar({ settings: { social: ALL_SOCIAL } });
    const rail = railOf(container);

    const mail = within(rail).getByRole("link", { name: "share.channel.mail(lng=pl)" });
    expect(mail.getAttribute("target")).toBe("_self");
    for (const channel of CHANNELS.filter((c) => c.id !== "mail")) {
      const link = within(rail).getByRole("link", { name: channel.label });
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("etykiety kanałów idą w języku ARTYKUŁU - lang=en wymusza jawne lng=en", () => {
    const { container } = renderBar({ lang: "en", settings: { social: ALL_SOCIAL } });
    const rail = railOf(container);

    expect(
      within(rail).getByRole("link", { name: "share.channel.facebook(lng=en)" }),
    ).toBeInTheDocument();
    expect(
      within(rail).getByRole("button", { name: "share.bar.copy(lng=en)" }),
    ).toBeInTheDocument();
    expect(rail.getAttribute("aria-label")).toBe("share.bar.share(lng=en)");
    expect(
      within(rail).queryByRole("link", { name: "share.channel.facebook(lng=pl)" }),
    ).not.toBeInTheDocument();
  });

  it("zmiana tytułu przelicza WSZYSTKIE linki, nie tylko pierwszy", () => {
    const { container, rerender } = render(
      <FloatingShareBar
        title="Pierwszy tytuł"
        url={BASE_URL}
        lang="pl"
        settings={{ social: ALL_SOCIAL }}
      />,
    );
    flushFrames();
    const rail = railOf(container);
    expect(
      within(rail).getByRole("link", { name: "share.channel.reddit(lng=pl)" }).getAttribute("href"),
    ).toContain(encodeURIComponent("Pierwszy tytuł"));

    rerender(
      <FloatingShareBar
        title="Drugi tytuł"
        url={BASE_URL}
        lang="pl"
        settings={{ social: ALL_SOCIAL }}
      />,
    );

    const reddit = within(rail).getByRole("link", { name: "share.channel.reddit(lng=pl)" });
    expect(reddit.getAttribute("href")).toContain(encodeURIComponent("Drugi tytuł"));
    expect(reddit.getAttribute("href")).not.toContain(encodeURIComponent("Pierwszy tytuł"));
  });
});

// ===========================================================================
// 2. Filtr kanałów z konfiguracji CMS-a.
// ===========================================================================
describe("FloatingShareBar - filtr kanałów z konfiguracji", () => {
  it("domyślna konfiguracja pokazuje cztery kanały i schowek, a trzy pozostałe są NIEOBECNE", () => {
    const { container } = renderBar();
    const rail = railOf(container);

    for (const id of ["x", "facebook", "linkedin", "mail"] as const) {
      const spec = CHANNELS.find((c) => c.id === id);
      if (!spec) throw new Error(`brak specyfikacji kanału ${id}`);
      expect(within(rail).getByRole("link", { name: spec.label })).toBeInTheDocument();
    }
    for (const id of ["whatsapp", "telegram", "reddit"] as const) {
      const spec = CHANNELS.find((c) => c.id === id);
      if (!spec) throw new Error(`brak specyfikacji kanału ${id}`);
      expect(within(rail).queryByRole("link", { name: spec.label })).not.toBeInTheDocument();
    }
    expect(
      within(rail).getByRole("button", { name: "share.bar.copy(lng=pl)" }),
    ).toBeInTheDocument();
    // Domyślne wartości bierzemy z JEDNEGO źródła prawdy, nie z kopii w teście.
    expect(DEFAULT_READING_PANEL_SETTINGS.social.whatsapp).toBe(false);
    expect(DEFAULT_READING_PANEL_SETTINGS.social.facebook).toBe(true);
  });

  it.each(CHANNELS)(
    "wyłączony kanał $id jest NIEOBECNY w drzewie, a nie tylko schowany",
    ({ id, label }: ChannelSpec) => {
      const social: Record<SocialKey, boolean> = { ...ALL_SOCIAL, [id]: false };
      const { container } = renderBar({ settings: { social } });
      const rail = railOf(container);

      expect(within(rail).queryByRole("link", { name: label })).not.toBeInTheDocument();
      // Pozostałe sześć nadal jest - filtr jest punktowy, nie hurtowy.
      for (const other of CHANNELS.filter((c) => c.id !== id)) {
        expect(within(rail).getByRole("link", { name: other.label })).toBeInTheDocument();
      }
    },
  );

  it("wszystkie kanały wyłączone dają ZERO linków i brak przycisku schowka", () => {
    const { container } = renderBar({ settings: { social: NO_SOCIAL } });
    const rail = railOf(container);

    expect(within(rail).queryAllByRole("link")).toHaveLength(0);
    expect(
      within(rail).queryByRole("button", { name: "share.bar.copy(lng=pl)" }),
    ).not.toBeInTheDocument();
    // Nagłówek sekcji „Udostępnij" zostaje - pusta siatka nie znika, ale nie ma
    // w niej ANI JEDNEGO celu kliknięcia.
    expect(within(rail).getAllByText("share.bar.share(lng=pl)").length).toBeGreaterThan(0);
    // To samo w arkuszu mobilnym - otwartym, żeby zero linków nie było skutkiem
    // samego `aria-hidden` na zamkniętym kontenerze.
    openSheet(container);
    expect(within(sheetOf(container)).queryAllByRole("link")).toHaveLength(0);
  });

  it("CZĘŚCIOWE `social` domyka się deep-mergem - klucz `social` NIE jest nadpisywany w całości", () => {
    // W runtime przychodzi `{ x: true }`. Gdyby komponent robił tylko
    // `{...DEFAULTS, ...settings}`, `social` zostałby ZASTĄPIONY jednym kluczem
    // i cztery domyślnie włączone kanały zniknęłyby z panelu bez powodu.
    const { container } = renderBar({ settings: { social: partialSocial(["x"]) } });
    const rail = railOf(container);

    expect(
      within(rail).getByRole("link", { name: "share.channel.facebook(lng=pl)" }),
    ).toBeInTheDocument();
    expect(
      within(rail).getByRole("link", { name: "share.channel.linkedin(lng=pl)" }),
    ).toBeInTheDocument();
    expect(
      within(rail).getByRole("link", { name: "share.channel.mail(lng=pl)" }),
    ).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "share.channel.x(lng=pl)" })).toBeInTheDocument();
    expect(
      within(rail).getByRole("button", { name: "share.bar.copy(lng=pl)" }),
    ).toBeInTheDocument();
    // A kanały domyślnie WYŁĄCZONE nadal są wyłączone - merge nie włącza nic sam.
    expect(
      within(rail).queryByRole("link", { name: "share.channel.telegram(lng=pl)" }),
    ).not.toBeInTheDocument();
  });

  it("CZĘŚCIOWE `settings` bez klucza `social` zostawia domyślną listę kanałów", () => {
    const { container } = renderBar({ settings: { showProgress: false } });
    const rail = railOf(container);

    expect(
      within(rail).getByRole("link", { name: "share.channel.facebook(lng=pl)" }),
    ).toBeInTheDocument();
    // Sama flaga, którą podano, JEST uwzględniona.
    expect(hasProgressBar(rail)).toBe(false);
  });

  it("flagi akcji wyłączają zapis i druk niezależnie od kanałów", () => {
    const off: Partial<ReadingPanelSettings> = {
      showSaveLater: false,
      showPrint: false,
      showPdf: false,
    };
    const { container } = renderBar({ settings: off });
    const rail = railOf(container);

    expect(rail.querySelector("[data-save-article]")).toBeNull();
    expect(
      within(rail).queryByRole("button", { name: "share.bar.printPdf(lng=pl)" }),
    ).not.toBeInTheDocument();
    expect(sheetOf(container).querySelector("[data-save-article]")).toBeNull();
  });

  it.each([
    { nazwa: "tylko showPdf", settings: { showPrint: false, showPdf: true } },
    { nazwa: "tylko showPrint", settings: { showPrint: true, showPdf: false } },
  ])(
    "przycisk druku pojawia się przy $nazwa (jedna akcja dla druku i PDF)",
    ({ settings }: { settings: Partial<ReadingPanelSettings> }) => {
      const { container } = renderBar({ settings });
      expect(
        within(railOf(container)).getByRole("button", { name: "share.bar.printPdf(lng=pl)" }),
      ).toBeInTheDocument();
    },
  );

  it("zapis na później dostaje identyfikator wpisu, jego typ i bieżący adres", () => {
    const { container } = renderBar({ entityId: "post-42", entityType: "page" });
    const save = railOf(container).querySelector<HTMLElement>("[data-save-article]");
    if (!save) throw new Error("atrapa SaveArticleButton nie została wyrenderowana");

    expect(save.getAttribute("data-entity-id")).toBe("post-42");
    expect(save.getAttribute("data-entity-type")).toBe("page");
    expect(save.getAttribute("data-save-url")).toBe(BASE_URL);
    expect(save.getAttribute("data-variant")).toBe("labelled");
  });

  it("bez `entityType` zapis dostaje domyślny typ `post`", () => {
    const { container } = renderBar({ entityId: "post-7" });
    const save = railOf(container).querySelector<HTMLElement>("[data-save-article]");
    expect(save?.getAttribute("data-entity-type")).toBe("post");
  });
});

// ===========================================================================
// 3. Schowek.
// ===========================================================================
describe("FloatingShareBar - kopiowanie do schowka", () => {
  async function clickCopy(container: HTMLElement): Promise<void> {
    const button = within(railOf(container)).getByRole("button", {
      name: "share.bar.copy(lng=pl)",
    });
    await act(async () => {
      button.click();
    });
  }

  it("sukces kopiowania woła schowek z adresem i pokazuje toast z kluczem share.bar.copied", async () => {
    const { container } = renderBar({ url: "https://example.org/analizy/wpis?utm_source=a&b=c" });

    await clickCopy(container);

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    // Do schowka idzie adres SUROWY, nie zakodowany - czytelnik wkleja link,
    // nie ciąg %3F.
    expect(clipboardWrite).toHaveBeenCalledWith(
      "https://example.org/analizy/wpis?utm_source=a&b=c",
    );
    expect(toastSuccessMock()).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock()).toHaveBeenCalledWith("share.bar.copied(lng=pl)");
    expect(toastErrorMock()).not.toHaveBeenCalled();
  });

  it("przycisk schowka w arkuszu mobilnym kopiuje ten sam adres", async () => {
    const { container } = renderBar();
    // Zamknięty arkusz jest `aria-hidden`, więc zapytania po ROLI go pomijają -
    // to samo, co robi czytnik ekranu. Najpierw otwieramy.
    openSheet(container);
    const button = within(sheetOf(container)).getByRole("button", {
      name: "share.bar.copy(lng=pl)",
    });

    await act(async () => {
      button.click();
    });

    expect(clipboardWrite).toHaveBeenCalledWith(BASE_URL);
    expect(toastSuccessMock()).toHaveBeenCalledWith("share.bar.copied(lng=pl)");
  });

  // KONSEKWENCJA DLA UŻYTKOWNIKA: czytelnik klika „Skopiuj link", nic się nie
  // dzieje i nie wie, że link NIE jest w schowku - w kontekście niezabezpieczonym
  // (http) albo przy zablokowanym uprawnieniu to jest cicha awaria jedynej
  // ścieżki udostępniania bez konta. `onCopy` ma PUSTY `catch` z komentarzem
  // „fall back silently", więc odmowa uprawnienia nie produkuje ŻADNEGO sygnału:
  // ani toastu, ani zmiany etykiety, ani zapisu w konsoli.
  it.fails("DEFEKT: odmowa schowka nie daje żadnego komunikatu", async () => {
    clipboardWrite.mockImplementation(async () => {
      throw new DOMException("Write permission denied.", "NotAllowedError");
    });
    const { container } = renderBar();

    await clickCopy(container);

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    // Odmowa MUSI dać czytelnikowi jakikolwiek komunikat - dowolnym kanałem.
    expect(
      toastSuccessMock().mock.calls.length + toastErrorMock().mock.calls.length,
    ).toBeGreaterThan(0);
  });

  // ZIELONY BLIŹNIAK powyższego `it.fails` - przypina stan FAKTYCZNY. Gdy
  // produkcja dostanie komunikat o odmowie, TEN test padnie razem z odblokowaniem
  // `it.fails`, więc naprawa nie przejdzie niezauważona.
  it("stan faktyczny: odmowa schowka jest CICHA - zero toastów i zero wyjątku", async () => {
    clipboardWrite.mockImplementation(async () => {
      throw new DOMException("Write permission denied.", "NotAllowedError");
    });
    const { container } = renderBar();

    await clickCopy(container);

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock()).not.toHaveBeenCalled();
    expect(toastErrorMock()).not.toHaveBeenCalled();
    // Przycisk nadal jest w drzewie i nadal jest klikalny - awaria nie zostawia
    // po sobie ŻADNEGO śladu w interfejsie.
    expect(
      within(railOf(container)).getByRole("button", { name: "share.bar.copy(lng=pl)" }),
    ).toBeEnabled();
  });

  it("stan faktyczny: brak API schowka w ogóle też przechodzi bez komunikatu i bez wyjątku", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const { container } = renderBar();

    await clickCopy(container);

    expect(toastSuccessMock()).not.toHaveBeenCalled();
    expect(toastErrorMock()).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Web Share API - fakt, że go NIE MA.
// ===========================================================================
describe("FloatingShareBar - Web Share API", () => {
  it("udostępnianie idzie WYŁĄCZNIE przez jawne linki kanałów - navigator.share ma zero wywołań", async () => {
    mountArticle(HEADINGS, { top: -500, height: 3000 });
    h.scanned = HEADINGS;
    const { container } = renderBar({ settings: { social: ALL_SOCIAL } });
    const rail = railOf(container);

    // Wszystkie ścieżki interakcji paska po kolei - żadna nie sięga po Web Share.
    await act(async () => {
      within(rail).getByRole("button", { name: "share.bar.copy(lng=pl)" }).click();
    });
    act(() => {
      within(rail).getByRole("button", { name: "share.bar.printPdf(lng=pl)" }).click();
    });
    openSheet(container);
    clickTocItem(sheetOf(container), "Wstęp");

    expect(shareSpy).not.toHaveBeenCalled();
    // Cała siedmiokanałowa siatka to statyczne `href` - kliknięcie prowadzi
    // wprost do portalu, bez arkusza systemowego.
    for (const channel of CHANNELS) {
      const link = within(rail).getByRole("link", { name: channel.label });
      expect(link.getAttribute("href")?.startsWith(channel.prefix)).toBe(true);
    }
  });

  it("brak navigator.share nie zmienia NICZEGO - te same linki, ten sam przycisk schowka", () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const { container } = renderBar({ settings: { social: ALL_SOCIAL } });
    const rail = railOf(container);

    expect(within(rail).getAllByRole("link")).toHaveLength(CHANNELS.length);
    expect(
      within(rail).getByRole("button", { name: "share.bar.copy(lng=pl)" }),
    ).toBeInTheDocument();
    expect(shareSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. Skąd bierze się adres.
// ===========================================================================
describe("FloatingShareBar - źródło adresu", () => {
  it("podany `url` jest użyty dosłownie i window.location NIE jest czytany", () => {
    window.history.replaceState({}, "", "/zupelnie-inna-sciezka");
    const { container } = renderBar({ url: "https://example.org/kanoniczny" });

    const facebook = within(railOf(container)).getByRole("link", {
      name: "share.channel.facebook(lng=pl)",
    });
    expect(new URL(facebook.getAttribute("href") ?? "").searchParams.get("u")).toBe(
      "https://example.org/kanoniczny",
    );
    expect(facebook.getAttribute("href")).not.toContain(
      encodeURIComponent("zupelnie-inna-sciezka"),
    );
  });

  it("pusty `url` czyta window.location.href w efekcie", () => {
    window.history.replaceState({}, "", "/analizy/pierwszy-wpis?utm_source=nl");
    const { container } = renderBar({ url: undefined });

    const facebook = within(railOf(container)).getByRole("link", {
      name: "share.channel.facebook(lng=pl)",
    });
    expect(new URL(facebook.getAttribute("href") ?? "").searchParams.get("u")).toBe(
      window.location.href,
    );
    expect(window.location.href).toContain("/analizy/pierwszy-wpis?utm_source=nl");
  });

  it("`url` podany jako pusty napis też degraduje do window.location.href", () => {
    window.history.replaceState({}, "", "/analizy/puste-url");
    const { container } = renderBar({ url: "" });

    const facebook = within(railOf(container)).getByRole("link", {
      name: "share.channel.facebook(lng=pl)",
    });
    expect(new URL(facebook.getAttribute("href") ?? "").searchParams.get("u")).toBe(
      window.location.href,
    );
  });

  it("ZMIANA entityId przy nawigacji wpis->wpis czyta adres PONOWNIE - link nie zostaje na poprzednim artykule", () => {
    window.history.replaceState({}, "", "/analizy/pierwszy-wpis");
    const { container, rerender } = render(
      <FloatingShareBar title="Pierwszy" entityId="post-1" lang="pl" />,
    );
    flushFrames();
    const rail = railOf(container);
    const facebookHref = (): string =>
      within(rail)
        .getByRole("link", { name: "share.channel.facebook(lng=pl)" })
        .getAttribute("href") ?? "";
    expect(facebookHref()).toContain(encodeURIComponent("/analizy/pierwszy-wpis"));

    // Poddrzewo wpisu jest REUŻYWANE przy nawigacji klienckiej: adres zmienia
    // się PRZED przerenderowaniem, więc odczyt tylko przy montowaniu zostawiłby
    // pasek na poprzednim artykule.
    window.history.replaceState({}, "", "/analizy/drugi-wpis");
    rerender(<FloatingShareBar title="Drugi" entityId="post-2" lang="pl" />);

    expect(facebookHref()).toContain(encodeURIComponent("/analizy/drugi-wpis"));
    expect(facebookHref()).not.toContain(encodeURIComponent("/analizy/pierwszy-wpis"));
  });

  it("ZMIANA samego `title` również przelicza adres z window.location", () => {
    window.history.replaceState({}, "", "/analizy/a");
    const { container, rerender } = render(<FloatingShareBar title="Tytuł A" lang="pl" />);
    flushFrames();
    const rail = railOf(container);

    window.history.replaceState({}, "", "/analizy/b");
    rerender(<FloatingShareBar title="Tytuł B" lang="pl" />);

    const href =
      within(rail).getByRole("link", { name: "share.channel.x(lng=pl)" }).getAttribute("href") ??
      "";
    expect(href).toContain(encodeURIComponent("/analizy/b"));
    expect(href).toContain(encodeURIComponent("Tytuł B"));
  });

  it("sidebar bez `url` oddaje karcie odsłuchu adres z window.location", () => {
    // Pierwsza klatka renderu nie ma jeszcze adresu (`href` jest pusty, więc
    // karta dostaje `undefined` zamiast pustego napisu - inaczej wyszedłby jej
    // link do „"), a efekt domyka go adresem bieżącej strony.
    window.history.replaceState({}, "", "/analizy/odsluch");
    const { container } = renderBar({
      variant: "sidebar",
      url: "",
      listen: { postId: "post-9", title: "Tytuł wpisu", author: null },
    });

    expect(container.querySelector("[data-listen-card]")?.getAttribute("data-post-href")).toBe(
      window.location.href,
    );
    expect(window.location.href).toContain("/analizy/odsluch");
  });

  it("adres z propa trafia też do zapisu na później i do karty odsłuchu", () => {
    const { container } = renderBar({
      variant: "sidebar",
      url: "https://example.org/kanoniczny",
      listen: { postId: "post-9", title: "Tytuł wpisu", author: null },
    });

    expect(
      railOf(container).querySelector("[data-save-article]")?.getAttribute("data-save-url"),
    ).toBe("https://example.org/kanoniczny");
    expect(container.querySelector("[data-listen-card]")?.getAttribute("data-post-href")).toBe(
      "https://example.org/kanoniczny",
    );
  });
});

// ===========================================================================
// 6. Warianty: rail vs sidebar.
// ===========================================================================
describe("FloatingShareBar - warianty i bramka przewinięcia", () => {
  it("rail jest schowany, dopóki przewinięcie nie minie domyślnego progu 240 px", () => {
    const { container } = renderBar();
    const rail = railOf(container);

    expect(rail.getAttribute("data-variant")).toBe("rail");
    expect(isRevealed(rail)).toBe(false);
    expect(rail.className).toContain("pointer-events-none");
    // Dokładnie NA progu jeszcze nie - warunek jest ostry (`y > showAfter`).
    scrollWindowTo(240);
    expect(isRevealed(rail)).toBe(false);

    scrollWindowTo(241);
    expect(isRevealed(rail)).toBe(true);
    expect(rail.className).not.toContain("pointer-events-none");
  });

  it("własny `showAfter` przesuwa próg odsłonięcia", () => {
    const { container } = renderBar({ showAfter: 900 });
    const rail = railOf(container);

    scrollWindowTo(500);
    expect(isRevealed(rail)).toBe(false);

    scrollWindowTo(901);
    expect(isRevealed(rail)).toBe(true);

    // Powrót na górę znowu chowa panel.
    scrollWindowTo(0);
    expect(isRevealed(rail)).toBe(false);
  });

  it("zdarzenie `resize` przelicza widoczność tą samą ścieżką co `scroll`", () => {
    const { container } = renderBar();
    const rail = railOf(container);

    setScrollY(1200);
    resizeWindow();

    expect(isRevealed(rail)).toBe(true);
  });

  it("wariant sidebar jest widoczny ZAWSZE - bez bramki przewinięcia", () => {
    const { container } = renderBar({ variant: "sidebar" });
    const rail = railOf(container);

    expect(rail.getAttribute("data-variant")).toBe("sidebar");
    expect(rail.className).toContain("sticky");
    expect(isRevealed(rail)).toBe(true);

    scrollWindowTo(0);
    expect(isRevealed(rail)).toBe(true);
    scrollWindowTo(5000);
    expect(isRevealed(rail)).toBe(true);
  });

  it("karta odsłuchu i wizytówka autora należą WYŁĄCZNIE do wariantu sidebar", () => {
    const listen = { postId: "post-9", title: "Tytuł wpisu", author: "Anna Kowalska" };
    const sidebar = renderBar({ variant: "sidebar", listen });

    expect(sidebar.container.querySelector("[data-listen-card]")).not.toBeNull();
    expect(sidebar.container.querySelector("[data-author-card]")?.getAttribute("data-name")).toBe(
      "Anna Kowalska",
    );
    sidebar.unmount();

    const rail = renderBar({ variant: "rail", listen });
    expect(rail.container.querySelector("[data-listen-card]")).toBeNull();
    expect(rail.container.querySelector("[data-author-card]")).toBeNull();
  });

  it("sidebar bez autora pokazuje kartę odsłuchu, ale NIE wizytówkę", () => {
    const { container } = renderBar({
      variant: "sidebar",
      listen: { postId: "post-9", title: "Tytuł wpisu", author: null },
    });

    expect(container.querySelector("[data-listen-card]")).not.toBeNull();
    expect(container.querySelector("[data-author-card]")).toBeNull();
  });

  it("sidebar bez propa `listen` nie renderuje ani karty odsłuchu, ani wizytówki", () => {
    const { container } = renderBar({ variant: "sidebar" });

    expect(container.querySelector("[data-listen-card]")).toBeNull();
    expect(container.querySelector("[data-author-card]")).toBeNull();
  });
});

// ===========================================================================
// 7. Postęp czytania - wszystkie gałęzie arytmetyki.
// ===========================================================================
describe("FloatingShareBar - postęp czytania", () => {
  it("brak korzenia artykułu zostawia postęp na 0 i NIE wywala komponentu", () => {
    rootMock().mockImplementation(() => null);
    const { container } = renderBar();
    const rail = railOf(container);

    scrollWindowTo(4000);

    expect(progressWidth(rail)).toBe("0%");
    expect(rail).toBeInTheDocument();
    expect(rootMock().mock.calls.length).toBeGreaterThan(0);
  });

  it("korzeń o zerowej wysokości (end <= start) daje 0 - gałąź dzielenia przez zero", () => {
    mountArticle([], { top: 0, height: 0 });
    const { container } = renderBar();

    scrollWindowTo(300);

    // end = start + 0 - 768 < start, więc licznik NIE jest dzielony.
    expect(progressWidth(railOf(container))).toBe("0%");
  });

  it("przewinięcie w połowie treści daje wartość z wnętrza przedziału [0,1]", () => {
    // start = scrollY + rect.top = 1000 + (-1000) = 0
    // end   = 0 + 3768 - 768 = 3000; scrollY = 1500 -> 50%
    mountArticle(HEADINGS, { top: -1000, height: 3768 });
    const { container } = renderBar();
    const rail = railOf(container);

    setScrollY(1500);
    Object.defineProperty(articleRoot, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: -1500,
        width: 640,
        height: 3768,
        top: -1500,
        right: 640,
        bottom: 2268,
        left: 0,
        toJSON: () => ({}),
      }),
    });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    flushFrames();

    expect(progressWidth(rail)).toBe("50%");
    // Ten sam procent trafia do arkusza mobilnego - jedna prawda, dwa miejsca.
    expect(progressWidth(sheetOf(container))).toBe("50%");
  });

  it("przewinięcie ZA koniec treści jest zaklamrowane do 1 (100%)", () => {
    mountArticle(HEADINGS, { top: 0, height: 2768 });
    const { container } = renderBar();

    setScrollY(9000);
    Object.defineProperty(articleRoot, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: -9000,
        width: 640,
        height: 2768,
        top: -9000,
        right: 640,
        bottom: -6232,
        left: 0,
        toJSON: () => ({}),
      }),
    });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    flushFrames();

    expect(progressWidth(railOf(container))).toBe("100%");
  });

  it("przewinięcie PRZED początkiem treści jest zaklamrowane do 0", () => {
    // start = 0 + 500 = 500, scrollY = 0 -> pct = -0,25 -> Math.max daje 0.
    mountArticle(HEADINGS, { top: 500, height: 3268 });
    const { container } = renderBar();

    scrollWindowTo(0);

    expect(progressWidth(railOf(container))).toBe("0%");
  });

  it("wyłączony `showProgress` usuwa pasek postępu z panelu", () => {
    mountArticle(HEADINGS, { top: 0, height: 2768 });
    const { container } = renderBar({ settings: { showProgress: false } });

    expect(hasProgressBar(railOf(container))).toBe(false);
    // Arkusz mobilny ma własny pasek, niezależny od tej flagi.
    expect(hasProgressBar(sheetOf(container))).toBe(true);
  });
});

// ===========================================================================
// 8. Spis treści.
// ===========================================================================
describe("FloatingShareBar - spis treści", () => {
  it("pusty wynik skanowania nie renderuje listy ani licznika", () => {
    mountArticle([], { top: 0, height: 1000 });
    h.scanned = [];
    const { container } = renderBar();
    const rail = railOf(container);

    expect(rail.querySelector("nav")).toBeNull();
    expect(within(rail).queryByText("1/0")).not.toBeInTheDocument();
    // Nagłówek sekcji spisu treści zostaje - sam widget nie znika.
    expect(within(rail).getByText("share.bar.tocTitle(lng=pl)")).toBeInTheDocument();
  });

  it("wynik skanowania daje listę z kotwicami, licznik i wcięcia dla WSZYSTKICH pięciu poziomów", () => {
    mountArticle(HEADINGS_ALL_LEVELS, { top: 0, height: 4000 });
    h.scanned = HEADINGS_ALL_LEVELS;
    const { container } = renderBar();
    const rail = railOf(container);

    const nav = within(rail).getByRole("navigation", { name: "share.bar.toc(lng=pl)" });
    const buttons = Array.from(nav.querySelectorAll<HTMLElement>("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(HEADINGS_ALL_LEVELS.map((i) => i.text));
    expect(buttons.map((b) => b.getAttribute("title"))).toEqual(
      HEADINGS_ALL_LEVELS.map((i) => i.text),
    );
    // Licznik „bieżąca/wszystkie" - bez aktywnej pozycji pokazuje pierwszą.
    expect(within(rail).getByText("1/5")).toBeInTheDocument();

    // Drabinka wcięć panelu (poziomy 1-5) - każdy poziom ma własną klasę.
    expect(buttons.map((b) => b.className.match(/\bpl-\d+\b/)?.[0])).toEqual([
      "pl-3",
      "pl-4",
      "pl-6",
      "pl-8",
      "pl-10",
    ]);
    // Drabinka wcięć arkusza mobilnego jest INNA - węższy panel, grubsze palce.
    const sheetButtons = tocButtons(sheetOf(container));
    expect(sheetButtons.map((b) => b.className.match(/\bpl-\d+\b/)?.[0])).toEqual([
      "pl-4",
      "pl-5",
      "pl-8",
      "pl-11",
      "pl-14",
    ]);
  });

  it("wyłączony `showToc` ukrywa listę nawet przy znalezionych nagłówkach", () => {
    mountArticle(HEADINGS, { top: 0, height: 2000 });
    h.scanned = HEADINGS;
    const { container } = renderBar({ settings: { showToc: false } });

    expect(railOf(container).querySelector("nav")).toBeNull();
    expect(sheetOf(container).querySelector("nav")).toBeNull();
    expect(within(railOf(container)).queryByText("1/3")).not.toBeInTheDocument();
  });

  it("MutationObserver przelicza listę po domontowaniu treści", async () => {
    const root = mountArticle([], { top: 0, height: 1000 });
    h.scanned = [];
    const { container } = renderBar();
    const rail = railOf(container);
    expect(rail.querySelector("nav")).toBeNull();

    // Treść dociąga się później (powiązane wpisy, bloki lazy) - obserwator musi
    // przeliczyć spis, inaczej czytelnik zostaje z pustym widgetem.
    h.scanned = HEADINGS;
    const late = document.createElement("h2");
    late.id = "kontekst";
    late.textContent = "Kontekst instytucjonalny";
    act(() => {
      root.appendChild(late);
    });

    await waitFor(() => {
      expect(within(rail).getByRole("navigation", { name: "share.bar.toc(lng=pl)" })).toBeVisible();
    });
    expect(tocButtons(rail).map((b) => b.textContent)).toEqual(HEADINGS.map((i) => i.text));
  });

  it("klik w pozycję woła smoothScrollToAnchor z jej id i ustawia ją jako aktywną", () => {
    mountArticle(HEADINGS, { top: 0, height: 3000 });
    h.scanned = HEADINGS;
    const { container } = renderBar();
    const rail = railOf(container);

    clickTocItem(rail, "Wnioski");

    expect(smoothScrollMock()).toHaveBeenCalledTimes(1);
    expect(smoothScrollMock()).toHaveBeenCalledWith("wnioski");
    expect(activeTocId(rail)).toBe("Wnioski");
    // Licznik idzie za aktywną pozycją: „Wnioski" to trzecia z trzech.
    expect(within(rail).getByText("3/3")).toBeInTheDocument();
  });

  it("klik w pozycję arkusza mobilnego ZAMYKA arkusz i przewija do kotwicy", () => {
    mountArticle(HEADINGS, { top: 0, height: 3000 });
    h.scanned = HEADINGS;
    const { container } = renderBar();
    openSheet(container);
    expect(isSheetOpen(container)).toBe(true);

    clickTocItem(sheetOf(container), "Kontekst instytucjonalny");

    expect(isSheetOpen(container)).toBe(false);
    expect(smoothScrollMock()).toHaveBeenCalledWith("kontekst");
  });

  it("klik w pozycję, której elementu NIE MA w DOM, nie robi nic i nie rzuca", () => {
    // Skaner oddaje kotwicę, której nagłówek został w międzyczasie usunięty
    // z drzewa (np. blok przełączył wariant) - `jumpTo` musi wyjść bez skutku.
    mountArticle([], { top: 0, height: 3000 });
    h.scanned = [{ id: "nie-ma-mnie", text: "Sekcja znikła", level: 2 }];
    const { container } = renderBar();
    const rail = railOf(container);
    openSheet(container);

    expect(() => clickTocItem(rail, "Sekcja znikła")).not.toThrow();

    expect(smoothScrollMock()).not.toHaveBeenCalled();
    expect(activeTocId(rail)).toBeNull();
    // Arkusz też NIE został zamknięty - `jumpTo` wychodzi przed `setMobileOpen`.
    expect(isSheetOpen(container)).toBe(true);
  });

  it("scrollspy przez IntersectionObserver wybiera NAJWYŻSZY widoczny nagłówek", () => {
    mountArticle(HEADINGS, { top: 0, height: 3000 });
    h.scanned = HEADINGS;
    const { container } = renderBar();
    const rail = railOf(container);

    const observer = latestObserver();
    expect(observer.observed.map((el) => el.id)).toEqual(["wstep", "kontekst", "wnioski"]);
    expect(observer.rootMargin).toBe("-80px 0px -70% 0px");
    expect(observer.thresholds).toEqual([0.01]);

    const el = (id: string): Element => {
      const found = document.getElementById(id);
      if (!found) throw new Error(`nagłówek #${id} nie istnieje`);
      return found;
    };

    // Dwa nagłówki widoczne jednocześnie, podane w kolejności ODWROTNEJ do
    // układu - wygrać ma ten wyżej na ekranie, nie pierwszy z listy zdarzeń.
    observer.emit([
      intersectionEntry(el("wnioski"), true, 420),
      intersectionEntry(el("kontekst"), true, 90),
      intersectionEntry(el("wstep"), false, -300),
    ]);
    expect(activeTocId(rail)).toBe("Kontekst instytucjonalny");
    expect(within(rail).getByText("2/3")).toBeInTheDocument();

    // Wejście kolejnej sekcji przesuwa podświetlenie.
    observer.emit([intersectionEntry(el("wnioski"), true, 40)]);
    expect(activeTocId(rail)).toBe("Wnioski");
  });

  it("scrollspy IGNORUJE zdarzenia, w których nic nie jest widoczne", () => {
    mountArticle(HEADINGS, { top: 0, height: 3000 });
    h.scanned = HEADINGS;
    const { container } = renderBar();
    const rail = railOf(container);
    const observer = latestObserver();
    const el = (id: string): Element => {
      const found = document.getElementById(id);
      if (!found) throw new Error(`nagłówek #${id} nie istnieje`);
      return found;
    };

    observer.emit([intersectionEntry(el("kontekst"), true, 90)]);
    expect(activeTocId(rail)).toBe("Kontekst instytucjonalny");

    // Wyjście wszystkiego z kadru NIE gasi podświetlenia - czytelnik między
    // sekcjami nadal widzi, gdzie jest.
    observer.emit([
      intersectionEntry(el("kontekst"), false, -500),
      intersectionEntry(el("wnioski"), false, 2000),
    ]);
    expect(activeTocId(rail)).toBe("Kontekst instytucjonalny");
  });

  it("scrollspy NIE jest zakładany, gdy żadnego nagłówka nie ma w dokumencie", () => {
    mountArticle([], { top: 0, height: 3000 });
    h.scanned = [{ id: "brak-w-dom", text: "Sekcja bez elementu", level: 2 }];
    renderBar();

    expect(observers).toHaveLength(0);
  });

  it("odmontowanie panelu rozłącza scrollspy", () => {
    mountArticle(HEADINGS, { top: 0, height: 3000 });
    h.scanned = HEADINGS;
    const { unmount } = renderBar();
    const observer = latestObserver();
    expect(observer.disconnected).toBe(false);

    unmount();

    expect(observer.disconnected).toBe(true);
  });

  it("stopka arkusza mobilnego pokazuje procent i tytuł BIEŻĄCEJ sekcji", () => {
    mountArticle(HEADINGS, { top: 0, height: 3000 });
    h.scanned = HEADINGS;
    const { container } = renderBar();
    const sheet = sheetOf(container);

    // Bez aktywnej pozycji stopka pokazuje PIERWSZĄ sekcję - czytelnik nigdy nie
    // widzi pustego miejsca zamiast nazwy rozdziału.
    expect(sheetStatus(sheet)).toEqual({ percent: "0%", title: "Wstęp" });

    clickTocItem(railOf(container), "Wnioski");
    expect(sheetStatus(sheet).title).toBe("Wnioski");
  });
});

// ===========================================================================
// 9. Arkusz mobilny.
// ===========================================================================
describe("FloatingShareBar - arkusz mobilny", () => {
  it("FAB otwiera arkusz, krzyżyk go zamyka, a `aria-expanded` idzie za stanem", () => {
    const { container } = renderBar();
    const fab = fabOf(container);

    expect(fab.getAttribute("aria-expanded")).toBe("false");
    expect(isSheetOpen(container)).toBe(false);

    openSheet(container);
    expect(fab.getAttribute("aria-expanded")).toBe("true");
    expect(isSheetOpen(container)).toBe(true);
    expect(sheetOf(container).getAttribute("aria-modal")).toBe("true");

    act(() => {
      within(sheetOf(container)).getByRole("button", { name: "common.close(lng=pl)" }).click();
    });
    expect(isSheetOpen(container)).toBe(false);
    expect(fab.getAttribute("aria-expanded")).toBe("false");
  });

  it("klik w tło zamyka arkusz", () => {
    const { container } = renderBar();
    openSheet(container);

    const backdrop = sheetOf(container).parentElement?.firstElementChild;
    if (!(backdrop instanceof HTMLElement)) throw new Error("tło arkusza nie zostało znalezione");
    act(() => {
      backdrop.click();
    });

    expect(isSheetOpen(container)).toBe(false);
  });

  it("Escape zamyka arkusz, a inne klawisze go NIE zamykają", () => {
    const { container } = renderBar();
    openSheet(container);

    pressKey("Enter");
    expect(isSheetOpen(container)).toBe(true);
    pressKey("Escape");
    expect(isSheetOpen(container)).toBe(false);
  });

  it("useFocusTrap dostaje `true` dokładnie wtedy, gdy arkusz jest otwarty", () => {
    const { container } = renderBar();
    const lastActive = (): boolean => {
      const calls = focusTrapMock().mock.calls;
      const last = calls[calls.length - 1];
      if (!last) throw new Error("useFocusTrap nie został wywołany");
      return last[1];
    };

    expect(lastActive()).toBe(false);
    openSheet(container);
    expect(lastActive()).toBe(true);
    pressKey("Escape");
    expect(lastActive()).toBe(false);
    // Pułapka dostaje referencję do TEGO elementu, który jest dialogiem.
    const calls = focusTrapMock().mock.calls;
    const lastRef = calls[calls.length - 1]?.[0];
    expect(
      lastRef && typeof lastRef === "object" && "current" in lastRef ? lastRef.current : null,
    ).toBe(sheetOf(container));
  });

  it("listener `keydown` jest ZDJĘTY z okna po zamknięciu arkusza", () => {
    const { container } = renderBar();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    openSheet(container);
    const added = addSpy.mock.calls.filter(([type]) => type === "keydown");
    expect(added).toHaveLength(1);
    expect(removeSpy.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);

    pressKey("Escape");

    const removed = removeSpy.mock.calls.filter(([type]) => type === "keydown");
    expect(removed).toHaveLength(1);
    // TEN SAM uchwyt - inaczej listener zostałby w oknie na zawsze.
    expect(removed[0]?.[1]).toBe(added[0]?.[1]);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("zamknięty arkusz nie zakłada listenera - Escape przed otwarciem nie ma na czym działać", () => {
    const { container } = renderBar();
    const addSpy = vi.spyOn(window, "addEventListener");

    pressKey("Escape");

    expect(addSpy.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
    expect(isSheetOpen(container)).toBe(false);
    addSpy.mockRestore();
  });

  it("FAB pokazuje pierścień postępu i chowa się, gdy arkusz jest otwarty", () => {
    mountArticle(HEADINGS, { top: 0, height: 2768 });
    const { container } = renderBar();
    const fab = fabOf(container);

    scrollWindowTo(500);
    expect(fab.className).toContain("opacity-100");

    openSheet(container);
    expect(fab.className).toContain("pointer-events-none");
    // Pierścień to dwa okręgi SVG: tło i wypełnienie z `strokeDasharray`.
    const circles = fab.querySelectorAll("circle");
    expect(circles).toHaveLength(2);
    expect(circles[1]?.getAttribute("stroke-dasharray")).toMatch(/^[\d.]+ [\d.]+$/);
  });
});

// ===========================================================================
// 10. Druk / PDF.
// ===========================================================================
describe("FloatingShareBar - druk i PDF", () => {
  it("klik w panelu woła window.print() dokładnie raz", () => {
    const { container } = renderBar();

    act(() => {
      within(railOf(container)).getByRole("button", { name: "share.bar.printPdf(lng=pl)" }).click();
    });

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("klik w arkuszu mobilnym woła window.print() dokładnie raz", () => {
    const { container } = renderBar();
    openSheet(container);

    act(() => {
      within(sheetOf(container))
        .getByRole("button", { name: "share.bar.printPdf(lng=pl)" })
        .click();
    });

    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 11. Dostępność i nawigacja klawiaturą.
// ===========================================================================
describe("FloatingShareBar - dostępność", () => {
  it("widoczny rail nie ma naruszeń axe", async () => {
    mountArticle(HEADINGS, { top: 0, height: 2768 });
    h.scanned = HEADINGS;
    const { container } = renderBar({ settings: { social: ALL_SOCIAL } });
    scrollWindowTo(600);

    const violations = await axeViolations(railOf(container));
    expect(summarize(violations)).toBe("");
    expect(violations).toEqual([]);
  });

  it("wariant sidebar z kartą odsłuchu nie ma naruszeń axe", async () => {
    mountArticle(HEADINGS, { top: 0, height: 2768 });
    h.scanned = HEADINGS;
    const { container } = renderBar({
      variant: "sidebar",
      settings: { social: ALL_SOCIAL },
      listen: { postId: "post-9", title: "Tytuł wpisu", author: "Anna Kowalska" },
    });

    const violations = await axeViolations(railOf(container));
    expect(summarize(violations)).toBe("");
  });

  it("otwarty arkusz mobilny nie ma naruszeń axe", async () => {
    mountArticle(HEADINGS, { top: 0, height: 2768 });
    h.scanned = HEADINGS;
    const { container } = renderBar({ settings: { social: ALL_SOCIAL } });
    openSheet(container);

    const violations = await axeViolations(sheetOf(container));
    expect(summarize(violations)).toBe("");
  });

  it("każdy przycisk i link panelu jest osiągalny klawiaturą i ma dostępną nazwę", () => {
    mountArticle(HEADINGS, { top: 0, height: 2768 });
    h.scanned = HEADINGS;
    const { container } = renderBar({ settings: { social: ALL_SOCIAL } });
    scrollWindowTo(600);
    const rail = railOf(container);

    const targets = Array.from(rail.querySelectorAll<HTMLElement>("a[href], button"));
    // 7 kanałów + schowek + zapis + druk + 3 pozycje spisu treści.
    expect(targets).toHaveLength(CHANNELS.length + 6);

    for (const el of targets) {
      // Nic nie jest wyjęte z kolejności tabulacji ani zablokowane.
      expect(el.getAttribute("tabindex")).toBeNull();
      expect(el.hasAttribute("disabled")).toBe(false);
      const name = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent;
      expect((name ?? "").trim().length).toBeGreaterThan(0);
      el.focus();
      expect(document.activeElement).toBe(el);
    }
  });

  it("etykiety akcji pochodzą z KLUCZY i18n, nie z wpisanego tekstu", () => {
    const { container } = renderBar({ settings: { social: ALL_SOCIAL } });
    const rail = railOf(container);

    expect(rail.getAttribute("aria-label")).toBe("share.bar.share(lng=pl)");
    expect(
      within(rail).getByRole("button", { name: "share.bar.copy(lng=pl)" }).getAttribute("title"),
    ).toBe("share.bar.copy(lng=pl)");
    expect(fabOf(container).getAttribute("aria-label")).toBe("share.bar.toc(lng=pl)");
    expect(sheetOf(container).getAttribute("aria-label")).toBe("share.bar.toc(lng=pl)");
  });
});
