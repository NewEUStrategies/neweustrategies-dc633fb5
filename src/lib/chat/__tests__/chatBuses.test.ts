// Dwie magistrale zdarzeń czatu i dataset emoji - trzy moduły, które stały na
// zerze (a raczej: 8%, 0% i 0%), choć każdy ma nietrywialny warunek poprawności.
//
//   chatDockBus              - most między „kliknij osobę gdziekolwiek" i dokiem;
//                              bez niego CTA w katalogu, na profilu i w dzwonku
//                              musiałyby przewlekać propsy przez cały layout,
//   expertRequestDialogBus   - ma REPLAY: host dialogu jest React.lazy, więc
//                              klik może paść PRZED pobraniem jego chunka.
//                              Bez odtworzenia prefill przepadałby bezpowrotnie,
//   emoji.ts                 - dataset pickera (~300 wpisów) z wyszukiwaniem
//                              dwujęzycznym; 467 linii bez ani jednej asercji.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onOpenChatWindow, openChatWindow } from "../chatDockBus";
import {
  closeExpertRequestDialog,
  openExpertRequestDialog,
  subscribeExpertRequestDialog,
  type ExpertRequestPrefill,
} from "../expertRequestDialogBus";
import { EMOJI_CATEGORIES, searchEmoji } from "../emoji";
import { isEmojiOnly, QUICK_REACTIONS } from "../emojiQuick";
import { CHAT_IDS } from "@/test/chat/fixtures";

describe("chatDockBus", () => {
  it("doręcza żądanie otwarcia rozmowy każdemu nasłuchującemu", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onOpenChatWindow(first);
    const offSecond = onOpenChatWindow(second);

    openChatWindow({ conversationId: CHAT_IDS.conversation });

    expect(first).toHaveBeenCalledWith({ conversationId: CHAT_IDS.conversation });
    expect(second).toHaveBeenCalledWith({ conversationId: CHAT_IDS.conversation });
    offFirst();
    offSecond();
  });

  it("przenosi flagę fokusu kompozytora", () => {
    const listener = vi.fn();
    const off = onOpenChatWindow(listener);
    openChatWindow({ conversationId: CHAT_IDS.conversation, focus: false });
    expect(listener).toHaveBeenCalledWith({
      conversationId: CHAT_IDS.conversation,
      focus: false,
    });
    off();
  });

  it("ODRZUCA żądanie bez id rozmowy - dok nie ma czego otworzyć", () => {
    const listener = vi.fn();
    const off = onOpenChatWindow(listener);
    // Zdarzenie z pustym `detail` może przyjść z kodu, który stracił kontekst.
    window.dispatchEvent(new CustomEvent("nes:open-chat", { detail: {} }));
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("odsubskrybowanie faktycznie zdejmuje nasłuch", () => {
    const listener = vi.fn();
    const off = onOpenChatWindow(listener);
    off();
    openChatWindow({ conversationId: CHAT_IDS.conversation });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("expertRequestDialogBus", () => {
  const prefill = (overrides: Partial<ExpertRequestPrefill> = {}): ExpertRequestPrefill => ({
    recipientId: CHAT_IDS.peer,
    recipientName: "Anna Ekspertka",
    recipientAvatar: null,
    ...overrides,
  });

  // Magistrala trzyma stan modułowy (pending prefill), więc każdy test musi
  // zaczynać od czystej karty - inaczej replay z poprzedniego przypadku
  // wchodziłby w następny.
  beforeEach(() => {
    const off = subscribeExpertRequestDialog(() => {});
    off();
    closeExpertRequestDialog();
  });

  it("doręcza prefill subskrybentowi obecnemu w chwili emisji", () => {
    const listener = vi.fn();
    const off = subscribeExpertRequestDialog(listener);
    listener.mockReset();

    openExpertRequestDialog(prefill());
    expect(listener).toHaveBeenCalledWith(prefill());
    off();
  });

  it("REPLAY: emisja przed pobraniem chunka hosta nie przepada", () => {
    // Klik w CTA padł, gdy nikt nie nasłuchiwał (host jest React.lazy).
    openExpertRequestDialog(prefill({ subject: "Pakiet energetyczny" }));

    const listener = vi.fn();
    const off = subscribeExpertRequestDialog(listener);
    expect(listener).toHaveBeenCalledWith(prefill({ subject: "Pakiet energetyczny" }));
    off();
  });

  it("replay zużywa się RAZ - drugi subskrybent nie dostaje starego żądania", () => {
    openExpertRequestDialog(prefill());
    const first = vi.fn();
    const offFirst = subscribeExpertRequestDialog(first);
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    const offSecond = subscribeExpertRequestDialog(second);
    expect(second).not.toHaveBeenCalled();
    offFirst();
    offSecond();
  });

  it("zamknięcie ogłasza null i UNIEWAŻNIA zaległy replay", () => {
    openExpertRequestDialog(prefill());
    closeExpertRequestDialog();

    const listener = vi.fn();
    const off = subscribeExpertRequestDialog(listener);
    // Zamknięcie skasowało zaległe żądanie - nowy host nie otwiera dialogu
    // dla kliknięcia, które użytkownik już porzucił.
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("zamknięcie przy aktywnym subskrybencie doręcza mu null", () => {
    const listener = vi.fn();
    const off = subscribeExpertRequestDialog(listener);
    listener.mockReset();

    closeExpertRequestDialog();
    expect(listener).toHaveBeenCalledWith(null);
    off();
  });

  it("odsubskrybowanie zdejmuje nasłuch", () => {
    const listener = vi.fn();
    const off = subscribeExpertRequestDialog(listener);
    off();
    openExpertRequestDialog(prefill());
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("dataset emoji", () => {
  const allEntries = EMOJI_CATEGORIES.flatMap((category) => category.emojis);

  it("ma osiem kategorii bez duplikatów identyfikatorów", () => {
    const ids = EMOJI_CATEGORIES.map((category) => category.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it("każda kategoria jest niepusta, a każdy wpis ma emotkę i słowa kluczowe", () => {
    for (const category of EMOJI_CATEGORIES) {
      expect(category.emojis.length).toBeGreaterThan(0);
      for (const entry of category.emojis) {
        expect(entry.e.length).toBeGreaterThan(0);
        expect(entry.k.trim().length).toBeGreaterThan(0);
        // Słowa kluczowe są PORÓWNYWANE małymi literami - wielka litera
        // w datasecie robiłaby wpis niewyszukiwalnym.
        expect(entry.k).toBe(entry.k.toLowerCase());
      }
    }
  });

  it("nie ma tej samej emotki w dwóch miejscach", () => {
    const emojis = allEntries.map((entry) => entry.e);
    expect(new Set(emojis).size).toBe(emojis.length);
  });
});

describe("searchEmoji", () => {
  it("pusta i białoznakowa fraza nie zwraca nic (picker pokazuje kategorie)", () => {
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("szuka po angielsku i po polsku - dataset jest dwujęzyczny", () => {
    expect(searchEmoji("heart").length).toBeGreaterThan(0);
    expect(searchEmoji("serce").length).toBeGreaterThan(0);
    expect(searchEmoji("usmiech").length).toBeGreaterThan(0);
  });

  it("ignoruje wielkość liter i otacza frazę trimem", () => {
    const plain = searchEmoji("smile");
    expect(searchEmoji("  SMILE  ")).toEqual(plain);
  });

  it("respektuje limit i domyślnie nie przekracza rozmiaru siatki", () => {
    expect(searchEmoji("a", 5)).toHaveLength(5);
    expect(searchEmoji("a").length).toBeLessThanOrEqual(48);
  });

  it("fraza bez trafień zwraca pustą listę, nie całość datasetu", () => {
    expect(searchEmoji("zzzznieistniejacefraza")).toEqual([]);
  });

  it("zwraca wpisy Z DATASETU, nie skonstruowane obiekty", () => {
    const hits = searchEmoji("serce", 3);
    for (const hit of hits) {
      expect(EMOJI_CATEGORIES.some((c) => c.emojis.includes(hit))).toBe(true);
    }
  });
});

describe("emojiQuick", () => {
  it("pasek szybkich reakcji ma sześć różnych emotek", () => {
    expect(QUICK_REACTIONS).toHaveLength(6);
    expect(new Set(QUICK_REACTIONS).size).toBe(6);
  });

  it("rozpoznaje wiadomość złożoną WYŁĄCZNIE z emotek (renderowaną powiększoną)", () => {
    expect(isEmojiOnly("👍")).toBe(true);
    expect(isEmojiOnly("👍👍👍")).toBe(true);
    expect(isEmojiOnly(" 🎉 ✨ ")).toBe(true);
  });

  it("tekst z emotką NIE jest wiadomością emoji-only", () => {
    expect(isEmojiOnly("dzięki 👍")).toBe(false);
    expect(isEmojiOnly("ok")).toBe(false);
  });

  it("pusta i białoznakowa treść nie jest emoji-only", () => {
    expect(isEmojiOnly("")).toBe(false);
    expect(isEmojiOnly("   ")).toBe(false);
  });

  it("bardzo długi ciąg emotek przestaje być powiększany (limit 12)", () => {
    expect(isEmojiOnly("🎉".repeat(12))).toBe(true);
    expect(isEmojiOnly("🎉".repeat(13))).toBe(false);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
