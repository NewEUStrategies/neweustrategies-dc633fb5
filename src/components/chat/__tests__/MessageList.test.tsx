// Historia wiadomości (`MessageList`) - organizm, który przed tym plikiem miał
// 64,8% linii, 17/26 funkcji i 47 linii z nietrafioną gałęzią. Największą dziurą
// był `TypingIndicator` (0 wywołań): cała arytmetyka „kto pisze" - jedna osoba,
// dwie, kilka - nie miała ANI JEDNEGO dowodu.
//
// PRZEDMIOT DOWODU. Wszystko, co ta lista LICZY, zanim cokolwiek narysuje:
//   * wskaźnik pisania (wątek bezpośredni kontra krąg, 1/2/3+ osoby),
//   * separatory dni i grupowanie dymków wg reguł z `@/lib/chat/time`
//     (`crossesDay`, `sameGroup`, `GROUP_WINDOW_MS`) - z granicą okna włącznie,
//   * kotwiczenie avatara na OSTATNIM dymku grupy i rozpórka `span.w-5` wcześniej,
//   * atrybucja nadawcy w kręgu (pseudonim > nazwa profilu > „..."),
//   * separator nieprzeczytanych, chip znikających wiadomości, stan pusty,
//   * doładowanie starszych stron przez `IntersectionObserver`,
//   * skok do wyniku wyszukiwania, pigułka „przewiń na dół" z licznikiem,
//   * stopka z potwierdzeniem odczytu i kontrakt a11y kontenera (`role="log"`).
//
// POZA ZAKRESEM (świadomie). Wnętrze `MessageBubble` - ma własny plik testowy,
// więc jest tu ATRAPĄ wystawiającą propsy; bez tego jeden render listy ciągnie
// trzydzieści dymków z tooltipami i menu kontekstowymi Radiksa. Poza zakresem są
// też animacje wejścia (klasy CSS z własnym wyłącznikiem `prefers-reduced-motion`)
// oraz realne zachowanie przewijania przeglądarki - happy-dom nie liczy layoutu,
// więc `scrollHeight`/`clientHeight` są tu podstawiane jawnie.
//
// RODO: żadnych prawdziwych osób - nadawcy to identyfikatory z `CHAT_IDS`,
// imiona zmyślone, treści zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { realT } from "@/test/i18nReal";
import { CHAT_IDS, chatMessage, peerProfile } from "@/test/chat/fixtures";
import { GROUP_WINDOW_MS } from "@/lib/chat/time";
import { MESSAGE_TTL_OPTIONS } from "@/lib/chat/receipts";
import type { ChatMessage, PeerProfile, ReactionRow } from "@/lib/chat/types";

// `ChatAvatar` potrafi linkować do profilu publicznego przez <Link> TanStacka,
// a ten wymaga żywego routera. Test bada listę wiadomości, nie routing.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Atrapa dymka wystawia WYŁĄCZNIE propsy wyliczone przez listę. To jest granica
// odpowiedzialności: grupowanie i atrybucję liczy lista, a renderowanie treści
// ma własny dowód w `MessageBubble`.
vi.mock("../MessageBubble", () => ({
  MessageBubble: (props: {
    message: { id: string; body: string | null };
    mine: boolean;
    groupStart: boolean;
    groupEnd: boolean;
    repliedAuthorName?: string;
    starred?: boolean;
  }) => (
    <div
      data-testid="bubble"
      data-message={props.message.id}
      data-mine={String(props.mine)}
      data-group-start={String(props.groupStart)}
      data-group-end={String(props.groupEnd)}
      data-replied-author={props.repliedAuthorName ?? ""}
      data-starred={String(props.starred === true)}
    >
      {props.message.body}
    </div>
  ),
}));

import { MessageList, type MessageListProps } from "../MessageList";

const t = realT("pl");
const L = chatPl.chat;

// --- atrapy obserwatorów ----------------------------------------------------
// happy-dom ma własne `IntersectionObserver`/`ResizeObserver`, ale nigdy ich nie
// wyzwala (nie liczy layoutu). Podstawiamy sterowalne atrapy, żeby test mógł
// POWIEDZIEĆ „sentinel wszedł w widok" i sprawdzić skutek.

interface IntersectionEntryLike {
  readonly isIntersecting: boolean;
}
type IntersectionCallbackLike = (entries: IntersectionEntryLike[]) => void;

class IntersectionObserverStub {
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(
    private readonly callback: IntersectionCallbackLike,
    readonly options?: unknown,
  ) {
    intersectionObservers.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  /** Wjazd sentinela w widok - dokładnie to, co robi przeglądarka. */
  enter(): void {
    this.callback([{ isIntersecting: true }]);
  }
  /** Wyjazd sentinela z widoku - nie wolno doładowywać. */
  leave(): void {
    this.callback([{ isIntersecting: false }]);
  }
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let intersectionObservers: IntersectionObserverStub[] = [];

/** Ostatni żywy obserwator sentinela - strażnik zamiast rzutowania. */
function lastIntersectionObserver(): IntersectionObserverStub {
  const observer = intersectionObservers.at(-1);
  if (!observer) throw new Error("test: lista nie założyła IntersectionObserver na sentinelu");
  return observer;
}

// --- fabryki ----------------------------------------------------------------

const PEER_NAME = "Zofia Testowa";
const NO_REACTIONS: ReadonlyMap<string, ReactionRow[]> = new Map();

function listProps(overrides: Partial<MessageListProps> = {}): MessageListProps {
  return {
    lang: "pl",
    myUserId: CHAT_IDS.me,
    messages: [],
    reactions: NO_REACTIONS,
    peerName: PEER_NAME,
    peerAvatarUrl: null,
    peerLastReadAt: null,
    peerTyping: false,
    hasOlder: false,
    loadingOlder: false,
    onLoadOlder: vi.fn(),
    onReact: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDiscardFailed: vi.fn(),
    canEdit: () => false,
    ...overrides,
  };
}

function renderList(overrides: Partial<MessageListProps> = {}) {
  const props = listProps(overrides);
  const utils = render(<MessageList {...props} />);
  return { ...utils, props };
}

/** Kontener przewijania - jednocześnie kontrakt a11y (`role="log"`). */
function logContainer(): HTMLElement {
  return screen.getByRole("log");
}

/**
 * happy-dom nie liczy layoutu, więc `scrollHeight`/`clientHeight` są zerowe
 * i heurystyka „czy jestem przy dnie" nie miałaby czego mierzyć. Podstawiamy
 * geometrię jawnie - to jedyny sposób, żeby przetestować progi 80/240 px.
 */
function setScrollGeometry(
  element: HTMLElement,
  geometry: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  Object.defineProperty(element, "scrollHeight", {
    value: geometry.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(element, "clientHeight", {
    value: geometry.clientHeight,
    configurable: true,
  });
  Object.defineProperty(element, "scrollTop", {
    value: geometry.scrollTop,
    writable: true,
    configurable: true,
  });
}

/** Znacznik czasu przesunięty względem realnego „teraz" (separatory dni liczą od zegara). */
function agoIso(milliseconds: number): string {
  return new Date(Date.now() - milliseconds).toISOString();
}

/**
 * Punkt DZISIEJSZEGO południa (czas lokalny) przesunięty o `offsetMs`.
 *
 * Grupowanie i separatory dni liczą od realnego zegara, więc kotwiczenie
 * testów przez `Date.now() - godzina` wprowadza CICHĄ FLAKĘ: przebieg tuż po
 * północy przesuwa bazę na wczoraj (asercja o „Dzisiaj" gaśnie), a przebieg
 * o 03:00 potrafi rozdzielić parę wiadomości granicą doby i podbić `groupStart`
 * mimo mieszczenia się w oknie grupowania. Południe jest odległe od obu granic
 * doby o dwanaście godzin, więc żadne przesunięcie liczone tu w minutach jej
 * nie przekroczy. Znacznik może wypaść w przyszłości - dla `crossesDay`,
 * `sameGroup` i `dayLabel` liczy się wyłącznie kalendarz, nie kierunek.
 */
function todayAt(offsetMs = 0): string {
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  return new Date(noon.getTime() + offsetMs).toISOString();
}

/**
 * Etykieta dnia wyliczona NIEZALEŻNIE od produkcji (własny formatter Intl), żeby
 * asercja mierzyła WYMAGANIE, a nie kopię implementacji. Rok dopisujemy tylko
 * przy innym roku - inaczej plik zapalałby się na czerwono w pierwszych dniach
 * stycznia, gdy „trzy dni temu" wpada do poprzedniego roku.
 */
function polishDayLabel(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(
    "pl-PL",
    sameYear
      ? { day: "numeric", month: "long" }
      : { day: "numeric", month: "long", year: "numeric" },
  ).format(date);
}

function bubbles(): HTMLElement[] {
  return screen.getAllByTestId("bubble");
}

// Rozpórka pod nieobecny avatar to `<span className="w-5 shrink-0" aria-hidden />`.
// Sam selektor `span.w-5` NIE wystarcza: avatar rozmiaru `xs` też jest spanem
// z klasą `w-5` (`h-5 w-5` z `ChatAvatar`), więc liczyłby avatary jako rozpórki.
// Rozróżnia je `aria-hidden` - rozpórka jest czystą dekoracją układu.
const SPACER_SELECTOR = 'span.w-5[aria-hidden="true"]';

function spacers(root: HTMLElement): NodeListOf<HTMLElement> {
  return root.querySelectorAll<HTMLElement>(SPACER_SELECTOR);
}

function rowOf(container: HTMLElement, messageId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!row) throw new Error(`test: brak wiersza wiadomości ${messageId}`);
  return row;
}

beforeEach(() => {
  intersectionObservers = [];
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("wskaźnik pisania", () => {
  it('wątek bezpośredni mówi „imię pisze..." tylko dla czytnika ekranu', () => {
    renderList({ peerTyping: true });

    const label = `${PEER_NAME} ${L.typing}`;
    expect(screen.getByLabelText(label)).toBeTruthy();
    // W wątku bezpośrednim imię rozmówcy jest już w nagłówku okna - powtarzanie
    // go NAD dymkiem byłoby szumem, więc podpis jest wyłącznie w `aria-label`.
    expect(screen.queryByText(label)).toBeNull();
  });

  it("pusta lista piszących spada na nazwę rozmówcy, nie na pusty napis", () => {
    renderList({ peerTyping: true, typingNames: [] });
    expect(screen.getByLabelText(`${PEER_NAME} ${L.typing}`)).toBeTruthy();
  });

  it("krąg z JEDNĄ piszącą osobą podpisuje ją widocznie nad dymkiem", () => {
    renderList({
      isGroup: true,
      peerTyping: true,
      typingNames: [PEER_NAME],
      typingAvatarUrl: null,
    });

    const label = t("chat.group.typing", { name: PEER_NAME });
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it('dwie osoby dostają obie nazwy, nie „kilka osób"', () => {
    renderList({
      isGroup: true,
      peerTyping: true,
      typingNames: [PEER_NAME, "Jan Przykładowy"],
    });

    expect(
      screen.getByText(t("chat.typingTwo", { a: PEER_NAME, b: "Jan Przykładowy" })),
    ).toBeTruthy();
    expect(screen.queryByText(L.typingMany)).toBeNull();
  });

  it('trzy osoby i więcej zwijają się w „kilka osób pisze"', () => {
    renderList({
      isGroup: true,
      peerTyping: true,
      typingNames: [PEER_NAME, "Jan Przykładowy", "Ewa Zmyślona", "Piotr Nieistniejący"],
    });

    expect(screen.getByText(L.typingMany)).toBeTruthy();
    expect(
      screen.queryByText(t("chat.typingTwo", { a: PEER_NAME, b: "Jan Przykładowy" })),
    ).toBeNull();
  });

  it("wskaźnik ZNIKA, gdy rozmówca przestaje pisać", () => {
    const props = listProps({ peerTyping: true });
    const { rerender } = render(<MessageList {...props} />);
    expect(screen.getByLabelText(`${PEER_NAME} ${L.typing}`)).toBeTruthy();

    rerender(<MessageList {...props} peerTyping={false} />);

    expect(screen.queryByLabelText(`${PEER_NAME} ${L.typing}`)).toBeNull();
  });
});

describe("separatory dni i grupowanie", () => {
  it("każda zmiana dnia dostaje własny separator z etykietą z reguł `@/lib/chat/time`", () => {
    const threeDaysAgo = agoIso(3 * 24 * 3600_000);
    const yesterday = agoIso(24 * 3600_000);
    // „Dzisiaj" bierzemy z realnego zegara, a nie z odjęcia minut - odjęcie
    // wpadłoby na wczoraj, gdyby przebieg trafił w pierwsze sekundy doby.
    const today = new Date().toISOString();
    renderList({
      messages: [
        chatMessage({ id: "m-1", created_at: threeDaysAgo, body: "Najstarsza" }),
        chatMessage({ id: "m-2", created_at: yesterday, body: "Wczorajsza" }),
        chatMessage({ id: "m-3", created_at: today, body: "Dzisiejsza" }),
      ],
    });

    expect(screen.getByText(polishDayLabel(threeDaysAgo))).toBeTruthy();
    expect(screen.getByText(L.yesterday)).toBeTruthy();
    expect(screen.getByText(L.today)).toBeTruthy();
  });

  it("wiadomości tego samego dnia i nadawcy NIE dostają drugiego separatora", () => {
    renderList({
      messages: [
        chatMessage({ id: "m-1", created_at: todayAt() }),
        chatMessage({ id: "m-2", created_at: todayAt(60_000) }),
      ],
    });

    expect(screen.getAllByText(L.today)).toHaveLength(1);
  });

  it("seria tego samego nadawcy ma JEDEN avatar - na ostatnim dymku, reszta to rozpórka", () => {
    const { container } = renderList({
      messages: [
        chatMessage({ id: "m-1", created_at: todayAt() }),
        chatMessage({ id: "m-2", created_at: todayAt(60_000) }),
        chatMessage({ id: "m-3", created_at: todayAt(120_000) }),
      ],
    });

    expect(bubbles().map((b) => b.getAttribute("data-group-start"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(bubbles().map((b) => b.getAttribute("data-group-end"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    // Rozpórki tylko na wierszach BEZ avatara - inaczej grupa rozjeżdża się w lewo.
    expect(spacers(container)).toHaveLength(2);
    expect(rowOf(container, "m-1").querySelector(SPACER_SELECTOR)).not.toBeNull();
    expect(rowOf(container, "m-3").querySelector(SPACER_SELECTOR)).toBeNull();
  });

  it("granica okna grupowania jest DOKŁADNIE `GROUP_WINDOW_MS` - sekunda mniej scala, równo rozbija", () => {
    const inside = renderList({
      messages: [
        chatMessage({ id: "m-1", created_at: todayAt() }),
        chatMessage({ id: "m-2", created_at: todayAt(GROUP_WINDOW_MS - 1000) }),
      ],
    });
    expect(bubbles()[1]?.getAttribute("data-group-start")).toBe("false");
    expect(spacers(inside.container)).toHaveLength(1);
    cleanup();

    const outside = renderList({
      messages: [
        chatMessage({ id: "m-1", created_at: todayAt() }),
        chatMessage({ id: "m-2", created_at: todayAt(GROUP_WINDOW_MS) }),
      ],
    });
    expect(bubbles()[1]?.getAttribute("data-group-start")).toBe("true");
    // Obie wiadomości domykają własną grupę, więc obie mają avatar - zero rozpórek.
    expect(spacers(outside.container)).toHaveLength(0);
  });

  it("zmiana nadawcy rozbija grupę nawet w tej samej minucie", () => {
    renderList({
      messages: [
        chatMessage({ id: "m-1", created_at: todayAt() }),
        chatMessage({ id: "m-2", sender_id: CHAT_IDS.me, created_at: todayAt(10_000) }),
      ],
    });

    expect(bubbles().map((b) => b.getAttribute("data-mine"))).toEqual(["false", "true"]);
    expect(bubbles().map((b) => b.getAttribute("data-group-start"))).toEqual(["true", "true"]);
  });

  it("własna wiadomość NIE dostaje avatara ani rozpórki po prawej", () => {
    const { container } = renderList({
      messages: [chatMessage({ id: "m-1", sender_id: CHAT_IDS.me })],
    });
    expect(spacers(container)).toHaveLength(0);
  });
});

describe("atrybucja nadawcy w kręgu", () => {
  const profiles: ReadonlyMap<string, PeerProfile> = new Map([
    [CHAT_IDS.peer, peerProfile({ id: CHAT_IDS.peer, display_name: "Zofia Testowa" })],
  ]);

  it("pseudonim rozmowy WYGRYWA z nazwą profilu", () => {
    renderList({
      isGroup: true,
      senderProfiles: profiles,
      senderNicknames: new Map([[CHAT_IDS.peer, "Zosia z kręgu"]]),
      messages: [chatMessage({ id: "m-1" })],
    });

    expect(screen.getByText("Zosia z kręgu")).toBeTruthy();
    expect(screen.queryByText("Zofia Testowa")).toBeNull();
  });

  it("bez pseudonimu podpisem jest nazwa profilu", () => {
    renderList({
      isGroup: true,
      senderProfiles: profiles,
      messages: [chatMessage({ id: "m-1" })],
    });

    expect(screen.getByText("Zofia Testowa")).toBeTruthy();
  });

  it("bez pseudonimu i bez profilu zostaje wielokropek zamiast pustego miejsca", () => {
    const { container } = renderList({
      isGroup: true,
      messages: [chatMessage({ id: "m-1" })],
    });

    // „..." to jawny zapasowy napis komponentu (nie klucz i18n) - pilnujemy,
    // żeby wiersz kręgu nigdy nie został BEZ podpisu nadawcy.
    const caption = rowOf(container, "m-1").querySelector("p");
    expect(caption?.textContent).toBe("...");
  });

  it("podpis pojawia się RAZ na grupę, nie nad każdym dymkiem", () => {
    renderList({
      isGroup: true,
      senderProfiles: profiles,
      messages: [
        chatMessage({ id: "m-1", created_at: todayAt() }),
        chatMessage({ id: "m-2", created_at: todayAt(60_000) }),
      ],
    });

    expect(screen.getAllByText("Zofia Testowa")).toHaveLength(1);
  });

  it("własna wiadomość w kręgu nie jest podpisywana", () => {
    const { container } = renderList({
      isGroup: true,
      senderProfiles: profiles,
      messages: [chatMessage({ id: "m-1", sender_id: CHAT_IDS.me })],
    });

    expect(rowOf(container, "m-1").querySelector("p")).toBeNull();
    expect(spacers(container)).toHaveLength(0);
  });
});

describe("cytat - kto jest autorem oryginału", () => {
  it('cytat WŁASNEJ wiadomości podpisuje się „Ty"', () => {
    renderList({
      messages: [
        chatMessage({ id: "m-quoted", sender_id: CHAT_IDS.me, body: "Pytanie" }),
        chatMessage({ id: "m-answer", reply_to_id: "m-quoted", body: "Odpowiedź" }),
      ],
    });

    expect(bubbles()[1]?.getAttribute("data-replied-author")).toBe(L.you);
  });

  it("cytat cudzej wiadomości w wątku bezpośrednim bierze nazwę rozmówcy", () => {
    renderList({
      messages: [
        chatMessage({ id: "m-quoted", body: "Pytanie" }),
        chatMessage({ id: "m-answer", sender_id: CHAT_IDS.me, reply_to_id: "m-quoted" }),
      ],
    });

    expect(bubbles()[1]?.getAttribute("data-replied-author")).toBe(PEER_NAME);
  });

  it("cytat w kręgu bierze pseudonim nadawcy oryginału", () => {
    renderList({
      isGroup: true,
      senderNicknames: new Map([[CHAT_IDS.peer, "Zosia z kręgu"]]),
      messages: [
        chatMessage({ id: "m-quoted", body: "Pytanie" }),
        chatMessage({ id: "m-answer", sender_id: CHAT_IDS.me, reply_to_id: "m-quoted" }),
      ],
    });

    expect(bubbles()[1]?.getAttribute("data-replied-author")).toBe("Zosia z kręgu");
  });

  it("cytat wiadomości spoza wczytanego okna nie podaje autora", () => {
    renderList({
      messages: [chatMessage({ id: "m-answer", reply_to_id: "m-dawno-wypadla" })],
    });

    expect(bubbles()[0]?.getAttribute("data-replied-author")).toBe("");
  });
});

describe("separator nieprzeczytanych", () => {
  it("liczy nieprzeczytane i wstawia kreskę PRZED pierwszą z nich", () => {
    const { container } = renderList({
      messages: [chatMessage({ id: "m-1" }), chatMessage({ id: "m-2", created_at: agoIso(1000) })],
      firstUnreadId: "m-2",
      unreadCount: 3,
    });

    const divider = container.querySelector('[data-unread-divider="1"]');
    expect(divider).not.toBeNull();
    expect(divider?.textContent).toBe(t("chat.unreadDivider", { count: 3 }));
    // Kreska mieszka W WIERSZU pierwszej nieprzeczytanej, nie na końcu listy.
    expect(rowOf(container, "m-2").querySelector('[data-unread-divider="1"]')).not.toBeNull();
  });

  it("zerowy licznik NIE rysuje kreski, nawet gdy identyfikator został w propsach", () => {
    const { container } = renderList({
      messages: [chatMessage({ id: "m-1" })],
      firstUnreadId: "m-1",
      unreadCount: 0,
    });

    expect(container.querySelector('[data-unread-divider="1"]')).toBeNull();
  });

  it("identyfikator spoza wczytanego okna nie rysuje kreski donikąd", () => {
    const { container } = renderList({
      messages: [chatMessage({ id: "m-1" })],
      firstUnreadId: "m-dawno-wypadla",
      unreadCount: 5,
    });

    expect(container.querySelector('[data-unread-divider="1"]')).toBeNull();
  });
});

describe("chip znikających wiadomości", () => {
  it("każde okno TTL z panelu ustawień ma własną etykietę", () => {
    const cases = [
      { ttlSeconds: 86400, window: L.disappearing.day },
      { ttlSeconds: 604800, window: L.disappearing.week },
      { ttlSeconds: 7776000, window: L.disappearing.quarter },
    ];
    // Testujemy DOKŁADNIE wartości, które da się ustawić (`MESSAGE_TTL_OPTIONS`).
    // Podstawienie tu wygodnej liczby spoza tej listy (np. godziny) dowodziłoby
    // tylko tego, że gałąź zapasowa łapie wszystko - a nie tego, że NAJDŁUŻSZE
    // realne okno ma poprawny napis. Gdy dojdzie czwarta opcja, wpadnie cicho
    // w `quarter` („90 dni") i ta asercja ma to wyłapać.
    expect(cases.map((c) => c.ttlSeconds)).toEqual([...MESSAGE_TTL_OPTIONS]);
    // Trzy okna muszą dać trzy RÓŻNE napisy - inaczej użytkownik nie wie, co ustawił.
    expect(new Set(cases.map((c) => c.window)).size).toBe(3);

    for (const c of cases) {
      renderList({ ttlSeconds: c.ttlSeconds });
      expect(screen.getByText(t("chat.disappearing.active", { window: c.window }))).toBeTruthy();
      cleanup();
    }
  });

  it("wyłączone znikanie nie zostawia chipa", () => {
    renderList({ ttlSeconds: null });
    expect(screen.queryByText(new RegExp(L.disappearing.title))).toBeNull();
    expect(screen.queryByTitle(L.disappearing.hint)).toBeNull();
  });
});

describe("pusty wątek", () => {
  it("wątek bezpośredni zaprasza do pierwszej wiadomości", () => {
    renderList();
    expect(screen.getByText(L.conversationEmpty)).toBeTruthy();
    expect(screen.queryByText(L.group.emptyConversation)).toBeNull();
  });

  it("krąg ma własny tekst startowy", () => {
    renderList({ isGroup: true });
    expect(screen.getByText(L.group.emptyConversation)).toBeTruthy();
    expect(screen.queryByText(L.conversationEmpty)).toBeNull();
  });

  it("podczas doczytywania historii stan pusty NIE miga - to nie jest pusta rozmowa", () => {
    renderList({ loadingOlder: true });
    expect(screen.queryByText(L.conversationEmpty)).toBeNull();
  });
});

describe("doładowanie starszych stron", () => {
  it('pasek zapowiada starsze wiadomości, a w trakcie pobierania mówi „ładowanie"', () => {
    renderList({ hasOlder: true, messages: [chatMessage({ id: "m-1" })] });
    expect(screen.getByText(L.loadOlder)).toBeTruthy();
    cleanup();

    renderList({ hasOlder: true, loadingOlder: true, messages: [chatMessage({ id: "m-1" })] });
    expect(screen.getByText(t("common.loading"))).toBeTruthy();
    expect(screen.queryByText(L.loadOlder)).toBeNull();
  });

  it("wjazd sentinela w widok pobiera kolejną stronę", () => {
    const { props } = renderList({ hasOlder: true, messages: [chatMessage({ id: "m-1" })] });

    lastIntersectionObserver().enter();

    expect(props.onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("sentinel POZA widokiem niczego nie pobiera", () => {
    const { props } = renderList({ hasOlder: true, messages: [chatMessage({ id: "m-1" })] });

    lastIntersectionObserver().leave();

    expect(props.onLoadOlder).not.toHaveBeenCalled();
  });

  it("trwające pobieranie blokuje kolejne żądanie tej samej strony", () => {
    const { props } = renderList({
      hasOlder: true,
      loadingOlder: true,
      messages: [chatMessage({ id: "m-1" })],
    });

    lastIntersectionObserver().enter();

    expect(props.onLoadOlder).not.toHaveBeenCalled();
  });

  it("wyczerpana historia nie zakłada obserwatora - nie ma czego pilnować", () => {
    renderList({ hasOlder: false, messages: [chatMessage({ id: "m-1" })] });
    expect(intersectionObservers).toHaveLength(0);
  });

  it("odmontowanie rozłącza obserwatora (wyciek przy zamykaniu okien doku)", () => {
    const { unmount } = renderList({ hasOlder: true, messages: [chatMessage({ id: "m-1" })] });
    const observer = lastIntersectionObserver();
    expect(observer.disconnected).toBe(false);

    unmount();

    expect(observer.disconnected).toBe(true);
  });
});

describe("skok do wyniku wyszukiwania", () => {
  it("cel obecny w oknie dostaje podświetlenie i zgłasza obsłużenie skoku", () => {
    const onJumpHandled = vi.fn();
    const { container } = renderList({
      messages: [chatMessage({ id: "m-1" }), chatMessage({ id: "m-2", created_at: agoIso(1000) })],
      jumpToId: "m-2",
      onJumpHandled,
    });

    // Samo `onJumpHandled` NIE dowodzi trafienia: efekt woła je bezwarunkowo po
    // `jumpToMessage`, a ta cicho wychodzi, gdy nie znajdzie wiersza. Dowodem,
    // że skok dosięgnął CELU, jest klasa błysku - jedyny skutek `jumpToMessage`
    // obserwowalny bez layoutu (samo przewinięcie happy-dom przemilcza).
    expect(rowOf(container, "m-2").classList.contains("chat-jump-flash")).toBe(true);
    expect(rowOf(container, "m-1").classList.contains("chat-jump-flash")).toBe(false);
    expect(onJumpHandled).toHaveBeenCalledTimes(1);
  });

  it("cel spoza wczytanego okna NIE zgłasza obsłużenia - właściciel musi doczytać stronę", () => {
    const onJumpHandled = vi.fn();
    renderList({
      messages: [chatMessage({ id: "m-1" })],
      jumpToId: "m-dawno-wypadla",
      onJumpHandled,
    });

    expect(onJumpHandled).not.toHaveBeenCalled();
  });

  it("brak celu nie rusza listy", () => {
    const onJumpHandled = vi.fn();
    renderList({ messages: [chatMessage({ id: "m-1" })], jumpToId: null, onJumpHandled });
    expect(onJumpHandled).not.toHaveBeenCalled();
  });
});

describe('pigułka „przewiń na dół"', () => {
  it("pojawia się dopiero po odjechaniu od dna i znika po powrocie", () => {
    renderList({ messages: [chatMessage({ id: "m-1" })] });
    expect(screen.queryByRole("button", { name: L.scrollToBottom })).toBeNull();

    const log = logContainer();
    // Dystans do dna = 1000 - 0 - 300 = 700 px, czyli powyżej progu 240 px.
    setScrollGeometry(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(log);
    expect(screen.getByRole("button", { name: L.scrollToBottom })).toBeTruthy();

    // Powrót na dno: dystans 0 px.
    log.scrollTop = 700;
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: L.scrollToBottom })).toBeNull();
  });

  it("dystans w progu tolerancji (poniżej 240 px) NIE wywołuje pigułki", () => {
    renderList({ messages: [chatMessage({ id: "m-1" })] });
    const log = logContainer();
    setScrollGeometry(log, { scrollHeight: 1000, clientHeight: 800, scrollTop: 0 });
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: L.scrollToBottom })).toBeNull();
  });

  it("nowe wiadomości przy przewinięciu w górę podbijają licznik na pigułce", () => {
    const props = listProps({ messages: [chatMessage({ id: "m-1" })] });
    const { rerender } = render(<MessageList {...props} />);

    const log = logContainer();
    setScrollGeometry(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(log);

    rerender(
      <MessageList
        {...props}
        messages={[
          chatMessage({ id: "m-1" }),
          chatMessage({ id: "m-2", created_at: agoIso(2000) }),
          chatMessage({ id: "m-3", created_at: agoIso(1000) }),
        ]}
      />,
    );

    expect(screen.getByLabelText(t("chat.unread", { count: 2 }))).toBeTruthy();
    expect(screen.getByLabelText(t("chat.unread", { count: 2 })).textContent).toBe("2");
  });

  it("powrót na dno zeruje licznik nowych", () => {
    const props = listProps({ messages: [chatMessage({ id: "m-1" })] });
    const { rerender } = render(<MessageList {...props} />);
    const log = logContainer();
    setScrollGeometry(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(log);
    rerender(
      <MessageList
        {...props}
        messages={[
          chatMessage({ id: "m-1" }),
          chatMessage({ id: "m-2", created_at: agoIso(1000) }),
        ]}
      />,
    );
    expect(screen.getByLabelText(t("chat.unread", { count: 1 }))).toBeTruthy();

    log.scrollTop = 700;
    fireEvent.scroll(log);

    expect(screen.queryByRole("button", { name: L.scrollToBottom })).toBeNull();
  });

  it("kliknięcie pigułki chowa ją i kasuje licznik", () => {
    const props = listProps({ messages: [chatMessage({ id: "m-1" })] });
    const { rerender } = render(<MessageList {...props} />);
    const log = logContainer();
    setScrollGeometry(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(log);
    rerender(
      <MessageList
        {...props}
        messages={[
          chatMessage({ id: "m-1" }),
          chatMessage({ id: "m-2", created_at: agoIso(1000) }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: L.scrollToBottom }));

    expect(screen.queryByRole("button", { name: L.scrollToBottom })).toBeNull();
  });

  it('ponad 99 nowych wiadomości skraca się do „99+"', () => {
    const props = listProps({ messages: [chatMessage({ id: "m-0" })] });
    const { rerender } = render(<MessageList {...props} />);
    const log = logContainer();
    setScrollGeometry(log, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(log);

    const flood: ChatMessage[] = [chatMessage({ id: "m-0" })];
    for (let i = 1; i <= 100; i++) {
      flood.push(chatMessage({ id: `m-${i}`, created_at: agoIso(100_000 - i * 100) }));
    }
    rerender(<MessageList {...props} messages={flood} />);

    expect(screen.getByLabelText(t("chat.unread", { count: 100 })).textContent).toBe("99+");
  });
});

describe("stopka - potwierdzenia odczytu", () => {
  it('„wyświetlone" pojawia się, gdy odczyt rozmówcy dogonił ostatnią własną wiadomość', () => {
    const mine = chatMessage({ id: "m-1", sender_id: CHAT_IDS.me, created_at: agoIso(60_000) });
    renderList({ messages: [mine], peerLastReadAt: agoIso(30_000) });

    expect(screen.getByText(L.seen)).toBeTruthy();
  });

  it("odczyt SPRZED ostatniej własnej wiadomości nie kłamie o wyświetleniu", () => {
    const mine = chatMessage({ id: "m-1", sender_id: CHAT_IDS.me, created_at: agoIso(30_000) });
    renderList({ messages: [mine], peerLastReadAt: agoIso(60_000) });

    expect(screen.queryByText(L.seen)).toBeNull();
  });

  it("brak potwierdzenia odczytu (wyłączone przez rozmówcę) nie pokazuje stopki", () => {
    renderList({
      messages: [chatMessage({ id: "m-1", sender_id: CHAT_IDS.me })],
      peerLastReadAt: null,
    });

    expect(screen.queryByText(L.seen)).toBeNull();
  });

  it("cudza ostatnia wiadomość nie generuje stopki o naszym odczycie", () => {
    renderList({
      messages: [chatMessage({ id: "m-1", created_at: agoIso(60_000) })],
      peerLastReadAt: agoIso(30_000),
    });

    expect(screen.queryByText(L.seen)).toBeNull();
  });

  // Towarzysz poniższego `it.fails`. `it.fails` zielenieje po KAŻDYM wyjątku,
  // więc sam nie odróżnia „brakuje napisu w stopce" od „render się wysypał"
  // albo „klucz `chat.sending` wypadł ze słownika" - a wtedy cicho pilnowałby
  // czegoś innego, niż głosi jego nazwa. Ten test odcina obie alternatywy:
  // dymek JEST na liście, klucz JEST w słowniku i w żywej instancji i18next,
  // a mimo to stopka zostaje pusta. Zostanie usunięty razem z `it.fails`, gdy
  // produkcja przestanie gubić stan „w locie".
  it("wiadomość w locie renderuje się poprawnie - martwa jest wyłącznie stopka", () => {
    renderList({
      messages: [chatMessage({ id: "m-1", sender_id: CHAT_IDS.me, pending: true })],
    });

    expect(bubbles()).toHaveLength(1);
    expect(L.sending.length).toBeGreaterThan(0);
    expect(t("chat.sending")).toBe(L.sending);
    expect(screen.queryByText(L.sending)).toBeNull();
  });

  // DEFEKT PRODUKCYJNY (`MessageList.tsx`, `lastMine` + stopka).
  // ZŁAMANY KONTRAKT: `lastMine` szuka ostatniej własnej wiadomości z warunkiem
  // `!m.pending`, czyli Z DEFINICJI pomija wiadomości w locie - a stopka pyta
  // potem `lastMine?.pending`, co nigdy nie może być prawdą. Gałąź `chat.sending`
  // jest martwa: użytkownik wysyłający wiadomość NIE dostaje informacji
  // „Wysyłanie...", mimo że klucz i18n istnieje i JSX go renderuje.
  // OCZEKIWANY KONTRAKT: przy własnej wiadomości ze stanem `pending` stopka
  // listy pokazuje `chat.sending`.
  // Naprawa to zmiana produkcji (osobny wskaźnik na ostatnią własną wiadomość
  // BEZ filtra `pending`), więc zostaje tu jako udokumentowana porażka.
  it.fails('stopka NIE pokazuje „Wysyłanie..." dla wiadomości w locie', () => {
    renderList({
      messages: [chatMessage({ id: "m-1", sender_id: CHAT_IDS.me, pending: true })],
    });

    expect(screen.getByText(L.sending)).toBeTruthy();
  });
});

describe("kontrakt dostępności kontenera", () => {
  it("historia jest dziennikiem ogłaszanym uprzejmie - nowa wiadomość nie przerywa czytnika", () => {
    renderList({ messages: [chatMessage({ id: "m-1" })] });

    const log = logContainer();
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.getAttribute("aria-label")).toBe(L.messages);
  });

  it("nowa wiadomość dopisuje się do TEGO SAMEGO dziennika, nie tworzy drugiego", () => {
    const props = listProps({ messages: [chatMessage({ id: "m-1" })] });
    const { rerender } = render(<MessageList {...props} />);
    const before = logContainer();

    rerender(
      <MessageList
        {...props}
        messages={[
          chatMessage({ id: "m-1" }),
          chatMessage({ id: "m-2", created_at: agoIso(1000) }),
        ]}
      />,
    );

    expect(screen.getAllByRole("log")).toHaveLength(1);
    expect(logContainer()).toBe(before);
    expect(bubbles()).toHaveLength(2);
  });
});
