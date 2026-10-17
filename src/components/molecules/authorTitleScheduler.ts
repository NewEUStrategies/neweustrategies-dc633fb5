// Wspólny harmonogram pomiaru tytułu dla bylinów autora (`useAuthorTitleSize`).
//
// Byline w trybie „tytuł minus 2 px” mierzy rozmiar czcionki tytułu SWOJEJ
// karty. Ten moduł pilnuje dwóch reguł:
//
//  * ZAKRES. Tytułu szukamy wyłącznie w najbliższym `[data-author-title-scope]`
//    (karta, slajd, wiersz) albo w ramce widgetu `[data-w-id]` - nigdy wyżej.
//    Wcześniej szukanie szło aż do `<body>`, więc byline bez własnego tytułu
//    (cytat, metadane wpisu, karta autora, karta z ukrytym tytułem, podgląd
//    w panelu) brał rozmiar z obcego nagłówka: H1 wpisu, etykiety sekcji albo
//    sąsiedniego widgetu. Brak tytułu w zakresie = `null` = rozmiar z panelu CMS.
//    Węzły `[data-author-title-ignore]` (np. nazwisko w karcie autora) i treść
//    samych bylinów nigdy nie są tytułem.
//
//  * JEDEN HARMONOGRAM. Każdy byline miał własny ResizeObserver, dwa
//    MutationObservery, nasłuch `resize` i `fonts.ready` - na stronie głównej
//    ~40 kompletów. Teraz działa jeden obserwator każdego rodzaju, a wszystkie
//    sygnały zbiegają się w jednej klatce `requestAnimationFrame`. Pierwszy
//    pomiar robi `watchAuthorTitle` synchronicznie (wołający jest efektem
//    layoutowym), więc klient nie maluje stanu sprzed pomiaru.
//
// `fonts.ready` zniknął świadomie: wczytanie kroju nie zmienia wartości
// obliczonej `font-size`, więc nie ma czego przeliczać.
//
// Moduł nie dotyka `window`/`document` przy imporcie - SSR go importuje, ale
// nigdy nie woła (efekty nie biegną na serwerze).
import { flushSync } from "react-dom";
import { authorSizeFromTitle } from "@/lib/builder/authorDisplay";

/** Zakres szukania tytułu: najbliższa karta/slajd/wiersz albo ramka widgetu. */
const AUTHOR_TITLE_SCOPE_SELECTOR = "[data-author-title-scope], [data-w-id]";

/** Kandydaci na tytuł - w tej kolejności (pierwszy pasujący selektor wygrywa). */
export const AUTHOR_TITLE_SELECTORS = [
  ".cms-post-title",
  "[data-title-root]",
  ".tt-live-title",
  "h1, h2, h3",
] as const;

/** Poddrzewa, które nigdy nie są tytułem: same byliny i węzły wyłączone jawnie. */
const NOT_A_TITLE = "[data-author-byline], [data-author-title-ignore]";

/** Atrybuty zmieniające ZAKRES albo zbiór kandydatów - przeliczamy wtedy wszystko. */
const STRUCTURAL_ATTRIBUTES = new Set([
  "data-author-title-scope",
  "data-author-title-ignore",
  "data-w-id",
  "data-title-root",
]);

/** Arkusze, których zmiana może przestawić rozmiar tytułów (Theme Design, typografia widgetu). */
const STYLESHEET = "style, link[rel~='stylesheet']";

/**
 * Przodkowie, których STYL niesie rozmiar tytułu: ramka widgetu (`--wt-*`
 * typografii) i renderer buildera. Styl innych przodków (przesuw karuzeli,
 * blokada przewijania) zmienia się bywa co klatkę i rozmiaru tytułu nie rusza.
 */
const SIZE_CARRIER = "[data-w-id], [data-wt], [data-builder-renderer]";

/** Wynik pomiaru: rozmiar nazwiska (px) albo `null`, gdy w zakresie nie ma tytułu. */
export type AuthorTitleMeasurement = number | null;

/** Najbliższy zakres bylinu albo `null` (byline poza kartą i widgetem). */
function findAuthorTitleScope(byline: Element): Element | null {
  return byline.parentElement?.closest(AUTHOR_TITLE_SCOPE_SELECTOR) ?? null;
}

/** Tytuł, za którym idzie byline - szukany WYŁĄCZNIE w jego zakresie. */
export function findAuthorTitle(byline: Element): Element | null {
  const scope = findAuthorTitleScope(byline);
  if (!scope) return null;
  for (const selector of AUTHOR_TITLE_SELECTORS) {
    for (const candidate of scope.querySelectorAll(selector)) {
      if (!candidate.closest(NOT_A_TITLE)) return candidate;
    }
  }
  return null;
}

/** Rozmiar nazwiska dla tytułu (px, dwa miejsca po przecinku) albo `null`. */
function sizeFromTitle(title: Element): AuthorTitleMeasurement {
  const px = Number.parseFloat(getComputedStyle(title).fontSize);
  if (!Number.isFinite(px) || px <= 2) return null;
  return Math.round(authorSizeFromTitle(px) * 100) / 100;
}

interface Entry {
  readonly byline: HTMLElement;
  readonly listener: (size: AuthorTitleMeasurement) => void;
  scope: Element | null;
  title: Element | null;
  /** `undefined` do pierwszego pomiaru - słuchacz dostaje wtedy zawsze wynik. */
  size: AuthorTitleMeasurement | undefined;
}

const entries = new Set<Entry>();
const dirty = new Set<Entry>();
/** Tytuł -> byliny, które za nim idą (jeden tytuł obserwujemy raz). */
const titleUsers = new Map<Element, Set<Entry>>();
let frame = 0;
/** Klatka zamówiona, a jeszcze nie wykonana (osobno od `frame`: atrapa rAF bywa synchroniczna). */
let queued = false;
let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
/** ResizeObserver zgłasza każdy element raz zaraz po `observe` - to nie zmiana. */
let primedTitles = new WeakSet<Element>();

function measure(entry: Entry): void {
  const connected = entry.byline.isConnected;
  entry.scope = connected ? findAuthorTitleScope(entry.byline) : null;
  const title = connected ? findAuthorTitle(entry.byline) : null;
  if (title !== entry.title) {
    untrackTitle(entry);
    entry.title = title;
    trackTitle(entry);
  }
  const size = title ? sizeFromTitle(title) : null;
  if (size === entry.size) return;
  entry.size = size;
  entry.listener(size);
}

function trackTitle(entry: Entry): void {
  const title = entry.title;
  if (!title) return;
  let users = titleUsers.get(title);
  if (!users) {
    users = new Set();
    titleUsers.set(title, users);
    resizeObserver?.observe(title);
  }
  users.add(entry);
}

function untrackTitle(entry: Entry): void {
  const title = entry.title;
  if (!title) return;
  const users = titleUsers.get(title);
  users?.delete(entry);
  if (users && users.size === 0) {
    titleUsers.delete(title);
    resizeObserver?.unobserve(title);
    primedTitles.delete(title);
  }
}

function flush(): void {
  queued = false;
  frame = 0;
  const batch = [...dirty];
  dirty.clear();
  // Jeden synchroniczny commit w tej samej klatce, PRZED malowaniem: zwykły
  // `setState` z rAF dostaje w React 19 pas domyślny i wchodzi dopiero po
  // malowaniu, więc np. po przełączeniu urządzenia renderera jedna klatka
  // miała nowy tytuł i stary podpis. Odczyty (`getComputedStyle`) i tak idą
  // przed zapisami - aktualizacje stanu czekają do końca wywołania.
  flushSync(() => {
    for (const entry of batch) if (entries.has(entry)) measure(entry);
  });
}

function requestFlush(): void {
  if (queued || !dirty.size) return;
  queued = true;
  frame = requestAnimationFrame(flush);
}

function schedule(entry?: Entry): void {
  if (entry) dirty.add(entry);
  else for (const each of entries) dirty.add(each);
  requestFlush();
}

const scheduleAll = (): void => schedule();

function isStylesheet(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).matches(STYLESHEET);
}

function holdsStylesheet(node: Node): boolean {
  return (
    isStylesheet(node) ||
    (node.nodeType === 1 && (node as Element).querySelector(STYLESHEET) !== null)
  );
}

/** Zmiana arkusza w `<head>` albo `<body>` (wstawienie, usunięcie, treść, `media`). */
function touchesStylesheet(record: MutationRecord): boolean {
  const target = record.target;
  if (record.type === "characterData") return target.parentNode?.nodeName === "STYLE";
  if (isStylesheet(target)) return true;
  if (record.type !== "childList") return false;
  for (const node of record.addedNodes) if (holdsStylesheet(node)) return true;
  for (const node of record.removedNodes) if (holdsStylesheet(node)) return true;
  return false;
}

function onMutations(records: MutationRecord[]): void {
  for (const record of records) {
    if (touchesStylesheet(record)) return scheduleAll();
    if (record.type !== "attributes") continue;
    // Motyw na `<html>` (np. klasa `dark`) i atrybuty zmieniające zakres.
    if (record.target === document.documentElement) return scheduleAll();
    if (STRUCTURAL_ATTRIBUTES.has(record.attributeName ?? "")) return scheduleAll();
  }
  for (const record of records) {
    if (record.type === "characterData" || record.target.nodeType !== 1) continue;
    const target = record.target as Element;
    // Własne zapisy bylinów (styl po pomiarze) nie zmieniają tytułów.
    if (target.closest(NOT_A_TITLE)) continue;
    // Zmiana W zakresie liczy się zawsze; u PRZODKA - klasa/atrybut (urządzenie
    // podglądu, wariant) albo styl ramki widgetu, w którym jadą `--wt-*`.
    // Tytuł `.cms-post-title` jest `display: inline`, więc ResizeObserver go
    // nie widzi - przodka trzeba łapać tutaj.
    const ancestorCounts =
      record.type === "attributes" &&
      (record.attributeName !== "style" || target.matches(SIZE_CARRIER));
    for (const entry of entries) {
      const scope = entry.scope;
      if (!scope || dirty.has(entry)) continue;
      if (scope.contains(target) || (ancestorCounts && target.contains(scope))) dirty.add(entry);
    }
  }
  requestFlush();
}

function onResize(observed: ResizeObserverEntry[]): void {
  for (const { target } of observed) {
    if (!primedTitles.has(target)) {
      primedTitles.add(target);
      continue;
    }
    for (const entry of titleUsers.get(target) ?? []) dirty.add(entry);
  }
  requestFlush();
}

/** `<link rel="stylesheet">` działa dopiero po wczytaniu, nie po wstawieniu. */
function onLoad(event: Event): void {
  if (event.target instanceof Element && event.target.matches("link[rel~='stylesheet']")) {
    scheduleAll();
  }
}

function connect(): void {
  if (typeof ResizeObserver !== "undefined") resizeObserver = new ResizeObserver(onResize);
  if (typeof MutationObserver !== "undefined") {
    mutationObserver = new MutationObserver(onMutations);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    // Arkusze Theme Design i typografii widgetu żyją w `<head>` ORAZ w `<body>`
    // (blok `<style>` ramki stoi przed widgetem), więc patrzymy na oba.
    mutationObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["media", "disabled", "href"],
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "media",
        "disabled",
        "data-device",
        "data-wt",
        ...STRUCTURAL_ATTRIBUTES,
      ],
    });
  }
  window.addEventListener("resize", scheduleAll, { passive: true });
  document.addEventListener("load", onLoad, true);
}

function disconnect(): void {
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  resizeObserver = null;
  mutationObserver = null;
  window.removeEventListener("resize", scheduleAll);
  document.removeEventListener("load", onLoad, true);
  if (queued) cancelAnimationFrame(frame);
  queued = false;
  frame = 0;
  dirty.clear();
  titleUsers.clear();
  primedTitles = new WeakSet();
}

/**
 * Zapina byline we wspólny harmonogram. Mierzy OD RAZU (wołający to efekt
 * layoutowy), potem przy każdej zmianie, która może przestawić tytuł: arkusz
 * w `<head>`/`<body>`, motyw na `<html>`, klasa/styl w zakresie, klasa
 * przodka, rozmiar tytułu, okno. Słuchacz dostaje wynik tylko, gdy się zmienił.
 * Zwraca funkcję odpinającą; ostatnie odpięcie zdejmuje wszystkie obserwatory.
 */
export function watchAuthorTitle(
  byline: HTMLElement,
  listener: (size: AuthorTitleMeasurement) => void,
): () => void {
  const entry: Entry = { byline, listener, scope: null, title: null, size: undefined };
  if (entries.size === 0) connect();
  entries.add(entry);
  measure(entry);
  return () => {
    if (!entries.delete(entry)) return;
    dirty.delete(entry);
    untrackTitle(entry);
    entry.title = null;
    if (entries.size === 0) disconnect();
  };
}

/** Liczba podpiętych bylinów - dla testów sprzątania. */
export function watchedAuthorTitleCount(): number {
  return entries.size;
}
