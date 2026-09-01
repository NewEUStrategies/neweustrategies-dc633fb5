// PIERWSZY audyt dostępności modułu 09 (czat). Przed tym plikiem `grep axe`
// w testach czatu nie zwracał NIC: cztery tysiące linii powierzchni, na której
// użytkownik czytnika ekranu spędza najwięcej czasu (dziennik wiadomości,
// kompozytor, dialogi), nie miały ani jednego dowodu dostępności.
//
// CO JEST PRZEDMIOTEM DOWODU.
//   1. `axe-core` na czterech powierzchniach: oknie rozmowy (`ChatWindow`,
//      warstwa danych zamockowana jak w `ChatWindow.test.tsx`), historii
//      (`MessageList` z wiadomościami, reakcjami i wskaźnikiem pisania),
//      kompozytorze (`ChatComposer`) oraz DWÓCH dialogach - potwierdzeniu
//      nieodwracalnej akcji (`ChatConfirmDialog`) i personalizacji rozmowy
//      (`ChatAppearanceDialog`).
//   2. Kontrakty, których axe NIE sprawdza, bo nie zna intencji produktu:
//      * dziennik ogłaszany uprzejmie - nowa wiadomość ląduje W TYM SAMYM
//        obszarze `aria-live`, więc czytnik ją przeczyta bez przerywania;
//      * cztery przyciski kompozytora (mikrofon, załącznik, emotka, wysyłka)
//        mają dostępną nazwę Z KLUCZA i18n, a ich ikona jest `aria-hidden`
//        (inaczej czytnik czyta nazwę pliku SVG albo nie czyta nic);
//      * pułapka fokusu dialogu - Tab NIE wychodzi poza dialog, a Escape
//        zamyka go, więc klawiatura nie zostaje uwięziona na zawsze;
//      * KOMPLET zmiennych CSS dymka (`--chat-user-from`, `--chat-user-to`,
//        `--chat-user-foreground`) dla KAŻDEGO motywu z katalogu - `themes.ts`
//        ma 100% pokrycia jako reguła, ale katalog nigdy nie był skonfrontowany
//        z arkuszem NA RENDERZE, a brak którejkolwiek zmiennej daje biały tekst
//        na białym tle (dymek jest jedynym miejscem, gdzie te tokeny działają).
//
// ŚWIADOMIE POZA ZAKRESEM. Reguła `color-contrast` jest wyłączona w
// `@/test/axe` (happy-dom nie liczy pikseli), dlatego kontrast motywów jest tu
// dowodzony inaczej: przez KOMPLETNOŚĆ tokenów odczytaną z prawdziwego
// `src/styles.css`, nie przez pomiar barw. Poza zakresem jest też sam wybór
// wartości kolorów (to decyzja projektowa) oraz zachowanie klikane - mają
// własne pliki (`ChatWindow.test.tsx`, `ChatComposer.test.tsx`,
// `MessageList.test.tsx`, `chatAppearance.test.tsx`).
//
// RODO: osoby zmyślone, identyfikatory z `CHAT_IDS`, treści zmyślone.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import {
  CHAT_IDS,
  chatMessage,
  conversationView,
  isoOffset,
  peerProfile,
  peerProfileMap,
  reactionRow,
} from "@/test/chat/fixtures";
import { CHAT_THEMES, themeLabelKey } from "@/lib/chat/themes";
import { __resetDraftsForTests } from "@/lib/chat/drafts";
import type { RuleObject } from "axe-core";
import type { ChatMessage, PeerProfile, ReactionRow } from "@/lib/chat/types";
import type { RecordedVoice } from "@/lib/chat/voice";

const h = vi.hoisted(() => ({
  views: [] as unknown[],
  peers: null as unknown,
  nicknames: new Map<string, Map<string, string>>(),
  blocks: new Set<string>() as ReadonlySet<string>,
  online: new Set<string>() as ReadonlySet<string>,
  prefs: { typing_indicators_enabled: true, auto_mark_on_open: true } as Record<string, boolean>,
  messages: [] as unknown[],
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  sendTyping: vi.fn(),
  typingUserIds: new Set<string>() as ReadonlySet<string>,
  recorder: {
    state: "idle" as "idle" | "requesting" | "recording",
    elapsed: 0,
    supported: true,
    start: vi.fn(),
    finish: vi.fn(async (): Promise<RecordedVoice | null> => null),
    cancel: vi.fn(),
  },
}));

// --- warstwa danych (atrapy jak w `ChatWindow.test.tsx`) ---------------------

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: CHAT_IDS.me, email: "ja@example.com", user_metadata: { display_name: "Ja" } },
    tenantId: CHAT_IDS.tenant,
  }),
}));

vi.mock("@/lib/chat/useConversations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/useConversations")>();
  return {
    isMuted: actual.isMuted,
    useConversations: () => ({ data: h.views }),
    usePeerProfiles: () => ({ data: h.peers }),
    useMarkConversationRead: () => ({ mutate: vi.fn() }),
    useSetConversationPinned: () => ({ mutate: vi.fn() }),
    useSetConversationArchived: () => ({ mutate: vi.fn() }),
    useSetConversationMuted: () => ({ mutate: vi.fn() }),
    useClearConversationHistory: () => ({ mutate: vi.fn() }),
    useSetMessageTtl: () => ({ mutate: vi.fn() }),
    useSetConversationAppearance: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("@/lib/chat/useMessages", async () => {
  const cache = await import("@/lib/chat/messageCache");
  return {
    useMessages: () => ({
      data: { pages: [{ rows: h.messages, nextCursor: null }], pageParams: [null] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      fetchNextPage: vi.fn(),
    }),
    useReactions: () => ({ data: new Map() }),
    useSendMessage: () => ({ mutate: vi.fn() }),
    useEditMessage: () => ({ mutate: vi.fn() }),
    useDeleteMessage: () => ({ mutate: vi.fn() }),
    useDiscardFailedMessage: () => vi.fn(),
    useToggleReaction: () => ({ mutate: vi.fn() }),
    useConversationChannel: () => ({ sendTyping: h.sendTyping }),
    useConversationAttachments: () => ({ data: [] }),
    canEditMessage: cache.canEditMessage,
    retrySendInput: cache.retrySendInput,
  };
});

vi.mock("@/lib/chat/useTypingRegistry", () => ({
  TYPING_VISIBLE_MS: 4000,
  useTypingRegistry: () => ({ typingUserIds: h.typingUserIds, sendTyping: h.sendTyping }),
}));

// Częściowa atrapa: czyste `nicknameFor`/`resolveMemberName` zostają prawdziwe -
// podmieniamy wyłącznie hooki chodzące do bazy.
vi.mock("@/lib/chat/nicknames", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/nicknames")>()),
  useNicknames: () => ({ data: h.nicknames }),
  useSetNickname: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/chat/stars", () => ({
  useStarredIds: () => ({ data: new Set<string>() }),
  useStarredMessages: () => ({ data: [] }),
  useToggleStar: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/lib/chat/useBlocks", () => ({
  useMyBlocks: () => ({ data: h.blocks }),
  useBlockUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUnblockUser: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => h.online }));

vi.mock("@/lib/notifications/useNotifications", () => ({
  useNotificationPreferences: () => ({ data: h.prefs }),
}));

vi.mock("@/lib/chat/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/attachments")>();
  return {
    ...actual,
    usePrefetchAttachmentUrls: () => undefined,
    useAttachmentUrl: () => ({ data: undefined, isSuccess: false }),
  };
});

// happy-dom nie ma `MediaRecorder`, więc prawdziwy `useVoiceRecorder` zgłosiłby
// brak wsparcia i kompozytor NIE wyrenderowałby mikrofonu - a to jego etykiety
// dowodzimy niżej.
vi.mock("@/lib/chat/voice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/voice")>()),
  useVoiceRecorder: () => h.recorder,
}));

vi.mock("sonner", () => ({ toast: h.toast }));

// `ChatAvatar` linkuje do profilu publicznego, a <Link> TanStacka wymaga routera.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ChatAppearanceDialog } from "../ChatAppearanceDialog";
import { ChatComposer, type ChatComposerProps } from "../ChatComposer";
import { ChatConfirmDialog, type ChatConfirmDialogProps } from "../ChatConfirmDialog";
import { ChatWindow, type ChatWindowProps } from "../ChatWindow";
import { MessageList, type MessageListProps } from "../MessageList";

const t = realT("pl");
const L = chatPl.chat;

/**
 * Jedyny ZAREJESTROWANY defekt tej powierzchni - `aria-prohibited-attr` na
 * stopce dymka (opis i dowód: `it.fails` na końcu pliku). Wyłączamy go
 * wyłącznie w audytach szerokich, żeby pilnowały CAŁEJ RESZTY zamiast raz po
 * raz powtarzać ten sam znany wynik. Gdy produkcja go naprawi, `it.fails`
 * zapali się na czerwono i ta stała znika razem z nim.
 */
const REGISTERED_BUBBLE_DEFECT: RuleObject = { "aria-prohibited-attr": { enabled: false } };

/** Naruszenia axe w poddrzewie - z czytelnym podsumowaniem w komunikacie. */
async function expectNoAxeViolations(
  container: Element,
  extraDisabled: RuleObject = {},
): Promise<void> {
  const violations = await axeViolations(container, extraDisabled);
  expect(violations, summarize(violations)).toEqual([]);
}

// --- render okna rozmowy ----------------------------------------------------

function renderWindow(overrides: Partial<ChatWindowProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatWindow conversationId={CHAT_IDS.conversation} variant="page" {...overrides} />
    </QueryClientProvider>,
  );
}

// --- render historii --------------------------------------------------------

const PEER_NAME = "Zofia Testowa";

function listProps(overrides: Partial<MessageListProps> = {}): MessageListProps {
  return {
    lang: "pl",
    myUserId: CHAT_IDS.me,
    messages: [],
    reactions: new Map<string, ReactionRow[]>(),
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

/** Trzy wiadomości: cudza, własna z odpowiedzią i cudza domykająca wątek. */
function threadMessages(): ChatMessage[] {
  return [
    chatMessage({ id: "m-1", body: "Dzień dobry, mamy komplet?", created_at: isoOffset(-30) }),
    chatMessage({
      id: "m-2",
      sender_id: CHAT_IDS.me,
      body: "Tak, przesyłam notatkę.",
      reply_to_id: "m-1",
      created_at: isoOffset(-20),
    }),
    chatMessage({ id: "m-3", body: "Dziękuję.", created_at: isoOffset(-10) }),
  ];
}

const REACTOR_PROFILES: ReadonlyMap<string, { display_name: string; avatar_url: string | null }> =
  new Map([
    [CHAT_IDS.me, { display_name: "Ja", avatar_url: null }],
    [CHAT_IDS.peer, { display_name: PEER_NAME, avatar_url: null }],
  ]);

// --- render kompozytora -----------------------------------------------------

function composerProps(overrides: Partial<ChatComposerProps> = {}): ChatComposerProps {
  return {
    conversationId: CHAT_IDS.conversation,
    lang: "pl",
    replyTo: null,
    replyToAuthor: null,
    editing: null,
    onClearReply: vi.fn(),
    onSend: vi.fn(),
    onSaveEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onTyping: vi.fn(),
    ...overrides,
  };
}

function textarea(): HTMLTextAreaElement {
  const el = document.querySelector("textarea");
  if (!el) throw new Error("test: kompozytor nie renderuje pola treści");
  return el;
}

/** Przycisk o zadanej dostępnej nazwie - ze strażnikiem typu zamiast rzutowania. */
function buttonNamed(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** Ikona wewnątrz przycisku ikonowego (jedyne dziecko `<svg>`). */
function iconOf(button: HTMLElement): SVGElement {
  const icon = button.querySelector("svg");
  if (!icon) throw new Error(`test: przycisk "${button.getAttribute("aria-label")}" nie ma ikony`);
  return icon;
}

// --- render dialogu potwierdzenia -------------------------------------------

const OUTSIDE_LABEL = "przycisk poza dialogiem";

function confirmProps(overrides: Partial<ChatConfirmDialogProps> = {}): ChatConfirmDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    title: L.menu.clear,
    description: L.menu.clearConfirm,
    confirmLabel: L.menu.clear,
    cancelLabel: L.close,
    onConfirm: vi.fn(),
    ...overrides,
  };
}

/**
 * Dialog RAZEM z rodzeństwem poza nim - bez elementu na zewnątrz nie da się
 * dowieść, że pułapka fokusu cokolwiek łapie.
 */
function renderConfirm(overrides: Partial<ChatConfirmDialogProps> = {}) {
  const props = confirmProps(overrides);
  const utils = render(
    <div>
      <button type="button">{OUTSIDE_LABEL}</button>
      <ChatConfirmDialog {...props} />
    </div>,
  );
  return { ...utils, props };
}

function alertDialog(): HTMLElement {
  return screen.getByRole("alertdialog");
}

/**
 * Przycisk poza dialogiem. Nie da się go znaleźć po roli, bo Radix przykrywa
 * tło `aria-hidden` - i to jest właśnie dowód, że tło zniknęło z drzewa
 * dostępności.
 */
function outsideButton(): HTMLElement {
  return screen.getByText(OUTSIDE_LABEL);
}

/** Tekst elementu wskazanego atrybutem (`aria-labelledby` / `aria-describedby`). */
function textOfReferenced(element: Element, attribute: string): string {
  const id = element.getAttribute(attribute);
  if (!id) throw new Error(`test: dialog nie ma atrybutu ${attribute}`);
  const target = element.ownerDocument.getElementById(id);
  if (!target) throw new Error(`test: ${attribute} wskazuje na nieistniejący element "${id}"`);
  return target.textContent ?? "";
}

// --- motywy: rozwiązywanie zmiennych CSS z PRAWDZIWEGO arkusza --------------

/** Zmienne, bez których dymek własnej wiadomości traci tło albo kolor tekstu. */
const BUBBLE_VARS = ["--chat-user-from", "--chat-user-to", "--chat-user-foreground"] as const;

interface CustomPropertyRule {
  readonly selectors: ReadonlyArray<string>;
  readonly values: ReadonlyMap<string, string>;
}

/**
 * Reguły arkusza deklarujące zmienne dymka. Świadomie MINIMALNY parser: bierze
 * wyłącznie reguły najwyższego poziomu (`:root`, `.light`, `.dark`,
 * `.chat-theme-*`) i pomija bloki `@media`/`@layer`, bo tam żadna z tych trzech
 * zmiennych nie mieszka. Alternatywą byłby `getComputedStyle` happy-doma, ale
 * ten nie kaskaduje własności niestandardowych, więc milczałby na KAŻDYM
 * brakującym tokenie - czyli dowodziłby dokładnie odwrotności tezy.
 */
function parseBubbleVariableRules(css: string): CustomPropertyRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CustomPropertyRule[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  let prelude = "";
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === "{") {
      if (depth === 0) {
        prelude = clean.slice(preludeStart, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        const body = clean.slice(bodyStart, i);
        if (!prelude.startsWith("@")) {
          const values = new Map<string, string>();
          for (const declaration of body.split(";")) {
            const colon = declaration.indexOf(":");
            if (colon < 0) continue;
            const property = declaration.slice(0, colon).trim();
            if (!BUBBLE_VARS.some((name) => name === property)) continue;
            values.set(property, declaration.slice(colon + 1).trim());
          }
          if (values.size > 0) {
            rules.push({
              selectors: prelude.split(",").map((selector) => selector.trim()),
              values,
            });
          }
        }
        preludeStart = i + 1;
      }
    }
  }
  return rules;
}

// Arkusz czytamy z dysku, bo to on jest źródłem prawdy o motywach (komponent
// nigdy nie widzi tych wartości - dokleja wyłącznie klasę). Vitest startuje
// z korzenia repozytorium.
const BUBBLE_RULES = parseBubbleVariableRules(
  readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8"),
);

/** `:root` w happy-domie bywa nieobsługiwany w `matches` - rozstrzygamy wprost. */
function matchesSelector(element: Element, selector: string): boolean {
  if (selector === ":root") return element === element.ownerDocument.documentElement;
  return element.matches(selector);
}

/**
 * Wartość zmiennej widziana przez element: własności niestandardowe dziedziczą,
 * więc wygrywa najbliższy przodek (włącznie z elementem), a w obrębie jednego
 * elementu - reguła późniejsza w arkuszu.
 */
function resolveBubbleVariable(element: Element, property: string): string | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    let value: string | null = null;
    for (const rule of BUBBLE_RULES) {
      const candidate = rule.values.get(property);
      if (candidate === undefined) continue;
      if (rule.selectors.some((selector) => matchesSelector(node, selector))) value = candidate;
    }
    if (value !== null) return value;
  }
  return null;
}

const UA_HIDDEN_STYLE_ID = "test-ua-hidden";

/**
 * Kawałek arkusza PRZEGLĄDARKI, którego happy-dom nie ma: `[hidden]` nie
 * dostaje `display: none`, więc ukryte pole pliku kompozytora zostaje w drzewie
 * dostępności i axe zgłasza je jako pole bez etykiety. To artefakt środowiska,
 * nie defekt produktu - każda przeglądarka wyklucza `[hidden]` z drzewa - więc
 * przywracamy regułę zamiast wyłączać sprawdzenie `label` (które ma tu pilnować
 * pola treści).
 */
function uaHiddenStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.id = UA_HIDDEN_STYLE_ID;
  style.textContent = "[hidden] { display: none; }";
  return style;
}

beforeEach(() => {
  h.views = [conversationView()];
  h.peers = peerProfileMap();
  h.nicknames = new Map();
  h.blocks = new Set();
  h.online = new Set();
  h.prefs = { typing_indicators_enabled: true, auto_mark_on_open: true };
  h.messages = threadMessages();
  h.typingUserIds = new Set();
  h.toast.error.mockReset();
  h.toast.success.mockReset();
  h.sendTyping.mockReset();
  h.recorder.state = "idle";
  h.recorder.supported = true;
  // happy-dom nie implementuje przewijania - lista wiadomości woła je przy
  // każdym renderze.
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => undefined);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);
  // Wersje robocze kompozytora żyją w pamięci modułu, nie tylko w localStorage -
  // bez tego tekst wpisany w jednym teście wraca w następnym i chowa mikrofon.
  __resetDraftsForTests();
  localStorage.clear();
  document.head.appendChild(uaHiddenStyle());
});

afterEach(() => {
  cleanup();
  document.getElementById(UA_HIDDEN_STYLE_ID)?.remove();
});

describe("ChatWindow - audyt axe całego okna", () => {
  it("wątek bezpośredni (wariant page) nie ma naruszeń axe", async () => {
    const { container } = renderWindow();
    // Strażnik pustego audytu: okno naprawdę wyrenderowało nagłówek, historię
    // i kompozytor, więc axe ma co sprawdzać.
    expect(screen.getByRole("log")).toBeTruthy();
    expect(screen.getByRole("button", { name: L.menu.title })).toBeTruthy();
    expect(screen.getByLabelText(L.inputPlaceholder)).toBeTruthy();
    await expectNoAxeViolations(container, REGISTERED_BUBBLE_DEFECT);
  });

  it("okno dokowane jest dialogiem z nazwą i też nie ma naruszeń axe", async () => {
    const { container } = renderWindow({ variant: "dock", onClose: vi.fn(), onMinimize: vi.fn() });
    // Dialog BEZ dostępnej nazwy jest dla czytnika bezimiennym pudełkiem -
    // przy kilku oknach w doku nie da się rozpoznać, w którym się jest.
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain(L.title);
    await expectNoAxeViolations(container, REGISTERED_BUBBLE_DEFECT);
  });
});

describe("MessageList - audyt axe historii", () => {
  it("historia z reakcjami i wskaźnikiem pisania nie ma naruszeń axe", async () => {
    const { container } = render(
      <MessageList
        {...listProps({
          messages: threadMessages(),
          reactions: new Map<string, ReactionRow[]>([
            [
              "m-2",
              [
                reactionRow({ id: "r-1", message_id: "m-2", user_id: CHAT_IDS.peer, emoji: "👍" }),
                reactionRow({ id: "r-2", message_id: "m-2", user_id: CHAT_IDS.me, emoji: "🎉" }),
              ],
            ],
          ]),
          reactorProfiles: REACTOR_PROFILES,
          peerTyping: true,
          typingNames: [PEER_NAME],
          peerLastReadAt: isoOffset(-5),
        })}
      />,
    );

    // Bez tych trzech asercji audyt mógłby przejść na PUSTYM poddrzewie.
    expect(screen.getAllByText(/Dzień dobry|Dziękuję/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(`${PEER_NAME} ${L.typing}`)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /👍|🎉/ }).length).toBeGreaterThan(0);

    await expectNoAxeViolations(container, REGISTERED_BUBBLE_DEFECT);
  });

  it("krąg z podpisami nadawców też nie ma naruszeń axe", async () => {
    const profiles: ReadonlyMap<string, PeerProfile> = new Map([
      [CHAT_IDS.peer, peerProfile({ id: CHAT_IDS.peer, display_name: PEER_NAME })],
    ]);
    const { container } = render(
      <MessageList
        {...listProps({
          isGroup: true,
          senderProfiles: profiles,
          messages: threadMessages(),
          firstUnreadId: "m-3",
          unreadCount: 2,
          ttlSeconds: 86400,
          hasOlder: true,
        })}
      />,
    );
    expect(screen.getByText(t("chat.unreadDivider", { count: 2 }))).toBeTruthy();
    await expectNoAxeViolations(container, REGISTERED_BUBBLE_DEFECT);
  });
});

describe("MessageList - dziennik ogłaszany na żywo", () => {
  it("nowa wiadomość ląduje W obszarze `aria-live`, a nie obok niego", () => {
    const props = listProps({ messages: [chatMessage({ id: "m-1", body: "Pierwsza" })] });
    const { rerender } = render(<MessageList {...props} />);
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.getAttribute("aria-label")).toBe(L.messages);

    rerender(
      <MessageList
        {...props}
        messages={[
          chatMessage({ id: "m-1", body: "Pierwsza" }),
          chatMessage({
            id: "m-2",
            body: "Druga - ta ma zostać ogłoszona",
            created_at: isoOffset(1),
          }),
        ]}
      />,
    );

    // Sam atrybut `aria-live` nic nie ogłasza, jeśli nowa treść dopisuje się
    // POZA tym obszarem (np. do drugiego kontenera pod listą).
    const announced = screen.getByText("Druga - ta ma zostać ogłoszona");
    expect(log.contains(announced)).toBe(true);
    expect(screen.getAllByRole("log")).toHaveLength(1);
  });

  it("wskaźnik pisania NIE jest ogłaszany jako wiadomość - ma tylko etykietę", () => {
    render(<MessageList {...listProps({ messages: threadMessages(), peerTyping: true })} />);
    const indicator = screen.getByLabelText(`${PEER_NAME} ${L.typing}`);
    // Trzy animowane kropki bez `aria-hidden` czytnik przeczytałby jako trzy
    // puste elementy przy KAŻDYM naciśnięciu klawisza przez rozmówcę.
    const dots = indicator.querySelectorAll(".chat-typing-dot");
    expect(dots).toHaveLength(3);
    for (const dot of dots) expect(dot.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("MessageBubble - zarejestrowany defekt potwierdzeń doręczenia", () => {
  /** Własna wiadomość doręczona rozmówcy - stopka rysuje wtedy ptaszek. */
  function renderDelivered() {
    return render(
      <MessageList
        {...listProps({
          messages: [
            chatMessage({
              id: "m-1",
              sender_id: CHAT_IDS.me,
              body: "Notatka poszła.",
              created_at: isoOffset(-10),
            }),
          ],
          peerLastDeliveredAt: isoOffset(-5),
        })}
      />,
    );
  }

  // Towarzysz `it.fails`. `it.fails` zielenieje po KAŻDYM wyjątku, więc sam
  // nie odróżnia „axe zgłasza naruszenie" od „render się wysypał". Ten test
  // odcina alternatywę: stopka JEST, niesie etykietę ze słownika, a jej ikona
  // jest zasłonięta - czyli cała informacja o doręczeniu wisi na tym jednym
  // `aria-label`.
  it("potwierdzenie doręczenia renderuje się z etykietą, a ikona jest `aria-hidden`", () => {
    renderDelivered();
    const receipt = screen.getByLabelText(L.receipt.delivered);
    expect(receipt.tagName).toBe("SPAN");
    // Brak roli = rola generyczna, a ta nie przyjmuje `aria-label`.
    expect(receipt.getAttribute("role")).toBeNull();
    expect(receipt.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  // DEFEKT PRODUKCYJNY (`MessageBubble.tsx`, `metaLine` - stopka dymka).
  // REGUŁA AXE: `aria-prohibited-attr` (poważna).
  // ZŁAMANY KONTRAKT: potwierdzenie doręczenia/odczytu to `<span>` bez roli
  // (rola generyczna), któremu nadano `aria-label`. ARIA zakazuje `aria-label`
  // na roli generycznej, więc czytniki ekranu tę etykietę IGNORUJĄ - a ikona
  // w środku jest `aria-hidden`. Efekt: użytkownik czytnika nie ma ŻADNEGO
  // sposobu, żeby dowiedzieć się, czy wiadomość została wysłana, doręczona
  // czy przeczytana; widzący użytkownik ma tę informację przy każdym dymku.
  // OCZEKIWANY KONTRAKT: stopka niesie stan doręczenia dostępnie - element
  // z rolą przyjmującą nazwę (np. `role="img"` albo `role="status"`) lub tekst
  // dla czytnika zamiast samego `aria-label` na generycznym spanie.
  // Naprawa to zmiana produkcji, więc zostaje tu jako udokumentowana porażka.
  it.fails(
    "stopka dymka łamie `aria-prohibited-attr` - stan doręczenia jest nieczytelny",
    async () => {
      const { container } = renderDelivered();
      const violations = await axeViolations(container);
      expect(summarize(violations)).toBe("");
    },
  );
});

describe("ChatComposer - audyt axe i etykiety przycisków", () => {
  it("pusty kompozytor (mikrofon) nie ma naruszeń axe", async () => {
    const { container } = render(<ChatComposer {...composerProps()} />);
    await expectNoAxeViolations(container);
  });

  it("kompozytor z tekstem i paskiem cytatu nie ma naruszeń axe", async () => {
    const { container } = render(
      <ChatComposer
        {...composerProps({
          replyTo: chatMessage({ id: "m-1", body: "Cytowana treść" }),
          replyToAuthor: PEER_NAME,
        })}
      />,
    );
    fireEvent.change(textarea(), { target: { value: "Odpowiedź" } });
    await expectNoAxeViolations(container);
  });

  it("mikrofon, załącznik i emotka mają nazwę Z KLUCZA i18n oraz ikonę `aria-hidden`", () => {
    render(<ChatComposer {...composerProps()} />);

    for (const label of [L.voice.record, L.attach, L.emoji]) {
      const button = buttonNamed(label);
      // Nazwa musi POCHODZIĆ ze słownika, a nie z literału w komponencie.
      expect(button.getAttribute("aria-label")).toBe(label);
      expect(iconOf(button).getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("wysyłka przejmuje miejsce mikrofonu z własną nazwą i ukrytą ikoną", () => {
    render(<ChatComposer {...composerProps()} />);
    fireEvent.change(textarea(), { target: { value: "Treść" } });

    const send = buttonNamed(L.send);
    expect(send.getAttribute("aria-label")).toBe(L.send);
    expect(iconOf(send).getAttribute("aria-hidden")).toBe("true");
    // Mikrofon i wysyłka to JEDEN slot - dwie nazwy naraz myliłyby czytnik.
    expect(screen.queryByRole("button", { name: L.voice.record })).toBeNull();
  });

  it("pole treści ma etykietę, a nie sam placeholder", () => {
    render(<ChatComposer {...composerProps()} />);
    // Placeholder znika po pierwszym znaku - czytnik zostałby bez nazwy pola.
    expect(textarea().getAttribute("aria-label")).toBe(L.inputPlaceholder);
  });

  it("szybka emotka niesie nazwę opisową, a znak jest `aria-hidden`", () => {
    render(<ChatComposer {...composerProps({ quickEmoji: "🔥" })} />);
    const quick = buttonNamed(t("chat.quickEmojiSend", { emoji: "🔥" }));
    const glyph = quick.querySelector("span");
    // Sama emotka jako nazwa („🔥") nie mówi, że przycisk WYSYŁA wiadomość.
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ChatConfirmDialog - axe, pułapka fokusu i wyjście", () => {
  it("potwierdzenie nieodwracalnej akcji nie ma naruszeń axe", async () => {
    renderConfirm();
    await expectNoAxeViolations(alertDialog());
  });

  it("dialog ma dostępną nazwę i opis wskazane przez `aria-labelledby`/`aria-describedby`", () => {
    renderConfirm();
    const dialog = alertDialog();
    // Same napisy w środku nie wystarczą: czytnik po otwarciu czyta TO, na co
    // wskazują atrybuty. Bez nich użytkownik słyszy „okno dialogowe" i dwa
    // przyciski, nie wiedząc, co potwierdza.
    expect(textOfReferenced(dialog, "aria-labelledby")).toBe(L.menu.clear);
    expect(textOfReferenced(dialog, "aria-describedby")).toBe(L.menu.clearConfirm);
  });

  it("fokus startuje WEWNĄTRZ dialogu, a nie na tle", () => {
    renderConfirm();
    expect(alertDialog().contains(document.activeElement)).toBe(true);
  });

  it("tło dialogu znika z drzewa dostępności", () => {
    renderConfirm();
    // Bez tego czytnik nadal przemierza całą stronę pod dialogiem, jakby nic
    // się nie otworzyło.
    expect(outsideButton().closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: OUTSIDE_LABEL })).toBeNull();
  });

  it("Tab nie wyprowadza fokusu poza dialog (pętla po elementach dialogu)", () => {
    renderConfirm();
    const dialog = alertDialog();
    const outside = outsideButton();
    const focusable = within(dialog).getAllByRole("button");
    expect(focusable.length).toBeGreaterThan(1);

    // Z OSTATNIEGO elementu Tab musi ZAWINĄĆ na początek dialogu, a nie zejść
    // na przycisk pod spodem - inaczej użytkownik klawiatury potwierdza akcję
    // nieodwracalną na ślepo, bo fokus siedzi poza widocznym dialogiem.
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(outside);

    // Shift+Tab z pierwszego elementu - ta sama pętla w drugą stronę.
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Escape zamyka dialog BEZ potwierdzania akcji", () => {
    const { props } = renderConfirm();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});

describe("ChatAppearanceDialog - audyt axe", () => {
  it("dialog personalizacji rozmowy nie ma naruszeń axe", async () => {
    h.peers = new Map([
      [CHAT_IDS.me, peerProfile({ id: CHAT_IDS.me, display_name: "Ja Testowy" })],
      [CHAT_IDS.peer, peerProfile({ id: CHAT_IDS.peer, display_name: PEER_NAME })],
    ]);
    render(<ChatAppearanceDialog view={conversationView()} open onClose={vi.fn()} />);
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });
});

describe("motywy rozmowy - komplet zmiennych CSS dymka NA RENDERZE", () => {
  /** Próbka motywu w dialogu wyglądu - element, który NOSI klasę motywu. */
  function themeSwatch(themeId: string): HTMLElement {
    const group = screen.getByRole("radiogroup", { name: L.appearance.themeSection });
    const radio = within(group).getByRole("radio", { name: t(themeLabelKey(themeId)) });
    const swatch = radio.querySelector<HTMLElement>('span[style*="linear-gradient"]');
    if (!swatch) throw new Error(`test: motyw "${themeId}" nie wyrenderował próbki gradientu`);
    return swatch;
  }

  beforeEach(() => {
    render(<ChatAppearanceDialog view={conversationView()} open onClose={vi.fn()} />);
  });

  it("arkusz w ogóle deklaruje zmienne dymka (strażnik parsera)", () => {
    // Gdyby parser nic nie znalazł, wszystkie asercje niżej byłyby puste.
    expect(BUBBLE_RULES.length).toBeGreaterThan(CHAT_THEMES.length);
    for (const name of BUBBLE_VARS) {
      expect(BUBBLE_RULES.some((rule) => rule.values.has(name))).toBe(true);
    }
  });

  it("KAŻDY motyw z katalogu ma komplet zmiennych - brak którejkolwiek to biały tekst na białym tle", () => {
    for (const themeId of CHAT_THEMES) {
      const swatch = themeSwatch(themeId);
      for (const name of BUBBLE_VARS) {
        const value = resolveBubbleVariable(swatch, name);
        expect(value, `motyw "${themeId}" nie rozwiązuje ${name}`).toBeTruthy();
      }
    }
  });

  it("klasa motywu faktycznie dociera do DOM - każdy motyw przebarwia dymek inaczej", () => {
    const stops = new Map<string, string>();
    for (const themeId of CHAT_THEMES) {
      const swatch = themeSwatch(themeId);
      const to = resolveBubbleVariable(swatch, "--chat-user-to");
      if (!to) throw new Error(`test: motyw "${themeId}" nie rozwiązuje --chat-user-to`);
      stops.set(themeId, to);
    }
    // Dwa motywy o tym samym ciemnym stopniu gradientu = jeden z nich nie
    // dostał swojej klasy i cicho pokazuje barwy poprzedniego.
    expect(new Set(stops.values()).size).toBe(CHAT_THEMES.length);
  });
});
