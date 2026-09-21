// Dymek pojedynczej wiadomości - MACIERZ STANÓW JEDNEJ WIADOMOŚCI.
//
// PO CO TEN PLIK. `MessageBubble` stał na 67,1% linii i 13/31 funkcji, a
// nietrafione gałęzie skupiały się dokładnie tam, gdzie użytkownik traci
// najwięcej: potwierdzenia odbioru, nagrobek po cofnięciu wiadomości, reakcje
// i menu kontekstowe. Ten sam JSX obsługuje kilkanaście stanów naraz (moja
// kontra cudza, wysyłana, nieudana, edytowana, cofnięta, przekazana, z cytatem,
// z załącznikiem, samo emoji), więc pojedynczy "renderuje się" niczego tu nie
// dowodzi - dowodem jest RÓŻNICA między stanami.
//
// PRZEDMIOT DOWODU: co użytkownik WIDZI i co MOŻE KLIKNĄĆ w danym stanie, oraz
// z jaką wiadomością wychodzi handler. Każdy blok pilnuje jednej reguły, której
// złamanie jest odczuwalne: cofnięta wiadomość nie może zostawić treści w DOM,
// cudza wiadomość nie może dać przycisku usuwania, potwierdzenia nie mogą
// pokazywać się przy cudzych dymkach (wyciek informacji o odczycie).
//
// POZA ZAKRESEM (świadomie): atomy załącznika (`AttachmentContent` ma własny
// plik testowy i ciąga podpisane URL-e ze storage - tutaj są atrapami
// wystawiającymi swój kontrakt propsów), czysta arytmetyka potwierdzeń
// (`src/lib/chat/__tests__/receipts...`), reguła `isEmojiOnly` i wariant
// załącznika (`attachmentPresentation`) - tu sprawdzamy tylko ICH SKLEJENIE
// z DOM-em.
//
// RODO: żadnych prawdziwych osób - nadawcy to identyfikatory z `CHAT_IDS`,
// nazwy zmyślone ("Zofia Testowa", "Jan Przykładowy"), treści zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BASE_ISO, CHAT_IDS, chatMessage, isoOffset, reactionRow } from "@/test/chat/fixtures";
import { QUICK_REACTIONS } from "@/lib/chat/emojiQuick";
import type { ReceiptState } from "@/lib/chat/receipts";
import { clockTime } from "@/lib/chat/time";

// Atomy załącznika mają WŁASNY plik testowy i rozwiązują podpisane URL-e przez
// `useAttachmentUrl` (react-query + storage). Tutaj są atrapami, które wystawiają
// swój kontrakt propsów przez `data-*` - dymek ma dowieść, że podaje właściwą
// ścieżkę i właściwy wariant, a nie wyrenderować odtwarzacz po raz drugi.
vi.mock("../AttachmentContent", () => ({
  AttachmentImage: (props: { path: string; name: string | null; mine: boolean }) => (
    <div
      data-testid="attachment-image"
      data-path={props.path}
      data-name={props.name ?? ""}
      data-mine={String(props.mine)}
    />
  ),
  AttachmentAudio: (props: { path: string; duration: number | null; mine: boolean }) => (
    <div
      data-testid="attachment-audio"
      data-path={props.path}
      data-duration={String(props.duration)}
      data-mine={String(props.mine)}
    />
  ),
  AttachmentFile: (props: {
    path: string;
    name: string | null;
    mime: string | null;
    size: number | null;
    mine: boolean;
    lang: string;
  }) => (
    <div
      data-testid="attachment-file"
      data-path={props.path}
      data-name={props.name ?? ""}
      data-mime={props.mime ?? ""}
      data-size={String(props.size)}
      data-lang={props.lang}
    />
  ),
}));

import { MessageBubble, type MessageBubbleProps, type ReactorProfile } from "../MessageBubble";

const t = chatPl.chat;
const BODY = "Zdanie testowe o niczym";

function bubbleProps(overrides: Partial<MessageBubbleProps> = {}): MessageBubbleProps {
  return {
    message: chatMessage({ body: BODY }),
    mine: false,
    lang: "pl",
    groupStart: true,
    groupEnd: true,
    reactions: [],
    myUserId: CHAT_IDS.me,
    editable: false,
    onReact: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDiscardFailed: vi.fn(),
    ...overrides,
  };
}

/** Render w `TooltipProvider` - bez niego tooltipy reakcji wywracają render. */
function renderBubble(overrides: Partial<MessageBubbleProps> = {}) {
  const props = bubbleProps(overrides);
  const view = render(
    <TooltipProvider delayDuration={0}>
      <MessageBubble {...props} />
    </TooltipProvider>,
  );
  return { ...view, props };
}

/** Korzeń dymka - niesie kierunek (`flex-row-reverse`) i przygaszenie wysyłki. */
function rootOf(container: HTMLElement): Element {
  const root = container.firstElementChild;
  if (!root) throw new Error("test: dymek nie wyrenderował korzenia");
  return root;
}

/** Prawy przycisk myszy na treści dymka - zdarzenie bąbelkuje do wyzwalacza. */
function openContextMenu(target: Element): HTMLElement {
  fireEvent.contextMenu(target);
  return screen.getByRole("menu");
}

function menuItem(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

/** Etykieta chipa reakcji składa się z tytułu, listy osób i podpowiedzi. */
function reactorsTitle(emoji: string): string {
  return t.reactions.reactorsTitle.replace("{{emoji}}", emoji);
}

/** Inicjał w kółku reagującego - ta sama reguła, co w komponencie. */
function initialOf(label: string): string {
  return label.trim().charAt(0).toUpperCase();
}

function chip(emoji: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`button[data-emoji="${emoji}"]`);
  if (!found) throw new Error(`test: brak chipa reakcji ${emoji}`);
  return found;
}

const clipboardWrite = vi.fn();
let originalClipboard: PropertyDescriptor | undefined;

beforeEach(() => {
  clipboardWrite.mockReset();
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("kierunek dymka i własność wiadomości", () => {
  it("własna wiadomość idzie w prawo i daje usuwanie", () => {
    const { container } = renderBubble({ mine: true, message: chatMessage({ body: BODY }) });
    expect(rootOf(container).className).toContain("flex-row-reverse");
    expect(screen.getByRole("button", { name: t.deleteMessage })).toBeTruthy();
  });

  it("cudza wiadomość idzie w lewo i NIE ma czym usuwać cudzej treści", () => {
    const { container } = renderBubble({ mine: false });
    expect(rootOf(container).className).not.toContain("flex-row-reverse");
    expect(screen.queryByRole("button", { name: t.deleteMessage })).toBeNull();
  });

  it("usunięcie woła handler z TĄ wiadomością, nie z identyfikatorem", () => {
    const message = chatMessage({ id: "msg-do-usuniecia", body: BODY });
    const { props } = renderBubble({ mine: true, message });
    fireEvent.click(screen.getByRole("button", { name: t.deleteMessage }));
    expect(props.onDelete).toHaveBeenCalledWith(message);
  });

  it("dymek w środku serii tępi wspólną krawędź po SWOJEJ stronie", () => {
    // Zaokrąglenie 3px na sklejonej krawędzi to jedyny sygnał, że wiadomości
    // są jednym blokiem tej samej osoby.
    const mineView = renderBubble({
      mine: true,
      groupStart: false,
      groupEnd: false,
      message: chatMessage({ body: BODY }),
    });
    const mineBubble = screen.getByText(BODY).parentElement;
    expect(mineBubble?.className).toContain("rounded-tr-[3px]");
    expect(mineBubble?.className).toContain("rounded-br-[3px]");
    mineView.unmount();

    renderBubble({ mine: false, groupStart: false, groupEnd: false });
    const theirBubble = screen.getByText(BODY).parentElement;
    expect(theirBubble?.className).toContain("rounded-tl-[3px]");
    expect(theirBubble?.className).toContain("rounded-bl-[3px]");
  });
});

describe("potwierdzenia odbioru", () => {
  const cases: ReadonlyArray<{ state: ReceiptState; over: Partial<MessageBubbleProps> }> = [
    { state: "pending", over: { message: chatMessage({ body: BODY, pending: true }) } },
    { state: "sent", over: {} },
    { state: "delivered", over: { peerLastDeliveredAt: isoOffset(1) } },
    { state: "read", over: { peerLastReadAt: isoOffset(1) } },
  ];

  it.each(cases)("stan $state ma własną etykietę w stopce", ({ state, over }) => {
    renderBubble({ mine: true, ...over });
    expect(screen.getByLabelText(t.receipt[state])).toBeTruthy();
  });

  it("każdy stan ma INNĄ ikonę, a przeczytane dokłada kolor marki", () => {
    const iconClasses = new Map<ReceiptState, string>();
    for (const { state, over } of cases) {
      const view = renderBubble({ mine: true, ...over });
      const icon = screen.getByLabelText(t.receipt[state]).querySelector("svg");
      if (!icon) throw new Error(`test: potwierdzenie ${state} bez ikony`);
      iconClasses.set(state, icon.getAttribute("class") ?? "");
      const style = icon.getAttribute("style") ?? "";
      if (state === "read") expect(style).toContain("--chat-user-tick-read");
      else expect(style).not.toContain("--chat-user-tick-read");
      view.unmount();
    }
    // Dostarczone i przeczytane mają tę samą podwójną fajkę - różni je kolor,
    // sprawdzony wyżej. Wysyłanie, wysłane i dostarczone MUSZĄ się różnić.
    const distinct = new Set([
      iconClasses.get("pending"),
      iconClasses.get("sent"),
      iconClasses.get("delivered"),
    ]);
    expect(distinct.size).toBe(3);
  });

  it("cudza wiadomość NIE pokazuje potwierdzeń (to stan mojego odczytu)", () => {
    renderBubble({ mine: false, peerLastReadAt: isoOffset(1), peerLastDeliveredAt: isoOffset(1) });
    for (const state of ["pending", "sent", "delivered", "read"] as const) {
      expect(screen.queryByLabelText(t.receipt[state])).toBeNull();
    }
  });

  it("własna wiadomość COFNIĘTA nie potwierdza już niczego", () => {
    renderBubble({
      mine: true,
      peerLastReadAt: isoOffset(1),
      message: chatMessage({ body: BODY, deleted_at: isoOffset(2) }),
    });
    expect(screen.queryByLabelText(t.receipt.read)).toBeNull();
    expect(screen.queryByLabelText(t.receipt.sent)).toBeNull();
  });

  it("nieudana wysyłka nie udaje wysłanej - zostaje przy zegarku", () => {
    renderBubble({ mine: true, message: chatMessage({ body: BODY, failed: true }) });
    expect(screen.getByLabelText(t.receipt.pending)).toBeTruthy();
    expect(screen.queryByLabelText(t.receipt.sent)).toBeNull();
  });
});

describe("znaczniki w stopce", () => {
  it("edytowana wiadomość mówi o tym w stopce", () => {
    renderBubble({ message: chatMessage({ body: BODY, edited_at: isoOffset(3) }) });
    expect(screen.getByText(t.edited)).toBeTruthy();
  });

  it("nieedytowana wiadomość NIE dokłada znacznika ani kropki", () => {
    renderBubble();
    expect(screen.queryByText(t.edited)).toBeNull();
    expect(screen.queryByText("·")).toBeNull();
  });

  it("stopka niesie godzinę wiadomości w formacie języka rozmowy", () => {
    renderBubble({ lang: "pl" });
    expect(screen.getByText(clockTime(BASE_ISO, "pl"))).toBeTruthy();
  });

  it("gwiazdka w stopce jest opisana, nie tylko żółta", () => {
    renderBubble({ starred: true, onToggleStar: vi.fn() });
    expect(screen.getByLabelText(t.star.starred)).toBeTruthy();
  });

  it("przekazana wiadomość ujawnia, że nie jest oryginałem", () => {
    renderBubble({ message: chatMessage({ body: BODY, forwarded: true }) });
    expect(screen.getByText(t.forward.tag)).toBeTruthy();
  });

  it("zwykła wiadomość nie udaje przekazanej", () => {
    renderBubble();
    expect(screen.queryByText(t.forward.tag)).toBeNull();
  });
});

describe("wiadomość cofnięta (nagrobek)", () => {
  const deleted = chatMessage({ body: BODY, deleted_at: isoOffset(2) });

  it("pokazuje nagrobek i NIE zostawia oryginalnej treści w DOM", () => {
    renderBubble({ mine: true, message: deleted });
    expect(screen.getByText(t.deletedMessage)).toBeTruthy();
    expect(screen.queryByText(BODY)).toBeNull();
  });

  it("nie da się już odpowiedzieć, zareagować, edytować ani usunąć", () => {
    renderBubble({ mine: true, editable: true, message: deleted, onToggleStar: vi.fn() });
    for (const label of [t.reply, t.react, t.editMessage, t.deleteMessage, t.star.add]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("prawy przycisk myszy NIE otwiera menu nad nagrobkiem", () => {
    renderBubble({ mine: true, message: deleted });
    fireEvent.contextMenu(screen.getByText(t.deletedMessage));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("cofnięcie wygrywa z regułą samego emoji - żadnego powiększenia", () => {
    renderBubble({ message: chatMessage({ body: "🎉", deleted_at: isoOffset(2) }) });
    expect(screen.getByText(t.deletedMessage)).toBeTruthy();
    expect(screen.queryByText("🎉")).toBeNull();
  });
});

describe("cytat odpowiedzi", () => {
  it("skok do oryginału woła handler z identyfikatorem CYTOWANEJ wiadomości", () => {
    const onJumpToReply = vi.fn();
    const repliedMessage = chatMessage({ id: "msg-oryginal", body: "Pytanie o termin" });
    renderBubble({ repliedMessage, repliedAuthorName: "Zofia Testowa", onJumpToReply });

    fireEvent.click(screen.getByRole("button", { name: t.jumpToReplied }));
    expect(onJumpToReply).toHaveBeenCalledWith("msg-oryginal");
  });

  it("cytat pokazuje autora i treść oryginału", () => {
    renderBubble({
      repliedMessage: chatMessage({ id: "msg-oryginal", body: "Pytanie o termin" }),
      repliedAuthorName: "Zofia Testowa",
    });
    expect(screen.getByText(/Zofia Testowa/)).toBeTruthy();
    expect(screen.getByText("Pytanie o termin")).toBeTruthy();
  });

  it("cytat wiadomości cofniętej pokazuje nagrobek, nie odzyskaną treść", () => {
    renderBubble({
      repliedMessage: chatMessage({
        id: "msg-oryginal",
        body: "Treść do ukrycia",
        deleted_at: isoOffset(1),
      }),
      repliedAuthorName: "Zofia Testowa",
    });
    expect(screen.getByText(t.deletedMessage)).toBeTruthy();
    expect(screen.queryByText("Treść do ukrycia")).toBeNull();
  });

  it("cytat zdjęcia bez podpisu nazywa rodzaj, a nie pustkę", () => {
    renderBubble({
      repliedMessage: chatMessage({ id: "msg-foto", kind: "image", body: null }),
      repliedAuthorName: "Zofia Testowa",
    });
    expect(screen.getByText(t.photo)).toBeTruthy();
  });

  it("cytat pliku bez podpisu nazywa rodzaj", () => {
    renderBubble({
      repliedMessage: chatMessage({ id: "msg-plik", kind: "file", body: null }),
      repliedAuthorName: "Zofia Testowa",
    });
    expect(screen.getByText(t.file)).toBeTruthy();
  });

  it("bez handlera skoku przycisk nie wybucha (okno mogło już przewinąć wątek)", () => {
    renderBubble({
      repliedMessage: chatMessage({ id: "msg-oryginal", body: "Pytanie o termin" }),
      repliedAuthorName: undefined,
    });
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: t.jumpToReplied })),
    ).not.toThrow();
  });

  it("wiadomość bez odpowiedzi nie dokłada przycisku skoku", () => {
    renderBubble();
    expect(screen.queryByRole("button", { name: t.jumpToReplied })).toBeNull();
  });
});

describe("załączniki", () => {
  it("zdjęcie trafia do atomu obrazu ze ścieżką i nazwą", () => {
    renderBubble({
      mine: true,
      message: chatMessage({
        kind: "image",
        body: null,
        attachment_path: `${CHAT_IDS.tenant}/foto.png`,
        attachment_name: "foto.png",
      }),
    });
    const atom = screen.getByTestId("attachment-image");
    expect(atom.getAttribute("data-path")).toBe(`${CHAT_IDS.tenant}/foto.png`);
    expect(atom.getAttribute("data-name")).toBe("foto.png");
    expect(atom.getAttribute("data-mine")).toBe("true");
  });

  it("nagranie głosowe trafia do odtwarzacza z długością", () => {
    renderBubble({
      message: chatMessage({
        kind: "audio",
        body: null,
        attachment_path: `${CHAT_IDS.tenant}/nagranie.webm`,
        attachment_duration: 12,
      }),
    });
    expect(screen.getByTestId("attachment-audio").getAttribute("data-duration")).toBe("12");
  });

  it("dokument trafia do kafla pliku z MIME, rozmiarem i językiem formatowania", () => {
    renderBubble({
      lang: "en",
      message: chatMessage({
        kind: "file",
        body: null,
        attachment_path: `${CHAT_IDS.tenant}/raport.pdf`,
        attachment_name: "raport.pdf",
        attachment_mime: "application/pdf",
        attachment_size: 2048,
      }),
    });
    const atom = screen.getByTestId("attachment-file");
    expect(atom.getAttribute("data-mime")).toBe("application/pdf");
    expect(atom.getAttribute("data-size")).toBe("2048");
    expect(atom.getAttribute("data-lang")).toBe("en");
  });

  it("wiersz z rodzajem załącznika BEZ ścieżki pokazuje sam podpis", () => {
    // Nieudane przesyłanie zostawia `kind: image` bez `attachment_path`.
    // Połamany obrazek byłby gorszy niż sam tekst.
    renderBubble({
      message: chatMessage({ kind: "image", body: "Podpis pod zdjęciem", attachment_path: null }),
    });
    expect(screen.queryByTestId("attachment-image")).toBeNull();
    expect(screen.getByText("Podpis pod zdjęciem")).toBeTruthy();
  });

  it("załącznik bez podpisu ma samą stopkę, bez pustego dymka", () => {
    renderBubble({
      message: chatMessage({
        kind: "image",
        body: "   ",
        attachment_path: `${CHAT_IDS.tenant}/foto.png`,
      }),
    });
    expect(screen.getByTestId("attachment-image")).toBeTruthy();
    expect(screen.getByText(clockTime(BASE_ISO, "pl"))).toBeTruthy();
    expect(screen.queryByText("   ")).toBeNull();
  });

  it("przekazany załącznik też nosi znacznik przekazania", () => {
    renderBubble({
      message: chatMessage({
        kind: "file",
        body: null,
        forwarded: true,
        attachment_path: `${CHAT_IDS.tenant}/raport.pdf`,
      }),
    });
    expect(screen.getByText(t.forward.tag)).toBeTruthy();
  });
});

describe("wiadomość z samych emoji", () => {
  it("emoji renderuje się powiększone i BEZ dymka", () => {
    const { container } = renderBubble({ message: chatMessage({ body: "🎉" }) });
    const enlarged = screen.getByText("🎉");
    expect(enlarged.className).toContain("text-[2rem]");
    expect(enlarged.getAttribute("title")).toBe(clockTime(BASE_ISO, "pl"));
    // Brak tła dymka - to cały sens powiększenia.
    expect(container.querySelector(".bg-card")).toBeNull();
  });

  it("emoji z tekstem zostaje zwykłą wiadomością w dymku", () => {
    const { container } = renderBubble({ message: chatMessage({ body: "🎉 gratulacje" }) });
    expect(screen.getByText("🎉 gratulacje").className).not.toContain("text-[2rem]");
    expect(container.querySelector(".bg-card")).not.toBeNull();
  });

  it("emoji przekazane nadal nosi znacznik przekazania", () => {
    renderBubble({ message: chatMessage({ body: "🎉", forwarded: true }) });
    expect(screen.getByText(t.forward.tag)).toBeTruthy();
  });
});

describe("reakcje", () => {
  const profiles: ReadonlyMap<string, ReactorProfile> = new Map([
    [CHAT_IDS.peer, { display_name: "Zofia Testowa", avatar_url: null }],
    [
      CHAT_IDS.peerTwo,
      { display_name: "Jan Przykładowy", avatar_url: "https://example.org/jan.png" },
    ],
  ]);

  const mixed = [
    reactionRow({ id: "rx-1", user_id: CHAT_IDS.peer, emoji: "👍" }),
    reactionRow({ id: "rx-2", user_id: CHAT_IDS.peerTwo, emoji: "👍" }),
    reactionRow({ id: "rx-3", user_id: CHAT_IDS.me, emoji: "❤️" }),
  ];

  it("brak reakcji nie zostawia pustego paska", () => {
    const { container } = renderBubble({ reactions: [] });
    expect(container.querySelector("[data-emoji]")).toBeNull();
  });

  it("chipy grupują po emoji i liczą osoby", () => {
    const { container } = renderBubble({ reactions: mixed, reactorProfiles: profiles });
    expect(container.querySelectorAll("[data-emoji]")).toHaveLength(2);
    expect(chip("👍").textContent).toContain("2");
    expect(chip("❤️").textContent).toContain("1");
  });

  it("własna reakcja jest ogłoszona jako wciśnięta, cudza nie", () => {
    renderBubble({ reactions: mixed, reactorProfiles: profiles });
    expect(chip("❤️").getAttribute("aria-pressed")).toBe("true");
    expect(chip("👍").getAttribute("aria-pressed")).toBe("false");
  });

  it("klik chipa niesie AKTUALNĄ własną reakcję, żeby dało się ją przełączyć", () => {
    const { props } = renderBubble({ reactions: mixed, reactorProfiles: profiles });
    fireEvent.click(chip("👍"));
    expect(props.onReact).toHaveBeenCalledWith(props.message, "👍", "❤️");
  });

  it("etykieta chipa wymienia reagujących i podpowiada kierunek przełączenia", () => {
    renderBubble({ reactions: mixed, reactorProfiles: profiles });
    const foreign = chip("👍").getAttribute("aria-label") ?? "";
    expect(foreign).toContain(reactorsTitle("👍"));
    expect(foreign).toContain("Zofia Testowa");
    expect(foreign).toContain("Jan Przykładowy");
    expect(foreign).toContain(t.reactions.addHint);

    const own = chip("❤️").getAttribute("aria-label") ?? "";
    expect(own).toContain(t.reactions.you);
    expect(own).toContain(t.reactions.removeHint);
  });

  it("tooltip wymienia reagujących: avatar z URL, inicjał bez avatara, „Ty” dla siebie", () => {
    renderBubble({
      reactions: [
        reactionRow({ id: "rx-1", user_id: CHAT_IDS.peer, emoji: "👍" }),
        reactionRow({ id: "rx-2", user_id: CHAT_IDS.peerTwo, emoji: "👍" }),
        reactionRow({ id: "rx-3", user_id: CHAT_IDS.me, emoji: "👍" }),
      ],
      reactorProfiles: profiles,
    });
    fireEvent.focus(chip("👍"));

    const tip = screen.getByRole("tooltip");
    expect(within(tip).getByText(t.reactions.tooltip)).toBeTruthy();
    expect(within(tip).getByText("Zofia Testowa")).toBeTruthy();
    expect(within(tip).getByText(t.reactions.you)).toBeTruthy();
    // Jan ma avatar - obraz jest dekoracją, znaczenie niesie tekst obok.
    const avatar = tip.querySelector("img");
    expect(avatar?.getAttribute("src")).toBe("https://example.org/jan.png");
    expect(avatar?.getAttribute("aria-hidden")).toBe("true");
    // Zofia nie ma avatara - zostaje inicjał.
    expect(within(tip).getByText("Z")).toBeTruthy();
    // Ja też nie mam profilu w mapie - inicjał liczy się z etykiety „Ty".
    expect(within(tip).getByText(initialOf(t.reactions.you))).toBeTruthy();
  });

  it("reagujący bez profilu jest „Ktoś”, a profil z pustą nazwą daje znak zapytania", () => {
    renderBubble({
      reactions: [
        reactionRow({ id: "rx-1", user_id: CHAT_IDS.peer, emoji: "👍" }),
        reactionRow({ id: "rx-2", user_id: CHAT_IDS.stranger, emoji: "👍" }),
      ],
      reactorProfiles: new Map([[CHAT_IDS.peer, { display_name: "", avatar_url: null }]]),
    });
    // Nikt z tej dwójki nie ma nazwy - etykieta chipa nie może skleić przecinków
    // z pustych łańcuchów.
    const label = chip("👍").getAttribute("aria-label") ?? "";
    expect(label).toBe(`${reactorsTitle("👍")} • ${t.reactions.addHint}`);

    fireEvent.focus(chip("👍"));
    const tip = screen.getByRole("tooltip");
    expect(within(tip).getAllByText(t.reactions.someone)).toHaveLength(2);
    // Profil z pustą nazwą: brak inicjału do pokazania.
    expect(within(tip).getByText("?")).toBeTruthy();
    // Brak profilu: inicjał liczy się z wyświetlanej etykiety („Ktoś").
    expect(within(tip).getByText(initialOf(t.reactions.someone))).toBeTruthy();
  });
});

describe("gwiazdka", () => {
  it("bez handlera gwiazdki nie ma czym oznaczać", () => {
    renderBubble();
    expect(screen.queryByRole("button", { name: t.star.add })).toBeNull();
    expect(screen.queryByRole("button", { name: t.star.remove })).toBeNull();
  });

  it("nieoznaczona wiadomość proponuje dodanie i ogłasza stan", () => {
    const onToggleStar = vi.fn();
    const { props } = renderBubble({ onToggleStar, starred: false });
    const button = screen.getByRole("button", { name: t.star.add });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggleStar).toHaveBeenCalledWith(props.message, false);
  });

  it("oznaczona wiadomość proponuje zdjęcie gwiazdki", () => {
    const onToggleStar = vi.fn();
    const { props } = renderBubble({ onToggleStar, starred: true });
    const button = screen.getByRole("button", { name: t.star.remove });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(onToggleStar).toHaveBeenCalledWith(props.message, true);
  });
});

describe("wysyłka w toku i nieudana", () => {
  it("wiadomość w locie jest przygaszona i nie daje akcji ani menu", () => {
    const { container } = renderBubble({
      mine: true,
      message: chatMessage({ body: BODY, pending: true }),
    });
    expect(rootOf(container).className).toContain("opacity-60");
    expect(screen.queryByRole("button", { name: t.reply })).toBeNull();
    expect(screen.queryByRole("button", { name: t.react })).toBeNull();

    fireEvent.contextMenu(screen.getByText(BODY));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("nieudana wysyłka nazywa awarię i daje dwa wyjścia, gdy jest czym ponowić", () => {
    const onRetryFailed = vi.fn();
    const message = chatMessage({ body: BODY, failed: true });
    const { props } = renderBubble({ mine: true, message, onRetryFailed });

    expect(screen.getByText(t.sendFailed)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.retry }));
    expect(onRetryFailed).toHaveBeenCalledWith(message);

    fireEvent.click(screen.getByRole("button", { name: t.discard }));
    expect(props.onDiscardFailed).toHaveBeenCalledWith(message);
  });

  it("bez handlera ponowienia zostaje samo odrzucenie - żadnego martwego przycisku", () => {
    renderBubble({ mine: true, message: chatMessage({ body: BODY, failed: true }) });
    expect(screen.queryByRole("button", { name: t.retry })).toBeNull();
    expect(screen.getByRole("button", { name: t.discard })).toBeTruthy();
  });

  it("nieudana wysyłka nie daje odpowiadania ani menu kontekstowego", () => {
    renderBubble({ mine: true, message: chatMessage({ body: BODY, failed: true }) });
    expect(screen.queryByRole("button", { name: t.reply })).toBeNull();
    fireEvent.contextMenu(screen.getByText(BODY));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("rząd akcji przy dymku", () => {
  it("odpowiedź woła handler z wiadomością", () => {
    const { props } = renderBubble();
    fireEvent.click(screen.getByRole("button", { name: t.reply }));
    expect(props.onReply).toHaveBeenCalledWith(props.message);
  });

  it("edycja jest dostępna TYLKO w oknie edycji własnej wiadomości", () => {
    const view = renderBubble({ mine: true, editable: false });
    expect(screen.queryByRole("button", { name: t.editMessage })).toBeNull();
    view.unmount();

    const { props } = renderBubble({ mine: true, editable: true });
    fireEvent.click(screen.getByRole("button", { name: t.editMessage }));
    expect(props.onEdit).toHaveBeenCalledWith(props.message);
  });

  it("przekazywanie dotyczy tylko tekstu - załącznika nie da się przekazać", () => {
    const onForward = vi.fn();
    const view = renderBubble({ onForward });
    fireEvent.click(screen.getByRole("button", { name: t.forward.action }));
    expect(onForward).toHaveBeenCalledTimes(1);
    view.unmount();

    renderBubble({
      onForward,
      message: chatMessage({
        kind: "image",
        body: null,
        attachment_path: `${CHAT_IDS.tenant}/foto.png`,
      }),
    });
    expect(screen.queryByRole("button", { name: t.forward.action })).toBeNull();
  });

  it("bez handlera przekazywania nie ma przycisku przekazywania", () => {
    renderBubble();
    expect(screen.queryByRole("button", { name: t.forward.action })).toBeNull();
  });

  it("pasek szybkich reakcji wysyła emoji i zamyka się po wyborze", () => {
    const { props } = renderBubble({
      reactions: [reactionRow({ id: "rx-1", user_id: CHAT_IDS.me, emoji: "❤️" })],
    });
    fireEvent.click(screen.getByRole("button", { name: t.react }));

    for (const emoji of QUICK_REACTIONS) {
      expect(screen.getByRole("button", { name: emoji })).toBeTruthy();
    }
    // Aktualna własna reakcja jest zaznaczona w pasku.
    expect(screen.getByRole("button", { name: "❤️" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "👍" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "👍" }));
    expect(props.onReact).toHaveBeenCalledWith(props.message, "👍", "❤️");
    expect(screen.queryByRole("button", { name: "😂" })).toBeNull();
  });
});

describe("menu kontekstowe", () => {
  it("prawy przycisk myszy otwiera menu z odpowiedzią i kopiowaniem", () => {
    const { props } = renderBubble();
    openContextMenu(screen.getByText(BODY));

    fireEvent.click(menuItem(t.reply));
    expect(props.onReply).toHaveBeenCalledWith(props.message);
  });

  it("kopiowanie wkłada treść do schowka", () => {
    renderBubble();
    openContextMenu(screen.getByText(BODY));
    fireEvent.click(menuItem(t.copyMessage));
    expect(clipboardWrite).toHaveBeenCalledWith(BODY);
  });

  it("kopiowanie jest WYŁĄCZONE dla wiadomości bez treści", () => {
    renderBubble({
      message: chatMessage({
        kind: "image",
        body: null,
        attachment_path: `${CHAT_IDS.tenant}/foto.png`,
      }),
    });
    openContextMenu(screen.getByTestId("attachment-image"));
    const copy = menuItem(t.copyMessage);
    expect(copy.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(copy);
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("gwiazdka w menu woła handler z aktualnym stanem", () => {
    const onToggleStar = vi.fn();
    const { props } = renderBubble({ onToggleStar, starred: true });
    openContextMenu(screen.getByText(BODY));
    fireEvent.click(menuItem(t.star.remove));
    expect(onToggleStar).toHaveBeenCalledWith(props.message, true);
  });

  it("przekazanie w menu jest tylko dla tekstu", () => {
    const onForward = vi.fn();
    const view = renderBubble({ onForward });
    openContextMenu(screen.getByText(BODY));
    fireEvent.click(menuItem(t.forward.action));
    expect(onForward).toHaveBeenCalledTimes(1);
    view.unmount();

    renderBubble({
      onForward,
      message: chatMessage({
        kind: "file",
        body: null,
        attachment_path: `${CHAT_IDS.tenant}/raport.pdf`,
      }),
    });
    openContextMenu(screen.getByTestId("attachment-file"));
    expect(screen.queryByRole("menuitem", { name: t.forward.action })).toBeNull();
  });

  // STRAŻNIK ZAŁOŻENIA dla `it.fails` poniżej. `it.fails` zielenieje od
  // DOWOLNEGO wyjątku, więc sam z siebie nie odróżnia „pasek się nie otworzył"
  // od „pozycji menu w ogóle nie ma". Ten test trzyma założenie osobno: gdyby
  // pozycja „Dodaj reakcję" zniknęła albo została wyłączona, czerwieni się TU,
  // a nie chowa pod oczekiwaną porażką.
  it("pozycja „reaguj” JEST w menu i jest klikalna", () => {
    renderBubble();
    openContextMenu(screen.getByText(BODY));
    const item = menuItem(t.react);
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
    expect(item.getAttribute("data-disabled")).toBeNull();
  });

  // DEFEKT PRODUKCYJNY - zapisany jako `it.fails`, komponentu NIE ruszam.
  //
  // ZŁAMANY KONTRAKT: pozycja „Dodaj reakcję" ustawia `reactOpen`, pasek
  // szybkich reakcji faktycznie montuje się w drzewie - i znika w tej samej
  // interakcji. Zmierzone obserwatorem mutacji na `document.body`: węzeł paska
  // jest DODANY i natychmiast USUNIĘTY, a `reactOpen` wraca do `false`. Powód
  // jest kompozycyjny: menu Radiksa zamyka się zaraz po `onSelect` i przy
  // oddawaniu ogniska odrzuca świeżo otwarty popover (klasyczna pułapka
  // „popover otwierany z pozycji menu"). Dla użytkownika ta pozycja menu jest
  // MARTWA - klika i nic się nie dzieje.
  //
  // OCZEKIWANY KONTRAKT: po wybraniu „Dodaj reakcję" pasek sześciu szybkich
  // reakcji zostaje OTWARTY - dokładnie tak, jak po kliknięciu ikony uśmiechu
  // w rzędzie akcji (test wyżej w „rząd akcji przy dymku"). Naprawa należy do
  // komponentu (otwarcie paska dopiero po zamknięciu menu), nie do testu.
  it.fails("pozycja „reaguj” otwiera pasek szybkich reakcji", () => {
    renderBubble();
    openContextMenu(screen.getByText(BODY));
    fireEvent.click(menuItem(t.react));
    expect(screen.getByRole("button", { name: "👍" })).toBeTruthy();
  });

  it("edycja i usuwanie pojawiają się w menu tylko wtedy, gdy wolno", () => {
    const view = renderBubble({ mine: false, editable: false });
    openContextMenu(screen.getByText(BODY));
    expect(screen.queryByRole("menuitem", { name: t.editMessage })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t.deleteMessage })).toBeNull();
    view.unmount();

    const own = renderBubble({ mine: true, editable: true });
    openContextMenu(screen.getByText(BODY));
    fireEvent.click(menuItem(t.editMessage));
    expect(own.props.onEdit).toHaveBeenCalledWith(own.props.message);
  });

  it("usunięcie z menu woła handler z tą samą wiadomością", () => {
    const { props } = renderBubble({ mine: true });
    openContextMenu(screen.getByText(BODY));
    fireEvent.click(menuItem(t.deleteMessage));
    expect(props.onDelete).toHaveBeenCalledWith(props.message);
  });

  it("bez handlera gwiazdki menu nie pokazuje pozycji gwiazdki", () => {
    renderBubble();
    openContextMenu(screen.getByText(BODY));
    expect(screen.queryByRole("menuitem", { name: t.star.add })).toBeNull();
  });
});
