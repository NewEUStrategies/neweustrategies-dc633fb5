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
// przepadłby (`stopPropagation`). Bramka otwiera się DOPIERO po
// `Promise.allSettled(chunks)` - loaderach zagnieżdżonych leniwych widgetów
// wyspy (krytyka M5): ponowiona hydratacja nie trafia na leniwy komponent bez
// chunku, czyli nie zostawia w środku odwodnionych granic, które późniejsza
// aktualizacja mogłaby wyrenderować po stronie klienta.
//
// WYZWALACZE (`trigger`, czytane przy montażu; domyślnie: własne zdarzenia i
// zapas ciszy). Żaden nie otwiera bramki synchronicznie w handlerze zdarzenia
// - każdy tylko zakłada wpis w kolejce P0.3; wyjątkiem jest tor pilny, który
// biegnie w pierwszym mikrozadaniu po handlerze:
//  - `visible: {rootMargin}` - IntersectionObserver na `[data-sec-id]` w
//    wyspie (albo jej dzieciach, albo korzeniu) -> `enqueue(open, {priority:
//    "islands", target: korzeń, release: "immediate"})`;
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
//    montażu: bramka otwarta od razu (bez chunków - zanim React dotknie
//    granicy; z chunkami - po ich załadowaniu, bez kolejki);
//  - `quiescent` (domyślnie `true`) - zapas `onQuiescent(open, {priority:
//    "islands"})`.
// Pierwszy wyzwalacz, który dojdzie do skutku, zdejmuje pozostałe.
//
// KONTRAKT ZADANIA (P0.3): zadanie otwarcia zwraca promise rozstrzygany PO
// COMMICIE wyspy (efekt warstwy wewnątrz granicy), więc kolejka nie nakłada
// następnej pracy na hydratację tej wyspy.
//
// GÓRNA GRANICA. Zmiana kontekstu nad czekającą wyspą (także w
// `startTransition`) dociera do jej odwodnionej granicy: przejście NIE
// zostanie zatwierdzone, dopóki wyspa się nie uwodni - i to na CAŁEJ stronie
// (React nie wie, czy treść wyspy czyta zmieniony kontekst), a Sync renderuje
// wyspę po stronie klienta. React próbuje wtedy wyrenderować treść wyspy w
// trybie KLIENTA - w odróżnieniu od każdej próby hydratacji (pierwszej,
// ponowionej po przerwanym przebiegu, synchronicznej przy zdarzeniu).
// `IslandGate` rozpoznaje tryb sondą `useSyncExternalStore` z IDENTYCZNĄ
// migawką (React woła `getServerSnapshot` wyłącznie przy hydratacji) i przy
// renderze klienta czekającej treści otwiera wyspę przez kolejkę
// (`island-target`, `immediate`): przejście czeka najwyżej na chunki i klatkę,
// a fallback po renderze klienta znika równie szybko. W DEV - ostrzeżenie z
// `id` wyspy (sygnał dla audytu providerów P2.2: taka wyspa nie jest odroczona).
//
// `data-island-state` (kontrakt P0.6, `@/lib/webVitals`): DOKŁADNIE
// `pending` (w HTML serwera i do commitu granicy) i `hydrated` (po commicie).
// Typ tylko przez `import type` - import wartości wciągnąłby reporter RUM do
// chunku wyspy.
//
// WARUNKI DLA KONSUMENTÓW (P2.2, P2.3):
//  - kontekst nad wyspą nie może się zmieniać, dopóki wyspa czeka (GÓRNA
//    GRANICA otworzy ją wtedy przedwcześnie, Sync dodatkowo porzuci jej HTML);
//    urządzenie z `useViewportDevice()` WEWNĄTRZ wyspy, nie z kontekstu ani
//    propsów; motyw, sesja, język nad wyspami - przez magazyny czytane w
//    środku albo klasę na `<html>`, nie przez wartość kontekstu;
//  - treść wyspy przy hydratacji renderuje się z BIEŻĄCYM stanem magazynów
//    zewnętrznych (react-query, i18next): dane zapytania czytanego w wyspie
//    albo język zmienione przed jej otwarciem dają rozjazd hydratacji i render
//    klienta wyspy (test „ograniczenie dla P2.2");
//  - wyspa jest `memo`: dzieci porównywane płytko jako element (typ, klucz,
//    propsy), `trigger` i `chunks` nie biorą udziału (czytane przy montażu),
//    `id` stały i unikalny na stronie (klucz elementu);
//  - wyspa nie może obejmować komponentów zawieszających się na SERWERZE
//    (bramka danych sekcji) - jej granica przejęłaby strumień;
//  - `disabled` (np. `editorPreview`) i kanwa buildera (`useBuilderMode()`) =
//    dzieci wprost, bez otoczki; wartość musi być taka sama na serwerze i
//    kliencie.

import {
  isValidElement,
  memo,
  Suspense,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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

/** Loader zagnieżdżonego leniwego widgetu wyspy (ten sam, którego używa `React.lazy`). */
export type IslandChunkLoader = () => PromiseLike<unknown>;

export interface HydrationIslandProps {
  /** Stały, unikalny na stronie identyfikator (`data-island-id`); używać też jako `key`. */
  readonly id: string;
  readonly trigger?: IslandTrigger;
  /** Loadery chunków, bez których treść wyspy nie uwodni się w całości. */
  readonly chunks?: readonly IslandChunkLoader[];
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
const NO_CHUNKS: readonly IslandChunkLoader[] = [];
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

/** Elementy, których widoczność otwiera wyspę: sekcje buildera, dzieci otoczki albo ona sama. */
function visibilityTargets(root: HTMLElement): Element[] {
  const sections = Array.from(root.querySelectorAll("[data-sec-id]"));
  if (sections.length > 0) return sections;
  const children = Array.from(root.children);
  return children.length > 0 ? children : [root];
}

// --- Sterownik jednej wyspy --------------------------------------------------

class IslandController {
  readonly gate: IslandGateThenable;
  /** Koniec pracy otwarcia (KONTRAKT ZADANIA): commit treści albo odmontowanie. */
  readonly committed: Promise<void>;
  /** Otoczka wyspy przeszła commit (patrz HYDRATACJA A ŚWIEŻY MONTAŻ). */
  wrapperCommitted = false;
  private readonly trigger: IslandTrigger;
  private readonly chunks: readonly IslandChunkLoader[];
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

  constructor(id: string, trigger: IslandTrigger, chunks: readonly IslandChunkLoader[]) {
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
    // Bez chunków bramka jest otwarta, zanim React dotknie granicy.
    if (this.immediate && this.chunksReady) this.release();
  }

  isOpen(): boolean {
    return this.gate.status === "fulfilled";
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
   * zmieniony w `startTransition`) albo Sync (render klienta z fallbackiem).
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
        `[hydration-island] "${this.id}": an update reached the pending island (context above it changed); opening it early.`,
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

  private loadChunks(): Promise<void> {
    if (this.chunksReady) return Promise.resolve();
    this.chunksLoading ??= Promise.allSettled(
      this.chunks.map((load) => {
        try {
          return load();
        } catch (error) {
          return Promise.reject(error);
        }
      }),
    ).then((results) => {
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

  /** Tor pilny: przy załadowanych chunkach bramka otwiera się w tym samym mikrozadaniu. */
  openUrgent(): Promise<void> {
    if (this.chunksReady) this.release();
    return this.requestOpen();
  }

  /** Zakłada wyzwalacze na korzeniu wyspy; zwraca ich zdjęcie. */
  arm(root: HTMLElement): () => void {
    if (this.isOpen()) return noop;
    if (this.immediate) {
      void this.requestOpen();
      return noop;
    }
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
      for (const target of visibilityTargets(root)) observer.observe(target);
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

function IslandBoundary({
  id,
  trigger,
  chunks,
  fallback,
  fallbackMinHeight,
  className,
  children,
}: HydrationIslandProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    const root = rootRef.current;
    if (!island || !root) return;
    const disarm = island.arm(root);
    return () => {
      disarm();
      island.abandon();
    };
  }, [island]);

  // Ten sam element granicy przy zmianie samego stanu otoczki: React kończy
  // na otoczce (bailout), granica nie dostaje nowych propsów.
  const boundary = useMemo(
    () => (
      <Suspense fallback={fallback ?? <IslandFallback minHeight={fallbackMinHeight} />}>
        <IslandGate island={island} onCommit={markHydrated}>
          {children}
        </IslandGate>
      </Suspense>
    ),
    [island, markHydrated, fallback, fallbackMinHeight, children],
  );

  const attributes: IslandStateAttributes = { "data-island-state": state };
  return (
    <div ref={rootRef} data-island-id={id} className={className ?? "contents"} {...attributes}>
      {boundary}
    </div>
  );
}

function shallowEqualObjects(a: object, b: object): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      Object.is(Reflect.get(a, key), Reflect.get(b, key)),
  );
}

/** Ten sam węzeł albo element tego samego typu i klucza z płytko równymi propsami. */
function sameNode(a: ReactNode, b: ReactNode): boolean {
  if (Object.is(a, b)) return true;
  if (!isValidElement(a) || !isValidElement(b)) return false;
  if (a.type !== b.type || a.key !== b.key) return false;
  const propsA = a.props;
  const propsB = b.props;
  return (
    typeof propsA === "object" &&
    propsA !== null &&
    typeof propsB === "object" &&
    propsB !== null &&
    shallowEqualObjects(propsA, propsB)
  );
}

/**
 * Re-render rodzica z równoważnymi propsami kończy się na wyspie (bailout),
 * zanim granica dostanie nowe propsy - aktualizacja Sync rodzica (np.
 * `useQuery` nad wyspą) nie dociera do odwodnionej treści.
 */
function islandPropsEqual(prev: HydrationIslandProps, next: HydrationIslandProps): boolean {
  return (
    prev.id === next.id &&
    prev.disabled === next.disabled &&
    prev.className === next.className &&
    prev.fallbackMinHeight === next.fallbackMinHeight &&
    sameNode(prev.fallback, next.fallback) &&
    sameNode(prev.children, next.children)
  );
}

/**
 * Wyspa hydratacji (opis mechanizmu, wyzwalaczy i warunków w nagłówku pliku).
 * Na serwerze: otoczka `data-island-state="pending"` i dzieci w `<Suspense>`.
 * Na kliencie: hydratacja treści dopiero po wyzwoleniu i po `chunks`.
 */
export const HydrationIsland = memo(function HydrationIsland(
  props: HydrationIslandProps,
): ReactElement {
  const inEditor = useBuilderMode() !== null;
  if (props.disabled === true || inEditor) return <>{props.children}</>;
  return <IslandBoundary {...props} />;
}, islandPropsEqual);
