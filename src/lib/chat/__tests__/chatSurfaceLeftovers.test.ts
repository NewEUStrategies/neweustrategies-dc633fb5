// Resztówki dwóch modułów czatu: ostatnie domknięcia `drafts.ts` i ostatnia
// funkcja `chatDockBus.ts`.
//
// PO CO OSOBNY PLIK. Oba moduły mają już własne testy (`drafts.test.ts`,
// `chatBuses.test.ts`) i oba stoją wysoko - ale niedobite kawałki NIE SĄ
// przypadkowe: to ratownicy stanu (zapis wersji roboczej przy zamykaniu karty)
// i ramiona obronne renderu serwerowego. Jedno i drugie odzywa się wyłącznie
// w sytuacji, której użytkownik nie zgłosi jako błąd - po prostu „zniknął mi
// tekst" albo „strona się wysypała po wdrożeniu SSR".
//
// Świadomie NIE dopisuję tego do istniejących plików: tamte testują KONTRAKT
// modułu, ten dobija JEGO OBRZEŻA i ma inny powód istnienia.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_IDS } from "@/test/chat/fixtures";
import { __resetDraftsForTests, getDraft, setDraft } from "../drafts";
import { onOpenChatWindow, openChatWindow } from "../chatDockBus";

const STORAGE_KEY = `nes.chat.drafts.${CHAT_IDS.me}`;

beforeEach(() => {
  __resetDraftsForTests();
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetDraftsForTests();
  localStorage.clear();
});

describe("drafts - ratownicy stanu przy opuszczaniu karty", () => {
  it("`pagehide` DOPYCHA wersję roboczą do magazynu przed debouncem", () => {
    // Zapis jest opóźniony o 400 ms. Zamknięcie karty w tym oknie bez tego
    // nasłuchu oznacza utratę ostatnich naciśnięć klawiszy - błąd, którego
    // użytkownik nie zgłosi jako błędu, tylko jako „zniknął mi tekst".
    setDraft(CHAT_IDS.me, CHAT_IDS.conversation, "niedokończone zdanie");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    window.dispatchEvent(new Event("pagehide"));

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw ?? "").toContain("niedokończone zdanie");
  });

  it("ukrycie karty (`visibilitychange`) też dopycha - bfcache nie woła `pagehide` wszędzie", () => {
    setDraft(CHAT_IDS.me, CHAT_IDS.otherConversation, "druga wersja robocza");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();

    expect(localStorage.getItem(STORAGE_KEY) ?? "").toContain("druga wersja robocza");
  });

  it("POWRÓT karty na wierzch NIE dopycha - zapis ma kosztować tylko przy wyjściu", () => {
    setDraft(CHAT_IDS.me, CHAT_IDS.conversation, "jeszcze nie zapisane");
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Stan w pamięci żyje dalej - dopychanie jest optymalizacją trwałości,
    // nie źródłem prawdy.
    expect(getDraft(CHAT_IDS.me, CHAT_IDS.conversation)).toBe("jeszcze nie zapisane");
  });

  it("awaria magazynu (tryb prywatny, przekroczony limit) NIE gubi wersji roboczej w pamięci", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    setDraft(CHAT_IDS.me, CHAT_IDS.conversation, "tekst mimo awarii magazynu");
    window.dispatchEvent(new Event("pagehide"));
    setItem.mockRestore();

    expect(getDraft(CHAT_IDS.me, CHAT_IDS.conversation)).toBe("tekst mimo awarii magazynu");
  });
});

describe("chatDockBus - ramię obronne renderu serwerowego", () => {
  it("bez `window` szyna MILCZY i oddaje odsubskrybowanie, które nic nie robi", () => {
    // Na serwerze nie ma czego otwierać ani czego nasłuchiwać. Ważne jest, żeby
    // OBIE funkcje wracały bez wyjątku, bo `openChatWindow` bywa wołane z
    // handlerów renderowanych po obu stronach - rzut tutaj wywróciłby cały
    // dokument, a nie tylko dok czatu.
    vi.stubGlobal("window", undefined);

    expect(() => openChatWindow({ conversationId: CHAT_IDS.conversation })).not.toThrow();
    const off = onOpenChatWindow(() => {
      throw new Error("test: handler nie miał prawa się wykonać");
    });
    expect(() => off()).not.toThrow();
  });

  it("po powrocie `window` szyna znowu doręcza - ramię obronne nie kaleczy klienta", () => {
    const seen: string[] = [];
    const off = onOpenChatWindow((request) => seen.push(request.conversationId));
    openChatWindow({ conversationId: CHAT_IDS.conversation });
    off();
    expect(seen).toEqual([CHAT_IDS.conversation]);
  });
});
