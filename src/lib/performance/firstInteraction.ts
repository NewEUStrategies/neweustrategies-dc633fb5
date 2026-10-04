// Pierwsza interakcja odwiedzającego - JEDEN współdzielony nasłuch na stronę.
//
// PO CO. Na sygnał „odwiedzający czegoś dotknął" czeka kilku konsumentów naraz:
// kolejka pracy po interakcji (`postInteractionQueue.ts`), a przez nią polityka
// gtag (P1.1), interaktywny baner zgód (P1.3), wyspy hydratacji (P1.6, P2.x) i
// nakładki. Gdyby każdy zakładał własny komplet nasłuchów, każde zdarzenie
// wejścia przechodziłoby przez N×5 handlerów w fazie capture, a „pierwsza
// interakcja" znaczyłaby u każdego coś odrobinę innego (inna lista zdarzeń,
// inny moment). Tutaj jest jeden komplet i jedna definicja.
//
// NASŁUCH. `pointerdown`, `keydown`, `touchstart`, `scroll`, `wheel` na
// `window`, w fazie capture i pasywnie:
//  - capture: handler strony, który zatrzymuje propagację, nie ukryje
//    interakcji (`window` w fazie capture jest pierwszy na ścieżce zdarzenia);
//  - passive: nasłuch nigdy nie blokuje przewijania (`touchstart`, `wheel`);
//  - `scroll` zostaje, bo przeciągnięcie paska przewijania dokumentu emituje
//    wyłącznie `scroll`; `wheel` łapie kółko myszy także na stronie, która się
//    nie przewija (krótka treść, przewijany kontener z `overscroll-behavior`).
//  - `scroll` liczy się WYŁĄCZNIE jako przewinięcie dokumentu (cel =
//    `document`). Przewinięcie elementu bywa programowe i bez udziału
//    odwiedzającego: autoodtwarzanie karuzeli `PostListView` woła co kilka
//    sekund `scrollTo` na torze slajdów, a w fazie capture na `window` takie
//    zdarzenie też by dotarło - i zwolniłoby całą odroczoną pracę (z gtag
//    włącznie) bez żadnej interakcji, także w śladzie Lighthouse'a. Ręczne
//    przewinięcie elementu poprzedza zawsze `pointerdown`, `touchstart`,
//    `wheel` albo `keydown`, więc nic nie ginie.
//  - liczą się wyłącznie zdarzenia ZAUFANE: `dispatchEvent` obcego skryptu
//    (`isTrusted === false`) nie zwalnia odroczonej pracy. To nie chroni przed
//    programowym przewinięciem DOKUMENTU (`scrollTo`, `scrollIntoView`,
//    `focus()` emitują zaufany `scroll`) - takie wywołania przed interakcją są
//    błędem strony, nie tego modułu. Atrapy DOM w testach (happy-dom) nie mają
//    `isTrusted`, więc filtr pomija tylko jawne `false`.
// Nasłuch powstaje leniwie przy pierwszej subskrypcji i znika po pierwszej
// interakcji albo wtedy, gdy ostatni subskrybent zrezygnuje.
//
// KONTRAKT CALLBACKU. Callback biegnie SYNCHRONICZNIE w dyspozycji zdarzenia,
// w fazie capture na `window` - czyli PRZED handlerami strony i w tym samym
// zadaniu, które liczy się do INP tej interakcji. Ma być tani: zapisać fakt,
// zaplanować pracę. Cięższą pracę wolno puścić wyłącznie przez
// `postInteractionQueue`, która schodzi po końcu gestu (`pointerup` + `click`,
// `keyup`), po klatce i po handlerach interakcji.
// Wyjątek jednego subskrybenta nie zatrzymuje pozostałych (`reportError`).
//
// INTERAKCJA SPRZED SUBSKRYPCJI. Nasłuchu nie ma, zanim ktoś się nie
// zapisze, więc wcześniejszego przewinięcia moduł nie zobaczy. Kliknięcie,
// dotknięcie albo klawisz sprzed subskrypcji łapie lepka aktywacja
// użytkownika (`navigator.userActivation.hasBeenActive`, HTML „sticky
// activation"): jeśli jest ustawiona w chwili zakładania nasłuchu, subskrybenci
// dostają sygnał od razu - w mikrozadaniu, z typem `"activation"` i bez celu.
// Lighthouse i PSI niczego nie klikają, więc ta ścieżka nie zmienia śladu.
//
// PAMIĘĆ. Moduł pamięta pierwszą interakcję przez całe życie dokumentu, ale
// jej cel trzyma SŁABO (`WeakRef`): węzeł zdjęty z DOM przy nawigacji SPA nie
// przytrzymuje odpiętego poddrzewa poprzedniej strony. Callbacki wołane w
// dyspozycji zdarzenia dostają cel wprost; `getFirstInteraction()` i spóźnieni
// subskrybenci - cel, o ile węzeł jeszcze żyje (inaczej `null`).
//
// SSR: każda funkcja jest no-opem (stan modułu na serwerze przeciekałby między
// żądaniami w tym samym izolacie Workera).

/** Zdarzenia uznawane za pierwszą interakcję (kolejność bez znaczenia). */
export const FIRST_INTERACTION_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
] as const;

export type FirstInteractionEventType = (typeof FIRST_INTERACTION_EVENTS)[number];

/** Co wiadomo o pierwszej interakcji. */
export interface FirstInteraction {
  /**
   * Typ zdarzenia albo `"activation"`, gdy interakcja zaszła przed
   * założeniem nasłuchu i zdradziła ją lepka aktywacja użytkownika.
   */
  readonly type: FirstInteractionEventType | "activation";
  /**
   * `event.target` - element pod palcem / z fokusem (np. do wybrania wyspy
   * hydratacji, którą trzeba ożywić pierwszą). `null` dla `"activation"` i
   * wtedy, gdy węzeł został już zebrany przez GC (patrz PAMIĘĆ w nagłówku).
   */
  readonly target: EventTarget | null;
  /** Chwila interakcji na osi `performance.now()` (`event.timeStamp`). */
  readonly timeStamp: number;
}

export type FirstInteractionCallback = (interaction: FirstInteraction) => void;

/** Odpina subskrypcję; bezpieczne do wielokrotnego wołania. */
export type CancelFirstInteraction = () => void;

const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

interface Subscriber {
  readonly callback: FirstInteractionCallback;
}

/** To, co z `WeakRef` jest potrzebne; bez `WeakRef` (stary silnik) - silna referencja. */
interface TargetHolder {
  deref(): EventTarget | undefined;
}

/** Zapisana interakcja: cel trzymany słabo. */
interface RecordedInteraction {
  readonly type: FirstInteraction["type"];
  readonly timeStamp: number;
  readonly target: TargetHolder | null;
}

let recorded: RecordedInteraction | null = null;
let listening = false;
const subscribers = new Set<Subscriber>();
/** Dostarczenia zaplanowane w mikrozadaniu (spóźnieni subskrybenci, aktywacja). */
const deferred = new Set<() => void>();

const noop = (): void => {};

/** Wołane wyłącznie w przeglądarce (każda ścieżka SSR kończy się wcześniej no-opem). */
function now(): number {
  return performance.now();
}

function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

function invoke(callback: FirstInteractionCallback, interaction: FirstInteraction): void {
  try {
    callback(interaction);
  } catch (error) {
    report(error);
  }
}

function holdWeakly(target: EventTarget | null): TargetHolder | null {
  if (!target) return null;
  if (typeof WeakRef === "function") return new WeakRef(target);
  return { deref: () => target };
}

function snapshot(entry: RecordedInteraction): FirstInteraction {
  return { type: entry.type, timeStamp: entry.timeStamp, target: entry.target?.deref() ?? null };
}

function deliver(interaction: FirstInteraction): void {
  if (recorded) return;
  recorded = {
    type: interaction.type,
    timeStamp: interaction.timeStamp,
    target: holdWeakly(interaction.target),
  };
  stopListening();
  const callbacks = [...subscribers];
  subscribers.clear();
  for (const { callback } of callbacks) invoke(callback, interaction);
}

function handleEvent(event: Event): void {
  const type = FIRST_INTERACTION_EVENTS.find((candidate) => candidate === event.type);
  if (!type || event.isTrusted === false) return;
  // Przewinięcie elementu (np. programowe `scrollTo` karuzeli) nie jest
  // interakcją - patrz NASŁUCH w nagłówku.
  if (type === "scroll" && event.target !== document) return;
  deliver({ type, target: event.target, timeStamp: event.timeStamp });
}

/** Planuje `run` w mikrozadaniu z możliwością odwołania (np. przy resecie testu). */
function defer(run: () => void): () => void {
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    deferred.delete(cancel);
  };
  deferred.add(cancel);
  queueMicrotask(() => {
    if (cancelled) return;
    deferred.delete(cancel);
    run();
  });
  return cancel;
}

function hasStickyActivation(): boolean {
  // `userActivation` nie istnieje w starszych Safari i w happy-dom.
  return typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive === true;
}

function startListening(): void {
  if (listening) return;
  listening = true;
  for (const type of FIRST_INTERACTION_EVENTS) {
    window.addEventListener(type, handleEvent, LISTENER_OPTIONS);
  }
  if (hasStickyActivation()) {
    defer(() => deliver({ type: "activation", target: null, timeStamp: now() }));
  }
}

function stopListening(): void {
  if (!listening) return;
  listening = false;
  for (const type of FIRST_INTERACTION_EVENTS) {
    window.removeEventListener(type, handleEvent, LISTENER_OPTIONS);
  }
}

/**
 * Woła `callback` przy pierwszej interakcji odwiedzającego (raz na dokument).
 *
 * - Przed interakcją: callback biegnie synchronicznie w dyspozycji zdarzenia
 *   (faza capture na `window`, przed handlerami strony) - ma być tani.
 * - Po interakcji (spóźniony subskrybent): callback dostaje zapisaną
 *   interakcję w mikrozadaniu, czyli już PO zwróceniu funkcji odpinającej.
 *
 * Wszyscy subskrybenci dzielą jeden komplet nasłuchów. Zwraca funkcję
 * odpinającą - wołać w cleanupie efektu. Na serwerze no-op.
 */
export function onFirstInteraction(callback: FirstInteractionCallback): CancelFirstInteraction {
  if (typeof window === "undefined") return noop;
  if (recorded) {
    const entry = recorded;
    return defer(() => invoke(callback, snapshot(entry)));
  }
  const subscriber: Subscriber = { callback };
  subscribers.add(subscriber);
  startListening();
  return () => {
    if (!subscribers.delete(subscriber)) return;
    if (subscribers.size === 0) stopListening();
  };
}

/**
 * Zapisana pierwsza interakcja albo `null`, jeśli jeszcze nie zaszła (lub SSR).
 * Każde wywołanie zwraca świeży obiekt; `target` jest `null`, gdy węzeł już
 * nie żyje.
 */
export function getFirstInteraction(): FirstInteraction | null {
  return recorded ? snapshot(recorded) : null;
}

/** Tylko testy: zdejmuje nasłuchy, odwołuje dostarczenia i zeruje stan modułu. */
export function __resetFirstInteractionForTests(): void {
  if (typeof window !== "undefined") stopListening();
  listening = false;
  recorded = null;
  subscribers.clear();
  for (const cancel of [...deferred]) cancel();
}
