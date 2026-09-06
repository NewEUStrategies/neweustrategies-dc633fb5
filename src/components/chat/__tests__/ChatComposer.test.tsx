// Kompozytor czatu - organizm, który przed tym plikiem miał 0/160 linii
// i 0/40 funkcji, czyli największe pojedyncze zero całego modułu 09.
//
// PODZIAŁ DOWODÓW. Arytmetyka reguł (Enter kontra Shift+Enter, próg morfowania
// mikrofonu, limit i typy załącznika, throttling „pisze…", stan paska
// odpowiedzi, plan wysyłki) ma własny plik: `src/lib/chat/__tests__/
// composerRules.test.ts`. TUTAJ sprawdzamy SKLEJENIE tych reguł z DOM-em
// i z warstwą przesyłania plików - czyli to, czego czysta funkcja nie dowiedzie:
// że wpisany znak faktycznie podmienia przycisk, że Enter czyści pole i wersję
// roboczą, że odrzucony plik NIE startuje uploadu, że pasek postępu znika także
// po błędzie i że odmontowanie zwalnia obiektowy URL podglądu.
//
// RODO: żadnych prawdziwych osób ani treści - nadawcy to identyfikatory
// z `CHAT_IDS`, adresy w domenie `example.com`, treści zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceClock } from "@/test/time";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { CHAT_IDS, chatMessage } from "@/test/chat/fixtures";
import { MAX_ATTACHMENT_BYTES } from "@/lib/chat/attachments";
import { __resetDraftsForTests, getDraft, setDraft } from "@/lib/chat/drafts";
import type { UploadedAttachment } from "@/lib/chat/attachments";
import type { RecordedVoice } from "@/lib/chat/voice";

interface UploadCall {
  readonly file: File;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly onProgress?: (percent: number) => void;
}

const h = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, tenantId: null as string | null },
  toast: { error: vi.fn(), success: vi.fn() },
  uploads: [] as UploadCall[],
  uploadOutcome: { kind: "resolve" } as { kind: "resolve" } | { kind: "reject"; error: unknown },
  recorder: {
    state: "idle" as "idle" | "requesting" | "recording",
    elapsed: 0,
    supported: true,
    start: vi.fn(),
    finish: vi.fn(),
    cancel: vi.fn(),
  },
  recorderOptions: null as {
    onLimitReached?: (voice: RecordedVoice | null) => void;
    onError?: (kind: "denied" | "unsupported") => void;
  } | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.auth.user, tenantId: h.auth.tenantId }),
}));

vi.mock("sonner", () => ({ toast: h.toast }));

// Częściowa atrapa: allowlista MIME, limit 30 MB i formatowanie rozmiaru są
// PRAWDZIWE (mają własne testy i to one decydują o odrzuceniu pliku).
// Podmieniamy wyłącznie sam transfer, bo test nie chodzi do storage.
vi.mock("@/lib/chat/attachments", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/chat/attachments")>();
  return {
    ...real,
    uploadChatAttachment: async (params: UploadCall): Promise<UploadedAttachment> => {
      h.uploads.push(params);
      params.onProgress?.(42);
      if (h.uploadOutcome.kind === "reject") throw h.uploadOutcome.error;
      return {
        path: `${params.tenantId}/${params.conversationId}/${params.userId}/plik`,
        name: params.file.name,
        mime: params.file.type,
        size: params.file.size,
      };
    },
  };
});

// Nagrywanie ma własny plik testowy (`src/lib/chat/__tests__/voice.test.ts`).
// Tutaj liczy się wyłącznie to, czy kompozytor ODCZYTUJE `supported` i `state`
// oraz co robi z CALLBACKAMI, które sam nagrywarce podaje - dlatego atrapa
// zapamiętuje opcje wręczone przez kompozytor.
vi.mock("@/lib/chat/voice", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/chat/voice")>();
  return {
    ...real,
    useVoiceRecorder: (options?: {
      onLimitReached?: (voice: RecordedVoice | null) => void;
      onError?: (kind: "denied" | "unsupported") => void;
    }) => {
      h.recorderOptions = options ?? null;
      return h.recorder;
    },
  };
});

import { ChatComposer, type ChatComposerProps } from "../ChatComposer";

const t = chatPl.chat;

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

function renderComposer(overrides: Partial<ChatComposerProps> = {}) {
  const props = composerProps(overrides);
  const utils = render(<ChatComposer {...props} />);
  return { ...utils, props };
}

/**
 * Pole treści. Etykieta ZMIENIA SIĘ z „Napisz wiadomość" na „Dodaj podpis",
 * gdy czeka załącznik - dlatego szukamy po roli elementu, a nie po etykiecie.
 * Sam kontrakt etykiety ma osobny dowód niżej.
 */
function textarea(): HTMLTextAreaElement {
  const el = document.querySelector("textarea");
  if (!el) throw new Error("test: kompozytor nie renderuje pola treści");
  return el;
}

function type(value: string): void {
  fireEvent.change(textarea(), { target: { value } });
}

/** Plik o zadanym typie i rozmiarze bez alokowania megabajtów w teście. */
function fileOfSize(name: string, mime: string, size: number): File {
  const file = new File(["x"], name, { type: mime });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

function pickFile(container: HTMLElement, file: File): void {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("test: kompozytor nie ma ukrytego pola pliku");
  fireEvent.change(input, { target: { files: [file] } });
}

let createdObjectUrls: string[] = [];
let revokedObjectUrls: string[] = [];

beforeEach(() => {
  h.auth.user = { id: CHAT_IDS.me };
  h.auth.tenantId = CHAT_IDS.tenant;
  h.toast.error.mockClear();
  h.toast.success.mockClear();
  h.uploads = [];
  h.uploadOutcome = { kind: "resolve" };
  h.recorder.state = "idle";
  h.recorder.elapsed = 0;
  h.recorder.supported = true;
  h.recorder.start = vi.fn();
  h.recorder.finish = vi.fn(async (): Promise<RecordedVoice | null> => null);
  h.recorder.cancel = vi.fn();
  h.recorderOptions = null;
  createdObjectUrls = [];
  revokedObjectUrls = [];
  let seq = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:test/${(seq += 1)}`;
    createdObjectUrls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revokedObjectUrls.push(url);
  });
  __resetDraftsForTests();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("morfowanie przycisku i szybka emotka", () => {
  it("puste pole pokazuje mikrofon, pierwszy znak zamienia go w wysyłkę", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: t.voice.record })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.send })).toBeNull();

    type("Dzień dobry");

    expect(screen.queryByRole("button", { name: t.voice.record })).toBeNull();
    expect(screen.getByRole("button", { name: t.send })).toBeTruthy();
  });

  it("same białe znaki NIE morfują przycisku - spacja to nie wiadomość", () => {
    renderComposer();
    type("   ");
    expect(screen.getByRole("button", { name: t.voice.record })).toBeTruthy();
  });

  it("przeglądarka bez nagrywania dostaje przycisk wysyłki, nie martwy mikrofon", () => {
    h.recorder.supported = false;
    renderComposer();
    expect(screen.queryByRole("button", { name: t.voice.record })).toBeNull();
    expect(screen.getByRole("button", { name: t.send })).toBeDisabled();
  });

  it("szybka emotka jest widoczna tylko przy pustym polu i wysyła się jednym dotknięciem", () => {
    const { props } = renderComposer({ quickEmoji: "🔥" });
    const quick = screen.getByRole("button", { name: "Wyślij 🔥" });
    fireEvent.click(quick);
    expect(props.onSend).toHaveBeenCalledWith({
      conversationId: CHAT_IDS.conversation,
      kind: "text",
      body: "🔥",
      replyToId: null,
    });

    type("cokolwiek");
    expect(screen.queryByRole("button", { name: "Wyślij 🔥" })).toBeNull();
  });

  it("nagrywanie zamienia całe pole na HUD z anulowaniem i wysyłką", () => {
    h.recorder.state = "recording";
    h.recorder.elapsed = 65;
    renderComposer();
    expect(screen.getByRole("status", { name: t.voice.recording })).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.queryByLabelText(t.inputPlaceholder)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t.voice.cancel }));
    expect(h.recorder.cancel).toHaveBeenCalledTimes(1);
  });

  it("mikrofon startuje nagrywanie", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: t.voice.record }));
    expect(h.recorder.start).toHaveBeenCalledTimes(1);
  });
});

describe("wysyłka tekstu", () => {
  it("Enter wysyła, czyści pole i kasuje wersję roboczą", async () => {
    const { props } = renderComposer();
    type("Dzień dobry");
    await waitFor(() => expect(getDraft(CHAT_IDS.me, CHAT_IDS.conversation)).toBe("Dzień dobry"));

    fireEvent.keyDown(textarea(), { key: "Enter" });

    expect(props.onSend).toHaveBeenCalledWith({
      conversationId: CHAT_IDS.conversation,
      kind: "text",
      body: "Dzień dobry",
      replyToId: null,
    });
    expect(props.onClearReply).toHaveBeenCalled();
    await waitFor(() => expect(textarea().value).toBe(""));
    expect(getDraft(CHAT_IDS.me, CHAT_IDS.conversation)).toBe("");
  });

  it("Shift+Enter NIE wysyła (łamie linię)", () => {
    const { props } = renderComposer();
    type("pierwsza linia");
    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    expect(props.onSend).not.toHaveBeenCalled();
    expect(textarea().value).toBe("pierwsza linia");
  });

  it("Enter na pustym polu nie wysyła pustej wiadomości", () => {
    const { props } = renderComposer();
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("przycisk wysyłki niesie identyfikator cytowanej wiadomości", () => {
    const replyTo = chatMessage({ id: "msg-quoted", body: "Pytanie" });
    const { props } = renderComposer({ replyTo, replyToAuthor: "Zofia Testowa" });
    type("Odpowiedź");
    fireEvent.click(screen.getByRole("button", { name: t.send }));
    expect(props.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ replyToId: "msg-quoted", body: "Odpowiedź" }),
    );
  });

  it("wersja robocza wraca po ponownym zamontowaniu tej samej rozmowy", () => {
    setDraft(CHAT_IDS.me, CHAT_IDS.conversation, "niedokończone zdanie");
    renderComposer();
    expect(textarea().value).toBe("niedokończone zdanie");
  });
});

describe("throttling broadcastu „pisze…”", () => {
  it("seria klawiszy nadaje JEDEN broadcast, a po progu kolejny", () => {
    vi.useFakeTimers();
    try {
      const { props } = renderComposer();
      type("a");
      type("ab");
      type("abc");
      expect(props.onTyping).toHaveBeenCalledTimes(1);

      advanceClock(2600);
      type("abcd");
      expect(props.onTyping).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pasek odpowiedzi i tryb edycji", () => {
  it("cytat pokazuje autora, treść i wyjście bez wysyłania", () => {
    const { props } = renderComposer({
      replyTo: chatMessage({ body: "Cytowana treść" }),
      replyToAuthor: "Zofia Testowa",
    });
    expect(screen.getByText(/Zofia Testowa/)).toBeTruthy();
    expect(screen.getByText("Cytowana treść")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t.close }));
    expect(props.onClearReply).toHaveBeenCalledTimes(1);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("cytat wiadomości cofniętej pokazuje nagrobek, nie treść", () => {
    renderComposer({
      replyTo: chatMessage({ body: "Treść do ukrycia", deleted_at: "2026-08-18T10:05:00.000Z" }),
      replyToAuthor: "Zofia Testowa",
    });
    expect(screen.getByText(t.deletedMessage)).toBeTruthy();
    expect(screen.queryByText("Treść do ukrycia")).toBeNull();
  });

  it("tryb edycji WYPIERA pasek cytatu i podmienia etykietę przycisku", async () => {
    renderComposer({
      editing: chatMessage({ id: "msg-edit", body: "Stara treść", sender_id: CHAT_IDS.me }),
      replyTo: chatMessage({ id: "msg-quoted", body: "Cytat" }),
      replyToAuthor: "Zofia Testowa",
    });
    expect(screen.getByText(t.editingMessage)).toBeTruthy();
    expect(screen.queryByText("Cytat")).toBeNull();
    await waitFor(() => expect(textarea().value).toBe("Stara treść"));
    expect(screen.getByRole("button", { name: t.saveEdit })).toBeTruthy();
    // W edycji nie wolno dokładać kolejnego załącznika do istniejącej wiadomości.
    expect(screen.queryByRole("button", { name: t.attach })).toBeNull();
  });

  it("zapis edycji leci tylko przy zmienionej treści i zawsze wychodzi z trybu", async () => {
    const editing = chatMessage({ id: "msg-edit", body: "Stara treść", sender_id: CHAT_IDS.me });
    const { props } = renderComposer({ editing });
    await waitFor(() => expect(textarea().value).toBe("Stara treść"));

    fireEvent.click(screen.getByRole("button", { name: t.saveEdit }));
    expect(props.onSaveEdit).not.toHaveBeenCalled();
    expect(props.onCancelEdit).toHaveBeenCalledTimes(1);

    type("Nowa treść");
    fireEvent.click(screen.getByRole("button", { name: t.saveEdit }));
    expect(props.onSaveEdit).toHaveBeenCalledWith("msg-edit", "Nowa treść");
  });

  it("Escape w edycji anuluje edycję i NIE dociera do okna rozmowy", async () => {
    const outerEscape = vi.fn();
    const editing = chatMessage({ id: "msg-edit", body: "Stara treść", sender_id: CHAT_IDS.me });
    const props = composerProps({ editing });
    render(
      <div onKeyDown={outerEscape}>
        <ChatComposer {...props} />
      </div>,
    );
    await waitFor(() => expect(textarea().value).toBe("Stara treść"));

    fireEvent.keyDown(textarea(), { key: "Escape" });

    expect(props.onCancelEdit).toHaveBeenCalledTimes(1);
    // Bez `stopPropagation` Escape zamykałby całe okno w doku.
    expect(outerEscape).not.toHaveBeenCalled();
  });

  it("bufor edycji NIE zostaje wersją roboczą rozmowy", async () => {
    const editing = chatMessage({ id: "msg-edit", body: "Stara treść", sender_id: CHAT_IDS.me });
    renderComposer({ editing });
    await waitFor(() => expect(textarea().value).toBe("Stara treść"));
    type("Poprawiona treść");
    expect(getDraft(CHAT_IDS.me, CHAT_IDS.conversation)).toBe("");
  });
});

describe("załączniki", () => {
  it("plik ponad 30 MB pokazuje błąd i NIE startuje przesyłania", () => {
    const { container } = renderComposer();
    pickFile(container, fileOfSize("wielki.pdf", "application/pdf", MAX_ATTACHMENT_BYTES + 1));

    expect(h.toast.error).toHaveBeenCalledWith(t.attachmentTooLarge);
    expect(h.uploads).toHaveLength(0);
    expect(screen.queryByRole("button", { name: t.caption.remove })).toBeNull();
  });

  it("plik spoza allowlisty MIME odpada na typie (SVG to aktywna treść)", () => {
    const { container } = renderComposer();
    pickFile(container, fileOfSize("ikona.svg", "image/svg+xml", 1024));

    expect(h.toast.error).toHaveBeenCalledWith(t.attachmentWrongType);
    expect(h.uploads).toHaveLength(0);
  });

  it("przyjęty obraz czeka z podglądem, nazwą i rozmiarem - przed wysyłką", () => {
    const { container } = renderComposer();
    pickFile(container, fileOfSize("wykres.png", "image/png", 2048));

    expect(screen.getByText("wykres.png")).toBeTruthy();
    expect(createdObjectUrls).toHaveLength(1);
    expect(container.querySelector(`img[src="${createdObjectUrls[0]}"]`)).not.toBeNull();
    // Sam wybór pliku NICZEGO nie wysyła - podpis dopisuje się przed wysyłką.
    expect(h.uploads).toHaveLength(0);
  });

  it("etykieta pola ZMIENIA SIĘ na podpis, gdy czeka załącznik", () => {
    const { container } = renderComposer();
    expect(screen.getByLabelText(t.inputPlaceholder)).toBeTruthy();

    pickFile(container, fileOfSize("wykres.png", "image/png", 2048));

    expect(screen.queryByLabelText(t.inputPlaceholder)).toBeNull();
    expect(screen.getByLabelText(t.caption.placeholder)).toBeTruthy();
  });

  it("dokument czeka BEZ obiektowego URL-a", () => {
    const { container } = renderComposer();
    pickFile(container, fileOfSize("raport.pdf", "application/pdf", 2048));
    expect(screen.getByText("raport.pdf")).toBeTruthy();
    expect(createdObjectUrls).toHaveLength(0);
  });

  it("zdjęcie podpisu przesyła plik i wysyła wiadomość z podpisem", async () => {
    const { container, props } = renderComposer();
    pickFile(container, fileOfSize("wykres.png", "image/png", 2048));
    type("Podpis pod wykresem");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.send }));
    });

    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({
      tenantId: CHAT_IDS.tenant,
      conversationId: CHAT_IDS.conversation,
      userId: CHAT_IDS.me,
    });
    expect(props.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", body: "Podpis pod wykresem" }),
    );
    // Pasek postępu znika po zakończeniu - żadnego wiszącego procenta.
    await waitFor(() => expect(screen.queryByText("42%")).toBeNull());
  });

  it("nieudane przesyłanie zdejmuje pasek postępu i nazywa przyczynę", async () => {
    h.uploadOutcome = { kind: "reject", error: new Error("chat-attachment:rate-limited") };
    const { container } = renderComposer();
    pickFile(container, fileOfSize("raport.pdf", "application/pdf", 2048));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.send }));
    });

    expect(h.toast.error).toHaveBeenCalledWith(t.uploadRateLimited);
    await waitFor(() => expect(screen.queryByText("42%")).toBeNull());
  });

  it("zwykła awaria przesyłania ma własny komunikat", async () => {
    h.uploadOutcome = { kind: "reject", error: new Error("chat-attachment:network") };
    const { container } = renderComposer();
    pickFile(container, fileOfSize("raport.pdf", "application/pdf", 2048));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.send }));
    });

    expect(h.toast.error).toHaveBeenCalledWith(t.uploadFailed);
  });

  it("zdjęcie załącznika przed wysyłką zwalnia obiektowy URL", () => {
    const { container } = renderComposer();
    pickFile(container, fileOfSize("wykres.png", "image/png", 2048));
    fireEvent.click(screen.getByRole("button", { name: t.caption.remove }));

    expect(screen.queryByText("wykres.png")).toBeNull();
    expect(revokedObjectUrls).toEqual(createdObjectUrls);
  });

  it("Escape zdejmuje czekający załącznik", () => {
    const { container } = renderComposer();
    pickFile(container, fileOfSize("wykres.png", "image/png", 2048));
    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(screen.queryByText("wykres.png")).toBeNull();
  });

  it("ODMONTOWANIE z czekającym załącznikiem zwalnia obiektowy URL (wyciek pamięci)", () => {
    const { container, unmount } = renderComposer();
    pickFile(container, fileOfSize("wykres.png", "image/png", 2048));
    expect(revokedObjectUrls).toHaveLength(0);

    unmount();

    expect(revokedObjectUrls).toEqual(createdObjectUrls);
  });

  it("bez tenanta przesyłanie NIE startuje - nie ma dokąd wgrać pliku", async () => {
    h.auth.tenantId = null;
    const { container, props } = renderComposer();
    pickFile(container, fileOfSize("raport.pdf", "application/pdf", 2048));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.send }));
    });

    expect(h.uploads).toHaveLength(0);
    expect(props.onSend).not.toHaveBeenCalled();
    // Załącznik zostaje w kompozytorze - użytkownik nie traci wyboru pliku.
    expect(screen.getByText("raport.pdf")).toBeTruthy();
  });

  it("dodanie załącznika jest zablokowane, gdy inny czeka w kolejce", () => {
    const { container } = renderComposer();
    pickFile(container, fileOfSize("raport.pdf", "application/pdf", 2048));
    expect(screen.getByRole("button", { name: t.attach })).toBeDisabled();
  });
});

describe("notatki głosowe - to, co kompozytor robi z nagraniem", () => {
  /** Nagranie w kształcie, jaki oddaje `useVoiceRecorder`. */
  function recordedVoice(sizeBytes = 4096, durationSeconds = 7): RecordedVoice {
    const file = new File(["x"], "voice-1.webm", { type: "audio/webm" });
    Object.defineProperty(file, "size", { value: sizeBytes, configurable: true });
    return { file, durationSeconds };
  }

  it("zakończone nagranie leci jako wiadomość `audio` z DŁUGOŚCIĄ", async () => {
    h.recorder.state = "recording";
    h.recorder.finish = vi.fn(async () => recordedVoice(4096, 7));
    const { props } = renderComposer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.voice.send }));
    });

    expect(h.uploads).toHaveLength(1);
    expect(props.onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "audio",
        attachment: expect.objectContaining({ duration: 7 }),
      }),
    );
    expect(props.onClearReply).toHaveBeenCalled();
  });

  it("PUSTE nagranie nie wysyła niczego", async () => {
    h.recorder.state = "recording";
    h.recorder.finish = vi.fn(async () => null);
    const { props } = renderComposer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.voice.send }));
    });

    expect(h.uploads).toHaveLength(0);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("nagranie ponad limit załącznika NIE startuje przesyłania", async () => {
    h.recorder.state = "recording";
    h.recorder.finish = vi.fn(async () => recordedVoice(MAX_ATTACHMENT_BYTES + 1, 600));
    renderComposer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.voice.send }));
    });

    expect(h.toast.error).toHaveBeenCalledWith(t.attachmentTooLarge);
    expect(h.uploads).toHaveLength(0);
  });

  it("nieudane przesłanie notatki nazywa awarię i zdejmuje pasek postępu", async () => {
    h.uploadOutcome = { kind: "reject", error: new Error("chat-attachment:network") };
    h.recorder.state = "recording";
    h.recorder.finish = vi.fn(async () => recordedVoice());
    renderComposer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.voice.send }));
    });

    expect(h.toast.error).toHaveBeenCalledWith(t.uploadFailed);
    await waitFor(() => expect(screen.queryByText("42%")).toBeNull());
  });

  it("OSIĄGNIĘTY LIMIT DŁUGOŚCI wysyła nagranie sam, bez kliknięcia", async () => {
    renderComposer();
    expect(h.recorderOptions?.onLimitReached).toBeTypeOf("function");

    await act(async () => {
      h.recorderOptions?.onLimitReached?.(recordedVoice(2048, 600));
      await Promise.resolve();
    });

    await waitFor(() => expect(h.uploads).toHaveLength(1));
  });

  it("odmowa mikrofonu i brak wsparcia mają OSOBNE komunikaty", () => {
    renderComposer();
    h.recorderOptions?.onError?.("denied");
    expect(h.toast.error).toHaveBeenCalledWith(t.voice.micDenied);

    h.toast.error.mockClear();
    h.recorderOptions?.onError?.("unsupported");
    expect(h.toast.error).toHaveBeenCalledWith(t.voice.unsupported);
  });

  it("bez tenanta nagranie NIE jest przesyłane", async () => {
    h.auth.tenantId = null;
    h.recorder.state = "recording";
    h.recorder.finish = vi.fn(async () => recordedVoice());
    const { props } = renderComposer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.voice.send }));
    });

    expect(h.uploads).toHaveLength(0);
    expect(props.onSend).not.toHaveBeenCalled();
  });
});

describe("wstawianie emotki z pickera", () => {
  /** Otwiera popover emoji i czeka na doładowanie leniwego pickera. */
  async function openEmojiPicker(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: t.emoji }));
    await screen.findByPlaceholderText(t.emojiSearch);
  }

  /** Klika pierwszą emotkę w siatce i zwraca jej znak. */
  function clickFirstEmoji(): string {
    // Kafelki mają `role="option"` (siatka jest listboksem), a nie `button` -
    // zapytanie po roli przycisku trafiłoby w zakładki kategorii.
    const first = screen.getAllByRole("option")[0];
    if (!first) throw new Error("test: picker nie wyrenderował ani jednej emotki");
    const emoji = first.textContent ?? "";
    fireEvent.click(first);
    return emoji;
  }

  it("wybrana emotka trafia W MIEJSCE KURSORA, nie na koniec", async () => {
    renderComposer();
    type("ab");
    const el = textarea();
    el.setSelectionRange(1, 1);

    await openEmojiPicker();
    const emoji = clickFirstEmoji();

    await waitFor(() => expect(textarea().value).toBe(`a${emoji}b`));
  });

  it("zaznaczony fragment jest ZASTĘPOWANY emotką", async () => {
    renderComposer();
    type("abc");
    textarea().setSelectionRange(0, 3);

    await openEmojiPicker();
    const emoji = clickFirstEmoji();

    await waitFor(() => expect(textarea().value).toBe(emoji));
  });
});

describe("sesja anonimowa", () => {
  it("bez zalogowanego użytkownika pole startuje puste i nie zapisuje wersji roboczej", () => {
    h.auth.user = null;
    h.auth.tenantId = null;
    setDraft("user-inny", CHAT_IDS.conversation, "cudza wersja robocza");
    renderComposer();
    expect(textarea().value).toBe("");
    type("cokolwiek");
    expect(getDraft("user-inny", CHAT_IDS.conversation)).toBe("cudza wersja robocza");
  });
});
