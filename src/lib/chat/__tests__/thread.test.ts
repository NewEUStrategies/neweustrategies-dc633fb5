// Czysta logika wątku rozmowy. Testujemy REGUŁY WIDOCZNE DLA UŻYTKOWNIKA,
// które do tej pory mieszkały w `useMemo`-ach organizmu na 0% pokrycia:
// kolejność wiadomości, deduplikacja bliźniaka optymistycznego, odsiew
// wygasłych, miejsce separatora „nieprzeczytane", budżet skoku i pierwszeństwo
// pseudonimu nad nazwą profilu.
import { describe, expect, it } from "vitest";
import {
  addTyper,
  attachmentPathsOf,
  buildReactorProfiles,
  canShowTyping,
  compareByCreatedAtThenId,
  countOnline,
  firstUnreadMessageId,
  headerSubtitle,
  JUMP_PAGE_BUDGET,
  needsUnreadSnapshot,
  nextJumpStep,
  orderThreadMessages,
  removeTyper,
  resolveAuthorName,
  sendErrorMessageKey,
  typingDisplay,
  type UnreadSnapshot,
} from "../thread";
import type { MessagesPage } from "../messageCache";
import { BASE_ISO, CHAT_IDS, chatMessage, isoOffset } from "@/test/chat/fixtures";

/** Strona historii w konwencji warstwy danych: NAJNOWSZE PIERWSZE. */
function page(rows: ReturnType<typeof chatMessage>[]): MessagesPage {
  return { rows, nextCursor: null };
}

const NOW_MS = new Date(isoOffset(60)).getTime();

describe("orderThreadMessages", () => {
  it("spłaszcza strony do porządku od najstarszej do najnowszej", () => {
    const pages = [
      // Strona 0 = najnowsza (tak zwraca zapytanie: created_at desc).
      page([chatMessage({ id: "m3", created_at: isoOffset(3) })]),
      page([
        chatMessage({ id: "m2", created_at: isoOffset(2) }),
        chatMessage({ id: "m1", created_at: isoOffset(1) }),
      ]),
    ];
    expect(orderThreadMessages(pages, NOW_MS).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("zwraca pustą listę dla braku stron (wątek jeszcze się nie wczytał)", () => {
    expect(orderThreadMessages(undefined, NOW_MS)).toEqual([]);
    expect(orderThreadMessages([], NOW_MS)).toEqual([]);
  });

  it("odsiewa wiadomości wygasłe po TTL (lustro filtra RLS)", () => {
    const pages = [
      page([
        chatMessage({ id: "live", created_at: isoOffset(2), expires_at: isoOffset(120) }),
        chatMessage({ id: "gone", created_at: isoOffset(1), expires_at: isoOffset(30) }),
      ]),
    ];
    expect(orderThreadMessages(pages, NOW_MS).map((m) => m.id)).toEqual(["live"]);
  });

  it("traktuje moment wygaśnięcia jako JUŻ wygasły (>= now, nie >)", () => {
    const pages = [page([chatMessage({ id: "edge", expires_at: new Date(NOW_MS).toISOString() })])];
    expect(orderThreadMessages(pages, NOW_MS)).toEqual([]);
  });

  it("deduplikuje po id i zachowuje wersję z NAJNOWSZEJ strony", () => {
    // Wiersz optymistyczny i jego bliźniak z realtime mogą przez jedną klatkę
    // współistnieć w dwóch stronach cache'u. Wygrywa strona najnowsza, bo tam
    // ląduje wersja serwerowa.
    const pages = [
      page([chatMessage({ id: "dup", body: "serwer", pending: false })]),
      page([chatMessage({ id: "dup", body: "optymistyczna", pending: true })]),
    ];
    const result = orderThreadMessages(pages, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0]?.body).toBe("serwer");
    expect(result[0]?.pending).toBe(false);
  });

  it("rozstrzyga remis identycznych znaczników czasu po id - stabilnie", () => {
    const pages = [
      page([
        chatMessage({ id: "b", created_at: BASE_ISO }),
        chatMessage({ id: "a", created_at: BASE_ISO }),
        chatMessage({ id: "c", created_at: BASE_ISO }),
      ]),
    ];
    expect(orderThreadMessages(pages, NOW_MS).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("porządkuje wiadomości spóźnione (realtime out-of-order) po czasie, nie po miejscu w cache", () => {
    const pages = [
      page([
        chatMessage({ id: "late", created_at: isoOffset(1) }),
        chatMessage({ id: "newer", created_at: isoOffset(5) }),
      ]),
    ];
    expect(orderThreadMessages(pages, NOW_MS).map((m) => m.id)).toEqual(["late", "newer"]);
  });
});

describe("compareByCreatedAtThenId", () => {
  it("zwraca 0 dla tej samej wiadomości (kontrakt sortowania)", () => {
    const message = chatMessage({ id: "x" });
    expect(compareByCreatedAtThenId(message, message)).toBe(0);
  });

  it("porównuje leksykograficznie ISO-8601, nie przez Date", () => {
    const older = chatMessage({ id: "a", created_at: "2026-01-01T00:00:00.000Z" });
    const newer = chatMessage({ id: "b", created_at: "2026-12-31T23:59:59.000Z" });
    expect(compareByCreatedAtThenId(older, newer)).toBe(-1);
    expect(compareByCreatedAtThenId(newer, older)).toBe(1);
  });

  it("przy równych znacznikach rozstrzyga po id w obie strony", () => {
    const a = chatMessage({ id: "a", created_at: BASE_ISO });
    const b = chatMessage({ id: "b", created_at: BASE_ISO });
    expect(compareByCreatedAtThenId(a, b)).toBe(-1);
    expect(compareByCreatedAtThenId(b, a)).toBe(1);
  });
});

describe("needsUnreadSnapshot", () => {
  const snapshot: UnreadSnapshot = {
    conversationId: CHAT_IDS.conversation,
    count: 2,
    lastReadAt: BASE_ISO,
  };

  it("wymaga migawki, gdy jeszcze jej nie ma", () => {
    expect(needsUnreadSnapshot(null, CHAT_IDS.conversation)).toBe(true);
  });

  it("wymaga migawki po przełączeniu rozmowy bez remountu (dock)", () => {
    expect(needsUnreadSnapshot(snapshot, CHAT_IDS.otherConversation)).toBe(true);
  });

  it("NIE odświeża migawki tej samej rozmowy - inaczej separator zapadłby się do zera", () => {
    expect(needsUnreadSnapshot(snapshot, CHAT_IDS.conversation)).toBe(false);
  });
});

describe("firstUnreadMessageId", () => {
  const messages = [
    chatMessage({ id: "old-peer", sender_id: CHAT_IDS.peer, created_at: isoOffset(1) }),
    chatMessage({ id: "mine", sender_id: CHAT_IDS.me, created_at: isoOffset(5) }),
    chatMessage({ id: "new-peer", sender_id: CHAT_IDS.peer, created_at: isoOffset(6) }),
    chatMessage({ id: "newest-peer", sender_id: CHAT_IDS.peer, created_at: isoOffset(7) }),
  ];

  it("wskazuje pierwszą wiadomość rozmówcy nowszą niż odcięcie odczytu", () => {
    const snapshot: UnreadSnapshot = {
      conversationId: CHAT_IDS.conversation,
      count: 2,
      lastReadAt: isoOffset(5),
    };
    expect(firstUnreadMessageId(messages, CHAT_IDS.me, snapshot)).toBe("new-peer");
  });

  it("bez `lastReadAt` (wątek nigdy nieotwarty) wskazuje PIERWSZĄ wiadomość rozmówcy", () => {
    const snapshot: UnreadSnapshot = {
      conversationId: CHAT_IDS.conversation,
      count: 3,
      lastReadAt: null,
    };
    expect(firstUnreadMessageId(messages, CHAT_IDS.me, snapshot)).toBe("old-peer");
  });

  it("nigdy nie wskazuje własnej wiadomości - siebie się nie czyta", () => {
    const ownOnly = [chatMessage({ id: "mine", sender_id: CHAT_IDS.me, created_at: isoOffset(9) })];
    const snapshot: UnreadSnapshot = {
      conversationId: CHAT_IDS.conversation,
      count: 1,
      lastReadAt: null,
    };
    expect(firstUnreadMessageId(ownOnly, CHAT_IDS.me, snapshot)).toBeNull();
  });

  it("zwraca null dla licznika zero, braku migawki i braku sesji", () => {
    const zero: UnreadSnapshot = {
      conversationId: CHAT_IDS.conversation,
      count: 0,
      lastReadAt: null,
    };
    expect(firstUnreadMessageId(messages, CHAT_IDS.me, zero)).toBeNull();
    expect(firstUnreadMessageId(messages, CHAT_IDS.me, null)).toBeNull();
    expect(firstUnreadMessageId(messages, undefined, { ...zero, count: 5 })).toBeNull();
  });

  it("zwraca null, gdy wszystkie wiadomości rozmówcy są starsze od odcięcia", () => {
    const snapshot: UnreadSnapshot = {
      conversationId: CHAT_IDS.conversation,
      count: 4,
      lastReadAt: isoOffset(99),
    };
    expect(firstUnreadMessageId(messages, CHAT_IDS.me, snapshot)).toBeNull();
  });
});

describe("attachmentPathsOf", () => {
  it("zbiera ścieżki wyłącznie z żywych, potwierdzonych wiadomości", () => {
    const messages = [
      chatMessage({ id: "img", kind: "image", attachment_path: "t/c/u/a.png" }),
      chatMessage({ id: "file", kind: "file", attachment_path: "t/c/u/b.pdf" }),
      // Tombstone: trigger sprzątnął obiekt w storage, podpis by padł.
      chatMessage({
        id: "removed",
        kind: "image",
        attachment_path: "t/c/u/c.png",
        deleted_at: BASE_ISO,
      }),
      // Optymistyczna: jeszcze nie przeszła przez insert.
      chatMessage({ id: "pending", kind: "image", attachment_path: "t/c/u/d.png", pending: true }),
      chatMessage({ id: "text", kind: "text" }),
    ];
    expect(attachmentPathsOf(messages)).toEqual(["t/c/u/a.png", "t/c/u/b.pdf"]);
  });

  it("zwraca pustą listę dla wątku bez załączników", () => {
    expect(attachmentPathsOf([chatMessage({ id: "t" })])).toEqual([]);
  });
});

describe("rejestr piszących", () => {
  it("dodaje piszącego i ZACHOWUJE tożsamość zbioru przy powtórce", () => {
    const empty: ReadonlySet<string> = new Set();
    const withPeer = addTyper(empty, CHAT_IDS.peer);
    expect([...withPeer]).toEqual([CHAT_IDS.peer]);
    // Powtórny ping tej samej osoby nie może przerenderować listy wiadomości.
    expect(addTyper(withPeer, CHAT_IDS.peer)).toBe(withPeer);
  });

  it("gasi TYLKO tę osobę, która przestała pisać (semantyka kręgu)", () => {
    let typing: ReadonlySet<string> = new Set();
    typing = addTyper(typing, CHAT_IDS.peer);
    typing = addTyper(typing, CHAT_IDS.peerTwo);
    const after = removeTyper(typing, CHAT_IDS.peer);
    expect([...after]).toEqual([CHAT_IDS.peerTwo]);
  });

  it("zdjęcie nieobecnego piszącego zachowuje tożsamość zbioru", () => {
    const typing: ReadonlySet<string> = new Set([CHAT_IDS.peer]);
    expect(removeTyper(typing, CHAT_IDS.stranger)).toBe(typing);
  });
});

describe("typingDisplay", () => {
  const resolveName = (id: string) => (id === CHAT_IDS.peer ? "Anna" : "Marek");
  const resolveAvatarUrl = (id: string) => (id === CHAT_IDS.peer ? "anna.png" : "marek.png");

  it("wątek bezpośredni: zawsze nazwa i avatar z nagłówka", () => {
    const result = typingDisplay({
      typingUserIds: new Set([CHAT_IDS.peer]),
      isGroup: false,
      peerName: "Anna Nowak",
      peerAvatarUrl: "header.png",
      resolveName,
      resolveAvatarUrl,
    });
    expect(result).toEqual({ names: ["Anna Nowak"], avatarUrl: "header.png" });
  });

  it("krąg: nazwy wszystkich piszących i avatar pierwszego z nich", () => {
    const result = typingDisplay({
      typingUserIds: new Set([CHAT_IDS.peer, CHAT_IDS.peerTwo]),
      isGroup: true,
      peerName: "Krąg",
      peerAvatarUrl: null,
      resolveName,
      resolveAvatarUrl,
    });
    expect(result).toEqual({ names: ["Anna", "Marek"], avatarUrl: "anna.png" });
  });

  it("krąg bez piszących: brak nazw i brak avatara", () => {
    const result = typingDisplay({
      typingUserIds: new Set(),
      isGroup: true,
      peerName: "Krąg",
      peerAvatarUrl: null,
      resolveName,
      resolveAvatarUrl,
    });
    expect(result).toEqual({ names: [], avatarUrl: null });
  });
});

describe("canShowTyping", () => {
  it("nie pokazuje wskaźnika bez piszących", () => {
    expect(canShowTyping({ typingCount: 0, isGroup: false, peerId: CHAT_IDS.peer })).toBe(false);
  });

  it("w kręgu wystarczy sam ping - tożsamość rozstrzyga lista nazw", () => {
    expect(canShowTyping({ typingCount: 1, isGroup: true, peerId: null })).toBe(true);
  });

  it("w wątku bezpośrednim wymaga rozstrzygniętego rozmówcy", () => {
    expect(canShowTyping({ typingCount: 1, isGroup: false, peerId: null })).toBe(false);
    expect(canShowTyping({ typingCount: 1, isGroup: false, peerId: CHAT_IDS.peer })).toBe(true);
  });
});

describe("headerSubtitle", () => {
  it("krąg: liczy uczestników WRAZ z wołającym i tylko online rozmówców", () => {
    expect(
      headerSubtitle({
        isGroup: true,
        peerIds: [CHAT_IDS.peer, CHAT_IDS.peerTwo],
        onlineIds: new Set([CHAT_IDS.peer]),
        peerId: null,
      }),
    ).toEqual({ kind: "group", members: 3, online: 1 });
  });

  it("krąg bez nikogo online zwraca zero, nie pomija pola", () => {
    expect(
      headerSubtitle({
        isGroup: true,
        peerIds: [CHAT_IDS.peer],
        onlineIds: new Set(),
        peerId: null,
      }),
    ).toEqual({ kind: "group", members: 2, online: 0 });
  });

  it("wątek bezpośredni: presence rozmówcy", () => {
    expect(
      headerSubtitle({
        isGroup: false,
        peerIds: [CHAT_IDS.peer],
        onlineIds: new Set([CHAT_IDS.peer]),
        peerId: CHAT_IDS.peer,
      }),
    ).toEqual({ kind: "direct", online: true });
  });

  it("wątek bezpośredni bez rozstrzygniętego rozmówcy nie kłamie o obecności", () => {
    expect(
      headerSubtitle({
        isGroup: false,
        peerIds: [],
        onlineIds: new Set([CHAT_IDS.peer]),
        peerId: null,
      }),
    ).toEqual({ kind: "direct", online: false });
  });
});

describe("countOnline", () => {
  it("liczy przecięcie listy rozmówców ze zbiorem online", () => {
    expect(
      countOnline([CHAT_IDS.peer, CHAT_IDS.peerTwo, CHAT_IDS.stranger], new Set([CHAT_IDS.peer])),
    ).toBe(1);
    expect(countOnline([], new Set([CHAT_IDS.peer]))).toBe(0);
  });
});

describe("resolveAuthorName", () => {
  const base = {
    myUserId: CHAT_IDS.me,
    peerName: "Anna Nowak",
    youLabel: "Ty",
    nickname: null,
    profileName: null,
  };

  it("własna wiadomość to zawsze etykieta wołającego (Ty)", () => {
    expect(
      resolveAuthorName({ ...base, senderId: CHAT_IDS.me, isGroup: true, nickname: "Szef" }),
    ).toBe("Ty");
  });

  it("pseudonim bije nazwę profilu (semantyka Messengera)", () => {
    expect(
      resolveAuthorName({
        ...base,
        senderId: CHAT_IDS.peer,
        isGroup: true,
        nickname: "Ania z DG ENER",
        profileName: "Anna Nowak",
      }),
    ).toBe("Ania z DG ENER");
  });

  it("wątek bezpośredni bez pseudonimu bierze nazwę z nagłówka (bez migania placeholdera)", () => {
    expect(resolveAuthorName({ ...base, senderId: CHAT_IDS.peer, isGroup: false })).toBe(
      "Anna Nowak",
    );
  });

  it("krąg bez pseudonimu bierze nazwę profilu", () => {
    expect(
      resolveAuthorName({
        ...base,
        senderId: CHAT_IDS.peerTwo,
        isGroup: true,
        profileName: "Marek Kowalski",
      }),
    ).toBe("Marek Kowalski");
  });

  it("krąg bez pseudonimu i bez profilu spada na placeholder", () => {
    expect(resolveAuthorName({ ...base, senderId: CHAT_IDS.stranger, isGroup: true })).toBe("...");
    expect(
      resolveAuthorName({ ...base, senderId: CHAT_IDS.stranger, isGroup: true, fallback: "?" }),
    ).toBe("?");
  });
});

describe("nextJumpStep", () => {
  const base = {
    targetId: CHAT_IDS.message,
    targetLoaded: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    pagesLeft: JUMP_PAGE_BUDGET,
  };

  it("bez celu nic nie robi", () => {
    expect(nextJumpStep({ ...base, targetId: null })).toBe("idle");
  });

  it("cel w oknie kończy skok - przewinięcie należy do listy", () => {
    expect(nextJumpStep({ ...base, targetLoaded: true })).toBe("done");
  });

  it("cel w oknie wygrywa NAWET przy wyczerpanym budżecie", () => {
    expect(nextJumpStep({ ...base, targetLoaded: true, pagesLeft: 0 })).toBe("done");
  });

  it("dociąga kolejną stronę, gdy cel jest poza oknem", () => {
    expect(nextJumpStep(base)).toBe("fetch");
  });

  it("czeka na stronę w locie zamiast zamawiać drugą", () => {
    expect(nextJumpStep({ ...base, isFetchingNextPage: true })).toBe("wait");
  });

  it("koniec historii kończy skok porażką (np. wiadomość znikła po TTL)", () => {
    expect(nextJumpStep({ ...base, hasNextPage: false })).toBe("fail");
  });

  it("wyczerpany budżet kończy skok porażką - bez przewijania całej historii", () => {
    expect(nextJumpStep({ ...base, pagesLeft: 0 })).toBe("fail");
    expect(nextJumpStep({ ...base, pagesLeft: -1 })).toBe("fail");
  });

  it("budżet porażki wygrywa nad stroną w locie (brak pętli bez wyjścia)", () => {
    expect(nextJumpStep({ ...base, pagesLeft: 0, isFetchingNextPage: true })).toBe("fail");
  });
});

describe("sendErrorMessageKey", () => {
  it("tłumaczy trzy werdykty serwera, których dymek nie potrafi wyjaśnić", () => {
    expect(sendErrorMessageKey("chat: blocked")).toBe("chat.block.sendBlocked");
    expect(sendErrorMessageKey("recipient unavailable")).toBe("chat.recipientUnavailable");
    expect(sendErrorMessageKey("chat: rate limited")).toBe("chat.rateLimited");
    expect(sendErrorMessageKey("chat: upload rate limited")).toBe("chat.rateLimited");
  });

  it("dopasowuje FRAGMENT, bo PostgREST owija komunikat swoim kontekstem", () => {
    expect(
      sendErrorMessageKey('new row violates ... RAISE: chat: blocked (code P0001)'),
    ).toBe("chat.block.sendBlocked");
  });

  it("MILCZY dla pozostałych awarii - dymek sam sygnalizuje nieudaną wysyłkę", () => {
    expect(sendErrorMessageKey("network error")).toBeNull();
    expect(sendErrorMessageKey("")).toBeNull();
    expect(sendErrorMessageKey("permission denied for table messages")).toBeNull();
  });
});

describe("buildReactorProfiles", () => {
  const peers = new Map([
    [CHAT_IDS.peer, { display_name: "Anna Nowak", avatar_url: "anna.png" }],
    [CHAT_IDS.peerTwo, { display_name: null, avatar_url: null }],
  ]);

  it("mapuje profile rozmówców i normalizuje brak nazwy do pustego napisu", () => {
    const map = buildReactorProfiles({ peerProfiles: peers, me: null, youLabel: "Ty" });
    expect(map.get(CHAT_IDS.peer)).toEqual({ display_name: "Anna Nowak", avatar_url: "anna.png" });
    expect(map.get(CHAT_IDS.peerTwo)).toEqual({ display_name: "", avatar_url: null });
  });

  it("dokłada wpis własny - `get_chat_peers` zwraca tylko rozmówców", () => {
    const map = buildReactorProfiles({
      peerProfiles: peers,
      me: {
        id: CHAT_IDS.me,
        email: "ja@nes.eu",
        metadata: { display_name: "Jan Testowy", avatar_url: "ja.png" },
      },
      youLabel: "Ty",
    });
    expect(map.get(CHAT_IDS.me)).toEqual({ display_name: "Jan Testowy", avatar_url: "ja.png" });
  });

  it("schodzi po metadanych: display_name -> full_name -> name -> e-mail -> etykieta Ty", () => {
    const nameOf = (metadata: Record<string, unknown>, email: string | null = null) =>
      buildReactorProfiles({
        peerProfiles: undefined,
        me: { id: CHAT_IDS.me, email, metadata },
        youLabel: "Ty",
      }).get(CHAT_IDS.me)?.display_name;

    expect(nameOf({ full_name: "Pełne Imię" })).toBe("Pełne Imię");
    expect(nameOf({ name: "Imię" })).toBe("Imię");
    expect(nameOf({}, "ja@nes.eu")).toBe("ja@nes.eu");
    expect(nameOf({})).toBe("Ty");
    // Puste napisy w metadanych to brak wartości, nie wartość.
    expect(nameOf({ display_name: "", full_name: "", name: "" }, "ja@nes.eu")).toBe("ja@nes.eu");
  });

  it("odrzuca avatar, który nie jest niepustym napisem", () => {
    const avatarOf = (metadata: Record<string, unknown>) =>
      buildReactorProfiles({
        peerProfiles: undefined,
        me: { id: CHAT_IDS.me, metadata },
        youLabel: "Ty",
      }).get(CHAT_IDS.me)?.avatar_url;

    expect(avatarOf({ avatar_url: "" })).toBeNull();
    expect(avatarOf({ avatar_url: 42 })).toBeNull();
    expect(avatarOf({})).toBeNull();
  });

  it("radzi sobie bez profili rozmówców i bez metadanych sesji", () => {
    const map = buildReactorProfiles({
      peerProfiles: undefined,
      me: { id: CHAT_IDS.me, metadata: null },
      youLabel: "Ty",
    });
    expect(map.size).toBe(1);
    expect(map.get(CHAT_IDS.me)?.display_name).toBe("Ty");
  });
});
