// Wpisy klubowe (A31) - model danych warstwy "ściany" społecznościowej.
//
// PO CO ISTNIEJE OSOBNY BYT OBOK WĄTKU. Wątek jest zobowiązaniem: ma tytuł,
// dział, kotwicę, status i cykl życia (otwarty -> rozstrzygnięty). Większość
// tego, co członek chce powiedzieć - zdjęcie z posiedzenia, PDF raportu,
// link do rozporządzenia z jednym zdaniem komentarza - nie jest tematem
// dyskusji i zakładanie dla tego wątku psuje obie rzeczy naraz: lista
// tematów zapycha się notatkami, a notatka dostaje ciężar, którego nie unosi.
//
// Wpis jest więc formą KRÓTKĄ i bez cyklu życia, a jego jedynym powiązaniem
// ze strukturą klubu jest opcjonalny wątek. To powiązanie jest istotą całej
// funkcji: post podpięty do wątku pokazuje się RÓWNIEŻ w tym wątku, więc
// materiał trafia tam, gdzie toczy się rozmowa, bez przepisywania go ręcznie.
//
// ZAŁĄCZNIKI SĄ JSONB, NIE TABELĄ. Załącznik nie ma własnego cyklu życia:
// nie da się go współdzielić między wpisami, nie da się go wersjonować i
// znika razem z wpisem. Osobna tabela dokładałaby JOIN i drugą ścieżkę
// autoryzacji do bytu, który zawsze czyta się w komplecie z rodzicem.
// Rzeczy, które mają własne życie, są w klubie osobno - to `club_documents`.
import type { Json } from "@/integrations/supabase/types";

/** Prywatny kubełek plików wpisów. Odczyt idzie przez podpisane adresy. */
export const CLUB_POST_MEDIA_BUCKET = "club-media";

export const CLUB_POST_MAX_BODY = 6000;
export const CLUB_POST_MAX_ATTACHMENTS = 10;
/** 50 MB - limit kubełka. Sprawdzamy po stronie klienta, żeby użytkownik
 *  dostał zdanie po polsku, a nie surowy błąd magazynu po wysłaniu 300 MB. */
export const CLUB_POST_MAX_FILE_BYTES = 50 * 1024 * 1024;

export const CLUB_POST_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;
export const CLUB_POST_VIDEO_MIME = ["video/mp4", "video/webm"] as const;
/** Dokumenty: PDF, pakiet Office (nowy i stary), OpenDocument, dane i tekst.
 *  Wszystkie mają podgląd w platformie (popup), więc lista akceptacji i lista
 *  obsługiwanych podglądów są celowo tą samą listą. */
export const CLUB_POST_FILE_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/rtf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/zip",
] as const;

/** Rozszerzenia dla atrybutu `accept`: system operacyjny bywa, że oddaje pusty
 *  MIME dla .csv czy .docx z dysku sieciowego - wtedy tylko rozszerzenie
 *  pozwala użytkownikowi w ogóle wybrać plik. */
export const CLUB_POST_FILE_EXT = [
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
  ".txt",
  ".csv",
  ".md",
  ".json",
  ".zip",
] as const;

export const CLUB_POST_ACCEPT_MIME: readonly string[] = [
  ...CLUB_POST_IMAGE_MIME,
  ...CLUB_POST_VIDEO_MIME,
  ...CLUB_POST_FILE_MIME,
];

/** Wartość dla `<input accept>` - MIME plus rozszerzenia (patrz wyżej). */
export const CLUB_POST_ACCEPT_ATTR: string = [...CLUB_POST_ACCEPT_MIME, ...CLUB_POST_FILE_EXT].join(
  ",",
);

export type ClubPostMediaKind = "image" | "video" | "file";

/**
 * Rodzaj załącznika. MIME jest pierwszym źródłem prawdy, ale gdy przeglądarka
 * odda pusty typ albo `application/octet-stream` (regularnie zdarza się to dla
 * plików Office z dysków sieciowych), decyduje rozszerzenie nazwy - inaczej
 * użytkownik dostawałby "nieobsługiwany format" dla zwykłego .docx.
 */
export function clubPostMediaKind(mime: string, name = ""): ClubPostMediaKind | null {
  if ((CLUB_POST_IMAGE_MIME as readonly string[]).includes(mime)) return "image";
  if ((CLUB_POST_VIDEO_MIME as readonly string[]).includes(mime)) return "video";
  if ((CLUB_POST_FILE_MIME as readonly string[]).includes(mime)) return "file";
  const dot = name.lastIndexOf(".");
  if (dot >= 0) {
    const ext = name.slice(dot).toLowerCase();
    if ((CLUB_POST_FILE_EXT as readonly string[]).includes(ext)) return "file";
  }
  return null;
}

export interface ClubPostMediaAttachment {
  type: ClubPostMediaKind;
  /** Ścieżka w kubełku, NIE adres. Adresy podpisane wygasają, więc trzymanie
   *  ich w bazie znaczyłoby, że wpis psuje się po godzinie. */
  path: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface ClubPostLinkAttachment {
  type: "link";
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

export type ClubPostAttachment = ClubPostMediaAttachment | ClubPostLinkAttachment;

export function isLinkAttachment(value: ClubPostAttachment): value is ClubPostLinkAttachment {
  return value.type === "link";
}

export function isMediaAttachment(value: ClubPostAttachment): value is ClubPostMediaAttachment {
  return value.type !== "link";
}

/** Wiersz z `club_posts_list`. */
export interface ClubPostRow {
  id: string;
  club_id: string;
  group_id: string | null;
  group_name_pl: string | null;
  group_name_en: string | null;
  thread_id: string | null;
  thread_slug: string | null;
  thread_title: string | null;
  author_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  author_slug: string | null;
  body: string;
  attachments: Json;
  like_count: number;
  liked_by_me: boolean;
  can_manage: boolean;
  created_at: string;
  edited_at: string | null;
  total_count: number;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Odczyt załączników z jsonb.
 *
 * WPIS Z JEDNYM USZKODZONYM ZAŁĄCZNIKIEM MA SIĘ WYŚWIETLIĆ. Dlatego zamiast
 * walidacji "wszystko albo nic" każdy element przechodzi osobno, a element
 * bez rozpoznanego kształtu jest po prostu pomijany - inaczej jeden zły
 * rekord (np. po ręcznej korekcie w bazie) wywracałby całą kartę.
 */
export function parseClubPostAttachments(value: Json | null | undefined): ClubPostAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: ClubPostAttachment[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const type = readString(item, "type");
    if (type === "link") {
      const url = readString(item, "url");
      if (url === null) continue;
      out.push({
        type: "link",
        url,
        title: readString(item, "title"),
        description: readString(item, "description"),
        image: readString(item, "image"),
        siteName: readString(item, "siteName"),
      });
      continue;
    }
    if (type !== "image" && type !== "video" && type !== "file") continue;
    const path = readString(item, "path");
    if (path === null) continue;
    out.push({
      type,
      path,
      name: readString(item, "name") ?? path.split("/").pop() ?? "file",
      mime: readString(item, "mime") ?? "application/octet-stream",
      size: readNumber(item, "size") ?? 0,
      width: readNumber(item, "width"),
      height: readNumber(item, "height"),
    });
  }
  return out.slice(0, CLUB_POST_MAX_ATTACHMENTS);
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/i;

/**
 * Pierwszy adres z treści - kandydat na podgląd linku.
 * Kompozytor pobiera metadane DOPIERO dla niego, więc wklejenie pięciu
 * odnośników nie oznacza pięciu zapytań sieciowych.
 */
export function extractFirstUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text);
  if (match === null) return null;
  // Kropka i przecinek na końcu zdania nie są częścią adresu.
  return match[0].replace(/[.,;:]+$/, "");
}

/** Czy wpis da się w ogóle zapisać (ten sam warunek, co CHECK w bazie). */
export function canSubmitClubPost(body: string, attachments: readonly unknown[]): boolean {
  return body.trim().length > 0 || attachments.length > 0;
}
