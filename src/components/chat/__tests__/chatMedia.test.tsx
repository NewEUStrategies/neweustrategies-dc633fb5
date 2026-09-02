// Media rozmowy w DWÓCH powierzchniach, które użytkownik otwiera, żeby
// odzyskać przysłany plik: boczny panel `ChatMediaPanel` (przed tym plikiem
// 0/34 linii i 0/12 funkcji - kompletne zero) oraz dialog historii
// `MediaHistoryDialog` (33,3% linii, 2/11 funkcji: niepokryte były dokładnie
// te dwie funkcje, które renderują KAFELEK zdjęcia i WIERSZ pliku, czyli cała
// zawartość obu zakładek).
//
// CO JEST PRZEDMIOTEM DOWODU. Wyłącznie sklejenie danych z DOM-em widziane
// oczami użytkownika:
//   - zanim dane przyjdą, widać komunikat ładowania, a nie pustą siatkę,
//   - rozmowa BEZ załączników mówi to wprost, zamiast rysować pustą kratkę,
//   - kafelek bez podpisanego URL-a nie zostawia złamanego obrazka,
//   - wiersz pliku niesie nazwę, rozmiar (`formatBytes`) i datę, a pobieranie
//     jest ZABLOKOWANE, dopóki URL nie wróci,
//   - przełączenie zakładki podmienia zawartość i liczniki,
//   - klik w miniaturę otwiera pełnoekranowy podgląd TEGO zdjęcia.
//
// PODZIAŁ DOWODÓW. Podpisywanie URL-a (`useAttachmentUrl`) i odczyt listy
// załączników (`useConversationAttachments`, `useStarredMessages`) są
// ZAMOCKOWANE - mają własne pliki (`src/lib/chat/__tests__/attachments.test.tsx`,
// `useMessages.test.tsx`, `chatDataHooks.test.tsx`). Wnętrze pełnoekranowego
// podglądu (zoom, obrót, zawijanie galerii) ma
// `src/components/chat/__tests__/attachmentSurfaces.test.tsx` i nie jest tu
// powtarzane - sprawdzamy tylko, CO historia mediów do niego podaje.
// `formatBytes` zostaje PRAWDZIWY, bo to on decyduje, co widzi użytkownik.
//
// ŚWIADOMIE POZA ZAKRESEM: dociąganie starszych stron załączników - żadna
// z tych powierzchni go nie ma. Panel czyta jednym zapytaniem z twardym
// limitem 500 wierszy po stronie serwera, a dialog renderuje wyłącznie to, co
// dostanie w propsie `messages` od okna rozmowy; dowód na paginację wiadomości
// mieszka w `src/lib/chat/__tests__/useMessages.test.tsx`.
//
// RODO: żadnych prawdziwych osób ani plików - identyfikatory z `CHAT_IDS`,
// nazwy plików zmyślone, adresy w domenie `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { BASE_ISO, CHAT_IDS, chatMessage, isoOffset, messageRow } from "@/test/chat/fixtures";
import type { ChatMessage, MessageRow } from "@/lib/chat/types";
import type { ChatAttachmentRow } from "@/lib/chat/useMessages";
import type { StarredEntry } from "@/lib/chat/stars";

interface QueryCall {
  readonly conversationId: string;
  readonly enabled: boolean;
}

const h = vi.hoisted(() => ({
  attachments: {
    data: undefined as ReadonlyArray<ChatAttachmentRow> | undefined,
    isLoading: false,
  },
  starred: { data: undefined as ReadonlyArray<StarredEntry> | undefined, isLoading: false },
  attachmentCalls: [] as QueryCall[],
  starredCalls: [] as QueryCall[],
  requestedPaths: [] as Array<string | null>,
  /** Podpisane URL-e per ścieżka; brak wpisu = URL jeszcze nie wrócił. */
  urlByPath: {} as Record<string, string>,
}));

// Odczyt listy załączników rozmowy - łańcuch PostgREST ma własny plik testowy.
// Atrapa REJESTRUJE argumenty, bo panel steruje flagą `enabled` (tryb bota
// podaje wiersze lokalnie i NIE wolno mu odpytywać bazy).
vi.mock("@/lib/chat/useMessages", () => ({
  useConversationAttachments: (conversationId: string, enabled: boolean) => {
    h.attachmentCalls.push({ conversationId, enabled });
    return { data: h.attachments.data, isLoading: h.attachments.isLoading };
  },
}));

vi.mock("@/lib/chat/stars", () => ({
  useStarredMessages: (conversationId: string, enabled: boolean) => {
    h.starredCalls.push({ conversationId, enabled });
    return { data: h.starred.data, isLoading: h.starred.isLoading };
  },
}));

// Częściowa atrapa: `formatBytes` PRAWDZIWY (ma własne testy i to jego wynik
// czyta użytkownik pod nazwą pliku). Podmieniamy sam `useAttachmentUrl`, bo
// podpisany URL przychodzi z react-query + Storage, a tu testujemy render.
vi.mock("@/lib/chat/attachments", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/chat/attachments")>();
  return {
    ...real,
    useAttachmentUrl: (path: string | null) => {
      h.requestedPaths.push(path);
      return { data: path ? h.urlByPath[path] : undefined, isLoading: false };
    },
  };
});

import { formatBytes } from "@/lib/chat/attachments";
import { clockTime, dayLabel } from "@/lib/chat/time";
import { ChatMediaPanel } from "../ChatMediaPanel";
import { MediaHistoryDialog, type MediaHistoryDialogProps } from "../MediaHistoryDialog";

const t = chatPl.chat;

/** i18next podstawia `{{...}}`; test nie może wpisywać przetłumaczonego literału. */
function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => String(vars[key]));
}

function pathOf(fileName: string): string {
  return `${CHAT_IDS.tenant}/${CHAT_IDS.conversation}/${CHAT_IDS.peer}/${fileName}`;
}

function signedUrl(fileName: string): string {
  return `https://storage.example.org/podpisane/${fileName}`;
}

// PDF celowo jako `data:`, a NIE `https:` - podgląd montuje prawdziwy <iframe>,
// który happy-dom próbowałby realnie pobrać (test wychodziłby do sieci).
const PDF_URL = "data:application/pdf;base64,JVBERi0xLjQK";

/**
 * `ChatAttachmentRow` to PROJEKCJA wiersza `messages` (osiem kolumn wybranych
 * przez `useConversationAttachments`), a nie osobna tabela - dlatego identyfikator,
 * nadawcę i znacznik czasu bierzemy z fabryki `messageRow`. Rozjazd tych kolumn
 * w migracji wychodzi więc także tutaj.
 */
function attachmentRow(overrides: Partial<ChatAttachmentRow> = {}): ChatAttachmentRow {
  // Bez przekazywania `overrides` do `messageRow`: klucz o wartości `undefined`
  // NADPISUJE wartość domyślną w rozwinięciu obiektu, więc wiersz wychodziłby
  // z pustym identyfikatorem i nieprawidłową datą.
  const base: MessageRow = messageRow();
  return {
    id: base.id,
    created_at: base.created_at,
    sender_id: base.sender_id,
    kind: "file",
    attachment_path: pathOf("raport.pdf"),
    attachment_name: "raport.pdf",
    attachment_mime: "application/pdf",
    attachment_size: 2048,
    ...overrides,
  };
}

/** Wiersz-zdjęcie: własna ścieżka i nazwa, żeby dało się rozróżnić kafelki. */
function photoRow(n: number, overrides: Partial<ChatAttachmentRow> = {}): ChatAttachmentRow {
  const name = `zdjecie-${n}.png`;
  return attachmentRow({
    id: `msg-foto-${n}`,
    kind: "image",
    attachment_path: pathOf(name),
    attachment_name: name,
    attachment_mime: "image/png",
    attachment_size: 4096,
    created_at: isoOffset(n),
    ...overrides,
  });
}

/** Wiadomość-zdjęcie dla dialogu historii (ten czyta cały `ChatMessage`). */
function photoMessage(n: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  const name = `zdjecie-${n}.png`;
  return chatMessage({
    id: `msg-foto-${n}`,
    kind: "image",
    body: null,
    created_at: isoOffset(n),
    attachment_path: pathOf(name),
    attachment_name: name,
    attachment_mime: "image/png",
    attachment_size: 4096,
    ...overrides,
  });
}

function fileMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return chatMessage({
    id: "msg-plik",
    kind: "file",
    body: null,
    created_at: BASE_ISO,
    attachment_path: pathOf("raport.pdf"),
    attachment_name: "raport.pdf",
    attachment_mime: "application/pdf",
    attachment_size: 2048,
    ...overrides,
  });
}

beforeEach(() => {
  h.attachments = { data: undefined, isLoading: false };
  h.starred = { data: undefined, isLoading: false };
  h.attachmentCalls = [];
  h.starredCalls = [];
  h.requestedPaths = [];
  h.urlByPath = {};
});

afterEach(() => cleanup());

// --- ChatMediaPanel ---------------------------------------------------------

function renderPanel(overrides: Partial<React.ComponentProps<typeof ChatMediaPanel>> = {}) {
  const props = {
    conversationId: CHAT_IDS.conversation,
    enabled: true,
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<ChatMediaPanel {...props} />), props };
}

/** Zakładka panelu: etykieta niesie licznik, więc szukamy po fragmencie nazwy. */
function panelTab(label: string): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(label) });
}

describe("ChatMediaPanel - boczny panel mediów", () => {
  it("panel i pasek zakładek są opisane dla czytnika ekranu", () => {
    h.attachments.data = [];
    renderPanel();
    expect(screen.getByRole("complementary", { name: t.mediaPanel.title })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: t.mediaPanel.title })).toBeTruthy();
  });

  it("zanim lista wróci, widać komunikat ładowania, a NIE pustą siatkę", () => {
    h.attachments.isLoading = true;
    const { container } = renderPanel();

    expect(screen.getByText(t.mediaPanel.loading)).toBeTruthy();
    expect(container.querySelector(".grid")).toBeNull();
    expect(screen.queryByText(t.mediaPanel.emptyPhotos)).toBeNull();
  });

  it("rozmowa BEZ załączników NIE renderuje pustej siatki, tylko komunikat", () => {
    h.attachments.data = [];
    const { container } = renderPanel();

    expect(screen.getByText(t.mediaPanel.emptyPhotos)).toBeTruthy();
    expect(container.querySelector(".grid")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);

    fireEvent.click(panelTab(t.mediaPanel.tabFiles));
    expect(screen.getByText(t.mediaPanel.emptyFiles)).toBeTruthy();
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("siatka miniatur pokazuje podpisane zdjęcia, a licznik zakładki - ich liczbę", () => {
    h.attachments.data = [photoRow(1), photoRow(2)];
    h.urlByPath[pathOf("zdjecie-1.png")] = signedUrl("zdjecie-1.png");
    h.urlByPath[pathOf("zdjecie-2.png")] = signedUrl("zdjecie-2.png");
    const { container } = renderPanel();

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("src")).toBe(signedUrl("zdjecie-1.png"));
    expect(images[0].getAttribute("loading")).toBe("lazy");
    expect(panelTab(t.mediaPanel.tabPhotos).textContent).toContain("(2)");
    expect(panelTab(t.mediaPanel.tabFiles).textContent).toContain("(0)");

    const tile = screen.getByRole("link", { name: "zdjecie-1.png" });
    expect(tile.getAttribute("href")).toBe(signedUrl("zdjecie-1.png"));
    expect(tile.getAttribute("rel")).toBe("noopener noreferrer");
    expect(tile.className).not.toContain("pointer-events-none");
  });

  it("miniatura BEZ podpisanego URL-a nie zostawia złamanego obrazka ani żywego linku", () => {
    h.attachments.data = [photoRow(1)];
    const { container } = renderPanel();

    expect(container.querySelectorAll("img")).toHaveLength(0);
    const tile = screen.getByRole("link", { name: "zdjecie-1.png" });
    expect(tile.getAttribute("href")).toBe("#");
    expect(tile.className).toContain("pointer-events-none");
    // Kafelek MUSI zapytać o podpis dokładnie tej ścieżki, a nie żadnej innej.
    expect(h.requestedPaths).toContain(pathOf("zdjecie-1.png"));
  });

  it("załącznik z typem obrazu trafia do zdjęć, nawet gdy wiersz ma rodzaj `file`", () => {
    // Rodzaj wiersza bywa `file` dla obrazów przysłanych jako dokument -
    // o zakładce decyduje MIME, inaczej zdjęcie ginie w liście plików.
    h.attachments.data = [
      attachmentRow({ id: "msg-a", kind: "file", attachment_mime: "image/webp" }),
    ];
    renderPanel();
    expect(panelTab(t.mediaPanel.tabPhotos).textContent).toContain("(1)");
    expect(panelTab(t.mediaPanel.tabFiles).textContent).toContain("(0)");
  });

  it("sekcja plików niesie nazwę, rozmiar i datę załącznika", () => {
    h.attachments.data = [attachmentRow()];
    h.urlByPath[pathOf("raport.pdf")] = signedUrl("raport.pdf");
    const { container } = renderPanel();

    fireEvent.click(panelTab(t.mediaPanel.tabFiles));

    expect(screen.getByText("raport.pdf")).toBeTruthy();
    const link = container.querySelector("a[download]");
    expect(link?.getAttribute("download")).toBe("raport.pdf");
    expect(link?.getAttribute("href")).toBe(signedUrl("raport.pdf"));
    expect(link?.textContent).toContain(`${formatBytes(2048, "pl")} - `);
    // Data załącznika - rok wystarczy, żeby dowieść, że nie zniknęła.
    expect(link?.textContent).toContain(new Date(BASE_ISO).getFullYear().toString());
  });

  it("bez nazwy wiersz pliku pokazuje ostatni segment ścieżki, a nie pustkę", () => {
    h.attachments.data = [attachmentRow({ attachment_name: null })];
    renderPanel();
    fireEvent.click(panelTab(t.mediaPanel.tabFiles));
    expect(screen.getByText("raport.pdf")).toBeTruthy();
  });

  it("nieznany rozmiar NIE dorabia separatora ani zera - zostaje sama data", () => {
    h.attachments.data = [attachmentRow({ attachment_size: null })];
    const { container } = renderPanel();
    fireEvent.click(panelTab(t.mediaPanel.tabFiles));

    const meta = container.querySelector("a span span:nth-of-type(2)");
    expect(meta?.textContent).not.toContain(" - ");
    expect(meta?.textContent).not.toContain(formatBytes(0, "pl"));
  });

  it("pobieranie jest ZABLOKOWANE, dopóki podpisany URL nie wróci", () => {
    h.attachments.data = [attachmentRow()];
    const { container } = renderPanel();
    fireEvent.click(panelTab(t.mediaPanel.tabFiles));

    const link = container.querySelector("a[download]");
    expect(link?.getAttribute("href")).toBe("#");
    expect(link?.className).toContain("pointer-events-none");
  });

  it("wiersz pliku używa JEDNEJ ikony dokumentu niezależnie od MIME", () => {
    // Rozróżnienie MIME -> rodzina ikony żyje w dymku (`AttachmentContent`
    // + `attachmentPresentation`). Lista panelu jest celowo jednorodna, więc
    // arkusz i prezentacja dostają tę samą ikonę co PDF.
    h.attachments.data = [
      attachmentRow({ id: "msg-a", attachment_mime: "text/csv", attachment_name: "dane.csv" }),
      attachmentRow({
        id: "msg-b",
        attachment_mime: "application/vnd.ms-powerpoint",
        attachment_name: "agenda.ppt",
        attachment_path: pathOf("agenda.ppt"),
      }),
    ];
    const { container } = renderPanel();
    fireEvent.click(panelTab(t.mediaPanel.tabFiles));

    const iconClasses = [...container.querySelectorAll("a svg")].map((svg) =>
      svg.getAttribute("class"),
    );
    expect(iconClasses).toHaveLength(4); // ikona pliku + ikona pobierania na wiersz
    expect(iconClasses[0]).toContain("lucide-file-text");
    expect(iconClasses[2]).toContain("lucide-file-text");
  });

  it("przełączanie zakładek podmienia zawartość i ogłasza wybór", () => {
    h.attachments.data = [photoRow(1), attachmentRow({ id: "msg-plik" })];
    h.urlByPath[pathOf("zdjecie-1.png")] = signedUrl("zdjecie-1.png");
    renderPanel();

    expect(panelTab(t.mediaPanel.tabPhotos).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "zdjecie-1.png" })).toBeTruthy();
    expect(screen.queryByText("raport.pdf")).toBeNull();

    fireEvent.click(panelTab(t.mediaPanel.tabFiles));

    expect(panelTab(t.mediaPanel.tabFiles).getAttribute("aria-selected")).toBe("true");
    expect(panelTab(t.mediaPanel.tabPhotos).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("raport.pdf")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "zdjecie-1.png" })).toBeNull();
  });

  it("zamknięcie panelu zgłasza się do okna rozmowy", () => {
    h.attachments.data = [];
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: t.mediaPanel.close }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("wyłączony panel NIE odpytuje bazy o załączniki", () => {
    h.attachments.data = [];
    renderPanel({ enabled: false });
    expect(h.attachmentCalls.every((call) => call.enabled === false)).toBe(true);
    expect(h.attachmentCalls[0].conversationId).toBe(CHAT_IDS.conversation);
  });

  it("tryb lokalny (bot demo) rysuje podane wiersze i NIE dotyka bazy ani gwiazdek", () => {
    const { container } = renderPanel({ localRows: [attachmentRow()] });

    // Wiersze z propsa wygrywają, a oba zapytania zdalne zostają wyłączone.
    expect(h.attachmentCalls.every((call) => call.enabled === false)).toBe(true);
    expect(h.starredCalls.every((call) => call.enabled === false)).toBe(true);
    // Bez zakładki gwiazdek - bot demo nie ma prywatnych oznaczeń.
    expect(screen.queryByRole("tab", { name: new RegExp(t.mediaPanel.tabStarred) })).toBeNull();
    fireEvent.click(panelTab(t.mediaPanel.tabFiles));
    expect(screen.getByText("raport.pdf")).toBeTruthy();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });
});

describe("ChatMediaPanel - zakładka gwiazdek", () => {
  function starred(overrides: Partial<StarredEntry> = {}): StarredEntry {
    return {
      message_id: CHAT_IDS.message,
      created_at: BASE_ISO,
      message: messageRow(),
      ...overrides,
    };
  }

  function openStarredTab(): void {
    fireEvent.click(panelTab(t.mediaPanel.tabStarred));
  }

  it("gwiazdki są dociągane DOPIERO po wejściu w zakładkę", () => {
    h.attachments.data = [];
    h.starred.data = [];
    renderPanel();

    expect(h.starredCalls.every((call) => call.enabled === false)).toBe(true);
    openStarredTab();
    expect(h.starredCalls.some((call) => call.enabled === true)).toBe(true);
  });

  it("pusta lista gwiazdek mówi to wprost", () => {
    h.attachments.data = [];
    h.starred.data = [];
    renderPanel();
    openStarredTab();
    expect(screen.getByText(t.mediaPanel.emptyStarred)).toBeTruthy();
  });

  it("ładowanie gwiazdek ma własny komunikat, nie pustą listę", () => {
    h.attachments.data = [];
    h.starred.isLoading = true;
    renderPanel();
    openStarredTab();
    expect(screen.getByText(t.mediaPanel.loading)).toBeTruthy();
    expect(screen.queryByText(t.mediaPanel.emptyStarred)).toBeNull();
  });

  it("oznaczona wiadomość pokazuje treść i godzinę", () => {
    h.attachments.data = [];
    h.starred.data = [starred({ message: messageRow({ body: "Ustalenia z narady" }) })];
    renderPanel();
    openStarredTab();

    expect(screen.getByText("Ustalenia z narady")).toBeTruthy();
    expect(screen.getByText(clockTime(BASE_ISO, "pl"))).toBeTruthy();
  });

  it("oznaczona notatka głosowa i zdjęcie bez nazwy dostają etykietę zastępczą", () => {
    h.attachments.data = [];
    h.starred.data = [
      starred({
        message_id: "msg-audio",
        message: messageRow({ id: "msg-audio", kind: "audio", body: null }),
      }),
      starred({
        message_id: "msg-foto",
        message: messageRow({ id: "msg-foto", kind: "image", body: null }),
      }),
      starred({
        message_id: "msg-plik",
        message: messageRow({ id: "msg-plik", kind: "file", body: null }),
      }),
    ];
    renderPanel();
    openStarredTab();

    expect(screen.getByText(t.voice.message)).toBeTruthy();
    expect(screen.getByText(t.photo)).toBeTruthy();
    expect(screen.getByText(t.file)).toBeTruthy();
  });

  it("wpis, któremu RLS zdjęło wiadomość, nie zostawia pustego kafelka", () => {
    // Wiadomość mogła wygasnąć (`expires_at`) albo zostać wyczyszczona
    // „tylko u mnie" - wpis gwiazdki zostaje, ale nie ma czego pokazać.
    h.attachments.data = [];
    h.starred.data = [starred({ message: null })];
    const { container } = renderPanel();
    openStarredTab();

    expect(container.querySelectorAll(".rounded-\\[6px\\].border")).toHaveLength(0);
    expect(screen.queryByText(t.mediaPanel.emptyStarred)).toBeNull();
  });
});

// --- MediaHistoryDialog -----------------------------------------------------

function historyProps(overrides: Partial<MediaHistoryDialogProps> = {}): MediaHistoryDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    messages: [],
    lang: "pl",
    ...overrides,
  };
}

function renderHistory(overrides: Partial<MediaHistoryDialogProps> = {}) {
  const props = historyProps(overrides);
  return { ...render(<MediaHistoryDialog {...props} />), props };
}

/** Radix przełącza zakładkę na `mousedown`, a nie na `click`. */
function switchHistoryTab(label: string): void {
  const trigger = screen.getByRole("tab", { name: new RegExp(label) });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
}

describe("MediaHistoryDialog - otwarcie, zakładki i stany puste", () => {
  it("zamknięty dialog nie zostawia po sobie DOM-u", () => {
    renderHistory({ open: false, messages: [photoMessage(1)] });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("otwarty dialog nazywa się i tłumaczy, po co jest", () => {
    renderHistory();
    expect(screen.getByText(t.mediaHistory.title)).toBeTruthy();
    expect(screen.getByText(t.mediaHistory.subtitle)).toBeTruthy();
  });

  it("liczniki zakładek dzielą załączniki na multimedia i pliki", () => {
    renderHistory({ messages: [photoMessage(1), photoMessage(2), fileMessage()] });

    expect(
      screen.getByRole("tab", { name: new RegExp(t.mediaHistory.tabMedia) }).textContent,
    ).toContain("2");
    expect(
      screen.getByRole("tab", { name: new RegExp(t.mediaHistory.tabFiles) }).textContent,
    ).toContain("1");
  });

  it("rozmowa BEZ załączników pokazuje komunikat w OBU zakładkach, a nie pustą siatkę", () => {
    const { baseElement } = renderHistory({ messages: [chatMessage({ body: "Sam tekst" })] });

    expect(screen.getByText(t.mediaHistory.emptyMedia)).toBeTruthy();
    expect(baseElement.querySelector(".grid-cols-3")).toBeNull();

    switchHistoryTab(t.mediaHistory.tabFiles);
    expect(screen.getByText(t.mediaHistory.emptyFiles)).toBeTruthy();
  });

  it("wiadomość cofnięta i wiadomość bez pliku NIE trafiają do historii", () => {
    renderHistory({
      messages: [
        photoMessage(1, { deleted_at: isoOffset(5) }),
        chatMessage({ id: "msg-tekst", body: "Bez załącznika" }),
        chatMessage({ id: "msg-pusty", kind: "image", attachment_path: null }),
      ],
    });
    expect(screen.getByText(t.mediaHistory.emptyMedia)).toBeTruthy();
  });

  it("nagranie głosowe i wideo liczą się jako plik, nie jako multimedia", () => {
    renderHistory({
      messages: [
        fileMessage({
          id: "msg-audio",
          kind: "audio",
          attachment_name: "notatka.webm",
          attachment_mime: "audio/webm",
          attachment_path: pathOf("notatka.webm"),
        }),
      ],
    });
    expect(screen.getByText(t.mediaHistory.emptyMedia)).toBeTruthy();
    switchHistoryTab(t.mediaHistory.tabFiles);
    expect(screen.getByText("notatka.webm")).toBeTruthy();
  });

  it("zamknięcie dialogu zgłasza się do okna rozmowy", () => {
    const { props } = renderHistory({ messages: [photoMessage(1)] });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("MediaHistoryDialog - ImageTile", () => {
  it("kafelek bez podpisanego URL-a pokazuje szkielet opisany dla czytnika, nie pusty obrazek", () => {
    const { baseElement } = renderHistory({ messages: [photoMessage(1)] });

    expect(screen.getByLabelText(t.mediaHistory.loading)).toBeTruthy();
    expect(baseElement.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "zdjecie-1.png" })).toBeNull();
    expect(h.requestedPaths).toContain(pathOf("zdjecie-1.png"));
  });

  it("kafelek z URL-em niesie miniaturę, nazwę i godzinę wysłania", () => {
    h.urlByPath[pathOf("zdjecie-1.png")] = signedUrl("zdjecie-1.png");
    const { baseElement } = renderHistory({ messages: [photoMessage(1)] });

    const tile = screen.getByRole("button", { name: "zdjecie-1.png" });
    expect(tile.getAttribute("title")).toBe(`zdjecie-1.png - ${clockTime(isoOffset(1), "pl")}`);
    const image = baseElement.querySelector("img");
    expect(image?.getAttribute("src")).toBe(signedUrl("zdjecie-1.png"));
    expect(image?.getAttribute("alt")).toBe("zdjecie-1.png");
    expect(image?.getAttribute("loading")).toBe("lazy");
  });

  it("zdjęcie bez nazwy zachowuje etykietę zastępczą - kafelek zostaje klikalny", () => {
    h.urlByPath[pathOf("zdjecie-1.png")] = signedUrl("zdjecie-1.png");
    renderHistory({ messages: [photoMessage(1, { attachment_name: null })] });
    expect(screen.getByRole("button", { name: t.photo })).toBeTruthy();
  });

  it("najnowsze zdjęcia stoją na górze galerii", () => {
    for (const n of [1, 2, 3])
      h.urlByPath[pathOf(`zdjecie-${n}.png`)] = signedUrl(`zdjecie-${n}.png`);
    renderHistory({ messages: [photoMessage(1), photoMessage(2), photoMessage(3)] });

    const labels = screen
      .getAllByRole("button")
      .map((el) => el.getAttribute("aria-label"))
      .filter((label): label is string => label !== null && label.startsWith("zdjecie-"));
    expect(labels).toEqual(["zdjecie-3.png", "zdjecie-2.png", "zdjecie-1.png"]);
  });

  it("klik w miniaturę otwiera pełnoekranowy podgląd TEGO zdjęcia", () => {
    for (const n of [1, 2, 3])
      h.urlByPath[pathOf(`zdjecie-${n}.png`)] = signedUrl(`zdjecie-${n}.png`);
    renderHistory({ messages: [photoMessage(1), photoMessage(2), photoMessage(3)] });

    expect(screen.queryByRole("button", { name: t.preview.close })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "zdjecie-2.png" }));

    expect(screen.getByRole("button", { name: t.preview.close })).toBeTruthy();
    // Pobieranie z paska podglądu celuje w KLIKNIĘTE zdjęcie, nie w pierwsze.
    const download = screen.getByRole("link", { name: t.preview.download });
    expect(download.getAttribute("href")).toBe(signedUrl("zdjecie-2.png"));
    expect(download.getAttribute("download")).toBe("zdjecie-2.png");
  });

  it.fails(
    "podgląd otwarty z galerii pozwala przejść do sąsiednich zdjęć (DEFEKT: dostaje jedno zdjęcie)",
    () => {
      // ZŁAMANY KONTRAKT: `MediaHistoryDialog` deklaruje w nagłówku pliku
      // „Zdjęcia otwierają wspólny ImageLightbox z nawigacją Prev/Next po całej
      // galerii", ale przekazuje `images={lightbox ? [lightbox] : []}`
      // i `index={0}` (MediaHistoryDialog.tsx:243-248), czyli galerię
      // JEDNOELEMENTOWĄ. `ImageLightbox` chowa licznik i strzałki przy
      // `total <= 1`, więc z historii mediów nie da się przewinąć do
      // następnego zdjęcia - trzeba zamknąć podgląd i kliknąć kolejny kafelek.
      // OCZEKIWANY KONTRAKT: podgląd dostaje CAŁĄ galerię (`images` = wszystkie
      // zdjęcia historii) oraz `index` klikniętego kafelka wraz z
      // `onIndexChange`, więc po kliknięciu drugiego z trzech zdjęć widać
      // licznik „2 z 3" i obie strzałki.
      for (const n of [1, 2, 3]) {
        h.urlByPath[pathOf(`zdjecie-${n}.png`)] = signedUrl(`zdjecie-${n}.png`);
      }
      renderHistory({ messages: [photoMessage(1), photoMessage(2), photoMessage(3)] });

      fireEvent.click(screen.getByRole("button", { name: "zdjecie-2.png" }));

      expect(screen.getByText(fill(t.preview.counter, { index: 2, total: 3 }))).toBeTruthy();
      expect(screen.getByRole("button", { name: t.preview.prev })).toBeTruthy();
      expect(screen.getByRole("button", { name: t.preview.next })).toBeTruthy();
    },
  );
});

describe("MediaHistoryDialog - FileRow", () => {
  function openFiles(): void {
    switchHistoryTab(t.mediaHistory.tabFiles);
  }

  it("wiersz pliku niesie nazwę, rozmiar i dzień z godziną", () => {
    renderHistory({ messages: [fileMessage()] });
    openFiles();

    expect(screen.getByText("raport.pdf")).toBeTruthy();
    const expectedDay = dayLabel(BASE_ISO, "pl", { today: t.today, yesterday: t.yesterday });
    expect(
      screen.getByText(
        `${formatBytes(2048, "pl")} - ${expectedDay} - ${clockTime(BASE_ISO, "pl")}`,
      ),
    ).toBeTruthy();
  });

  it("rozmiar jest liczony w języku rozmowy, nie w języku przeglądarki", () => {
    renderHistory({ messages: [fileMessage({ attachment_size: 1536 })], lang: "en" });
    openFiles();
    // 1,5 KB (pl) kontra 1.5 KB (en) - separator dziesiętny idzie z propsa.
    expect(screen.getByText(new RegExp(formatBytes(1536, "en")))).toBeTruthy();
    expect(screen.queryByText(new RegExp(formatBytes(1536, "pl")))).toBeNull();
  });

  it("nieznany rozmiar pokazuje zero, a nie puste miejsce", () => {
    renderHistory({ messages: [fileMessage({ attachment_size: null })] });
    openFiles();
    expect(screen.getByText(new RegExp(formatBytes(0, "pl")))).toBeTruthy();
  });

  it("bez podpisanego URL-a NIE ma czego pobrać ani podejrzeć", () => {
    renderHistory({ messages: [fileMessage()] });
    openFiles();

    expect(screen.getByText("raport.pdf")).toBeTruthy();
    expect(screen.queryByRole("link", { name: t.mediaHistory.download })).toBeNull();
    expect(screen.queryByRole("button", { name: t.preview.previewPdf })).toBeNull();
  });

  it("z podpisanym URL-em pobieranie podpowiada nazwę pliku i nie wynosi referrera", () => {
    h.urlByPath[pathOf("raport.pdf")] = PDF_URL;
    renderHistory({ messages: [fileMessage()] });
    openFiles();

    const link = screen.getByRole("link", { name: t.mediaHistory.download });
    expect(link.getAttribute("href")).toBe(PDF_URL);
    expect(link.getAttribute("download")).toBe("raport.pdf");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("przycisk podglądu istnieje WYŁĄCZNIE dla PDF-a", () => {
    h.urlByPath[pathOf("notatka.txt")] = "https://storage.example.org/podpisane/notatka.txt";
    renderHistory({
      messages: [
        fileMessage({
          attachment_name: "notatka.txt",
          attachment_mime: "text/plain",
          attachment_path: pathOf("notatka.txt"),
        }),
      ],
    });
    openFiles();

    expect(screen.getByRole("link", { name: t.mediaHistory.download })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.preview.previewPdf })).toBeNull();
  });

  it("podgląd PDF-a otwiera natywną przeglądarkę w iframie", () => {
    h.urlByPath[pathOf("raport.pdf")] = PDF_URL;
    const { baseElement } = renderHistory({ messages: [fileMessage()] });
    openFiles();
    expect(baseElement.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t.preview.previewPdf }));

    const iframe = baseElement.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(`${PDF_URL}#toolbar=1&navpanes=0`);
    expect(iframe?.getAttribute("title")).toBe("raport.pdf");
  });

  it("wiersz pliku używa JEDNEJ ikony dokumentu niezależnie od MIME", () => {
    // Tak samo jak w panelu bocznym: macierz MIME -> ikona żyje w dymku
    // (`AttachmentContent`), historia jest celowo jednorodna.
    renderHistory({
      messages: [
        fileMessage({ id: "msg-csv", attachment_name: "dane.csv", attachment_mime: "text/csv" }),
      ],
    });
    openFiles();

    const icon = screen.getByText("dane.csv").closest("div")?.parentElement?.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("lucide-file-text");
  });

  it("najnowsze pliki stoją na górze listy", () => {
    renderHistory({
      messages: [
        fileMessage({ id: "msg-stary", attachment_name: "stary.pdf", created_at: BASE_ISO }),
        fileMessage({
          id: "msg-nowy",
          attachment_name: "nowy.pdf",
          attachment_path: pathOf("nowy.pdf"),
          created_at: isoOffset(10),
        }),
      ],
    });
    openFiles();

    const names = screen
      .getAllByText(/\.pdf$/)
      .map((el) => el.textContent)
      .filter((name): name is string => name !== null);
    expect(names).toEqual(["nowy.pdf", "stary.pdf"]);
  });
});
