// Reguły kompozytora czatu - czysty moduł wyjęty z `ChatComposer.tsx`.
//
// PO CO OSOBNY PLIK. Kompozytor stał na 0/160 linii i 0/40 funkcji, bo każda
// jego decyzja mieszkała w domknięciu komponentu: żeby sprawdzić, czy Enter
// wysyła, trzeba było wyrenderować organizm z sesją, tenantem, kanałem realtime
// i atrapą `MediaRecorder`. Reguły są teraz funkcjami i mają tu własne dowody -
// render kompozytora sprawdza SKLEJENIE (osobny plik), a nie arytmetykę progów.
//
// RODO: żadnych prawdziwych osób ani treści - nadawcy to identyfikatory
// z `CHAT_IDS`, a treści wiadomości są zmyślone.
import { describe, expect, it } from "vitest";
import { chatMessage } from "@/test/chat/fixtures";
import { MAX_ATTACHMENT_BYTES } from "../attachments";
import {
  MAX_BODY_LENGTH,
  MAX_CAPTION_LENGTH,
  TYPING_THROTTLE_MS,
  composerKeyIntent,
  composerPrimaryAction,
  composerSubmitPlan,
  keyIntentPreventsDefault,
  keyIntentStopsPropagation,
  quickEmojiVisible,
  replyBarState,
  shouldEmitTyping,
  stageFileDecision,
  uploadErrorKey,
  uploadLooksLikeImage,
} from "../composerRules";

/** Plik o zadanym typie i rozmiarze - bez alokowania 30 MB w pamięci testu. */
function fileOfSize(name: string, type: string, size: number): File {
  const file = new File([], name, { type });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

describe("composerKeyIntent", () => {
  const idle = { editing: false, staged: false };

  it("Enter wysyła, Shift+Enter łamie linię", () => {
    expect(composerKeyIntent({ key: "Enter", shiftKey: false }, idle)).toBe("send");
    expect(composerKeyIntent({ key: "Enter", shiftKey: true }, idle)).toBe("newline");
  });

  it("Escape wychodzi z edycji, a poza edycją zdejmuje załącznik", () => {
    expect(composerKeyIntent({ key: "Escape", shiftKey: false }, { ...idle, editing: true })).toBe(
      "cancel-edit",
    );
    expect(composerKeyIntent({ key: "Escape", shiftKey: false }, { ...idle, staged: true })).toBe(
      "clear-staged",
    );
  });

  it("edycja WYGRYWA z załącznikiem - jeden Escape nie robi dwóch rzeczy naraz", () => {
    expect(
      composerKeyIntent({ key: "Escape", shiftKey: false }, { editing: true, staged: true }),
    ).toBe("cancel-edit");
  });

  it("Escape bez czego wyjść nie porywa zdarzenia oknu rozmowy", () => {
    const intent = composerKeyIntent({ key: "Escape", shiftKey: false }, idle);
    expect(intent).toBe("none");
    expect(keyIntentPreventsDefault(intent)).toBe(false);
    expect(keyIntentStopsPropagation(intent)).toBe(false);
  });

  it("pozostałe klawisze przechodzą do przeglądarki nietknięte", () => {
    for (const key of ["a", "Tab", "ArrowUp", "Backspace"]) {
      expect(composerKeyIntent({ key, shiftKey: false }, idle)).toBe("none");
    }
  });

  it("tylko wyjście z edycji zatrzymuje propagację (Escape w doku zamyka okno)", () => {
    expect(keyIntentStopsPropagation("cancel-edit")).toBe(true);
    for (const intent of ["send", "newline", "clear-staged", "none"] as const) {
      expect(keyIntentStopsPropagation(intent)).toBe(false);
    }
  });

  it("nowa linia NIE przejmuje zdarzenia - inaczej Shift+Enter nic by nie robił", () => {
    expect(keyIntentPreventsDefault("newline")).toBe(false);
    expect(keyIntentPreventsDefault("send")).toBe(true);
    expect(keyIntentPreventsDefault("cancel-edit")).toBe(true);
    expect(keyIntentPreventsDefault("clear-staged")).toBe(true);
  });
});

describe("composerPrimaryAction - próg morfowania mikrofonu w wysyłkę", () => {
  const base = { editing: false, text: "", staged: false, recorderSupported: true };

  it("puste pole pokazuje mikrofon", () => {
    expect(composerPrimaryAction(base)).toBe("record");
  });

  it("same białe znaki to nadal puste pole", () => {
    expect(composerPrimaryAction({ ...base, text: "   \n\t " })).toBe("record");
  });

  it("pierwszy znak treści zamienia mikrofon w przycisk wysyłki", () => {
    expect(composerPrimaryAction({ ...base, text: "a" })).toBe("send");
  });

  it("czekający załącznik też morfuje przycisk, mimo pustego tekstu", () => {
    expect(composerPrimaryAction({ ...base, staged: true })).toBe("send");
  });

  it("w trybie edycji nie ma czego nagrywać", () => {
    expect(composerPrimaryAction({ ...base, editing: true })).toBe("send");
  });

  it("przeglądarka bez MediaRecordera dostaje przycisk wysyłki, nie martwy mikrofon", () => {
    expect(composerPrimaryAction({ ...base, recorderSupported: false })).toBe("send");
  });
});

describe("quickEmojiVisible", () => {
  it("obiecany warunek to DOKŁADNIE puste pole poza edycją i bez załącznika", () => {
    expect(quickEmojiVisible({ editing: false, text: "", staged: false })).toBe(true);
    expect(quickEmojiVisible({ editing: false, text: "  ", staged: false })).toBe(true);
    expect(quickEmojiVisible({ editing: false, text: "x", staged: false })).toBe(false);
    expect(quickEmojiVisible({ editing: false, text: "", staged: true })).toBe(false);
    expect(quickEmojiVisible({ editing: true, text: "", staged: false })).toBe(false);
  });
});

describe("shouldEmitTyping", () => {
  it("pierwszy klawisz nadaje od razu - licznik startuje z zera epoki", () => {
    // Kompozytor trzyma `lastTypingRef` zainicjowane zerem, a `now` to
    // `Date.now()`, więc pierwsze naciśnięcie zawsze przekracza próg.
    expect(shouldEmitTyping(new Date("2026-08-18T10:00:00.000Z").getTime(), 0)).toBe(true);
  });

  it("dokładnie na progu jeszcze NIE nadaje (warunek jest ostry)", () => {
    expect(shouldEmitTyping(TYPING_THROTTLE_MS, 0)).toBe(false);
    expect(shouldEmitTyping(TYPING_THROTTLE_MS + 1, 0)).toBe(true);
  });

  it("milisekunda po nadaniu nie nadaje drugi raz", () => {
    expect(shouldEmitTyping(10_001, 10_000)).toBe(false);
  });

  it("próg jest parametrem - test opisuje regułę, nie czeka na zegar", () => {
    expect(shouldEmitTyping(50, 0, 40)).toBe(true);
    expect(shouldEmitTyping(30, 0, 40)).toBe(false);
  });
});

describe("stageFileDecision - walidacja pliku z okna wyboru", () => {
  it("obraz z allowlisty wchodzi i dostaje podgląd", () => {
    const decision = stageFileDecision(fileOfSize("wykres.png", "image/png", 1024));
    expect(decision).toEqual({ outcome: "stage", kind: "image", needsPreviewUrl: true });
  });

  it("dokument wchodzi BEZ podglądu (obiektowy URL byłby wyciekiem bez odbiorcy)", () => {
    const decision = stageFileDecision(fileOfSize("raport.pdf", "application/pdf", 2048));
    expect(decision).toEqual({ outcome: "stage", kind: "file", needsPreviewUrl: false });
  });

  it("nagranie głosowe jest rodzajem `audio`, choć nie ma go w ATTACHMENT_ACCEPT", () => {
    const decision = stageFileDecision(fileOfSize("nagranie.webm", "audio/webm", 4096));
    expect(decision).toEqual({ outcome: "stage", kind: "audio", needsPreviewUrl: false });
  });

  it("SVG odpada na TYPIE - to aktywna treść, nie obrazek", () => {
    expect(stageFileDecision(fileOfSize("ikona.svg", "image/svg+xml", 512))).toEqual({
      outcome: "reject",
      messageKey: "chat.attachmentWrongType",
    });
  });

  it("plik bez rozpoznanego typu MIME odpada na typie, nie na rozmiarze", () => {
    expect(stageFileDecision(fileOfSize("dane", "", 512))).toEqual({
      outcome: "reject",
      messageKey: "chat.attachmentWrongType",
    });
    expect(stageFileDecision(fileOfSize("skrypt.exe", "application/x-msdownload", 512))).toEqual({
      outcome: "reject",
      messageKey: "chat.attachmentWrongType",
    });
  });

  it("dokładnie 30 MB jeszcze wchodzi, bajt więcej już nie", () => {
    expect(
      stageFileDecision(fileOfSize("duzy.pdf", "application/pdf", MAX_ATTACHMENT_BYTES)).outcome,
    ).toBe("stage");
    expect(
      stageFileDecision(fileOfSize("duzy.pdf", "application/pdf", MAX_ATTACHMENT_BYTES + 1)),
    ).toEqual({ outcome: "reject", messageKey: "chat.attachmentTooLarge" });
  });

  it("nazwa z przejściem katalogowym nie zmienia decyzji - ścieżkę buduje upload", () => {
    // Decyzja dotyczy TYPU i ROZMIARU. Higiena nazwy (`sanitizeFileName`)
    // mieszka w `uploadChatAttachment`, więc reguła kompozytora nie ma prawa
    // odrzucić pliku za nazwę ani jej po cichu przepisać.
    const decision = stageFileDecision(
      fileOfSize("../../../etc/passwd.pdf", "application/pdf", 128),
    );
    expect(decision).toEqual({ outcome: "stage", kind: "file", needsPreviewUrl: false });
  });

  it.fails("DEFEKT: plik zerowej długości dostaje komunikat »za duży« zamiast własnego", () => {
    // ZŁAMANY KONTRAKT: `validateAttachment` zwraca `\"size\"` dla obu końców
    // przedziału (`file.size <= 0 || file.size > MAX`), więc pusty plik
    // dostaje `chat.attachmentTooLarge` - komunikat, który mówi
    // użytkownikowi dokładnie odwrotność prawdy.
    // OCZEKIWANY KONTRAKT: pusty plik ma własny powód odrzucenia
    // (np. `chat.attachmentEmpty`), bo „za duży" nie da się naprawić
    // zmniejszeniem pliku, który już ma zero bajtów.
    expect(stageFileDecision(fileOfSize("pusty.pdf", "application/pdf", 0))).toEqual({
      outcome: "reject",
      messageKey: "chat.attachmentEmpty",
    });
  });
});

describe("uploadErrorKey", () => {
  it("limit tempa ma własny komunikat - »spróbuj ponownie« byłoby złą radą", () => {
    expect(uploadErrorKey(new Error("chat-attachment:rate-limited"))).toBe(
      "chat.uploadRateLimited",
    );
  });

  it("każdy inny błąd to zwykła porażka przesyłania", () => {
    expect(uploadErrorKey(new Error("chat-attachment:network"))).toBe("chat.uploadFailed");
    expect(uploadErrorKey(new Error("HTTP 500"))).toBe("chat.uploadFailed");
  });

  it("odrzucenie NIE-błędem nie wywraca kompozytora", () => {
    expect(uploadErrorKey("rate-limited")).toBe("chat.uploadFailed");
    expect(uploadErrorKey(null)).toBe("chat.uploadFailed");
    expect(uploadErrorKey(undefined)).toBe("chat.uploadFailed");
  });
});

describe("uploadLooksLikeImage - ikona paska postępu", () => {
  it("rozpoznaje rozszerzenia obrazów bez względu na wielkość liter", () => {
    for (const name of ["a.jpg", "a.JPEG", "b.png", "c.gif", "d.svg", "e.WEBP"]) {
      expect(uploadLooksLikeImage(name)).toBe(true);
    }
  });

  it("dokument zostaje dokumentem, także gdy udaje obraz w środku nazwy", () => {
    for (const name of ["raport.pdf", "arkusz.xlsx", "foto.png.pdf", "bez-rozszerzenia"]) {
      expect(uploadLooksLikeImage(name)).toBe(false);
    }
  });
});

describe("replyBarState", () => {
  it("edycja WYGRYWA z odpowiedzią - dwa paski obiecywałyby jeden zapis dwóm rzeczom", () => {
    const state = replyBarState({
      editing: true,
      replyTo: chatMessage({ body: "Do zacytowania" }),
      replyToAuthor: "Zofia Testowa",
    });
    expect(state).toEqual({ kind: "editing" });
  });

  it("bez cytatu i bez edycji pasek nie istnieje", () => {
    expect(replyBarState({ editing: false, replyTo: null, replyToAuthor: null })).toEqual({
      kind: "hidden",
    });
  });

  it("cytat tekstowy niesie treść i autora", () => {
    const state = replyBarState({
      editing: false,
      replyTo: chatMessage({ body: "Spotkanie o dziesiątej" }),
      replyToAuthor: "Zofia Testowa",
    });
    expect(state).toEqual({
      kind: "reply",
      author: "Zofia Testowa",
      preview: { kind: "body", body: "Spotkanie o dziesiątej" },
    });
  });

  it("PUSTY podpis zostaje pustym podpisem, a nie zastępnikiem »plik«", () => {
    // `??`, nie `||`: zdjęcie z pustym podpisem ma pokazać pusty wiersz,
    // dokładnie jak przed wyjęciem reguły z komponentu.
    const state = replyBarState({
      editing: false,
      replyTo: chatMessage({ body: "", kind: "image", attachment_path: "t/c/u/a.png" }),
      replyToAuthor: null,
    });
    expect(state).toEqual({ kind: "reply", author: null, preview: { kind: "body", body: "" } });
  });

  it("załącznik bez podpisu dostaje zastępnik zależny od rodzaju", () => {
    const photo = replyBarState({
      editing: false,
      replyTo: chatMessage({ body: null, kind: "image", attachment_path: "t/c/u/a.png" }),
      replyToAuthor: null,
    });
    expect(photo).toMatchObject({ preview: { kind: "photo" } });

    const file = replyBarState({
      editing: false,
      replyTo: chatMessage({ body: null, kind: "file", attachment_path: "t/c/u/a.pdf" }),
      replyToAuthor: null,
    });
    expect(file).toMatchObject({ preview: { kind: "file" } });

    // Nagranie głosowe nie jest zdjęciem - wpada w gałąź „plik".
    const voice = replyBarState({
      editing: false,
      replyTo: chatMessage({ body: null, kind: "audio", attachment_path: "t/c/u/a.webm" }),
      replyToAuthor: null,
    });
    expect(voice).toMatchObject({ preview: { kind: "file" } });
  });

  it("cytat wiadomości cofniętej pokazuje nagrobek, NIE treść", () => {
    const state = replyBarState({
      editing: false,
      replyTo: chatMessage({ body: "Treść do ukrycia", deleted_at: "2026-08-18T10:05:00.000Z" }),
      replyToAuthor: "Zofia Testowa",
    });
    expect(state).toMatchObject({ preview: { kind: "deleted" } });
  });
});

describe("composerSubmitPlan", () => {
  const empty = { text: "", editing: null, hasStaged: false, canUpload: true };

  it("puste pole bez załącznika nie wysyła nic", () => {
    expect(composerSubmitPlan(empty)).toEqual({ kind: "none" });
    expect(composerSubmitPlan({ ...empty, text: "   \n " })).toEqual({ kind: "none" });
  });

  it("zwykły tekst leci przycięty z obu stron", () => {
    expect(composerSubmitPlan({ ...empty, text: "  Dzień dobry  " })).toEqual({
      kind: "send-text",
      body: "Dzień dobry",
    });
  });

  it("treść ponad limit kolumny jest ucinana, a nie odrzucana", () => {
    const plan = composerSubmitPlan({ ...empty, text: "x".repeat(MAX_BODY_LENGTH + 500) });
    expect(plan).toMatchObject({ kind: "send-text" });
    if (plan.kind !== "send-text") throw new Error("test: oczekiwano planu wysyłki tekstu");
    expect(plan.body).toHaveLength(MAX_BODY_LENGTH);
  });

  it("zapis edycji leci tylko przy ZMIENIONEJ treści", () => {
    const editing = chatMessage({ id: "msg-edit", body: "Stara treść" });
    expect(composerSubmitPlan({ ...empty, editing, text: "Nowa treść" })).toEqual({
      kind: "save-edit",
      messageId: "msg-edit",
      body: "Nowa treść",
    });
  });

  it("edycja bez zmiany treści tylko wychodzi z trybu - `edited_at` nie może kłamać", () => {
    const editing = chatMessage({ id: "msg-edit", body: "Stara treść" });
    expect(composerSubmitPlan({ ...empty, editing, text: "Stara treść" })).toEqual({
      kind: "cancel-edit",
    });
    // Zmiana wyłącznie w białych znakach to nadal brak zmiany.
    expect(composerSubmitPlan({ ...empty, editing, text: "  Stara treść  " })).toEqual({
      kind: "cancel-edit",
    });
  });

  it("wyczyszczenie pola w edycji NIE kasuje wiadomości - to wyjście z trybu", () => {
    const editing = chatMessage({ id: "msg-edit", body: "Stara treść" });
    expect(composerSubmitPlan({ ...empty, editing, text: "" })).toEqual({ kind: "cancel-edit" });
  });

  it("edycja wiadomości bez treści (załącznik) przyjmuje pierwszy podpis", () => {
    const editing = chatMessage({ id: "msg-img", body: null, kind: "image" });
    expect(composerSubmitPlan({ ...empty, editing, text: "Podpis" })).toEqual({
      kind: "save-edit",
      messageId: "msg-img",
      body: "Podpis",
    });
  });

  it("edycja WYGRYWA z czekającym załącznikiem", () => {
    const editing = chatMessage({ id: "msg-edit", body: "Stara treść" });
    expect(
      composerSubmitPlan({ ...empty, editing, text: "Nowa treść", hasStaged: true }),
    ).toMatchObject({ kind: "save-edit" });
  });

  it("załącznik bez podpisu leci z `undefined`, nie z pustym stringiem", () => {
    expect(composerSubmitPlan({ ...empty, hasStaged: true })).toEqual({
      kind: "send-attachment",
      caption: undefined,
    });
    expect(composerSubmitPlan({ ...empty, hasStaged: true, text: "   " })).toEqual({
      kind: "send-attachment",
      caption: undefined,
    });
  });

  it("podpis ponad limit kolumny jest ucinany do 2000 znaków", () => {
    const plan = composerSubmitPlan({
      ...empty,
      hasStaged: true,
      text: "y".repeat(MAX_CAPTION_LENGTH + 100),
    });
    if (plan.kind !== "send-attachment") throw new Error("test: oczekiwano planu z załącznikiem");
    expect(plan.caption).toHaveLength(MAX_CAPTION_LENGTH);
  });

  it("bez sesji albo bez tenanta upload NIE startuje - nie ma dokąd wgrać pliku", () => {
    expect(composerSubmitPlan({ ...empty, hasStaged: true, canUpload: false })).toEqual({
      kind: "none",
    });
    // ...a wiadomość tekstowa w tej samej sytuacji nadal leci: wysyłkę
    // autoryzuje warstwa danych, nie kompozytor.
    expect(composerSubmitPlan({ ...empty, text: "Bez pliku", canUpload: false })).toEqual({
      kind: "send-text",
      body: "Bez pliku",
    });
  });
});
