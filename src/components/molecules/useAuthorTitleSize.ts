// Rozmiar nazwiska autora = rozmiar tytułu jego karty - 2 px (`authorSizeFromTitle`).
//
// ZAKRES WYSZUKIWANIA TYTUŁU
// Tytuł szukamy od rodzica bylinu w górę, ale NIGDY poza jego zakres:
// najbliższy `[data-author-title-scope]` (karta, slajd, wiersz) albo korzeń
// widgetu `[data-w-id]`. Wcześniej pętla szła aż do `body` i byline bez
// własnego tytułu (cytat, meta wpisu, karta z ukrytym tytułem, podgląd w
// panelu) brał rozmiar z pierwszego obcego nagłówka na stronie - etykiety
// sekcji, H1 wpisu albo karty sąsiedniego widgetu. Byline bez zakresu albo
// bez tytułu w zakresie = `null`: wraca do rozmiaru z panelu CMS.
//
// JEDEN WSPÓLNY HARMONOGRAM
// Wszystkie byliny strony (na stronie głównej ~40) dzielą jeden zestaw
// obserwatorów i jeden `requestAnimationFrame`. Arkusze stylów (Theme Design
// i rozmiary czcionek renderują się w `<body>`, arkusz instancji slidera obok
// widgetu, arkusze w `<head>`) przeliczają wszystkie byliny; montaż tytułu,
// zmiana jego klasy/stylu i przełączenie urządzenia w kanwie - tylko byliny
// z tego zakresu; zmiana szerokości okna i dociągnięte fonty - wszystkie.
import { useCallback, useState } from "react";
import { authorSizeFromTitle } from "@/lib/builder/authorDisplay";
import { useIsomorphicLayoutEffect } from "@/lib/react/useIsomorphicLayoutEffect";

/** Tytuły w kolejności pierwszeństwa (pierwszy trafiony na danym poziomie wygrywa). */
const TITLE_SELECTORS = [
  ".cms-post-title",
  "[data-title-root]",
  '[data-typography-role="title"]',
  ".tt-live-title",
  "h1, h2, h3",
  "h4, h5, h6",
];
/** Granica wyszukiwania tytułu: karta/slajd/wiersz albo korzeń widgetu. */
const SCOPE_SELECTOR = "[data-author-title-scope], [data-w-id]";
/**
 * Węzły, które nigdy nie są „tytułem” bylinu: inne byliny, nazwisko w karcie
 * autora, nagłówki tylko dla czytników ekranu.
 */
const IGNORED_SELECTOR = "[data-author-byline], [data-author-title-ignore], .sr-only";

/**
 * Wynik pomiaru:
 *   `undefined` - jeszcze nie zmierzono (SSR, pierwszy render): byline używa
 *                 zastępczej wartości z CSS (`--abl-title-size` / tokeny tytułu),
 *   `number`    - zmierzony tytuł - 2 px,
 *   `null`      - w zakresie bylinu nie ma tytułu: obowiązuje rozmiar z panelu.
 */
export type AuthorTitleSize = number | null | undefined;

/** Tytuł renderowany (duplikat `display: none` dla innej szerokości się nie liczy). */
function isRendered(el: Element): boolean {
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
}

/** Najbliższy tytuł bylinu w jego zakresie (eksportowane dla testów). */
export function findAuthorTitle(byline: Element): Element | null {
  const scope = byline.closest(SCOPE_SELECTOR);
  if (!scope) return null;
  let parent = byline.parentElement;
  while (parent) {
    for (const selector of TITLE_SELECTORS) {
      for (const candidate of Array.from(parent.querySelectorAll(selector))) {
        if (!candidate.closest(IGNORED_SELECTOR) && isRendered(candidate)) return candidate;
      }
    }
    if (parent === scope) return null;
    parent = parent.parentElement;
  }
  return null;
}

function measureAuthorSize(byline: Element): number | null {
  const title = findAuthorTitle(byline);
  if (!title) return null;
  const px = Number.parseFloat(getComputedStyle(title).fontSize);
  return Number.isFinite(px) && px > 2 ? authorSizeFromTitle(px) : null;
}

interface Entry {
  readonly byline: HTMLElement;
  readonly apply: (size: number | null) => void;
}

const entries = new Set<Entry>();
const dirty = new Set<Entry>();
let frame = 0;
let teardown: (() => void) | null = null;

function flush() {
  frame = 0;
  const batch = Array.from(dirty);
  dirty.clear();
  // Najpierw same odczyty (getComputedStyle), potem zapisy stanu - bez
  // przeplatania odczytów z zapisami DOM w jednej klatce.
  const sizes = batch.map((entry) =>
    entry.byline.isConnected ? measureAuthorSize(entry.byline) : null,
  );
  batch.forEach((entry, index) => entry.apply(sizes[index]));
}

function schedule(targets: Iterable<Entry>) {
  for (const entry of targets) dirty.add(entry);
  if (!frame && dirty.size > 0) frame = requestAnimationFrame(flush);
}

/** Arkusz stylów: `<style>` albo `<link rel="stylesheet">`. */
function isSheet(node: Node | null): boolean {
  if (!node) return false;
  if (node.nodeName === "STYLE") return true;
  return node.nodeName === "LINK" && /\bstylesheet\b/i.test((node as HTMLLinkElement).rel);
}

/** Czy mutacja dotyczy arkusza stylów (treść, atrybuty, dodanie lub usunięcie). */
function touchesSheet(record: MutationRecord): boolean {
  if (isSheet(record.target) || isSheet(record.target.parentNode)) return true;
  for (const node of Array.from(record.addedNodes)) if (isSheet(node)) return true;
  for (const node of Array.from(record.removedNodes)) if (isSheet(node)) return true;
  return false;
}

/** Byliny, których rozmiar może zmienić któraś z mutacji (poza arkuszami). */
function affectedBy(records: MutationRecord[]): Entry[] {
  const scoped = Array.from(entries, (entry) => ({
    entry,
    scope: entry.byline.closest(SCOPE_SELECTOR),
  }));
  const hit = new Set<Entry>();
  for (const { type, target, attributeName } of records) {
    // Zmiana tekstu poza arkuszem (licznik, zegar) nie zmienia rozmiaru tytułu.
    if (type === "characterData") continue;
    for (const { entry, scope } of scoped) {
      if (!scope || hit.has(entry)) continue;
      if (scope.contains(target)) {
        hit.add(entry);
      } else if (attributeName !== null && target.contains(scope)) {
        // Przodek zakresu: klasa / urządzenie kanwy mogą zmienić rozmiar
        // tytułu dziedziczony w dół. Styl inline przodka liczy się tylko na
        // korzeniu widgetu (zmienne typografii `--wt-*`) - przesunięcie toru
        // slidera (`transform` przy każdym ruchu) nie przelicza bylinów.
        if (
          attributeName !== "style" ||
          (target instanceof Element && target.matches("[data-w-id], [data-wt]"))
        ) {
          hit.add(entry);
        }
      }
    }
  }
  return Array.from(hit);
}

function start() {
  const all = () => schedule(entries);
  // `<head>`: tylko arkusze - tytuł strony, meta i `modulepreload` przy
  // najechaniu na link nie zmieniają rozmiaru tytułów.
  const head = new MutationObserver((records) => {
    if (records.some(touchesSheet)) all();
  });
  head.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  // `<body>`: arkusze (Theme Design i rozmiary czcionek, arkusz instancji
  // slidera, typografia widgetu w trybie zgodności) przeliczają wszystko;
  // reszta - asynchroniczny montaż tytułu, jego klasa/styl, urządzenie kanwy
  // (`data-device`), tokeny typografii (`data-wt`) - tylko swój zakres.
  const body = new MutationObserver((records) => {
    if (records.some(touchesSheet)) all();
    else schedule(affectedBy(records));
  });
  body.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "data-device", "data-wt", "rel", "media", "disabled"],
  });
  const root = new MutationObserver(all);
  root.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  window.addEventListener("resize", all, { passive: true });
  document.fonts?.addEventListener?.("loadingdone", all);
  void document.fonts?.ready.then(() => {
    if (teardown) all();
  });
  teardown = () => {
    head.disconnect();
    body.disconnect();
    root.disconnect();
    window.removeEventListener("resize", all);
    document.fonts?.removeEventListener?.("loadingdone", all);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    dirty.clear();
    teardown = null;
  };
}

function register(entry: Entry) {
  entries.add(entry);
  if (!teardown) start();
  // Pierwszy pomiar synchronicznie (efekt layoutowy): byline dodany po
  // hydracji (kanwa, nawigacja, dane autora dojechały później) nie maluje
  // klatki z wartością zastępczą.
  entry.apply(measureAuthorSize(entry.byline));
  return () => {
    entries.delete(entry);
    dirty.delete(entry);
    if (entries.size === 0) teardown?.();
  };
}

/** Rozmiar nazwiska autora wynikający z najbliższego tytułu w zakresie bylinu. */
export function useAuthorTitleSize(enabled: boolean) {
  const [byline, setByline] = useState<HTMLElement | null>(null);
  // Węzeł w stanie, nie w `useRef`: byline bywa montowany później niż
  // komponent (nazwisko dojeżdża z danymi), a efekt musi to zauważyć.
  const ref = useCallback((node: HTMLElement | null) => setByline(node), []);
  const [size, setSize] = useState<AuthorTitleSize>();
  useIsomorphicLayoutEffect(() => {
    if (!enabled || !byline) return;
    return register({ byline, apply: setSize });
  }, [enabled, byline]);
  return { ref, size: enabled ? size : undefined };
}
