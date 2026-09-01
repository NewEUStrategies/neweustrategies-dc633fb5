/*
 * DemoBotChat - dowody GAŁĘZIOWE, nie kolejny render.
 *
 * PO CO TEN PLIK ISTNIEJE. Podgląd bota ma już dwa pliki testowe
 * (`DemoBotChat.test.tsx` - happy path wysyłki i reakcji, `DemoBotChat
 * .contract.test.tsx` - kontrakt propsów z `MessageList`), a mimo to co druga
 * gałąź komponentu była nietrafiona: 70% linii przy 38% gałęzi. Powód jest
 * prosty - wyrenderowanie komponentu przechodzi przez jego LINIE, ale nie
 * przez jego WARUNKI. Ten plik dobiera się wyłącznie do warunków, których
 * tamte dwa pliki nie dotykają, i nie powtarza ich dowodów.
 *
 * PRZEDMIOT DOWODU (rzeczy, które psują się użytkownikowi):
 *   - scenariusz bota: przywitanie / pytanie / echo z obcięciem do 240 znaków
 *     oraz próg `Math.min` na czasie „pisze..." (krótka odpowiedź przychodzi
 *     wcześniej niż długa),
 *   - blokada kompozytora na czas odpowiedzi bota (Enter nie dokłada drugiej
 *     wiadomości, spinacz i wysyłka są wyłączone),
 *   - reakcje: ta sama emotka zdejmuje, inna PODMIENIA (semantyka Messengera),
 *   - pasek odpowiedzi: autor „Ty" kontra nazwa bota, wyjście przez Escape
 *     i przez krzyżyk, wpięcie echa jako odpowiedzi na moją wiadomość,
 *   - usunięcie własnej wiadomości: nagrobek i zniknięcie reakcji bota,
 *   - lokalne załączniki: limit 30 MB, allowlista MIME, anulowany wybór,
 *     podmiana podglądu (zwolnienie `blob:`), obraz kontra dokument,
 *     wysyłka z podpisem i bez, panel „Multimedia i pliki",
 *   - `lang: "en"` obok `pl` - rozmiar pliku z kropką zamiast przecinka,
 *   - brak sesji kontra zalogowany użytkownik z/bez zdjęcia profilowego,
 *   - `onBack` (powrót do listy rozmów na wąskim ekranie).
 *
 * ŚWIADOMIE POZA ZAKRESEM: `prefers-reduced-motion` i przewijanie listy -
 * to gałęzie `MessageList`, nie `DemoBotChat` (podgląd nie czyta tego media
 * query); klasa `md:hidden` przy strzałce wstecz jest czystym CSS, więc
 * „wąski ekran" dowodzimy przez OBECNOŚĆ przycisku i wywołanie `onBack`.
 *
 * RODO: żadnych prawdziwych osób - profil testowy to „Zofia Testowa",
 * adresy wyłącznie w `example.org`, nazwy plików i treści zmyślone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { PeerProfile } from "@/lib/chat/types";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { CHAT_IDS, peerProfile, peerProfileMap } from "@/test/chat/fixtures";
import { MAX_ATTACHMENT_BYTES } from "@/lib/chat/attachments";
import { QUICK_REACTIONS } from "@/lib/chat/emojiQuick";

const h = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null },
  /** Identyfikatory, o które podgląd poprosił warstwę profili (per render). */
  peerRequests: [] as ReadonlyArray<string>[],
  peers: null as ReadonlyMap<string, PeerProfile> | null,
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.auth.user, tenantId: null }),
}));

// Warstwa profili ma własne testy (`src/lib/chat/__tests__`). Tutaj liczy się
// wyłącznie to, O CO podgląd pyta i co robi z odpowiedzią - nie sam odczyt.
vi.mock("@/lib/chat/useConversations", () => ({
  usePeerProfiles: (ids: ReadonlyArray<string>) => {
    h.peerRequests.push(ids);
    return { data: h.peers };
  },
}));

vi.mock("sonner", () => ({ toast: h.toast }));

import { DemoBotChat, type DemoBotChatProps } from "../DemoBotChat";

const t = chatPl.chat;

/** Zdjęcie profilowe testowej tożsamości - domena wyłącznie przykładowa. */
const MY_AVATAR = "https://example.org/zofia-testowa.png";

let createdUrls: string[] = [];
let revokedUrls: string[] = [];

function renderDemo(overrides: Partial<DemoBotChatProps> = {}) {
  return renderWithQueryClient(<DemoBotChat lang="pl" {...overrides} />);
}

/**
 * Pole treści. `aria-label` NIE zmienia się przy załączniku (zmienia się tylko
 * `placeholder`), więc etykieta jest stabilnym uchwytem do całego pliku.
 */
function textarea(): HTMLTextAreaElement {
  const el = screen.getByLabelText(t.inputPlaceholder);
  if (!(el instanceof HTMLTextAreaElement)) {
    throw new Error("test: podgląd demo nie renderuje pola treści");
  }
  return el;
}

function type(value: string): void {
  fireEvent.change(textarea(), { target: { value } });
}

function submit(): void {
  const form = textarea().closest("form");
  if (!form) throw new Error("test: pole treści jest poza formularzem");
  fireEvent.submit(form);
}

/** Przesunięcie zegara bota (potwierdzenia, „pisze...", odpowiedź). */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Wariant dla ścieżek z załącznikiem: dopuszcza mikrozadania wewnątrz `act`. */
async function tickAsync(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Plik o zadanym typie i rozmiarze bez alokowania megabajtów w teście. */
function fileOfSize(name: string, mime: string, size: number): File {
  const file = new File(["x"], name, { type: mime });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

function fileInput(): HTMLInputElement {
  const el = document.querySelector('input[type="file"]');
  if (!(el instanceof HTMLInputElement)) {
    throw new Error("test: podgląd demo nie ma ukrytego pola pliku");
  }
  return el;
}

/** `null` odwzorowuje anulowane okno wyboru pliku (pusta lista `files`). */
function pick(file: File | null): void {
  fireEvent.change(fileInput(), { target: { files: file ? [file] : [] } });
}

/** Etykieta paska cytatu („Odpowiadasz na wiadomość - <autor>"). */
function replyBarLabel(): HTMLElement {
  return screen.getByText((content) => content.startsWith(t.replyingTo));
}

function replyBarPresent(): boolean {
  return screen.queryByText((content) => content.startsWith(t.replyingTo)) !== null;
}

/** Druga linia paska cytatu: treść wiadomości albo nagrobek. */
function replyBarQuote(): string {
  const quote = replyBarLabel().nextElementSibling;
  if (!(quote instanceof HTMLElement)) {
    throw new Error("test: pasek odpowiedzi bez linii cytatu");
  }
  return quote.textContent ?? "";
}

/** Otwiera pasek szybkich reakcji przy n-tym dymku (0 = powitanie bota). */
function openQuickBar(index: number): void {
  fireEvent.click(screen.getAllByLabelText(t.react)[index]);
}

function pressedChip(): HTMLElement {
  return screen.getByRole("button", { pressed: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.auth.user = null;
  h.peers = null;
  h.peerRequests = [];
  h.toast.error.mockClear();
  h.toast.success.mockClear();
  createdUrls = [];
  revokedUrls = [];
  let seq = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:test/${(seq += 1)}`;
    createdUrls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revokedUrls.push(url);
  });
  // happy-dom nie implementuje płynnego przewijania używanego przez MessageList.
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => undefined);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("nagłówek podglądu", () => {
  it("strzałka wstecz wraca do listy rozmów, gdy panel dostał `onBack`", () => {
    const onBack = vi.fn();
    renderDemo({ onBack });
    fireEvent.click(screen.getByLabelText(t.back));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("bez `onBack` nagłówek nie pokazuje martwej strzałki wstecz", () => {
    renderDemo();
    expect(screen.queryByLabelText(t.back)).toBeNull();
  });

  it('podtytuł zmienia się w "pisze..." tylko na czas odpowiedzi bota', () => {
    renderDemo();
    expect(screen.getByText(t.demoBot.subtitle)).toBeTruthy();

    type("abc");
    submit();
    tick(700); // 650 ms: dostarczono -> bot zaczyna pisać

    expect(screen.getByText(t.typing)).toBeTruthy();
    expect(screen.queryByText(t.demoBot.subtitle)).toBeNull();
    // Ten sam stan steruje wskaźnikiem na liście, nie tylko podtytułem.
    expect(screen.getByLabelText(`${t.demoBot.name} ${t.typing}`)).toBeTruthy();

    tick(1000); // odpowiedź dochodzi w 1458 ms od wysłania
    expect(screen.getByText(t.demoBot.subtitle)).toBeTruthy();
    expect(screen.queryByText(t.typing)).toBeNull();
  });
});

describe("scenariusz odpowiedzi bota", () => {
  it("przywitanie dostaje odpowiedź powitalną, nie echo", () => {
    renderDemo();
    type("Hej bocie");
    submit();
    tick(3000);

    expect(screen.getByText(t.demoBot.replies.greeting)).toBeTruthy();
    expect(screen.queryByText(/^Echo:/)).toBeNull();
  });

  it("wiadomość zakończona znakiem zapytania dostaje odpowiedź o pytaniu", () => {
    renderDemo();
    type("Jak działa ten podgląd?  ");
    submit();
    tick(3000);

    expect(screen.getByText(t.demoBot.replies.question)).toBeTruthy();
  });

  // DEFEKT PRODUKCYJNY (`botReply` w `DemoBotChat.tsx`).
  // Wzorzec `/^(cześć|hej|hello|hi|witaj)\b/i` nie zadziała dla „Cześć":
  // `\b` w JS liczy się względem `\w` = [A-Za-z0-9_], a po „ć" NIGDY nie ma
  // granicy słowa. Skutek: najbardziej naturalne polskie powitanie - to samo,
  // którym bot otwiera wątek („Cześć! Jestem podglądowym botem...") - wraca
  // echem zamiast przywitania.
  // ZŁAMANY KONTRAKT: „Cześć" -> `chat.demoBot.replies.echo`.
  // OCZEKIWANY KONTRAKT: „Cześć" -> `chat.demoBot.replies.greeting`.
  it.fails('polskie "Cześć" wita się z botem, zamiast wracać echem', () => {
    renderDemo();
    type("Cześć");
    submit();
    tick(3000);

    expect(screen.getByText(t.demoBot.replies.greeting)).toBeTruthy();
  });

  it("echo przycina bardzo długą wiadomość do 240 znaków", () => {
    renderDemo();
    type("a".repeat(300));
    submit();
    tick(3000);

    expect(screen.getByText(`Echo: ${"a".repeat(240)}`)).toBeTruthy();
    expect(screen.queryByText(`Echo: ${"a".repeat(300)}`)).toBeNull();
  });

  it("krótka odpowiedź bota przychodzi przed limitem pisania", () => {
    renderDemo();
    type("abc");
    submit();

    tick(1000);
    expect(screen.queryByText("Echo: abc")).toBeNull();
    tick(600); // 1600 ms > 650 + (700 + 9*12)
    expect(screen.getByText("Echo: abc")).toBeTruthy();
  });

  it("długa odpowiedź czeka pełny limit pisania, a nie proporcjonalnie dłużej", () => {
    renderDemo();
    const echo = `Echo: ${"a".repeat(240)}`;
    type("a".repeat(300));
    submit();

    tick(1600); // krótkiej odpowiedzi taki czas by wystarczył
    expect(screen.queryByText(echo)).toBeNull();
    tick(600); // 2200 ms > 650 + 1400 (sufit z Math.min)
    expect(screen.getByText(echo)).toBeTruthy();
  });
});

describe("blokada kompozytora na czas odpowiedzi", () => {
  it("gdy bot pisze, Enter nie dokłada drugiej wiadomości i pole jej nie traci", () => {
    renderDemo();
    type("Pierwsza");
    submit();
    tick(700);

    expect(screen.getByLabelText(t.send)).toBeDisabled();
    expect(screen.getByLabelText(t.attach)).toBeDisabled();

    type("Druga");
    fireEvent.keyDown(textarea(), { key: "Enter" });
    // Wysyłka odpadła na straży `botTyping`, więc pole NIE zostało wyczyszczone.
    expect(textarea().value).toBe("Druga");

    tick(1000);
    expect(screen.getByLabelText(t.send)).not.toBeDisabled();
  });

  it("puste pole bez załącznika nie tworzy dymka", () => {
    renderDemo();
    expect(screen.getByLabelText(t.send)).toBeDisabled();

    fireEvent.keyDown(textarea(), { key: "Enter" });
    tick(3000);

    // W wątku nadal jest wyłącznie powitanie bota (jeden dymek z akcjami).
    expect(screen.getAllByLabelText(t.react)).toHaveLength(1);
  });

  it("Shift+Enter łamie linię, zamiast wysyłać", () => {
    renderDemo();
    type("pierwsza linia");
    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    tick(3000);

    expect(textarea().value).toBe("pierwsza linia");
    expect(screen.getAllByLabelText(t.react)).toHaveLength(1);
  });
});

describe("reakcje", () => {
  it("ta sama emotka drugi raz ZDEJMUJE reakcję - chip znika", () => {
    renderDemo();
    openQuickBar(0);
    fireEvent.click(screen.getByLabelText(QUICK_REACTIONS[0]));
    expect(pressedChip().getAttribute("data-emoji")).toBe(QUICK_REACTIONS[0]);

    fireEvent.click(pressedChip());

    expect(screen.queryByRole("button", { pressed: true })).toBeNull();
  });

  it("inna emotka PODMIENIA reakcję, zamiast dokładać drugą", () => {
    renderDemo();
    openQuickBar(0);
    fireEvent.click(screen.getByLabelText(QUICK_REACTIONS[0]));
    openQuickBar(0);
    fireEvent.click(screen.getByLabelText(QUICK_REACTIONS[1]));

    const chips = screen.getAllByRole("button", { pressed: true });
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute("data-emoji")).toBe(QUICK_REACTIONS[1]);
  });
});

describe("pasek odpowiedzi", () => {
  it("odpowiedź na wiadomość bota podpisuje pasek jego nazwą i cytuje treść", () => {
    renderDemo();
    fireEvent.click(screen.getAllByLabelText(t.reply)[0]);

    expect(replyBarLabel().textContent).toContain(t.demoBot.name);
    expect(replyBarQuote()).toBe(t.demoBot.welcome);
  });

  it('odpowiedź na WŁASNĄ wiadomość podpisuje pasek jako "Ty"', () => {
    renderDemo();
    type("Moja notatka");
    submit();
    tick(300); // koniec stanu „wysyłanie" - akcje dymka wracają

    fireEvent.click(screen.getAllByLabelText(t.reply)[1]);

    expect(replyBarLabel().textContent).toContain(t.you);
    expect(replyBarQuote()).toBe("Moja notatka");
  });

  it("wysłanie cytatu wpina echo bota jako odpowiedź na moją wiadomość", () => {
    renderDemo();
    fireEvent.click(screen.getAllByLabelText(t.reply)[0]);
    type("Odpowiadam na powitanie");
    submit();

    // Pasek znika natychmiast po wysłaniu.
    expect(replyBarPresent()).toBe(false);

    tick(3000);
    // Dwa cytaty: mój na powitaniu bota i echo bota na mojej wiadomości.
    expect(screen.getAllByLabelText(t.jumpToReplied)).toHaveLength(2);
  });

  it("bez cytowania echo bota nie udaje odpowiedzi na nic", () => {
    renderDemo();
    type("Zwykła wiadomość");
    submit();
    tick(3000);

    expect(screen.queryByLabelText(t.jumpToReplied)).toBeNull();
  });

  it("krzyżyk przy pasku anuluje cytowanie", () => {
    renderDemo();
    fireEvent.click(screen.getAllByLabelText(t.reply)[0]);
    fireEvent.click(screen.getByLabelText(t.close));

    expect(replyBarPresent()).toBe(false);
  });

  it("Escape najpierw anuluje cytat, a dopiero drugi zdejmuje załącznik", () => {
    renderDemo();
    fireEvent.click(screen.getAllByLabelText(t.reply)[0]);
    pick(fileOfSize("wykres.png", "image/png", 2048));

    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(replyBarPresent()).toBe(false);
    expect(screen.getByText("wykres.png")).toBeTruthy();

    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(screen.queryByText("wykres.png")).toBeNull();
  });

  // DEFEKT PRODUKCYJNY (`DemoBotChat.tsx`: `replyTo` to MIGAWKA wiadomości).
  // `handleDelete` przepisuje tablicę `messages`, ale nie odświeża stanu
  // `replyTo`, więc pasek cytatu dalej pokazuje treść wiadomości, która na
  // liście jest już nagrobkiem. Realny kompozytor (`ChatComposer`) ma ten
  // przypadek udowodniony w drugą stronę - patrz „cytat wiadomości cofniętej
  // pokazuje nagrobek, nie treść" w `ChatComposer.test.tsx` - bo tam `replyTo`
  // przychodzi z żywych danych.
  // ZŁAMANY KONTRAKT: po usunięciu cytowanej wiadomości pasek pokazuje jej treść.
  // OCZEKIWANY KONTRAKT: pasek pokazuje `chat.deletedMessage`.
  it.fails("pasek cytatu po usunięciu wiadomości pokazuje nagrobek, nie treść", () => {
    renderDemo();
    type("Treść do skasowania");
    submit();
    tick(300);

    fireEvent.click(screen.getAllByLabelText(t.reply)[1]);
    fireEvent.click(screen.getByLabelText(t.deleteMessage));

    expect(replyBarQuote()).toBe(t.deletedMessage);
  });
});

describe("usuwanie własnej wiadomości", () => {
  it("usunięcie zostawia nagrobek i zabiera reakcję dołożoną przez bota", () => {
    renderDemo();
    type("Wiadomość dłuższa niż dwadzieścia znaków");
    submit();
    tick(3000);
    expect(screen.getByRole("button", { pressed: false, name: /👍/ })).toBeTruthy();

    fireEvent.click(screen.getByLabelText(t.deleteMessage));

    expect(screen.getByText(t.deletedMessage)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /👍/ })).toBeNull();
    expect(screen.queryByText("Wiadomość dłuższa niż dwadzieścia znaków")).toBeNull();
  });

  it("usunięcie wiadomości bez reakcji też kończy się nagrobkiem", () => {
    renderDemo();
    type("ok");
    submit();
    tick(3000);
    // Krótka wiadomość (<= 20 znaków) nie dostaje reakcji bota.
    expect(screen.queryByRole("button", { name: /👍/ })).toBeNull();

    fireEvent.click(screen.getByLabelText(t.deleteMessage));

    expect(screen.getByText(t.deletedMessage)).toBeTruthy();
  });
});

describe("lokalne załączniki", () => {
  it("plik ponad 30 MB nie trafia do podglądu i nazywa przyczynę", () => {
    renderDemo();
    pick(fileOfSize("wielki.pdf", "application/pdf", MAX_ATTACHMENT_BYTES + 1));

    expect(h.toast.error).toHaveBeenCalledWith(t.attachmentTooLarge);
    expect(screen.queryByText("wielki.pdf")).toBeNull();
    expect(createdUrls).toHaveLength(0);
  });

  it("plik spoza allowlisty MIME odpada na typie (SVG to aktywna treść)", () => {
    renderDemo();
    pick(fileOfSize("ikona.svg", "image/svg+xml", 1024));

    expect(h.toast.error).toHaveBeenCalledWith(t.attachmentWrongType);
    expect(screen.queryByText("ikona.svg")).toBeNull();
  });

  it("spinacz otwiera systemowe okno wyboru pliku", () => {
    renderDemo();
    const opened = vi.spyOn(fileInput(), "click").mockImplementation(() => undefined);

    fireEvent.click(screen.getByLabelText(t.attach));

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("anulowane okno wyboru pliku niczego nie zmienia i nie krzyczy", () => {
    renderDemo();
    pick(null);

    expect(h.toast.error).not.toHaveBeenCalled();
    expect(createdUrls).toHaveLength(0);
    expect(screen.getByPlaceholderText(t.inputPlaceholder)).toBeTruthy();
  });

  it("obraz czeka z miniaturą, nazwą, rozmiarem i podmienionym podpowiadaczem", () => {
    const { container } = renderDemo();
    pick(fileOfSize("wykres.png", "image/png", 2048));

    expect(screen.getByText("wykres.png")).toBeTruthy();
    // Rozmiar po polsku: separator dziesiętny to przecinek.
    expect(screen.getByText("2,0 KB")).toBeTruthy();
    expect(container.querySelector(`img[src="${createdUrls[0]}"]`)).not.toBeNull();
    expect(screen.getByPlaceholderText(t.attachmentCaptionPlaceholder)).toBeTruthy();
    expect(screen.queryByPlaceholderText(t.inputPlaceholder)).toBeNull();
    // Sam wybór pliku niczego nie wysyła.
    expect(screen.getAllByLabelText(t.react)).toHaveLength(1);
  });

  it("angielski podgląd formatuje rozmiar kropką, nie przecinkiem", () => {
    renderDemo({ lang: "en" });
    pick(fileOfSize("chart.png", "image/png", 2048));

    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.queryByText("2,0 KB")).toBeNull();
  });

  it("dokument czeka pod ikoną spinacza, bez miniatury", () => {
    const { container } = renderDemo();
    pick(fileOfSize("raport.pdf", "application/pdf", 4096));

    expect(screen.getByText("raport.pdf")).toBeTruthy();
    expect(container.querySelector(`img[src="${createdUrls[0]}"]`)).toBeNull();
  });

  it("podmiana załącznika zwalnia poprzedni podgląd (wyciek pamięci)", () => {
    renderDemo();
    pick(fileOfSize("pierwszy.png", "image/png", 2048));
    pick(fileOfSize("drugi.png", "image/png", 4096));

    expect(revokedUrls).toEqual([createdUrls[0]]);
    expect(screen.getByText("drugi.png")).toBeTruthy();
    expect(screen.queryByText("pierwszy.png")).toBeNull();
  });

  it("krzyżyk przy załączniku zwalnia podgląd i czyści ukryte pole pliku", () => {
    renderDemo();
    pick(fileOfSize("wykres.png", "image/png", 2048));
    fireEvent.click(screen.getByLabelText(t.close));

    expect(screen.queryByText("wykres.png")).toBeNull();
    expect(revokedUrls).toEqual(createdUrls);
    expect(fileInput().value).toBe("");
  });

  it("odmontowanie z czekającym załącznikiem zwalnia obiektowy URL", () => {
    const { unmount } = renderDemo();
    pick(fileOfSize("wykres.png", "image/png", 2048));
    expect(revokedUrls).toHaveLength(0);

    unmount();

    expect(revokedUrls).toEqual(createdUrls);
  });

  it("zdjęcie bez podpisu: bot odpowiada o zdjęciu i dokłada 🎉", async () => {
    renderDemo();
    pick(fileOfSize("wykres.png", "image/png", 2048));
    submit();
    await tickAsync(4000);

    expect(screen.getByText(t.demoBot.replies.image)).toBeTruthy();
    expect(screen.getByRole("button", { pressed: false, name: /🎉/ })).toBeTruthy();
    // Podglądu NIE wolno zwolnić przy wysyłce - dymek nadal go pokazuje.
    expect(revokedUrls).toHaveLength(0);
  });

  it("dokument z podpisem: bot potwierdza nazwą pliku, a podpis zostaje w dymku", async () => {
    renderDemo();
    pick(fileOfSize("raport.pdf", "application/pdf", 4096));
    type("Podpis pod raportem");
    submit();
    await tickAsync(4000);

    expect(screen.getByText(t.demoBot.replies.file.replace("{{name}}", "raport.pdf"))).toBeTruthy();
    expect(screen.getByText("Podpis pod raportem")).toBeTruthy();
    // Kompozytor wraca do stanu wyjściowego.
    expect(screen.getByPlaceholderText(t.inputPlaceholder)).toBeTruthy();
    expect(fileInput().value).toBe("");
  });
});

describe("panel multimediów", () => {
  it("pusty wątek mówi wprost, że nie ma czego pokazać", () => {
    renderDemo();
    fireEvent.click(screen.getByLabelText(t.mediaHistory.open));

    expect(screen.getByText(t.mediaHistory.title)).toBeTruthy();
    expect(screen.getByText(t.mediaHistory.emptyMedia)).toBeTruthy();
  });

  it("wysłane zdjęcie trafia do panelu multimediów", async () => {
    renderDemo();
    pick(fileOfSize("wykres.png", "image/png", 2048));
    submit();
    await tickAsync(4000);

    fireEvent.click(screen.getByLabelText(t.mediaHistory.open));

    expect(screen.queryByText(t.mediaHistory.emptyMedia)).toBeNull();
  });
});

describe("tożsamość nadawcy", () => {
  it("bez zalogowanej sesji podgląd nie pyta o żaden profil", () => {
    renderDemo();
    expect(h.peerRequests.at(-1)).toEqual([]);
    expect(screen.getByText(t.demoBot.welcome)).toBeTruthy();
  });

  it("zalogowany użytkownik pyta wyłącznie o własny profil", () => {
    h.auth.user = { id: CHAT_IDS.me };
    renderDemo();
    expect(h.peerRequests.at(-1)).toEqual([CHAT_IDS.me]);
  });

  it("własne zdjęcie profilowe podpisuje mnie na liście reagujących", () => {
    h.auth.user = { id: CHAT_IDS.me };
    h.peers = peerProfileMap([
      peerProfile({ id: CHAT_IDS.me, display_name: "Zofia Testowa", avatar_url: MY_AVATAR }),
    ]);
    renderDemo();

    openQuickBar(0);
    fireEvent.click(screen.getByLabelText(QUICK_REACTIONS[0]));
    fireEvent.focus(pressedChip());

    const tip = screen.getByRole("tooltip");
    expect(within(tip).getByText(t.reactions.you)).toBeTruthy();
    expect(tip.querySelector("img")?.getAttribute("src")).toBe(MY_AVATAR);
  });

  it("profil bez zdjęcia zostawia na liście reagujących inicjał, nie pusty obrazek", () => {
    h.auth.user = { id: CHAT_IDS.me };
    h.peers = peerProfileMap([
      peerProfile({ id: CHAT_IDS.me, display_name: "Zofia Testowa", avatar_url: "" }),
    ]);
    renderDemo();

    openQuickBar(0);
    fireEvent.click(screen.getByLabelText(QUICK_REACTIONS[0]));
    fireEvent.focus(pressedChip());

    const tip = screen.getByRole("tooltip");
    expect(tip.querySelector("img")).toBeNull();
    expect(within(tip).getByText(t.reactions.you.charAt(0).toUpperCase())).toBeTruthy();
  });
});
