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
  /** Komentarze `visible` wpisu - licznik w pasie karty, zanim lista dojedzie. */
  comment_count: number;
  /** `club_capabilities(klub, dział).can_reply` WOŁAJĄCEGO; gość zawsze `false`. */
  can_comment: boolean;
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

// ---------------------------------------------------------------------------
// Komentarze wpisów ściany (`club_post_comments`)
//
// DLACZEGO KOMENTARZ NIE JEST ODPOWIEDZIĄ W WĄTKU. Wpis jest formą krótką
// i bez cyklu życia (nagłówek pliku), więc rozmowa pod nim też jest krótka:
// PŁASKA lista bez drzewa, bez rozstrzygnięć i bez stanowisk. „Odpowiedz" na
// komentarz to wzmianka `@slug` w nowym komentarzu - powiadamia adresata, a nie
// buduje gałęzi, której karta w strumieniu i tak nie miałaby gdzie pokazać.
// ---------------------------------------------------------------------------

/** Twardy limit treści komentarza - ten sam, co CHECK w `club_post_comments`. */
export const CLUB_POST_COMMENT_MAX = 3000;

/** Ile komentarzy pokazuje karta, zanim czytelnik poprosi o wcześniejsze. */
export const CLUB_POST_COMMENT_PAGE_SIZE = 3;

/** Górny limit adresu w migawce linku (url i obraz) - jak walidacja RPC. */
export const CLUB_LINK_URL_MAX = 2048;

/** Górny limit pól tekstowych migawki (tytuł, opis, nazwa serwisu). */
export const CLUB_LINK_TEXT_MAX = 300;

/** Statusy komentarza - słownik zamknięty, zgodny z CHECK-iem tabeli. */
export const CLUB_POST_COMMENT_STATUSES = ["pending", "visible", "hidden", "deleted"] as const;
export type ClubPostCommentStatus = (typeof CLUB_POST_COMMENT_STATUSES)[number];

export function isClubPostCommentStatus(value: unknown): value is ClubPostCommentStatus {
  return (CLUB_POST_COMMENT_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Wiersz `club_post_comments_list`.
 *
 * Pola autora są NULL-ami w trybie Chatham House - wtedy `author_alias` niesie
 * stabilny pseudonim per wpis. Komponent renderuje autora WYŁĄCZNIE przez
 * `toAuthorLabel` (`types.ts`), więc decyzja o anonimowości zostaje w bazie.
 */
export interface ClubPostCommentRow {
  id: string;
  post_id: string;
  body: string;
  /** Migawka podglądu linku z chwili wysłania; czytać przez `parseClubLinkSnapshot`. */
  link_preview: Json | null;
  status: ClubPostCommentStatus;
  author_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  author_slug: string | null;
  author_alias: string | null;
  created_at: string;
  edited_at: string | null;
  /** Autor komentarza albo moderator klubu/działu - może usunąć. */
  can_manage: boolean;
  /**
   * Komentarz czeka w kolejce, a WOŁAJĄCY moderuje klub/dział wpisu - może go
   * zatwierdzić (`club_post_comment_moderate`). Nie da się tego wyprowadzić
   * z `can_manage`: ten jest prawdziwy także dla autora, a w trybie Chatham
   * House `author_id` jest NULL-em, więc widok nie odróżniłby jednego od drugiego.
   */
  can_approve: boolean;
  /** Komentarze widoczne dla WOŁAJĄCEGO (bez kursora) - licznik „wcześniejszych". */
  total_count: number;
}

/**
 * Decyzja moderatora o komentarzu (`club_post_comment_moderate`):
 * `approve` - z kolejki albo z ukrycia do widocznych, `hide` - z widocznych
 * albo z kolejki do ukrytych.
 */
export type ClubPostCommentModerationAction = "approve" | "hide";

/**
 * O ile zmienia się `comment_count` wpisu, gdy komentarz przechodzi ze statusu
 * `from` do `to`. Licznik liczy WYŁĄCZNIE komentarze `visible`, więc zmiana
 * między kolejką, ukryciem i usunięciem nie rusza go wcale.
 */
export function clubCommentCountDelta(
  from: ClubPostCommentStatus,
  to: ClubPostCommentStatus,
): -1 | 0 | 1 {
  if (from === to) return 0;
  if (to === "visible") return 1;
  return from === "visible" ? -1 : 0;
}

/**
 * Czy komentarz da się wysłać. JEDNO miejsce dla przycisku i dla uchwytu
 * skrótu klawiszowego (ta sama zasada, co `canSubmitClubReply`): rozjazd
 * tych dwóch warunków daje przycisk, który wygląda na czynny i nic nie robi.
 *
 * Długość liczymy w PUNKTACH KODOWYCH, jak `char_length` w Postgresie - emoji
 * to jeden znak dla bazy i dwie jednostki UTF-16 dla `String.length`.
 */
export function canSubmitClubComment(body: string, pending: boolean): boolean {
  if (pending) return false;
  const length = Array.from(body.trim()).length;
  return length > 0 && length <= CLUB_POST_COMMENT_MAX;
}

// ---------------------------------------------------------------------------
// Migawka podglądu linku
// ---------------------------------------------------------------------------

/**
 * Podgląd OpenGraph ZAMROŻONY w chwili wysyłki. Ten sam kształt, co
 * `ClubPostLinkAttachment` bez `type` i co wynik `fetchClubLinkPreview`.
 *
 * DLACZEGO MIGAWKA, A NIE POBRANIE PRZY ODCZYCIE. Serwer podglądów nie ma
 * pamięci podręcznej, a limit 30 podglądów na minutę na konto zamyka się na
 * twardo - strumień z dwudziestoma komentarzami z linkami wyczerpałby go
 * jednym przewinięciem. Podgląd pobiera więc AUTOR (raz), a czytelnicy dostają
 * zapisane pięć pól.
 */
export interface ClubLinkSnapshot {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

/** Znaki sterujące C0, DEL i C1 - ten sam zbiór, który baza odrzuca jako `[:cntrl:]`. */
function hasControlChar(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isLoneSurrogate(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdfff;
}

/**
 * Tekst przycięty do `max` PUNKTÓW KODOWYCH, bez osieroconych surogatów
 * i bez znaków sterujących.
 *
 * DLACZEGO NIE `slice`. `slice(0, 300)` tnie po jednostkach UTF-16, więc emoji
 * na granicy zostawia połówkę pary. `JSON.stringify` zapisuje ją jako `\ud83d`,
 * a `jsonb` w Postgresie odrzuca taki escape - komentarz z podglądem padałby
 * błędem bazy, którego autor nie ma jak zrozumieć.
 *
 * ZNAKI STERUJĄCE z tego samego powodu: surowy bajt NUL w `og:title` strony
 * dojeżdża jako U+0000, a `jsonb` odrzuca `\u0000` (22P05) - cały komentarz
 * albo wpis padałby przez dodatek, który z założenia nigdy go nie blokuje.
 * Reszta C0/DEL/C1 nie ma czego szukać w tytule, a baza i tak odrzuca ją
 * jako `[:cntrl:]`. Biały znak sterujący (koniec linii, tabulator) staje się
 * spacją, żeby „Raport\nroczny" nie zlepił się w jedno słowo.
 */
function clampText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  let cleaned = "";
  for (const char of Array.from(value)) {
    if (isLoneSurrogate(char)) continue;
    if (!hasControlChar(char)) cleaned += char;
    else if (/\s/.test(char) && !cleaned.endsWith(" ")) cleaned += " ";
  }
  const text = Array.from(cleaned.trim()).slice(0, max).join("").trim();
  return text === "" ? null : text;
}

/**
 * Adres https albo `null`. Schemat sprawdzamy na surowym tekście I przez
 * parser `URL` - samo `startsWith` przepuściłoby `https://` bez hosta,
 * a sam parser przyjąłby `javascript:` jako poprawny adres.
 */
function readHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^https:\/\//i.test(raw)) return null;
  if (Array.from(raw).length > CLUB_LINK_URL_MAX) return null;
  // Biały znak albo znak sterujący WEWNĄTRZ adresu: parser `URL` po cichu go
  // zakoduje albo wytnie, więc karta prowadziłaby gdzie indziej, niż pokazuje.
  if (/\s/.test(raw) || hasControlChar(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.hostname === "") return null;
  } catch {
    return null;
  }
  // Baza sprawdza prefiks dosłownie, więc `HTTPS://` normalizujemy do małych
  // liter - reszta adresu zostaje bajt w bajt taka, jaką wkleił autor.
  return `https://${raw.slice("https://".length)}`;
}

function normalizeSnapshot(source: Record<string, unknown>): ClubLinkSnapshot | null {
  const url = readHttpsUrl(source.url);
  if (url === null) return null;
  return {
    url,
    title: clampText(source.title, CLUB_LINK_TEXT_MAX),
    description: clampText(source.description, CLUB_LINK_TEXT_MAX),
    // Obraz spoza https (albo za długi) znika, ale karta zostaje - tytuł
    // i adres wystarczą, a `http:` w `<img>` to mieszana treść i ślad wizyty.
    image: readHttpsUrl(source.image),
    siteName: clampText(source.siteName, CLUB_LINK_TEXT_MAX),
  };
}

/**
 * Odczyt migawki z jsonb (`link_preview` komentarza).
 *
 * TOLERANCYJNY jak `parseClubPostAttachments`: śmieć daje `null` (brak karty),
 * nigdy wyjątek - komentarz z uszkodzoną migawką ma się wyświetlić. Te same
 * granice, co walidacja RPC (https, 2048 / 300 znaków), więc wiersz zapisany
 * z pominięciem RPC i tak nie wstawi do karty `data:` ani `javascript:`.
 */
export function parseClubLinkSnapshot(json: Json | null | undefined): ClubLinkSnapshot | null {
  if (json === null || json === undefined || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }
  return normalizeSnapshot(json as Record<string, unknown>);
}

/**
 * Migawka z wyniku `fetchClubLinkPreview` - PRZED wysyłką.
 *
 * Serwer podglądów może oddać obraz `http:` (rozwiązuje adres względny
 * strony), a RPC komentarza odrzuciłoby go całym błędem. Normalizacja tutaj
 * sprawia, że podgląd nigdy nie blokuje komentarza: w najgorszym razie karta
 * jedzie bez obrazu, a przy adresie nie do przyjęcia - nie jedzie wcale.
 */
export function clubLinkSnapshotFromPreview(
  preview: Readonly<Partial<ClubLinkSnapshot>> | null | undefined,
): ClubLinkSnapshot | null {
  if (preview === null || preview === undefined) return null;
  return normalizeSnapshot({ ...preview });
}

/** Element `type: "link"` dla `p_attachments` nowego wpisu ściany. */
export function clubLinkSnapshotToAttachment(snapshot: ClubLinkSnapshot): ClubPostLinkAttachment {
  return {
    type: "link",
    url: snapshot.url,
    title: snapshot.title,
    description: snapshot.description,
    image: snapshot.image,
    siteName: snapshot.siteName,
  };
}

// ---------------------------------------------------------------------------
// Błędy komentowania z karty strumienia
// ---------------------------------------------------------------------------

/**
 * Klucze i18n komunikatów o odmowie. Lista jest JAWNA, żeby test słowników
 * mógł sprawdzić, że każdy klucz ma tekst w PL i EN.
 */
export const CLUB_COMMENT_ERROR_KEYS = [
  "club.comments.error.rateLimit",
  "club.comments.error.burstLimit",
  "club.comments.error.forbidden",
  "club.comments.error.locked",
  "club.comments.error.notFound",
  "club.comments.error.invalid",
  "club.comments.error.generic",
] as const;
export type ClubCommentErrorKey = (typeof CLUB_COMMENT_ERROR_KEYS)[number];

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * Komunikat odmowy dla komentarza wpisu (`club_post_comment_create`) ORAZ
 * odpowiedzi w wątku wysłanej z karty (`club_reply`).
 *
 * DLACZEGO PO TEKŚCIE. PostgREST gubi SQLSTATE po drodze do klienta, więc
 * jedynym stabilnym nośnikiem powodu jest treść `RAISE EXCEPTION 'clubs: …'`
 * - te same napisy, na których stoi `toClubSaveError`. Kolejność sprawdzeń
 * ma znaczenie: „burst limit" sprawdzamy PRZED „rate limit", a brak sesji
 * (`authentication required`) traktujemy jak brak prawa - z karty i tak nie da
 * się w tej chwili napisać, a powód „zaloguj się" pokazuje sam widok gościa.
 */
export function clubCommentErrorKey(error: unknown): ClubCommentErrorKey {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("burst limit")) return "club.comments.error.burstLimit";
  if (message.includes("rate limit")) return "club.comments.error.rateLimit";
  if (message.includes("thread locked")) return "club.comments.error.locked";
  if (message.includes("clubs: forbidden") || message.includes("authentication required")) {
    return "club.comments.error.forbidden";
  }
  if (message.includes("not found")) return "club.comments.error.notFound";
  if (message.includes("invalid")) return "club.comments.error.invalid";
  return "club.comments.error.generic";
}

// ---------------------------------------------------------------------------
// Błędy publikacji wpisu ściany (`club_post_create`)
// ---------------------------------------------------------------------------

/**
 * Klucze i18n odmowy publikacji wpisu. Lista JAWNA z tego samego powodu, co
 * `CLUB_COMMENT_ERROR_KEYS`: test słowników sprawdza po niej PL i EN.
 */
export const CLUB_POST_ERROR_KEYS = [
  "club.post.error.rateLimit",
  "club.post.error.burstLimit",
  "club.post.error.invalidLink",
  "club.post.error.forbidden",
  "club.post.error.invalid",
  "club.post.error.generic",
] as const;
export type ClubPostErrorKey = (typeof CLUB_POST_ERROR_KEYS)[number];

/**
 * Komunikat odmowy dla kompozytora wpisu - zamiast surowego `error.message`
 * z bazy w dymku.
 *
 * Napisy RPC: `clubs: post burst limit` / `clubs: post rate limit` (limity
 * autora, 42901), `clubs: invalid link attachment` (karta linku nie przeszła
 * walidacji) oraz `club_post_create: …` dla braku sesji, braku prawa i treści
 * nie do przyjęcia. Kolejność jak w `clubCommentErrorKey`: „burst limit"
 * PRZED „rate limit", karta linku PRZED ogólnym „invalid".
 */
export function clubPostErrorKey(error: unknown): ClubPostErrorKey {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("burst limit")) return "club.post.error.burstLimit";
  if (message.includes("rate limit")) return "club.post.error.rateLimit";
  if (message.includes("invalid link attachment")) return "club.post.error.invalidLink";
  if (
    message.includes("forbidden") ||
    message.includes("unauthenticated") ||
    message.includes("authentication required")
  ) {
    return "club.post.error.forbidden";
  }
  if (
    message.includes("invalid") ||
    message.includes("empty post") ||
    message.includes("body too long") ||
    message.includes("too many attachments") ||
    message.includes("not in club")
  ) {
    return "club.post.error.invalid";
  }
  return "club.post.error.generic";
}
