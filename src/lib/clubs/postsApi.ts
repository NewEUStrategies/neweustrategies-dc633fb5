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
import type { Json } from "@/integrations/supabase/types";
import {
  CLUB_POST_ACCEPT_MIME,
  CLUB_POST_MAX_FILE_BYTES,
  CLUB_POST_MEDIA_BUCKET,
  clubPostMediaKind,
  type ClubPostAttachment,
  type ClubPostMediaAttachment,
  type ClubPostRow,
} from "./postTypes";

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
  const rows = (data ?? []) as ClubPostRow[];
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
  const kind = clubPostMediaKind(file.type);
  if (kind === null || !CLUB_POST_ACCEPT_MIME.includes(file.type)) {
    throw new ClubMediaError("type", `Unsupported file type: ${file.type}`);
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

  const dimensions = kind === "image" ? await readImageSize(file) : null;

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
