// SZYNA ZMINIMALIZOWANYCH ROZMÓW - molekuła z ~11% pokrycia, przy czterech
// obietnicach, których nie pilnuje NIC innego w repozytorium:
//
//   1. BRAMKA MA BYĆ DARMOWA. `MinimizedChats` czyta wyłącznie synchroniczny
//      magazyn, a warstwa danych (`useConversations` + `usePeerProfiles`)
//      montuje się DOPIERO za bramką. Dotąd dowodził tego jedynie
//      `WorkspaceDock.test.tsx:381-387`, i to z zewnątrz (`.wd-pill` jest
//      `null`) - czyli mierzył brak pigułki, a nie brak dwóch zapytań.
//      To rozróżnienie jest całym uzasadnieniem podziału na dwa komponenty
//      (MinimizedChats.tsx:6-18), więc tutaj liczymy wywołania obu haków.
//   2. ZDJĘCIE NA ŻYWO BIJE ZAPAMIĘTANE. Magazyn zapisuje URL awatara w chwili
//      minimalizacji (sessionStorage), więc po zmianie zdjęcia przez rozmówcę
//      pigułka pokazywałaby wersję sprzed sesji. `liveAvatars` ma to nadpisać,
//      ale tylko wtedy, gdy lista rozmów naprawdę coś o tej rozmowie wie -
//      inaczej zapas musi przetrwać.
//   3. PRZYWRÓCENIE TO DWA RUCHY, ZAMKNIĘCIE JEDEN. Klik w pigułkę zdejmuje
//      rozmowę Z SZYNY i PROSI skrzynkę o jej otwarcie; klik w „x" tylko
//      zdejmuje. Pomylenie tych dwóch ścieżek daje albo rozmowę, której nie da
//      się zamknąć, albo skrzynkę otwierającą się bez powodu.
//   4. LICZBA MNOGA PRZY „+N". Limit widocznych pigułek to 2, więc NAJCZĘSTSZĄ
//      wartością `count` jest 1 - i to właśnie ta forma drukowała kiedyś
//      „Jeszcze 1 zminimalizowane rozmowy" (regresja opisana w słowniku,
//      i18n-dock.ts:38-42). Etykieta „+N" jest niewidoczna dla oka, więc
//      jedynym miejscem, gdzie ten napis żyje, jest nazwa dostępna.
//
// Atrapy: warstwa czatu jest mockowana modułowo (wzorzec z
// `WorkspaceDock.test.tsx:33-105`), magazyn `minimizedChats` zostaje PRAWDZIWY
// (jest synchroniczny i ma `reset()` „wyłącznie do testów"), a `conversationDisplay`
// też zostaje prawdziwe - to ono rozstrzyga, czy rozmowa ma zdjęcie na żywo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ConversationView, PeerProfile } from "@/lib/chat/types";
import "@/test/i18nReal";
import { dockPl } from "@/lib/i18n-dock";
import { axeViolations, summarize } from "@/test/axe";
import {
  CHAT_IDS,
  conversationView,
  groupConversationView,
  peerProfile,
  peerProfileMap,
} from "@/test/chat/fixtures";
import {
  MINIMIZED_VISIBLE_LIMIT,
  minimizedChatsStore,
  type MinimizedChat,
} from "@/lib/chat/minimizedChats";

interface Hoisted {
  /** `undefined` = zapytanie o listę rozmów jeszcze nie odpowiedziało. */
  views: ConversationView[] | undefined;
  peers: ReadonlyMap<string, PeerProfile> | undefined;
  prefetched: number;
  conversationsCalls: number;
  peerQueries: string[][];
}

const h = vi.hoisted((): Hoisted => ({
  views: [],
  peers: undefined,
  prefetched: 0,
  conversationsCalls: 0,
  peerQueries: [],
}));

// Oba haki liczą wywołania, bo to JEDYNY sposób udowodnienia punktu 1:
// „nie ma pigułki" i „nie ma zapytania" to dwa różne zdania.
vi.mock("@/lib/chat/useConversations", () => ({
  useConversations: () => {
    h.conversationsCalls += 1;
    return { data: h.views };
  },
  usePeerProfiles: (ids: ReadonlyArray<string>) => {
    h.peerQueries.push([...ids]);
    return { data: h.peers };
  },
}));

// Prawdziwy `ChatAvatar` ciągnie `useFaceAwarePosition` (FaceDetector) i router
// (opcjonalny `to`), a tutaj liczy się wyłącznie URL, który do niego trafia.
// `String(...)` zamiast `?? ""`, żeby odróżnić „profil bez zdjęcia" (pusty
// napis) od „brak danych na żywo" (`null`/`undefined`).
vi.mock("@/components/chat/ChatAvatar", () => ({
  ChatAvatar: ({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) => (
    <span data-testid="avatar" data-name={name} data-url={String(avatarUrl)} />
  ),
}));

vi.mock("@/components/chat/chatWindowChunk", () => ({
  prefetchChatWindow: () => void (h.prefetched += 1),
}));

import { MinimizedChats } from "../MinimizedChats";

const STORED_AVATAR = "/zapas.png";
const LIVE_AVATAR = "/na-zywo.png";

/** Nazwy zmyślone; „Anna Nowak" jest nazwą rozmówcy z fixture'ów czatu. */
const PEER_NAME = peerProfile().display_name;

function renderRail() {
  const onOpenInbox = vi.fn();
  // Świadomie BEZ `QueryClientProvider`: molekuła nie sięga po klienta React
  // Query ani bezpośrednio, ani przez bramkę - gdyby zaczęła, ten render ma
  // paść, a nie cicho przejść na podstawionym kliencie.
  const view = render(<MinimizedChats onOpenInbox={onOpenInbox} />);
  return { ...view, onOpenInbox };
}

/** Mutacje magazynu idą przez `useSyncExternalStore`, więc muszą być w `act`. */
function minimize(...chats: MinimizedChat[]): void {
  act(() => {
    for (const chat of chats) minimizedChatsStore.minimize(chat);
  });
}

/** Pigułka po nazwie dostępnej przycisku przywracania. */
function restoreButton(name: string): HTMLElement {
  return screen.getByLabelText(dockPl.dock.chat.restore.replace("{{name}}", name));
}

function overflowLabel(form: "one" | "few" | "many", count: number): string {
  const template =
    form === "one"
      ? dockPl.dock.chat.minimizedMore_one
      : form === "few"
        ? dockPl.dock.chat.minimizedMore_few
        : dockPl.dock.chat.minimizedMore_many;
  return template.replace("{{count}}", String(count));
}

beforeEach(() => {
  minimizedChatsStore.reset();
  h.views = [];
  h.peers = undefined;
  h.prefetched = 0;
  h.conversationsCalls = 0;
  h.peerQueries = [];
});

afterEach(() => {
  cleanup();
  minimizedChatsStore.reset();
  // Magazyn zapisuje się do `sessionStorage` i hydratuje raz na moduł - bez
  // tego stan przeciekłby do następnego pliku w tym samym workerze.
  window.sessionStorage.clear();
});

describe("bramka szyny", () => {
  it("pusta szyna nie rysuje nic I nie montuje warstwy danych", () => {
    const { container } = renderRail();

    expect(container.firstChild).toBeNull();
    // Sedno podziału na dwa komponenty: zero zapytań, nie „zapytania, których
    // wynik jest wyrzucany".
    expect(h.conversationsCalls).toBe(0);
    expect(h.peerQueries).toEqual([]);
  });

  it("pierwsza zminimalizowana rozmowa montuje warstwę danych i rysuje pigułkę", () => {
    renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME, avatarUrl: null });

    expect(restoreButton(PEER_NAME)).toBeTruthy();
    expect(within(restoreButton(PEER_NAME)).getByText(PEER_NAME)).toBeTruthy();
    expect(h.conversationsCalls).toBeGreaterThan(0);
  });

  it("zdjęcie ostatniej rozmowy z szyny zwija ją z powrotem do niczego", () => {
    const { container } = renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME });

    expect(container.querySelector(".wd-pill")).toBeTruthy();

    act(() => minimizedChatsStore.remove(CHAT_IDS.conversation));

    expect(container.firstChild).toBeNull();
  });

  it("profile rozmówców pobiera dla ZBIORU uczestników wszystkich rozmów, bez powtórzeń", () => {
    // `conv-1` i `conv-group` dzielą `user-peer`; zapytanie ma go widzieć raz,
    // inaczej klucz zapytania zmieniałby się przy każdej nowej rozmowie.
    h.views = [conversationView(), groupConversationView()];
    renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME });

    const lastQuery = h.peerQueries.at(-1);
    expect(lastQuery).toEqual([CHAT_IDS.peer, CHAT_IDS.peerTwo]);
  });
});

describe("przywracanie i zamykanie", () => {
  it("przywrócenie zdejmuje pigułkę, prosi skrzynkę o tę rozmowę i otwiera ją", () => {
    const { onOpenInbox } = renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME });

    fireEvent.click(restoreButton(PEER_NAME));

    const snapshot = minimizedChatsStore.getSnapshot();
    expect(snapshot.minimized).toEqual([]);
    expect(snapshot.requested).toBe(CHAT_IDS.conversation);
    expect(onOpenInbox).toHaveBeenCalledTimes(1);
  });

  it("zamknięcie zdejmuje pigułkę, ale NIE prosi o otwarcie rozmowy", () => {
    const { onOpenInbox } = renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME });

    fireEvent.click(screen.getByLabelText(dockPl.dock.chat.closeConversation));

    const snapshot = minimizedChatsStore.getSnapshot();
    expect(snapshot.minimized).toEqual([]);
    expect(snapshot.requested).toBeNull();
    expect(onOpenInbox).not.toHaveBeenCalled();
  });

  it("przywraca KLIKNIĘTĄ rozmowę, a nie pierwszą z brzegu", () => {
    renderRail();
    minimize(
      { id: CHAT_IDS.conversation, name: PEER_NAME },
      { id: CHAT_IDS.otherConversation, name: "Bartosz Mielnik" },
    );

    fireEvent.click(restoreButton(PEER_NAME));

    const snapshot = minimizedChatsStore.getSnapshot();
    expect(snapshot.requested).toBe(CHAT_IDS.conversation);
    expect(snapshot.minimized.map((chat) => chat.id)).toEqual([CHAT_IDS.otherConversation]);
    expect(screen.getByText("Bartosz Mielnik")).toBeTruthy();
  });

  it("rozgrzewa paczkę okna rozmowy NA ZAMIAR, zanim padnie klik", () => {
    renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME });
    const pill = restoreButton(PEER_NAME);

    expect(h.prefetched).toBe(0);

    // Trzy różne drogi do tej samej pigułki: mysz, dotyk i klawiatura.
    fireEvent.pointerEnter(pill);
    expect(h.prefetched).toBe(1);
    fireEvent.pointerDown(pill);
    expect(h.prefetched).toBe(2);
    fireEvent.focus(pill);
    expect(h.prefetched).toBe(3);
  });
});

describe("zdjęcie rozmówcy", () => {
  it("bierze zdjęcie z listy rozmów, nie z tego zapamiętanego przy minimalizacji", () => {
    h.views = [conversationView()];
    h.peers = peerProfileMap([peerProfile({ avatar_url: LIVE_AVATAR })]);
    renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME, avatarUrl: STORED_AVATAR });

    expect(screen.getByTestId("avatar").getAttribute("data-url")).toBe(LIVE_AVATAR);
  });

  it("bez wpisu na liście rozmów zostaje zapamiętany URL - to jest cała rola zapasu", () => {
    // Dwa różne „nie wiem": zapytanie jeszcze nie odpowiedziało (`undefined`)
    // i odpowiedziało, ale tej rozmowy na liście nie ma (pusta tablica).
    // W obu wypadkach szyna musi narysować pigułkę zamiast czekać na sieć.
    h.views = undefined;
    const first = renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME, avatarUrl: STORED_AVATAR });

    expect(screen.getByTestId("avatar").getAttribute("data-url")).toBe(STORED_AVATAR);
    expect(h.peerQueries.at(-1)).toEqual([]);
    first.unmount();

    h.views = [];
    renderRail();

    expect(screen.getByTestId("avatar").getAttribute("data-url")).toBe(STORED_AVATAR);
  });

  it("dopóki profile się nie wczytały, zapas też przeżywa", () => {
    // Rozmowa JEST na liście, ale mapa profili jest jeszcze pusta, więc
    // `conversationDisplay` zwraca `null` - a `null` ma oddać pole zapasowi.
    h.views = [conversationView()];
    h.peers = undefined;
    renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME, avatarUrl: STORED_AVATAR });

    expect(screen.getByTestId("avatar").getAttribute("data-url")).toBe(STORED_AVATAR);
  });

  it("profil BEZ zdjęcia gasi zapas - pigułka wraca do inicjału", () => {
    // Kolumna `avatar_url` trzyma pusty napis, nie `null`, więc żywa prawda
    // brzmi „ta osoba nie ma zdjęcia" i ma wygrać z wersją sprzed sesji.
    h.views = [conversationView()];
    h.peers = peerProfileMap([peerProfile({ avatar_url: "" })]);
    renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME, avatarUrl: STORED_AVATAR });

    expect(screen.getByTestId("avatar").getAttribute("data-url")).toBe("");
  });

  it("krąg nie ma zdjęcia na żywo, więc korzysta z zapasu", () => {
    h.views = [groupConversationView()];
    h.peers = peerProfileMap([peerProfile({ avatar_url: LIVE_AVATAR })]);
    renderRail();
    minimize({ id: CHAT_IDS.group, name: "Krąg energetyczny", avatarUrl: STORED_AVATAR });

    const avatar = screen.getByTestId("avatar");
    expect(avatar.getAttribute("data-name")).toBe("Krąg energetyczny");
    expect(avatar.getAttribute("data-url")).toBe(STORED_AVATAR);
  });

  it("nazwa pigułki pochodzi z magazynu, nie z listy rozmów", () => {
    // Świadomy kontrakt magazynu: zapamiętana nazwa pozwala narysować pigułkę
    // bez czekania na profile. Gdyby ktoś przepiął ją na `conversationDisplay`,
    // pusty cache dawałby „..." zamiast nazwiska.
    h.views = [conversationView()];
    h.peers = peerProfileMap([peerProfile({ display_name: "Iwona Grabska" })]);
    renderRail();
    minimize({ id: CHAT_IDS.conversation, name: PEER_NAME });

    expect(screen.getByText(PEER_NAME)).toBeTruthy();
    expect(screen.queryByText("Iwona Grabska")).toBeNull();
  });
});

describe("przepełnienie szyny", () => {
  it("pokazuje wprost tylko limit pigułek, resztę chowa pod „+N”", () => {
    renderRail();
    minimize(
      { id: "rozmowa-a", name: "Rafał Dębski" },
      { id: "rozmowa-b", name: "Lidia Ostoja" },
      { id: "rozmowa-c", name: "Bartosz Mielnik" },
      { id: "rozmowa-d", name: "Iwona Grabska" },
    );

    // Magazyn dokłada na początek, więc widoczne są DWIE ostatnio zminimalizowane.
    const visible = screen.getAllByTestId("avatar");
    expect(visible).toHaveLength(MINIMIZED_VISIBLE_LIMIT);
    expect(visible.map((node) => node.getAttribute("data-name"))).toEqual([
      "Iwona Grabska",
      "Bartosz Mielnik",
    ]);
    expect(screen.queryByText("Rafał Dębski")).toBeNull();
    expect(screen.getByText("+2")).toBeTruthy();
  });

  it("jedna ukryta rozmowa dostaje formę POJEDYNCZĄ, nie mnogą", () => {
    // Wartość najczęstsza - limit to 2, więc trzecia rozmowa daje count = 1.
    renderRail();
    minimize(
      { id: "rozmowa-a", name: "Rafał Dębski" },
      { id: "rozmowa-b", name: "Lidia Ostoja" },
      { id: "rozmowa-c", name: "Bartosz Mielnik" },
    );

    expect(screen.getByLabelText(overflowLabel("one", 1))).toBeTruthy();
  });

  it("dwie ukryte rozmowy dostają formę mnogą „few”", () => {
    renderRail();
    minimize(
      { id: "rozmowa-a", name: "Rafał Dębski" },
      { id: "rozmowa-b", name: "Lidia Ostoja" },
      { id: "rozmowa-c", name: "Bartosz Mielnik" },
      { id: "rozmowa-d", name: "Iwona Grabska" },
    );

    expect(screen.getByLabelText(overflowLabel("few", 2))).toBeTruthy();
  });

  it("pięć ukrytych rozmów dostaje formę mnogą „many”", () => {
    renderRail();
    minimize(
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `rozmowa-${index}`,
        name: `Rozmówca ${index}`,
      })),
    );

    expect(screen.getByLabelText(overflowLabel("many", 5))).toBeTruthy();
  });

  it("klik w „+N” otwiera skrzynkę i NIE rusza szyny", () => {
    const { onOpenInbox } = renderRail();
    minimize(
      { id: "rozmowa-a", name: "Rafał Dębski" },
      { id: "rozmowa-b", name: "Lidia Ostoja" },
      { id: "rozmowa-c", name: "Bartosz Mielnik" },
    );

    fireEvent.click(screen.getByLabelText(overflowLabel("one", 1)));

    expect(onOpenInbox).toHaveBeenCalledTimes(1);
    const snapshot = minimizedChatsStore.getSnapshot();
    expect(snapshot.minimized).toHaveLength(3);
    expect(snapshot.requested).toBeNull();
  });
});

describe("dostępność", () => {
  it("szyna z przepełnieniem nie ma naruszeń axe", async () => {
    h.views = [conversationView()];
    h.peers = peerProfileMap();
    const { container } = renderRail();
    minimize(
      { id: CHAT_IDS.conversation, name: PEER_NAME, avatarUrl: STORED_AVATAR },
      { id: CHAT_IDS.otherConversation, name: "Lidia Ostoja" },
      { id: CHAT_IDS.group, name: "Krąg energetyczny" },
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
