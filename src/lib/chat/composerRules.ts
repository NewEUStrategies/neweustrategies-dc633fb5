// Reguły kompozytora czatu wyjęte z organizmu `ChatComposer` - czyste funkcje,
// bez Reacta, bez i18n, bez `supabase`.
//
// PO CO TO ISTNIEJE. `ChatComposer.tsx` ma 606 linii i ZERO funkcji modułowych:
// każda decyzja - „Enter wysyła czy łamie linię", „mikrofon czy przycisk
// wysyłki", „ten plik wolno przyjąć", „czy nadawać »pisze…«" - mieszkała
// wewnątrz domknięcia komponentu. Skutek jest mierzalny: 0/160 linii i 0/40
// funkcji pokrycia, bo do żadnej z tych reguł nie da się dojść inaczej niż
// przez pełny render z sesją, tenantem i kanałem realtime. Reguła bez własnego
// testu to reguła, którą wolno zepsuć po cichu.
//
// PRZENIESIENIE, NIE ZMIANA. Każda funkcja niżej odtwarza zachowanie sprzed
// ekstrakcji CO DO GAŁĘZI - włącznie z kolejnością warunków i z tym, że pusty
// `body` przy załączniku daje `undefined` (a nie pusty string). Kompozytor
// woła je zamiast powtarzać warunki w JSX-ie; nic w widocznym zachowaniu się
// nie zmienia. Gdzie zachowanie jest wątpliwe (pusty plik dostaje komunikat
// „za duży"), test opisuje to jako defekt przez `it.fails`, a kod zostaje.
import { attachmentKindForMime, validateAttachment, type AttachmentKind } from "./attachments";
import type { ChatMessage } from "./types";

/** Odstęp między broadcastami „pisze…" (jeden kanał, wiele klawiszy). */
export const TYPING_THROTTLE_MS = 2500;

/** Twardy limit treści wiadomości - lustro kolumny `messages.body`. */
export const MAX_BODY_LENGTH = 8000;

/** Twardy limit podpisu pod załącznikiem - baza tnie podpisy na 2000 znaków. */
export const MAX_CAPTION_LENGTH = 2000;

// --- klawiatura --------------------------------------------------------------

/**
 * Intencja klawisza w polu tekstowym.
 *
 * `newline` jest JAWNA, choć kompozytor nie robi wtedy nic: to jedyny sposób,
 * żeby test odróżnił „Shift+Enter świadomie nie wysyła" od „Shift+Enter wpadł
 * do gałęzi domyślnej przez pomyłkę".
 */
export type ComposerKeyIntent = "send" | "newline" | "cancel-edit" | "clear-staged" | "none";

export interface ComposerKeyEvent {
  key: string;
  shiftKey: boolean;
}

export interface ComposerKeyContext {
  /** Trwa edycja własnej wiadomości (bufor edycji, nie wersja robocza). */
  editing: boolean;
  /** Załącznik czeka na podpis i wysyłkę. */
  staged: boolean;
}

/**
 * Enter wysyła, Shift+Enter łamie linię, Escape wychodzi - najpierw z edycji,
 * potem z załącznika. Kolejność jest częścią kontraktu: podczas edycji Escape
 * NIE zdejmuje załącznika (edycja nie ma czego zdejmować), a poza edycją nie
 * ma czego anulować.
 */
export function composerKeyIntent(
  event: ComposerKeyEvent,
  ctx: ComposerKeyContext,
): ComposerKeyIntent {
  if (event.key === "Enter") return event.shiftKey ? "newline" : "send";
  if (event.key === "Escape") {
    if (ctx.editing) return "cancel-edit";
    if (ctx.staged) return "clear-staged";
  }
  return "none";
}

/**
 * Czy intencja klawisza musi zatrzymać propagację. Dotyczy WYŁĄCZNIE wyjścia
 * z edycji: okno w doku zamyka się na Escape, więc bez `stopPropagation`
 * anulowanie edycji zamykałoby całą rozmowę.
 */
export function keyIntentStopsPropagation(intent: ComposerKeyIntent): boolean {
  return intent === "cancel-edit";
}

/** Czy intencja klawisza przejmuje zdarzenie od przeglądarki. */
export function keyIntentPreventsDefault(intent: ComposerKeyIntent): boolean {
  return intent === "send" || intent === "cancel-edit" || intent === "clear-staged";
}

// --- morfowanie przycisku ----------------------------------------------------

export interface ComposerSurfaceContext {
  editing: boolean;
  text: string;
  staged: boolean;
}

/**
 * Próg morfowania mikrofonu w przycisk wysyłki (WhatsApp). Puste pole bez
 * załącznika i poza edycją = nagrywanie; cokolwiek do wysłania = wysyłka.
 * Brak wsparcia dla `MediaRecorder` również daje przycisk wysyłki - inaczej
 * przeglądarka bez mikrofonu nie miałaby czym wysłać pustej rozmowy.
 */
export function composerPrimaryAction(
  ctx: ComposerSurfaceContext & { recorderSupported: boolean },
): "record" | "send" {
  return isComposerEmpty(ctx) && ctx.recorderSupported ? "record" : "send";
}

/** Czy przycisk szybkiej emotki jest widoczny (obietnica dialogu wyglądu). */
export function quickEmojiVisible(ctx: ComposerSurfaceContext): boolean {
  return isComposerEmpty(ctx);
}

function isComposerEmpty(ctx: ComposerSurfaceContext): boolean {
  return !ctx.editing && ctx.text.trim().length === 0 && !ctx.staged;
}

// --- throttling „pisze…" -----------------------------------------------------

/**
 * Czy nadać kolejny broadcast „pisze…". Zegar jest PARAMETREM, nie odczytem
 * `Date.now()` w środku - dzięki temu test opisuje próg, a nie czeka na niego.
 */
export function shouldEmitTyping(
  now: number,
  lastEmittedAt: number,
  throttleMs: number = TYPING_THROTTLE_MS,
): boolean {
  return now - lastEmittedAt > throttleMs;
}

// --- walidacja załącznika ----------------------------------------------------

export type AttachmentRejectionKey = "chat.attachmentTooLarge" | "chat.attachmentWrongType";

export type StageFileDecision =
  | { readonly outcome: "reject"; readonly messageKey: AttachmentRejectionKey }
  | {
      readonly outcome: "stage";
      readonly kind: AttachmentKind;
      /** Podgląd przez `URL.createObjectURL` przysługuje wyłącznie obrazom. */
      readonly needsPreviewUrl: boolean;
    };

/**
 * Decyzja o przyjęciu pliku z okna wyboru: typ z listy `ATTACHMENT_ACCEPT`,
 * rozmiar w granicach kubełka (30 MB), rodzaj załącznika i to, czy trzeba
 * zbudować obiektowy URL podglądu.
 *
 * ZNANY DEFEKT (opisany testem `it.fails`): plik zerowej długości przechodzi
 * kontrolę typu i wypada na kontroli rozmiaru, więc dostaje komunikat „plik
 * jest za duży". Kod zostaje bez zmian - to jest zadanie testowe, nie
 * produktowe - ale defekt jest zapisany, a nie przemilczany.
 */
export function stageFileDecision(file: File): StageFileDecision {
  const invalid = validateAttachment(file);
  if (invalid === "size") return { outcome: "reject", messageKey: "chat.attachmentTooLarge" };
  if (invalid === "type") return { outcome: "reject", messageKey: "chat.attachmentWrongType" };
  const kind = attachmentKindForMime(file.type);
  // Nieosiągalne po `validateAttachment`, ale kompozytor miał tu własne
  // ramię obronne i przeniesienie ma być wierne, a nie „poprawione".
  if (!kind) return { outcome: "reject", messageKey: "chat.attachmentWrongType" };
  return { outcome: "stage", kind, needsPreviewUrl: kind === "image" };
}

/** Klucz komunikatu dla nieudanego przesyłania (limit tempa vs reszta). */
export function uploadErrorKey(error: unknown): "chat.uploadRateLimited" | "chat.uploadFailed" {
  return error instanceof Error && error.message.includes("rate-limited")
    ? "chat.uploadRateLimited"
    : "chat.uploadFailed";
}

/** Czy pasek postępu ma pokazać ikonę obrazu (a nie dokumentu). */
export function uploadLooksLikeImage(fileName: string): boolean {
  return /\.(jpe?g|png|gif|svg|webp)$/i.test(fileName);
}

// --- pasek odpowiedzi --------------------------------------------------------

/** Treść podglądu cytatu: własny tekst, zastępnik zdjęcia/pliku albo nagrobek. */
export type ReplyPreview =
  | { readonly kind: "deleted" }
  | { readonly kind: "body"; readonly body: string }
  | { readonly kind: "photo" }
  | { readonly kind: "file" };

export type ReplyBarState =
  | { readonly kind: "hidden" }
  | { readonly kind: "editing" }
  | {
      readonly kind: "reply";
      readonly author: string | null;
      readonly preview: ReplyPreview;
    };

/**
 * Stan paska nad polem tekstowym. EDYCJA WYGRYWA Z ODPOWIEDZIĄ - dwa paski
 * naraz obiecywałyby, że zapis edycji jest jednocześnie odpowiedzią, a nie
 * jest (`submit` w trybie edycji nigdy nie czyta `replyTo`).
 */
export function replyBarState(ctx: {
  editing: boolean;
  replyTo: ChatMessage | null;
  replyToAuthor: string | null;
}): ReplyBarState {
  if (ctx.editing) return { kind: "editing" };
  if (!ctx.replyTo) return { kind: "hidden" };
  return {
    kind: "reply",
    author: ctx.replyToAuthor,
    preview: replyPreview(ctx.replyTo),
  };
}

function replyPreview(message: ChatMessage): ReplyPreview {
  if (message.deleted_at) return { kind: "deleted" };
  // `??`, nie `||`: pusty podpis pod zdjęciem ma zostać pustym podpisem,
  // dokładnie jak przed ekstrakcją.
  if (message.body !== null && message.body !== undefined) {
    return { kind: "body", body: message.body };
  }
  return message.kind === "image" ? { kind: "photo" } : { kind: "file" };
}

// --- plan wysyłki ------------------------------------------------------------

export type ComposerSubmitPlan =
  | { readonly kind: "none" }
  | { readonly kind: "save-edit"; readonly messageId: string; readonly body: string }
  | { readonly kind: "cancel-edit" }
  | { readonly kind: "send-attachment"; readonly caption: string | undefined }
  | { readonly kind: "send-text"; readonly body: string };

export interface ComposerSubmitContext {
  text: string;
  editing: ChatMessage | null;
  hasStaged: boolean;
  /** Sesja i tenant znane - bez nich nie ma dokąd wgrać pliku. */
  canUpload: boolean;
}

/**
 * Jedno wyjście dla trzech trybów wysyłki (zapis edycji, załącznik z podpisem,
 * zwykły tekst). Kolejność gałęzi jest kontraktem: edycja wygrywa z załącznikiem,
 * załącznik wygrywa z tekstem, a pusty tekst bez załącznika nie wysyła nic.
 */
export function composerSubmitPlan(ctx: ComposerSubmitContext): ComposerSubmitPlan {
  const body = ctx.text.trim();

  if (ctx.editing) {
    const previous = (ctx.editing.body ?? "").trim();
    // Zapis BEZ zmiany treści to nie zapis - kolumna `edited_at` nie może
    // kłamać, że wiadomość była poprawiana.
    if (body && body !== previous) {
      return { kind: "save-edit", messageId: ctx.editing.id, body: body.slice(0, MAX_BODY_LENGTH) };
    }
    return { kind: "cancel-edit" };
  }

  if (ctx.hasStaged) {
    if (!ctx.canUpload) return { kind: "none" };
    return { kind: "send-attachment", caption: body.slice(0, MAX_CAPTION_LENGTH) || undefined };
  }

  if (!body) return { kind: "none" };
  return { kind: "send-text", body: body.slice(0, MAX_BODY_LENGTH) };
}
