// Wyspa hydratacji: `HydrationIsland` - granica Suspense, którą klient
// hydratuje dopiero po wyzwoleniu (widoczność, interakcja, intencja, zapytanie
// mediów, punkt ciszy), a do tego czasu zostawia HTML serwera nietknięty.
//
// PO CO (P1.6, podstawa P2.2/P2.3). Commit hydratacji (K12 w księdze P0.5) to
// największe zadanie w oknie TBT: React hydratuje całe drzewo jednym ciągiem.
// Wyspa dzieli tę pracę - treść poniżej zgięcia i ukryte warianty hydratują
// później, po jednej na klatkę, przez kolejkę P0.3 (`postInteractionQueue`).
//
// MECHANIZM. Na serwerze wyspa renderuje dzieci wprost w `<Suspense>` (bez
// zawieszenia, więc w HTML nie ma fallbacku). Na kliencie React przy
// hydratacji zostawia każdą granicę Suspense ODWODNIONĄ w pierwszym przebiegu
// i wraca do niej w osobnym (OffscreenLane). Wtedy `IslandGate` woła
// `use(bramka)`: bramka czeka, React zostawia HTML serwera i ponawia granicę,
// gdy bramka się otworzy. Otoczka `<div data-island-state>` leży POZA granicą,
// więc hydratuje razem z rodzicem - daje korzeń dla obserwatorów i atrybut
// stanu dla RUM (P0.6).
//
// HYDRATACJA A ŚWIEŻY MONTAŻ. Wyspa zamontowana po nawigacji SPA nie ma HTML
// serwera i nie może czekać (pokazałaby fallback do wyzwolenia). Rozróżnia to
// kolejność, którą gwarantuje React: przy hydratacji treść granicy renderuje
// się dopiero PO commicie otoczki (przebieg odroczony), przy świeżym montażu -
// w tym samym przebiegu, PRZED commitem. `IslandGate` wyrenderowany przed
// commitem otoczki otwiera więc bramkę od razu (zatrzask), bez zapytań o DOM.
//
// BRAMKA = thenable z polem `status` ustawianym SYNCHRONICZNIE przy otwarciu
// (kontrakt TORU PILNEGO z `postInteractionQueue.ts`). react-dom 19.2 przy
// zdarzeniu dyskretnym na odwodnionej granicy próbuje ją uwodnić
// synchronicznie (`dispatchEvent` -> `attemptSynchronousHydration`); `use()`
// na promise bez `status: "fulfilled"` zawiesiłby się jeszcze raz, a klik
// przepadłby (`stopPropagation`).
//
// CHUNKI (krytyka M5). Bramka otwiera się DOPIERO po `chunks`: loaderach
// (`() => import(...)`) i komponentach `React.lazy` zagnieżdżonych widgetów
// wyspy. Sam załadowany moduł NIE wystarcza komponentowi `lazy`: przy
// pierwszym renderze woła on WŁASNĄ fabrykę, a status „resolved" dostaje
// dopiero w `.then`, czyli w mikrozadaniu - render rzuca thenable, a
// hydratacja synchroniczna przy zdarzeniu dyskretnym (`renderRootSync`) nie
// ponawia i klik przepada, także gdy widget siedzi we własnej granicy
// (`withSuspense`). Dlatego komponent `lazy` podany w `chunks` wyspa
// GRUNTUJE (`primeLazy`: `_init(_payload)`, ten sam protokół react/react-dom,
// którym react-dom rozwiązuje `lazy` przy renderze), a bramka czeka na jego
// rozstrzygnięcie - pierwszy render jest wtedy synchroniczny. Każdy
// `React.lazy` w wyspie trzeba więc podać w `chunks` JAKO KOMPONENT, nie jego
// loader (test „loader zamiast komponentu lazy gubi klik"). Komponent `lazy`
// rozwiązany wcześniej (np. przez inną wyspę) jest gotowy synchronicznie:
// tor pilny otwiera wtedy bramkę w tym samym mikrozadaniu.
//
// WYZWALACZE (`trigger`, czytane przy montażu; domyślnie: własne zdarzenia i
// zapas ciszy). Żaden nie otwiera bramki synchronicznie w handlerze zdarzenia
// - każdy tylko zakłada wpis w kolejce P0.3; wyjątkiem jest tor pilny, który
// biegnie w pierwszym mikrozadaniu po handlerze:
//  - `visible: {rootMargin}` - IntersectionObserver na `[data-sec-id]` w
//    wyspie (albo jej dzieciach-elementach) -> `enqueue(open, {priority:
//    "islands", target: korzeń, release: "immediate"})`; treść bez elementów
//    zostawia sam korzeń, który z klasą `contents` (domyślną albo podaną, także
//    z wariantem, np. `md:contents`) nie ma pudełka i nigdy się nie przetnie
//    (w DEV ostrzeżenie z `id`; korzeń z pudełkiem z `className` - bez
//    ostrzeżenia);
//  - `interaction: "any"` - pierwsza interakcja gdziekolwiek ->
//    `enqueue(open, {priority: "islands", target: korzeń})` (kolejka stawia
//    wyspę pod palcem na początku, resztę puszcza po jednej na klatkę);
//  - `interaction: "own"` (domyślnie) albo `"any"` + `ownEvents` (domyślnie
//    `pointerdown`, `focusin`, `keydown` - przed `click`) - zdarzenie we
//    wnętrzu wyspy -> `enqueue(open, {priority: "island-target", target:
//    korzeń, release: "urgent"})`. Nasłuch w fazie capture na `window`, nie na
//    korzeniu wyspy: dokument jest korzeniem Reacta, a React w swoim
//    nasłuchu capture na DOKUMENCIE zatrzymuje (`stopPropagation`) zdarzenia
//    celujące w odwodnioną granicę - nasłuch na korzeniu wyspy nigdy by ich
//    nie zobaczył. `window` jest na ścieżce przed dokumentem, a mikrozadanie
//    toru pilnego biegnie między nasłuchami, więc bramka (gdy chunki są już
//    załadowane) jest otwarta, zanim React spróbuje hydratacji synchronicznej;
//  - `globalKeys` (np. `["/"]`) - klawisz poza polem edycji, bez Ctrl/Meta/Alt
//    -> `enqueue(open, {priority: "island-target", release: "immediate"})`;
//  - `media` - zapytanie, które ZACZYNA pasować -> `release: "immediate"`;
//    zapytanie pasujące już przy montażu = otwarcie od razu (jak
//    `immediateWhen`), np. ukryty nagłówek desktopowy na desktopie (P2.3);
//  - `immediateWhen()` (np. `hasStoredAuthSession` z P1.7) - `true` przy
//    montażu: bramka otwarta od razu, bez kolejki. Chunki startują już w
//    renderze otoczki (przed jej commitem i efektami); gotowe synchronicznie
//    (brak chunków, `lazy` rozwiązane wcześniej) otwierają bramkę, zanim React
//    dotknie granicy, pozostałe - zaraz po załadowaniu;
//  - `quiescent` (domyślnie `true`) - zapas `onQuiescent(open, {priority:
//    "islands"})`.
// Pierwszy wyzwalacz, który dojdzie do skutku, zdejmuje pozostałe.
//
// KONTRAKT ZADANIA (P0.3): zadanie otwarcia zwraca promise rozstrzygany PO
// COMMICIE wyspy (efekt warstwy wewnątrz granicy), więc kolejka nie nakłada
// następnej pracy na hydratację tej wyspy. Zagnieżdżone granice (np. widgety
// `withSuspense`) hydratują dopiero w kolejnych przebiegach Offscreen po tym
// commicie, więc kolejka może zwolnić następną wyspę, zanim skończy się ich
// praca - to praca w torze Idle, dzielona na kawałki, więc szkoda jest mała.
//
// GÓRNA GRANICA. Zmiana kontekstu nad czekającą wyspą (także w
// `startTransition`) dociera do jej odwodnionej granicy: przejście NIE
// zostanie zatwierdzone, dopóki wyspa się nie uwodni - i to na CAŁEJ stronie
// (React nie wie, czy treść wyspy czyta zmieniony kontekst), a aktualizacja
// poza przejściem (Sync i Default) renderuje wyspę po stronie klienta. React
// próbuje wtedy wyrenderować treść wyspy w trybie KLIENTA - w odróżnieniu od
// każdej próby hydratacji (pierwszej, ponowionej po przerwanym przebiegu,
// synchronicznej przy zdarzeniu).
// `IslandGate` rozpoznaje tryb sondą `useSyncExternalStore` z IDENTYCZNĄ
// migawką (React woła `getServerSnapshot` wyłącznie przy hydratacji) i przy
// renderze klienta czekającej treści otwiera wyspę przez kolejkę
// (`island-target`, `immediate`): przejście czeka najwyżej na chunki i klatkę,
// a fallback po renderze klienta znika równie szybko. W DEV - ostrzeżenie z
// `id` wyspy (sygnał dla audytu providerów P2.2: taka wyspa nie jest odroczona).
// UWAGA: na bazie cc1a3767 górną granicę wyzwala u KAŻDEGO gościa
// `AuthProvider` (`useAuth.tsx`: `startTransition(() =>
// setSessionLoading(false))` w pierwszym przebiegu efektów zmienia wartość
// kontekstu), a przy zapisanym motywie innym niż `SERVER_THEME` także
// `ThemeProvider` (`readStored` w przejściu). Dopóki providery nad wyspami
// zmieniają wartość kontekstu przy boocie, wyspy otwierają się zaraz po nim
// (podział na klatki zostaje, odroczenia poza okno TBT nie ma) - wymóg dla
// P2.2: stała wartość kontekstu przy boocie gościa. P1.7 zmierzyła ją bez
// wysp i wycofała (regres TBT po commicie) - patrz `useAuth.tsx`, blok
// „DLACZEGO NIE STAŁA WARTOŚĆ KONTEKSTU…"; wraca razem z wyspami P2.2.
//
// `data-island-state` (kontrakt P0.6, `@/lib/webVitals`): DOKŁADNIE
// `pending` (w HTML serwera i do commitu granicy) i `hydrated` (po commicie).
// Typ tylko przez `import type` - import wartości wciągnąłby reporter RUM do
// chunku wyspy.
//
// WARUNKI DLA KONSUMENTÓW (P2.2, P2.3):
//  - kontekst nad wyspą nie może się zmieniać, dopóki wyspa czeka (GÓRNA
//    GRANICA otworzy ją wtedy przedwcześnie, a każda aktualizacja poza
//    `startTransition` - Sync i Default - dodatkowo porzuci jej HTML);
//    urządzenie z `useViewportDevice()` WEWNĄTRZ wyspy, nie z kontekstu ani
//    propsów; motyw, sesja, język nad wyspami - przez magazyny czytane w
//    środku albo klasę na `<html>`, nie przez wartość kontekstu;
//  - treść wyspy przy hydratacji renderuje się z BIEŻĄCYM stanem magazynów
//    zewnętrznych (react-query, i18next): dane zapytania czytanego w wyspie
//    albo język zmienione przed jej otwarciem dają rozjazd hydratacji i render
//    klienta wyspy (test „ograniczenie dla P2.2");
//  - ścieżka wyspy jest `memo` na dwóch poziomach: cała wyspa
//    (`islandPropsEqual`) i osobno jej granica (`IslandContent`,
//    `contentPropsEqual`). Do granicy docierają WYŁĄCZNIE dzieci, `fallback` i
//    `fallbackMinHeight`. `className` i `id` otoczki (oraz jej stan) do niej
//    nie docierają: zmiana samej klasy czekającej wyspy (np. zależnej od
//    układu, P2.3) aktualizuje tylko otoczkę, a HTML serwera zostaje.
//    `fallbackMinHeight` dociera do granicy jak zmiana danych (niżej), więc ma
//    być stały, dopóki wyspa czeka;
//  - dzieci i `fallback` porównywane strukturalnie - element (typ, klucz,
//    propsy), tablica (kilkoro dzieci, fragment) i zwykły obiekt (np. `style`)
//    pole po polu, a funkcje, instancje klas i refy WYŁĄCZNIE referencyjnie
//    (`ref` elementu i zwykły obiekt z jedynym polem `current`, np.
//    `inputRef={r}`: dwa różne, jeszcze nieprzypięte refy nie są „równe", więc
//    podmiana refu dochodzi do treści i po hydratacji przypięty jest nowy).
//    Dziecko wyspy musi więc mieć stabilne propsy: bez inline callbacków
//    (`onPick={() => …}` - zamiast tego `useCallback` albo funkcja modułu),
//    bez nowych instancji klas i nowych refów przy każdym renderze rodzica
//    (`useRef` jest stabilny); inaczej re-render rodzica dociera do czekającej
//    granicy i porzuca jej HTML (w DEV ostrzeżenie z `id`). Tak samo działają
//    dane, które naprawdę się zmieniają (np. odświeżone zapytanie nad wyspą
//    podane w propsie, podmieniony ref): docierają do czekającej granicy jak
//    każda aktualizacja. Po commicie wyspy nierówne propsy to zwykła
//    aktualizacja; obiekt zmieniony W MIEJSCU (ta sama referencja) jest - jak
//    przy każdym `memo` - pominięty. `trigger` i `chunks` nie biorą udziału
//    (czytane przy montażu); `id` stały i unikalny na stronie (klucz
//    elementu);
//  - każdy `React.lazy` w wyspie podany w `chunks` jako komponent (CHUNKI);
//  - wyspa nie może obejmować komponentów zawieszających się na SERWERZE
//    (bramka danych sekcji) - jej granica przejęłaby strumień;
//  - `disabled` (np. `editorPreview`) i kanwa buildera (`useBuilderMode()`) =
//    dzieci wprost, bez otoczki i BEZ `memo` (każdy render rodzica dochodzi do
//    dzieci, także po zmianie obiektu sekcji w miejscu); wartość musi być taka
//    sama na serwerze i kliencie.

import {
  isValidElement,
  memo,
  Suspense,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import type { IslandState, IslandStateAttributes } from "@/lib/webVitals";
import { enqueue, type EnqueueOptions, type QueuedTask } from "./postInteractionQueue";
import { onQuiescent } from "./whenQuiescent";

/** Zdarzenia we wnętrzu wyspy, które mogą ją otworzyć torem pilnym. */
export const ISLAND_OWN_EVENTS = [
  "pointerdown",
  "pointerover",
  "touchstart",
  "focusin",
  "keydown",
] as const;

export type IslandOwnEvent = (typeof ISLAND_OWN_EVENTS)[number];

/** Domyślne `ownEvents`: wszystkie poprzedzają `click`. */
export const DEFAULT_ISLAND_OWN_EVENTS = [
  "pointerdown",
  "focusin",
  "keydown",
] as const satisfies readonly IslandOwnEvent[];

export interface IslandVisibleTrigger {
  /** Margines IntersectionObservera, np. `"0px 0px 100% 0px"` (ekran zapasu w dół). */
  readonly rootMargin?: string;
}

/** Wyzwalacze wyspy; czytane raz, przy montażu. */
export interface IslandTrigger {
  /** Widoczność (domyślnie `false`). */
  readonly visible?: false | IslandVisibleTrigger;
  /**
   * `"own"` (domyślnie) - tylko `ownEvents` we wnętrzu wyspy; `"any"` - także
   * pierwsza interakcja gdziekolwiek (przez kolejkę); `false` - bez wyzwalaczy
   * interakcji (także bez `ownEvents`).
   */
  readonly interaction?: "any" | "own" | false;
  /** Zdarzenia we wnętrzu wyspy (domyślnie `DEFAULT_ISLAND_OWN_EVENTS`). */
  readonly ownEvents?: readonly IslandOwnEvent[];
  /** Klawisze (`KeyboardEvent.key`) otwierające wyspę z dowolnego miejsca strony. */
  readonly globalKeys?: readonly string[];
  /** Zapytanie mediów: pasujące przy montażu = od razu, zaczynające pasować = kolejka. */
  readonly media?: string;
  /** `true` przy montażu = otwarcie od razu (hydratacja jak bez wyspy). */
  readonly immediateWhen?: () => boolean;
  /** Zapas przez punkt ciszy P0.3 (domyślnie `true`). */
  readonly quiescent?: boolean;
}

/**
 * Loader modułu potrzebnego treści wyspy (`() => import(...)`). Tylko ładuje
 * kod - NIE gruntuje `React.lazy` zbudowanego na tym samym imporcie (patrz
 * CHUNKI w nagłówku); taki komponent podaje się w `chunks` wprost.
 */
export type IslandChunkLoader = () => PromiseLike<unknown>;

/**
 * Komponent `React.lazy` (`LazyExoticComponent` z `@types/react` pasuje
 * strukturalnie). Wyspa woła jego inicjalizator, zanim otworzy bramkę.
 */
export interface IslandLazyComponent {
  readonly $$typeof: symbol;
  readonly _result: unknown;
}

/** Wpis `chunks`: loader albo komponent `React.lazy`. */
export type IslandChunk = IslandChunkLoader | IslandLazyComponent;

export interface HydrationIslandProps {
  /** Stały, unikalny na stronie identyfikator (`data-island-id`); używać też jako `key`. */
  readonly id: string;
  readonly trigger?: IslandTrigger;
  /**
   * Chunki, bez których treść wyspy nie uwodni się w całości: loadery i
   * komponenty `React.lazy` (te drugie wyspa gruntuje - pierwszy render
   * synchroniczny, klik toru pilnego nie przepada).
   */
  readonly chunks?: readonly IslandChunk[];
  /**
   * Fallback granicy - widoczny tylko przy renderze po stronie klienta (świeży
   * montaż z zawieszonym dzieckiem albo awaryjne porzucenie HTML serwera);
   * domyślnie pusty blok o `fallbackMinHeight` (siatka bezpieczeństwa CLS).
   */
  readonly fallback?: ReactNode;
  readonly fallbackMinHeight?: number;
  /** Klasy otoczki (domyślnie `contents` - otoczka nie tworzy pudełka). */
  readonly className?: string;
  /** Wyłącza wyspę (np. `editorPreview`): dzieci wprost, bez otoczki i granicy. */
  readonly disabled?: boolean;
  readonly children: ReactNode;
}

type GateStatus = "pending" | "fulfilled";

/** Bramka czytana przez `use()`: promise z polami `status`/`value` w konwencji Reacta. */
type IslandGateThenable = Promise<void> & { status: GateStatus; value: undefined };

const NO_TRIGGER: IslandTrigger = {};
const NO_CHUNKS: readonly IslandChunk[] = [];
const REACT_LAZY_TYPE = Symbol.for("react.lazy");
const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

const noop = (): void => {};

function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

function mediaMatches(query: string | undefined): boolean {
  if (!query || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

function isImmediate(trigger: IslandTrigger): boolean {
  try {
    if (trigger.immediateWhen?.() === true) return true;
  } catch (error) {
    report(error);
  }
  return mediaMatches(trigger.media);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "then") === "function"
  );
}

/**
 * Gruntuje komponent `React.lazy`: woła jego inicjalizator dokładnie tak, jak
 * react-dom przy renderze (`lazy._init(lazy._payload)`; pola spoza typów
 * publicznych, ale to protokół między `react` a rendererami - ten sam od 16.6
 * do 19.2, korzystają z niego też zewnętrzne renderery na
 * `react-reconciler`). Pierwsze wywołanie uruchamia fabrykę (import chunku) i
 * rzuca jej thenable; po jego rozstrzygnięciu payload ma status „resolved",
 * więc render komponentu jest synchroniczny. Zwraca `null`, gdy komponent
 * jest gotowy już teraz, albo promise rozstrzygany PO `.then` Reacta
 * (zarejestrowanym wcześniej, w inicjalizatorze).
 */
function primeLazy(component: IslandLazyComponent): PromiseLike<unknown> | null {
  const init: unknown = Reflect.get(component, "_init");
  if (component.$$typeof !== REACT_LAZY_TYPE || typeof init !== "function") {
    return Promise.reject(
      new TypeError("[hydration-island] chunks: expected a loader or a React.lazy component"),
    );
  }
  try {
    Reflect.apply(init, undefined, [Reflect.get(component, "_payload")]);
    return null;
  } catch (thrown) {
    return isThenable(thrown) ? Promise.resolve(thrown) : Promise.reject(thrown);
  }
}

/** Uruchamia wpis `chunks`; `null` = gotowy synchronicznie. */
function startChunk(chunk: IslandChunk): PromiseLike<unknown> | null {
  if (typeof chunk !== "function") return primeLazy(chunk);
  try {
    return chunk();
  } catch (error) {
    return Promise.reject(error);
  }
}

// --- Delegowane nasłuchy na `window` (jeden komplet na stronę) --------------

interface OwnEventSubscription {
  readonly root: Node;
  readonly types: ReadonlySet<string>;
  readonly onEvent: () => void;
}

interface GlobalKeySubscription {
  readonly keys: ReadonlySet<string>;
  readonly onKey: () => void;
}

const ownSubscriptions = new Set<OwnEventSubscription>();
const keySubscriptions = new Set<GlobalKeySubscription>();
let ownListened = new Set<string>();
let keysListened = false;

function handleOwnEvent(event: Event): void {
  // Zdarzenie wysłane skryptem nie jest intencją odwiedzającego. `=== false`:
  // atrapy DOM bez `isTrusted` przechodzą (jak w P0.3).
  if (event.isTrusted === false) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  for (const subscription of [...ownSubscriptions]) {
    if (subscription.types.has(event.type) && subscription.root.contains(target)) {
      subscription.onEvent();
    }
  }
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}

function handleGlobalKey(event: Event): void {
  if (event.isTrusted === false || !(event instanceof KeyboardEvent)) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (isEditable(event.target)) return;
  for (const subscription of [...keySubscriptions]) {
    if (subscription.keys.has(event.key)) subscription.onKey();
  }
}

function syncOwnListeners(): void {
  const wanted = new Set<string>();
  for (const subscription of ownSubscriptions) {
    for (const type of subscription.types) wanted.add(type);
  }
  for (const type of ownListened) {
    if (!wanted.has(type)) window.removeEventListener(type, handleOwnEvent, LISTENER_OPTIONS);
  }
  for (const type of wanted) {
    if (!ownListened.has(type)) window.addEventListener(type, handleOwnEvent, LISTENER_OPTIONS);
  }
  ownListened = wanted;
}

function syncKeyListener(): void {
  const wanted = keySubscriptions.size > 0;
  if (wanted === keysListened) return;
  keysListened = wanted;
  if (wanted) window.addEventListener("keydown", handleGlobalKey, LISTENER_OPTIONS);
  else window.removeEventListener("keydown", handleGlobalKey, LISTENER_OPTIONS);
}

function subscribeOwnEvents(subscription: OwnEventSubscription): () => void {
  ownSubscriptions.add(subscription);
  syncOwnListeners();
  return () => {
    ownSubscriptions.delete(subscription);
    syncOwnListeners();
  };
}

function subscribeGlobalKeys(subscription: GlobalKeySubscription): () => void {
  keySubscriptions.add(subscription);
  syncKeyListener();
  return () => {
    keySubscriptions.delete(subscription);
    syncKeyListener();
  };
}

/** Klasa `contents` w atrybucie `class` (także z wariantem, np. `md:contents`). */
const CONTENTS_CLASS = /(?:^|[\s:])contents(?:\s|$)/;

/** Elementy, których widoczność otwiera wyspę: sekcje buildera, dzieci otoczki albo ona sama. */
function visibilityTargets(root: HTMLElement, id: string): Element[] {
  const sections = Array.from(root.querySelectorAll("[data-sec-id]"));
  if (sections.length > 0) return sections;
  const children = Array.from(root.children);
  if (children.length > 0) return children;
  // Sama treść tekstowa: zostaje otoczka. Z klasą `contents` (domyślną albo
  // z `className`) nie ma ona pudełka, więc IO nigdy nie zgłosi przecięcia.
  // Patrzymy tylko na atrybut `class` (bez odczytu układu, który wymusiłby
  // layout) - stąd tylko ostrzeżenie w DEV, a otoczka z pudełkiem z
  // `className` (np. `block`) go nie dostaje.
  if (import.meta.env.DEV && CONTENTS_CLASS.test(root.getAttribute("class") ?? "")) {
    console.warn(
      `[hydration-island] "${id}": the visible trigger has no element to observe besides the wrapper; with display: contents it never intersects. Wrap the content in an element or give the wrapper a box (className).`,
    );
  }
  return [root];
}

// --- Sterownik jednej wyspy --------------------------------------------------

class IslandController {
  readonly gate: IslandGateThenable;
  /** Koniec pracy otwarcia (KONTRAKT ZADANIA): commit treści albo odmontowanie. */
  readonly committed: Promise<void>;
  /** Otoczka wyspy przeszła commit (patrz HYDRATACJA A ŚWIEŻY MONTAŻ). */
  wrapperCommitted = false;
  private readonly trigger: IslandTrigger;
  private readonly chunks: readonly IslandChunk[];
  private readonly immediate: boolean;
  private resolveGate: () => void = noop;
  private resolveCommitted: () => void = noop;
  private chunksReady: boolean;
  private chunksLoading: Promise<void> | null = null;
  private opening = false;
  private hydrated = false;
  /** React renderuje czekającą treść po stronie klienta - wyspa ma się otworzyć (GÓRNA GRANICA). */
  private blocked = false;
  /** Otwarcie przez kolejkę po `blocked`; ustawiane przez `arm`, zdejmowane przez rozbrojenie. */
  private onBlocked: (() => void) | null = null;
  private readonly id: string;

  constructor(id: string, trigger: IslandTrigger, chunks: readonly IslandChunk[]) {
    this.id = id;
    this.trigger = trigger;
    this.chunks = chunks;
    this.chunksReady = chunks.length === 0;
    const state: { status: GateStatus; value: undefined } = { status: "pending", value: undefined };
    this.gate = Object.assign(
      new Promise<void>((resolve) => {
        this.resolveGate = resolve;
      }),
      state,
    );
    this.committed = new Promise<void>((resolve) => {
      this.resolveCommitted = resolve;
    });
    this.immediate = isImmediate(trigger);
    // Otwarcie od razu, bez kolejki - ta sama ścieżka co tor pilny. Konstruktor
    // biegnie w renderze otoczki, więc chunki startują przed jej commitem i
    // przed efektami (import nie czeka na commit hydratacji strony), a gotowe
    // synchronicznie (brak chunków, `lazy` rozwiązane wcześniej) otwierają
    // bramkę, zanim React dotknie granicy. Podwójny inicjalizator `useState`
    // w StrictMode (DEV) startuje chunki drugi raz - `import()` i `_init` są
    // idempotentne.
    if (this.immediate) void this.openUrgent();
  }

  isOpen(): boolean {
    return this.gate.status === "fulfilled";
  }

  /** Treść wyspy przeszła commit (hydratacja albo świeży montaż). */
  isCommitted(): boolean {
    return this.hydrated;
  }

  /** Otwiera bramkę: `status` synchronicznie, potem rozwiązanie promise (ping Reacta). */
  private release(): void {
    if (this.gate.status === "fulfilled") return;
    this.gate.status = "fulfilled";
    this.gate.value = undefined;
    this.resolveGate();
  }

  /** Render treści przed commitem otoczki = świeży montaż: bramka otwarta na stałe. */
  openForClientRender(): void {
    this.release();
  }

  /**
   * React renderuje czekającą treść w trybie KLIENTA (nie hydratacji), czyli
   * aktualizacja dotarła do odwodnionej granicy: przejście (kontekst nad wyspą
   * zmieniony w `startTransition`) albo aktualizacja poza przejściem, Sync i
   * Default (render klienta z fallbackiem).
   * Przejście czeka wtedy na hydratację wyspy - i to na CAŁEJ stronie, bo
   * React nie wie, czy treść wyspy czyta zmieniony kontekst - więc wyspa
   * otwiera się przez kolejkę (GÓRNA GRANICA w nagłówku pliku). Próby w
   * trybie hydratacji (pierwsza, ponowienie po przerwanym przebiegu,
   * hydratacja synchroniczna przy zdarzeniu, powtórka `pointerover`) niczego
   * tu nie zmieniają.
   */
  noteClientRender(): void {
    if (this.blocked) return;
    this.blocked = true;
    if (import.meta.env.DEV) {
      console.warn(
        `[hydration-island] "${this.id}": an update reached the pending island (context above it or its props changed); opening it early.`,
      );
    }
    // Poza renderem: zapis do kolejki dopiero w mikrozadaniu.
    queueMicrotask(() => this.onBlocked?.());
  }

  /** Efekt warstwy w treści granicy: wyspa jest uwodniona (albo zamontowana). */
  markCommitted(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    this.resolveCommitted();
  }

  /**
   * Odmontowanie po zleceniu otwarcia: commitu już nie będzie, więc zadanie
   * kolejki, które na niego czeka, kończy się od razu (bez limitu kolejki).
   */
  abandon(): void {
    if (this.opening || this.isOpen()) this.resolveCommitted();
  }

  /**
   * Ładuje loadery i gruntuje komponenty `lazy` (CHUNKI w nagłówku), raz.
   * Wszystko gotowe synchronicznie (np. `lazy` rozwiązane wcześniej) =
   * `chunksReady` od razu, bez mikrozadania.
   */
  private loadChunks(): Promise<void> {
    if (this.chunksReady) return Promise.resolve();
    if (this.chunksLoading) return this.chunksLoading;
    const pending: PromiseLike<unknown>[] = [];
    for (const chunk of this.chunks) {
      const started = startChunk(chunk);
      if (started !== null) pending.push(started);
    }
    if (pending.length === 0) {
      this.chunksReady = true;
      return Promise.resolve();
    }
    this.chunksLoading = Promise.allSettled(pending).then((results) => {
      // Chunk, który nie przyszedł, i tak zgłosi błąd przy renderze (granica
      // błędu konsumenta) - jak dziś bez wyspy. Bramka się otwiera.
      for (const result of results) if (result.status === "rejected") report(result.reason);
      this.chunksReady = true;
    });
    return this.chunksLoading;
  }

  /** Otwarcie po chunkach; promise rozstrzyga się po commicie wyspy. Idempotentne. */
  requestOpen(): Promise<void> {
    if (!this.opening && !this.isOpen()) {
      this.opening = true;
      void this.loadChunks().then(() => this.release());
    }
    return this.committed;
  }

  /**
   * Tor pilny (i `immediate` w konstruktorze): chunki gotowe (albo gotowe
   * synchronicznie, np. `lazy` rozwiązane wcześniej) = bramka otwarta w tym
   * samym wywołaniu - na torze pilnym w tym samym mikrozadaniu, przed
   * nasłuchem Reacta na dokumencie; pozostałe - zaraz po załadowaniu.
   */
  openUrgent(): Promise<void> {
    void this.loadChunks();
    if (this.chunksReady) this.release();
    return this.requestOpen();
  }

  /** Zakłada wyzwalacze na korzeniu wyspy; zwraca ich zdjęcie. */
  arm(root: HTMLElement): () => void {
    // `immediate`: otwarcie zlecone już w konstruktorze, bez wyzwalaczy.
    if (this.isOpen() || this.immediate) return noop;
    const trigger = this.trigger;
    const cleanups: Array<() => void> = [];
    let armed = true;
    const disarm = () => {
      if (!armed) return;
      armed = false;
      for (const cleanup of cleanups.splice(0)) cleanup();
    };
    const schedule = (task: QueuedTask, options: EnqueueOptions) => {
      if (armed) cleanups.push(enqueue(task, options));
    };
    const open = () => {
      disarm();
      return this.requestOpen();
    };
    const openUrgent = () => {
      disarm();
      return this.openUrgent();
    };
    const onBlocked = () =>
      schedule(open, { priority: "island-target", target: root, release: "immediate" });
    this.onBlocked = onBlocked;
    cleanups.push(() => {
      if (this.onBlocked === onBlocked) this.onBlocked = null;
    });
    if (this.blocked) onBlocked();

    const visible = trigger.visible;
    if (visible && typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          schedule(open, { priority: "islands", target: root, release: "immediate" });
        },
        { rootMargin: visible.rootMargin ?? "0px" },
      );
      for (const target of visibilityTargets(root, this.id)) observer.observe(target);
      cleanups.push(() => observer.disconnect());
    }

    const interaction = trigger.interaction ?? "own";
    if (interaction === "any") {
      schedule(open, { priority: "islands", target: root });
    }
    if (interaction !== false) {
      const types = new Set<string>(trigger.ownEvents ?? DEFAULT_ISLAND_OWN_EVENTS);
      if (types.size > 0) {
        cleanups.push(
          subscribeOwnEvents({
            root,
            types,
            onEvent: () =>
              schedule(openUrgent, { priority: "island-target", target: root, release: "urgent" }),
          }),
        );
      }
    }

    if (trigger.globalKeys && trigger.globalKeys.length > 0) {
      cleanups.push(
        subscribeGlobalKeys({
          keys: new Set(trigger.globalKeys),
          onKey: () =>
            schedule(open, { priority: "island-target", target: root, release: "immediate" }),
        }),
      );
    }

    const media = trigger.media;
    if (media && typeof window.matchMedia === "function") {
      const query = window.matchMedia(media);
      const onChange = (event: MediaQueryListEvent) => {
        if (event.matches) {
          schedule(open, { priority: "islands", target: root, release: "immediate" });
        }
      };
      query.addEventListener("change", onChange);
      cleanups.push(() => query.removeEventListener("change", onChange));
    }

    if (trigger.quiescent !== false) {
      cleanups.push(onQuiescent(open, { priority: "islands" }));
    }

    return disarm;
  }
}

// --- Komponenty --------------------------------------------------------------

function IslandFallback({ minHeight }: { minHeight?: number }): ReactElement {
  return (
    <div
      data-island-fallback=""
      aria-busy="true"
      style={minHeight !== undefined ? { minHeight } : undefined}
    />
  );
}

/** Commit treści granicy (hydratacja albo świeży montaż). */
function IslandCommitMarker({
  island,
  onCommit,
}: {
  island: IslandController | null;
  onCommit: () => void;
}): null {
  useLayoutEffect(() => {
    island?.markCommitted();
    onCommit();
  }, [island, onCommit]);
  return null;
}

/**
 * SONDA TRYBU RENDERU. React woła `getServerSnapshot` wyłącznie przy
 * hydratacji (i na serwerze), a `getSnapshot` - przy renderze klienta
 * (kontrakt `useSyncExternalStore`). Obie zwracają TĘ SAMĄ migawkę (0), więc
 * React nigdy nie wymusza re-renderu Sync (to rozjazd migawek serwer/klient
 * jest groźny - zob. `viewportDevice.ts`); który getter zadziałał, mówi tylko
 * zmienna robocza, czytana zaraz po wywołaniu haka.
 */
let renderMode: "hydration" | "client" | null = null;
const subscribeNothing = (): (() => void) => noop;
const clientSnapshot = (): number => {
  renderMode = "client";
  return 0;
};
const hydrationSnapshot = (): number => {
  renderMode = "hydration";
  return 0;
};

/**
 * Brama treści: dzieci są jej wyjściem, więc przy zawieszeniu React nie
 * renderuje (ani nie „prerenderuje") niczego z wnętrza wyspy.
 */
function IslandGate({
  island,
  onCommit,
  children,
}: {
  island: IslandController | null;
  onCommit: () => void;
  children: ReactNode;
}): ReactElement {
  renderMode = null;
  useSyncExternalStore(subscribeNothing, clientSnapshot, hydrationSnapshot);
  const mode = renderMode;
  if (island !== null) {
    if (!island.wrapperCommitted) {
      island.openForClientRender();
    } else if (!island.isOpen()) {
      if (mode === "client") island.noteClientRender();
      use(island.gate);
    }
  }
  return (
    <>
      {children}
      <IslandCommitMarker island={island} onCommit={onCommit} />
    </>
  );
}

function IslandBoundary(props: HydrationIslandProps): ReactElement {
  const { id, trigger, chunks, fallback, fallbackMinHeight, className, children } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const seenProps = useRef(props);
  // Serwer nie potrzebuje bramki: renderuje dzieci wprost.
  const [island] = useState<IslandController | null>(() =>
    import.meta.env.SSR
      ? null
      : new IslandController(id, trigger ?? NO_TRIGGER, chunks ?? NO_CHUNKS),
  );
  const [state, setState] = useState<IslandState>("pending");
  const markHydrated = useCallback(() => setState("hydrated"), []);

  useLayoutEffect(() => {
    if (island) island.wrapperCommitted = true;
  }, [island]);

  // DEV: nierówne pola granicy czekającej wyspy (dzieci, `fallback`,
  // `fallbackMinHeight`: zmienione dane, inline callback, nowa instancja klasy,
  // podmieniony ref) docierają do odwodnionej granicy - poza przejściem
  // porzucają jej HTML (WARUNKI DLA KONSUMENTÓW: stabilne propsy dziecka).
  // Sama klasa i `id` otoczki do granicy nie docierają, więc nie ostrzegają.
  useLayoutEffect(() => {
    const previous = seenProps.current;
    seenProps.current = props;
    if (!import.meta.env.DEV || island === null || previous === props) return;
    if (island.isCommitted() || contentPropsEqual(previous, props)) return;
    console.warn(
      `[hydration-island] "${id}": props changed while the island is pending (changed data, an inline callback, a new class instance or a swapped ref in its children, or a new fallback / fallbackMinHeight?); the update reaches its dehydrated boundary.`,
    );
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!island || !root) return;
    const disarm = island.arm(root);
    return () => {
      disarm();
      island.abandon();
    };
  }, [island]);

  // Granica za własnym `memo` (`IslandContent`): zmiana samej otoczki (stan,
  // `className`, `id`) kończy się na nim, odwodniona granica nie dostaje
  // nowych propsów.
  const attributes: IslandStateAttributes = { "data-island-state": state };
  return (
    <div ref={rootRef} data-island-id={id} className={className ?? "contents"} {...attributes}>
      <IslandContent
        island={island}
        onCommit={markHydrated}
        fallback={fallback}
        fallbackMinHeight={fallbackMinHeight}
      >
        {children}
      </IslandContent>
    </div>
  );
}

/** Głębokość porównania strukturalnego; głębiej = „nierówne" (bezpieczny kierunek). */
const MAX_COMPARE_DEPTH = 16;

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Ref obiektowy (`useRef`, `createRef`): zwykły obiekt z jedynym polem `current`. */
function isRefObject(value: object): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "current";
}

function equivalentFields(a: object, b: object, depth: number): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      equivalent(Reflect.get(a, key), Reflect.get(b, key), depth),
  );
}

/**
 * Równoważność wartości w propsach wyspy: ta sama wartość (`Object.is`) albo
 * strukturalnie - element tego samego typu i klucza o równoważnych propsach
 * (także `children` w środku), tablica tej samej długości (kilkoro dzieci,
 * fragment) i zwykły obiekt (np. `style`) o równoważnych polach. Funkcje,
 * instancje klas i refy (`ref` elementu, zwykły obiekt z jedynym polem
 * `current`) porównywane WYŁĄCZNIE referencyjnie (inline callback, podmieniony
 * ref = nierówne). Pominięcie re-renderu przy równoważnych propsach to
 * semantyka `memo` dla czystych komponentów.
 */
function equivalent(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_COMPARE_DEPTH) return false;
  if (isArray(a)) {
    return (
      isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => equivalent(item, b[index], depth + 1))
    );
  }
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  if (isValidElement(a)) {
    if (!isValidElement(b) || a.type !== b.type || a.key !== b.key) return false;
    const propsA: unknown = a.props;
    const propsB: unknown = b.props;
    return (
      typeof propsA === "object" &&
      propsA !== null &&
      typeof propsB === "object" &&
      propsB !== null &&
      // React 19: `ref` to zwykły props elementu - ref podmieniony na inny
      // (także oba jeszcze nieprzypięte) jest zmianą, nie „równym" obiektem.
      Object.is(Reflect.get(propsA, "ref"), Reflect.get(propsB, "ref")) &&
      equivalentFields(propsA, propsB, depth + 1)
    );
  }
  // Ref w dowolnym propsie (np. `inputRef={r}`) - tylko referencyjnie.
  if (!isPlainObject(a) || !isPlainObject(b) || isRefObject(a) || isRefObject(b)) return false;
  return equivalentFields(a, b, depth + 1);
}

/** Pola, które docierają do granicy wyspy (`IslandContent`). */
type IslandContentFields = Pick<
  HydrationIslandProps,
  "fallback" | "fallbackMinHeight" | "children"
>;

/**
 * Równoważność pól granicy: `fallbackMinHeight` przez `===`, `fallback` i
 * dzieci strukturalnie. Wspólna dla `memo` granicy i ostrzeżenia DEV.
 */
function contentPropsEqual(prev: IslandContentFields, next: IslandContentFields): boolean {
  return (
    prev.fallbackMinHeight === next.fallbackMinHeight &&
    equivalent(prev.fallback, next.fallback, 0) &&
    equivalent(prev.children, next.children, 0)
  );
}

/**
 * Re-render rodzica z równoważnymi propsami kończy się na wyspie (bailout),
 * zanim granica dostanie nowe propsy - aktualizacja rodzica poza przejściem
 * (Sync, Default; np. `useQuery` nad wyspą) nie dociera do odwodnionej treści,
 * dopóki dzieci spełniają warunek stabilnych propsów (nagłówek pliku).
 * `disabled` nie bierze udziału: ścieżka wyspy renderuje się tylko bez niego.
 */
function islandPropsEqual(prev: HydrationIslandProps, next: HydrationIslandProps): boolean {
  return prev.id === next.id && prev.className === next.className && contentPropsEqual(prev, next);
}

interface IslandContentProps extends IslandContentFields {
  readonly island: IslandController | null;
  readonly onCommit: () => void;
}

function islandContentPropsEqual(prev: IslandContentProps, next: IslandContentProps): boolean {
  return (
    prev.island === next.island && prev.onCommit === next.onCommit && contentPropsEqual(prev, next)
  );
}

/**
 * Granica wyspy (`<Suspense>` z bramką) za własnym `memo`: re-render otoczki
 * (stan `data-island-state`, `className`, `id`) przy równoważnych polach
 * granicy kończy się tutaj (bailout), więc aktualizacja nie dociera do
 * odwodnionej granicy i React zostawia HTML serwera - także poza przejściem.
 */
const IslandContent = memo(function IslandContent({
  island,
  onCommit,
  fallback,
  fallbackMinHeight,
  children,
}: IslandContentProps): ReactElement {
  return (
    <Suspense fallback={fallback ?? <IslandFallback minHeight={fallbackMinHeight} />}>
      <IslandGate island={island} onCommit={onCommit}>
        {children}
      </IslandGate>
    </Suspense>
  );
}, islandContentPropsEqual);

/** Ścieżka wyspy z komparatorem strukturalnym (przełącznik niżej nie jest `memo`). */
const MemoIslandBoundary = memo(IslandBoundary, islandPropsEqual);

/**
 * Wyspa hydratacji (opis mechanizmu, wyzwalaczy i warunków w nagłówku pliku).
 * Na serwerze: otoczka `data-island-state="pending"` i dzieci w `<Suspense>`.
 * Na kliencie: hydratacja treści dopiero po wyzwoleniu i po `chunks`.
 * Sam przełącznik NIE jest `memo`: `disabled` i kanwa buildera renderują
 * dzieci wprost przy każdym renderze rodzica - bez głębokiego porównania i bez
 * bailoutu (podgląd edytora odświeża się także po zmianie obiektu w miejscu).
 */
export function HydrationIsland(props: HydrationIslandProps): ReactElement {
  const inEditor = useBuilderMode() !== null;
  if (props.disabled === true || inEditor) return <>{props.children}</>;
  return <MemoIslandBoundary {...props} />;
}
