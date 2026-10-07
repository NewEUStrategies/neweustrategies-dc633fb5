// Wpisy klubowe (A31) - warstwa dostępu do danych.
//
// Tak jak reszta modułu: JEDNO wywołanie RPC na operację, zero zapytań
// tabelarycznych. `club_posts` nie ma polityk RLS, więc `supabase.from(...)`
// zwróciłby pusty zbiór nawet autorowi - cała autoryzacja żyje w SECURITY
// DEFINER, po `club_capabilities`.
//
// PLIKI IDĄ WPROST DO MAGAZYNU, nie przez serwer. Przesyłanie 50 MB wideo
// przez funkcję serwerową znaczyłoby bufor w pamięci workera i limit czasu.
// Zamiast tego kubełek jest PRYWATNY, zapis ograniczony polityką do katalogu
// `<uid>/`, a odczyt idzie przez adresy podpisane na godzinę.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  CLUB_POST_COMMENT_PAGE_SIZE,
  CLUB_POST_MAX_FILE_BYTES,
  CLUB_POST_MEDIA_BUCKET,
  clubLinkSnapshotFromPreview,
  clubPostMediaKind,
  isClubPostCommentStatus,
  type ClubLinkSnapshot,
  type ClubPostAttachment,
  type ClubPostCommentRow,
  type ClubPostMediaAttachment,
  type ClubPostRow,
} from "./postTypes";

type Fn = Database["public"]["Functions"];

export interface ClubPostsPage {
  rows: ClubPostRow[];
  total: number;
}

export interface ClubPostsQuery {
  clubId: string;
  groupId?: string | null;
  threadId?: string | null;
  limit?: number;
  cursor?: string | null;
}

export async function fetchClubPosts(params: ClubPostsQuery): Promise<ClubPostsPage> {
  const { data, error } = await supabase.rpc("club_posts_list", {
    p_club_id: params.clubId,
    p_group_id: params.groupId ?? undefined,
    p_thread_id: params.threadId ?? undefined,
    p_limit: params.limit ?? 20,
    p_cursor: params.cursor ?? undefined,
  });
  if (error) throw error;
  // Liczniki komentarzy NORMALIZUJEMY, zamiast ufać rzutowaniu: przed
  // wdrożeniem migracji komentarzy RPC nie zwraca tych kolumn, a `undefined`
  // w liczniku renderowałoby się w karcie jako „Komentuj · undefined".
  const rows = ((data ?? []) as ClubPostRow[]).map((row) => ({
    ...row,
    comment_count: Number(row.comment_count ?? 0) || 0,
    can_comment: row.can_comment === true,
  }));
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

export interface CreateClubPostInput {
  clubId: string;
  groupId?: string | null;
  threadId?: string | null;
  body: string;
  attachments: readonly ClubPostAttachment[];
}

export async function createClubPost(input: CreateClubPostInput): Promise<string> {
  const payload: unknown = JSON.parse(JSON.stringify(input.attachments));
  const { data, error } = await supabase.rpc("club_post_create", {
    p_club_id: input.clubId,
    p_group_id: input.groupId ?? undefined,
    p_thread_id: input.threadId ?? undefined,
    p_body: input.body,
    p_attachments: payload as Json,
  });
  if (error) throw error;
  const rows = (data ?? []) as Array<{ post_id: string }>;
  return rows[0]?.post_id ?? "";
}

export async function deleteClubPost(postId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_post_delete", { p_post_id: postId });
  if (error) throw error;
  return data === true;
}

export interface ClubPostLikeResult {
  liked: boolean;
  likeCount: number;
}

export async function toggleClubPostLike(postId: string): Promise<ClubPostLikeResult> {
  const { data, error } = await supabase.rpc("club_post_toggle_like", { p_post_id: postId });
  if (error) throw error;
  const rows = (data ?? []) as Array<{ liked: boolean; like_count: number }>;
  const row = rows[0];
  return { liked: row?.liked === true, likeCount: Number(row?.like_count ?? 0) };
}

// ---------------------------------------------------------------------------
// Komentarze wpisów
//
// KOLEJNOŚĆ: NAJNOWSZE PIERWSZE, kursor KEYSET `(created_at, id)`. Karta
// pokazuje najświeższe komentarze, a „wcześniejsze" doczytuje w głąb - offset
// przesuwałby się przy każdym nowym komentarzu i dublował wiersz na granicy
// stron, a sam znacznik czasu (jak w `club_posts_list`) gubiłby komentarze
// z tej samej mikrosekundy. Odwrócenie do kolejności czytania robi hook.
// ---------------------------------------------------------------------------

export interface ClubPostCommentsCursor {
  createdAt: string;
  id: string;
}

export interface ClubPostCommentsPage {
  /** Strona w kolejności RPC: najnowszy komentarz pierwszy. */
  rows: ClubPostCommentRow[];
  /** Wszystkie komentarze widoczne dla wołającego, nie tylko ta strona. */
  total: number;
}

export interface ClubPostCommentsQuery {
  postId: string;
  limit?: number;
  /** Ostatni (najstarszy) wiersz poprzedniej strony; brak = najnowsze. */
  before?: ClubPostCommentsCursor | null;
}

type CommentRpcRow = Fn["club_post_comments_list"]["Returns"][number];

/**
 * Wiersz RPC -> wiersz widoku. Każde pole jest przepisane JAWNIE (nie
 * rzutowaniem), więc przemianowana kolumna w `types.ts` wychodzi błędem
 * kompilacji tutaj, a nie pustym polem w karcie. Status spoza słownika
 * odrzucamy: komponent porównujący go z `"pending"` pisałby warunek, który
 * nigdy nie jest prawdziwy.
 */
function toCommentRow(row: CommentRpcRow): ClubPostCommentRow | null {
  if (!isClubPostCommentStatus(row.status)) return null;
  return {
    id: row.id,
    post_id: row.post_id,
    body: row.body ?? "",
    link_preview: row.link_preview ?? null,
    status: row.status,
    author_id: row.author_id ?? null,
    author_name: row.author_name ?? null,
    author_avatar: row.author_avatar ?? null,
    author_slug: row.author_slug ?? null,
    author_alias: row.author_alias ?? null,
    created_at: row.created_at,
    edited_at: row.edited_at ?? null,
    can_manage: row.can_manage === true,
    total_count: Number(row.total_count ?? 0) || 0,
  };
}

export async function fetchClubPostComments(
  params: ClubPostCommentsQuery,
): Promise<ClubPostCommentsPage> {
  const before = params.before ?? null;
  const { data, error } = await supabase.rpc("club_post_comments_list", {
    p_post_id: params.postId,
    p_limit: params.limit ?? CLUB_POST_COMMENT_PAGE_SIZE,
    // Kursor jedzie PARĄ albo wcale - sam znacznik czasu bez `id` to inny
    // (i błędny) warunek strony.
    p_before: before?.createdAt ?? undefined,
    p_before_id: before?.id ?? undefined,
  });
  if (error) throw error;
  const raw = data ?? [];
  const rows: ClubPostCommentRow[] = [];
  for (const item of raw) {
    const row = toCommentRow(item);
    if (row !== null) rows.push(row);
  }
  return { rows, total: raw.length > 0 ? Number(raw[0].total_count ?? 0) || 0 : 0 };
}

/**
 * Wynik dodania komentarza. `queued` = kolejka premoderacji: komentarz wraca
 * z listy WYŁĄCZNIE autorowi (z plakietką), reszta zobaczy go po akceptacji.
 */
export interface ClubPostCommentOutcome {
  id: string;
  queued: boolean;
}

export interface CreateClubPostCommentInput {
  postId: string;
  body: string;
  /** Migawka podglądu z kompozytora; `null`/brak = komentarz bez karty linku. */
  linkPreview?: ClubLinkSnapshot | null;
}

/**
 * Nowy komentarz. Treść jest PRZYCINANA tutaj, a nie u wołającego: końcowy
 * znak nowej linii z pola tekstowego nie jest treścią, a w `pre-wrap` rysuje
 * pusty wiersz w dymku.
 *
 * Migawka jest normalizowana PRZED wysyłką do dokładnie pięciu pól, które
 * przyjmuje RPC. Podgląd jest dodatkiem: migawka nie do przyjęcia (np. adres
 * bez https) jedzie jako brak migawki, zamiast zablokować cały komentarz
 * błędem `invalid link preview`.
 */
export async function createClubPostComment(
  input: CreateClubPostCommentInput,
): Promise<ClubPostCommentOutcome> {
  const snapshot = clubLinkSnapshotFromPreview(input.linkPreview);
  const { data, error } = await supabase.rpc("club_post_comment_create", {
    p_post_id: input.postId,
    p_body: input.body.trim(),
    p_link_preview:
      snapshot === null
        ? undefined
        : {
            url: snapshot.url,
            title: snapshot.title,
            description: snapshot.description,
            image: snapshot.image,
            siteName: snapshot.siteName,
          },
  });
  if (error) throw error;
  // Pusta odpowiedź nie powinna się zdarzyć, ale udawanie publikacji byłoby
  // gorsze niż błąd - ta sama zasada, co w `replyToClubThread`.
  const row = (data ?? [])[0];
  if (row === undefined) throw new Error("club_post_comment_create: brak wiersza wyniku");
  return { id: row.comment_id, queued: row.comment_status === "pending" };
}

/**
 * Usunięcie komentarza (miękkie, `status = 'deleted'`). Idzie po SAMYM
 * identyfikatorze - wpis i klub ustala RPC z wiersza, a prawo (autor albo
 * moderator) sprawdza `club_capabilities`. `false` = już usunięty / nie ma.
 */
export async function deleteClubPostComment(commentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_post_comment_delete", {
    p_comment_id: commentId,
  });
  if (error) throw error;
  return data === true;
}

// ---------------------------------------------------------------------------
// Magazyn plików
// ---------------------------------------------------------------------------

export class ClubMediaError extends Error {
  readonly code: "type" | "size" | "auth" | "upload";
  constructor(code: "type" | "size" | "auth" | "upload", message: string) {
    super(message);
    this.name = "ClubMediaError";
    this.code = code;
  }
}

function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return cleaned === "" ? "plik" : cleaned.slice(-80);
}

/**
 * Wysyła jeden plik do `club-media/<uid>/...` i zwraca gotowy załącznik.
 * Wymiary obrazu czytamy PRZED wysyłką: karta wpisu rezerwuje wtedy właściwą
 * proporcję i strumień nie skacze przy dociąganiu zdjęć.
 */
export async function uploadClubPostMedia(file: File): Promise<ClubPostMediaAttachment> {
  const kind = clubPostMediaKind(file.type, file.name);
  if (kind === null) {
    throw new ClubMediaError("type", `Unsupported file type: ${file.type || file.name}`);
  }
  if (file.size > CLUB_POST_MAX_FILE_BYTES) {
    throw new ClubMediaError("size", `File too large: ${file.size}`);
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;
  if (userId === null) throw new ClubMediaError("auth", "Not signed in");

  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  const path = `${userId}/${stamp}-${random}-${safeName(file.name)}`;

  const { error } = await supabase.storage
    .from(CLUB_POST_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new ClubMediaError("upload", error.message);

  // Wymiary nagrania też: pionowe wideo (4:5, 9:16) dostaje wtedy w strumieniu
  // własną ramę zamiast pasów w ramie 16:9.
  const dimensions =
    kind === "image"
      ? await readImageSize(file)
      : kind === "video"
        ? await readVideoSize(file)
        : null;

  return {
    type: kind,
    path,
    name: file.name.slice(0, 120),
    mime: file.type,
    size: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Wymiary nagrania z jego metadanych. Odczyt ma limit czasu: kodek, którego
 * przeglądarka nie rozumie, nigdy nie odpali `loadedmetadata`, a wysyłka nie
 * może na to czekać - bez wymiarów karta po prostu użyje ramy 16:9.
 */
async function readVideoSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const probe = document.createElement("video");
  // Format, którego przeglądarka nie odtworzy, nie odda też metadanych -
  // nie ma na co czekać.
  if (typeof probe.canPlayType !== "function" || probe.canPlayType(file.type) === "") return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      probe.preload = "metadata";
      probe.muted = true;
      probe.onloadedmetadata = () => {
        clearTimeout(timer);
        const { videoWidth, videoHeight } = probe;
        resolve(
          videoWidth > 0 && videoHeight > 0 ? { width: videoWidth, height: videoHeight } : null,
        );
      };
      probe.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      probe.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Usuwa plik, którego wpis ostatecznie nie użył (autor cofnął załącznik). */
export async function removeClubPostMedia(path: string): Promise<void> {
  await supabase.storage.from(CLUB_POST_MEDIA_BUCKET).remove([path]);
}

/**
 * Podpisane adresy dla listy ścieżek - JEDNYM żądaniem.
 * Wpis z galerią czterech zdjęć nie ma prawa generować czterech round-tripów.
 */
export async function signClubMediaUrls(
  paths: readonly string[],
  expiresIn = 3600,
): Promise<Record<string, string>> {
  const unique = [...new Set(paths)].filter((path) => path.trim() !== "");
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(CLUB_POST_MEDIA_BUCKET)
    .createSignedUrls(unique, expiresIn);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path !== null && typeof entry.signedUrl === "string") {
      out[entry.path] = entry.signedUrl;
    }
  }
  return out;
}
