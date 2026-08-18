// Rozstrzyganie PREZENTACJI rozmowy - nazwa, avatar, slug, oraz agregacja
// potwierdzeń odczytu w kręgu. Plik miał 29% pokrycia, a niedobita część to
// dokładnie `aggregatePeerReadState`: funkcja, która decyduje, czy nadawca
// zobaczy „wyświetlone". Pomyłka w niej to albo zdradzony odczyt osoby, która
// wyłączyła potwierdzenia, albo dwa ptaszki, których nikt nie zasłużył.
import { describe, expect, it } from "vitest";
import { aggregatePeerReadState, conversationDisplay, isGroupView } from "../display";
import {
  BASE_ISO,
  CHAT_IDS,
  conversationView,
  groupConversationView,
  isoOffset,
  participantRow,
  peerProfile,
  peerProfileMap,
} from "@/test/chat/fixtures";

describe("isGroupView", () => {
  it("rozpoznaje krąg po `kind`, nie po liczbie uczestników", () => {
    expect(isGroupView(groupConversationView())).toBe(true);
    // Wątek bezpośredni z dwoma wierszami peerów (teoretycznie) to NADAL nie krąg.
    expect(
      isGroupView(
        conversationView({
          peers: [
            participantRow({ user_id: CHAT_IDS.peer }),
            participantRow({ user_id: CHAT_IDS.peerTwo }),
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe("conversationDisplay - wątek bezpośredni", () => {
  it("bierze nazwę, avatar i slug z profilu rozmówcy", () => {
    const display = conversationDisplay(conversationView(), peerProfileMap());
    expect(display).toEqual({
      isGroup: false,
      name: "Anna Nowak",
      avatarUrl: "",
      peerId: CHAT_IDS.peer,
      slug: "anna-nowak",
    });
  });

  it("pseudonim bije nazwę profilu", () => {
    const display = conversationDisplay(
      conversationView(),
      peerProfileMap(),
      "Krąg",
      new Map([[CHAT_IDS.peer, "Ania z DG ENER"]]),
    );
    expect(display.name).toBe("Ania z DG ENER");
    // Avatar i slug zostają z profilu - pseudonim zmienia tylko etykietę.
    expect(display.slug).toBe("anna-nowak");
  });

  it("bez wczytanego profilu pokazuje placeholder, ale ZNA id rozmówcy", () => {
    const display = conversationDisplay(conversationView(), undefined);
    expect(display.name).toBe("...");
    expect(display.avatarUrl).toBeNull();
    expect(display.slug).toBeNull();
    // Id musi być, inaczej blokada i kropka presence nie mają na czym stanąć.
    expect(display.peerId).toBe(CHAT_IDS.peer);
  });

  it("wątek bez żadnego wiersza rozmówcy nie wymyśla tożsamości", () => {
    const display = conversationDisplay(conversationView({ peers: [] }), peerProfileMap());
    expect(display.peerId).toBeNull();
    expect(display.name).toBe("...");
  });

  it("normalizuje brakujące pola profilu do nulli, nie do undefined", () => {
    const display = conversationDisplay(
      conversationView(),
      peerProfileMap([peerProfile({ avatar_url: "", slug: "" })]),
    );
    expect(display.avatarUrl).toBe("");
    expect(display.slug).toBe("");
  });
});

describe("conversationDisplay - krąg", () => {
  it("bierze tytuł kręgu i NIE pokazuje avatara ani slugu osoby", () => {
    const display = conversationDisplay(groupConversationView(), peerProfileMap(), "Krąg");
    expect(display).toEqual({
      isGroup: true,
      name: "Krąg energetyczny",
      avatarUrl: null,
      peerId: null,
      slug: null,
    });
  });

  it("puste i białoznakowe tytuły spadają na etykietę zastępczą", () => {
    for (const title of ["", "   ", null]) {
      const display = conversationDisplay(
        groupConversationView({ conversation: { title } }),
        peerProfileMap(),
        "Krąg",
      );
      expect(display.name).toBe("Krąg");
    }
  });

  it("pseudonimy nie zmieniają nazwy kręgu (dotyczą osób, nie wątku)", () => {
    const display = conversationDisplay(
      groupConversationView(),
      peerProfileMap(),
      "Krąg",
      new Map([[CHAT_IDS.peer, "Ania"]]),
    );
    expect(display.name).toBe("Krąg energetyczny");
  });
});

describe("aggregatePeerReadState - wątek bezpośredni", () => {
  it("przepisuje stan jedynego rozmówcy", () => {
    const view = conversationView({
      peers: [
        participantRow({
          user_id: CHAT_IDS.peer,
          last_read_at: isoOffset(5),
          last_delivered_at: isoOffset(3),
        }),
      ],
    });
    expect(aggregatePeerReadState(view)).toEqual({
      lastReadAt: isoOffset(5),
      lastDeliveredAt: isoOffset(3),
    });
  });

  it("rozmówca z wyłączonymi potwierdzeniami (wiersz-placeholder) daje null", () => {
    const view = conversationView({
      peers: [participantRow({ user_id: CHAT_IDS.peer })],
    });
    expect(aggregatePeerReadState(view)).toEqual({ lastReadAt: null, lastDeliveredAt: null });
  });

  it("wątek bez rozmówców daje null - dymek zatrzyma się na stanie wysłane", () => {
    expect(aggregatePeerReadState(conversationView({ peers: [] }))).toEqual({
      lastReadAt: null,
      lastDeliveredAt: null,
    });
  });
});

describe("aggregatePeerReadState - krąg (semantyka WhatsAppa)", () => {
  it("bierze NAJWCZEŚNIEJSZY znacznik - odczyt tylko, gdy przeczytali WSZYSCY", () => {
    const view = groupConversationView({
      peers: [
        participantRow({
          user_id: CHAT_IDS.peer,
          last_read_at: isoOffset(9),
          last_delivered_at: isoOffset(9),
        }),
        participantRow({
          user_id: CHAT_IDS.peerTwo,
          last_read_at: isoOffset(4),
          last_delivered_at: isoOffset(6),
        }),
      ],
    });
    expect(aggregatePeerReadState(view)).toEqual({
      lastReadAt: isoOffset(4),
      lastDeliveredAt: isoOffset(6),
    });
  });

  it("kolejność wierszy nie zmienia wyniku - liczy minimum, nie pierwszy wiersz", () => {
    const early = participantRow({
      user_id: CHAT_IDS.peer,
      last_read_at: isoOffset(2),
      last_delivered_at: isoOffset(2),
    });
    const late = participantRow({
      user_id: CHAT_IDS.peerTwo,
      last_read_at: isoOffset(8),
      last_delivered_at: isoOffset(8),
    });
    expect(aggregatePeerReadState(groupConversationView({ peers: [early, late] }))).toEqual(
      aggregatePeerReadState(groupConversationView({ peers: [late, early] })),
    );
  });

  it("JEDEN członek bez znacznika zeruje cały agregat (null dominuje)", () => {
    const view = groupConversationView({
      peers: [
        participantRow({
          user_id: CHAT_IDS.peer,
          last_read_at: BASE_ISO,
          last_delivered_at: BASE_ISO,
        }),
        // Ten wyłączył potwierdzenia - nie wolno twierdzić, że przeczytał.
        participantRow({ user_id: CHAT_IDS.peerTwo }),
      ],
    });
    expect(aggregatePeerReadState(view)).toEqual({ lastReadAt: null, lastDeliveredAt: null });
  });

  it("równe znaczniki zwracają tę samą wartość, nie null", () => {
    const view = groupConversationView({
      peers: [
        participantRow({
          user_id: CHAT_IDS.peer,
          last_read_at: BASE_ISO,
          last_delivered_at: BASE_ISO,
        }),
        participantRow({
          user_id: CHAT_IDS.peerTwo,
          last_read_at: BASE_ISO,
          last_delivered_at: BASE_ISO,
        }),
      ],
    });
    expect(aggregatePeerReadState(view)).toEqual({
      lastReadAt: BASE_ISO,
      lastDeliveredAt: BASE_ISO,
    });
  });
});
